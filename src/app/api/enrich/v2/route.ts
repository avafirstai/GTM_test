import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Import waterfall engine — registers all sources on import
import {
  runWaterfall,
  DEFAULT_WATERFALL_CONFIG,
} from "@/lib/enrichment";
import type {
  EnrichmentLeadInput,
  WaterfallConfig,
  EnrichmentPipelineResult,
} from "@/lib/enrichment";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // Up to 120s for batch processing

/**
 * POST /api/enrich/v2 — Waterfall enrichment engine (8 sources)
 *
 * Body: {
 *   category?: string,
 *   city?: string,
 *   leadIds?: string[],
 *   limit?: number,                 // Max leads (default 20, max 100)
 *   sources?: string[],             // Override which sources to use
 *   stopOnConfidence?: number,       // Default 80
 *   useKaspr?: boolean,             // Default false (opt-in — saves credits)
 *   minScoreForPaid?: number,       // Default 30
 * }
 *
 * Returns detailed results per source with confidence scoring.
 */

interface EnrichV2Request {
  category?: string;
  city?: string;
  leadIds?: string[];
  limit?: number;
  sources?: string[];
  stopOnConfidence?: number;
  useKaspr?: boolean;
  minScoreForPaid?: number;
}

export async function POST(request: Request) {
  let body: EnrichV2Request;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const limit = Math.min(Math.max(body.limit ?? 20, 1), 500);

  // Build waterfall config
  const config: WaterfallConfig = {
    ...DEFAULT_WATERFALL_CONFIG,
    stopOnConfidence: body.stopOnConfidence ?? 80,
    useKaspr: body.useKaspr ?? false,
    minScoreForPaid: body.minScoreForPaid ?? 30,
  };

  // Override source enablement if specified
  if (body.sources && body.sources.length > 0) {
    config.sources = config.sources.map((s) => ({
      ...s,
      enabled: body.sources!.includes(s.name),
    }));
  }

  // Query leads needing enrichment (have website, missing email)
  let query = supabase
    .from("gtm_leads")
    .select("id, name, website, email, phone, city, category, score")
    .not("website", "is", null)
    .neq("website", "")
    .or("email.is.null,email.eq.")
    .limit(limit);

  // Apply filters
  if (body.leadIds && body.leadIds.length > 0) {
    query = query.in("id", body.leadIds);
  } else {
    if (body.category) {
      query = query.ilike("category", `%${body.category}%`);
    }
    if (body.city) {
      query = query.ilike("city", `%${body.city}%`);
    }
  }

  const { data: leads, error } = await query;

  if (error) {
    return NextResponse.json(
      { success: false, error: "Database query failed" },
      { status: 500 },
    );
  }

  if (!leads || leads.length === 0) {
    return NextResponse.json({
      success: true,
      processed: 0,
      enriched: 0,
      results: [],
      sourceStats: {},
      message:
        "Aucun lead a enrichir (tous ont deja un email ou pas de site web)",
    });
  }

  // Convert to EnrichmentLeadInput
  const enrichmentLeads: EnrichmentLeadInput[] = leads.map((lead) => ({
    id: lead.id,
    name: lead.name || "",
    website: lead.website,
    city: lead.city || undefined,
    category: lead.category || undefined,
    score: lead.score ?? undefined,
    email: lead.email || undefined,
    phone: lead.phone || undefined,
  }));

  // Run waterfall for each lead (sequential batches of 3)
  const allResults: EnrichmentPipelineResult[] = [];
  const BATCH_SIZE = 3;
  let enrichedCount = 0;

  // Source-level stats
  const sourceStats: Record<
    string,
    { tried: number; emailFound: number; phoneFound: number; siretFound: number }
  > = {};

  for (let i = 0; i < enrichmentLeads.length; i += BATCH_SIZE) {
    const batch = enrichmentLeads.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map((lead) => runWaterfall(lead, config)),
    );

    for (const settled of batchResults) {
      if (settled.status !== "fulfilled") continue;
      const result = settled.value;
      allResults.push(result);

      // Update source stats
      for (const sr of result.allResults) {
        if (!sourceStats[sr.source]) {
          sourceStats[sr.source] = {
            tried: 0,
            emailFound: 0,
            phoneFound: 0,
            siretFound: 0,
          };
        }
        sourceStats[sr.source].tried++;
        if (sr.email) sourceStats[sr.source].emailFound++;
        if (sr.phone) sourceStats[sr.source].phoneFound++;
        if (sr.siret) sourceStats[sr.source].siretFound++;
      }

      // Update Supabase with best results
      if (result.bestEmail || result.bestPhone || result.siret || result.dirigeant) {
        enrichedCount++;

        const updateData: Record<string, unknown> = {};
        if (result.bestEmail) updateData.email = result.bestEmail;
        if (result.bestPhone) updateData.phone = result.bestPhone;
        if (result.siret) updateData.siret = result.siret;
        if (result.dirigeant) updateData.dirigeant = result.dirigeant;
        if (result.dirigeantLinkedin) updateData.dirigeant_linkedin = result.dirigeantLinkedin;
        if (result.mxProvider) updateData.mx_provider = result.mxProvider;
        updateData.has_mx = result.hasMx;
        updateData.enrichment_source = result.sourcesTried.join(",");
        updateData.enrichment_confidence = result.finalConfidence;
        updateData.enriched_at = new Date().toISOString();

        await supabase
          .from("gtm_leads")
          .update(updateData)
          .eq("id", result.leadId);
      }
    }
  }

  // Summarize results
  const summary = {
    totalEmails: allResults.filter((r) => r.bestEmail).length,
    totalPhones: allResults.filter((r) => r.bestPhone).length,
    totalSiret: allResults.filter((r) => r.siret).length,
    totalDirigeants: allResults.filter((r) => r.dirigeant).length,
    avgConfidence:
      allResults.length > 0
        ? Math.round(
            allResults.reduce((sum, r) => sum + r.finalConfidence, 0) /
              allResults.length,
          )
        : 0,
    avgDurationMs:
      allResults.length > 0
        ? Math.round(
            allResults.reduce((sum, r) => sum + r.durationMs, 0) /
              allResults.length,
          )
        : 0,
  };

  return NextResponse.json({
    success: true,
    processed: allResults.length,
    enriched: enrichedCount,
    summary,
    sourceStats,
    results: allResults.map((r) => ({
      leadId: r.leadId,
      bestEmail: r.bestEmail,
      bestPhone: r.bestPhone,
      dirigeant: r.dirigeant,
      siret: r.siret,
      mxProvider: r.mxProvider,
      hasMx: r.hasMx,
      finalConfidence: r.finalConfidence,
      sourcesTried: r.sourcesTried,
      durationMs: r.durationMs,
      sourceResults: r.allResults.map((sr) => ({
        source: sr.source,
        email: sr.email,
        phone: sr.phone,
        dirigeant: sr.dirigeant,
        siret: sr.siret,
        confidence: sr.confidence,
        durationMs: sr.durationMs,
      })),
    })),
    timestamp: new Date().toISOString(),
  });
}
