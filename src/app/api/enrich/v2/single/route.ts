import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Import waterfall engine — registers all sources on import
import { runWaterfall, DEFAULT_WATERFALL_CONFIG } from "@/lib/enrichment";
import type { EnrichmentLeadInput } from "@/lib/enrichment";
import { parseExistingDecisionMakers, mergeDecisionMakers } from "@/lib/enrichment/merge-utils";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // Single lead — 120s to guarantee full waterfall incl. Kaspr

/**
 * POST /api/enrich/v2/single — Waterfall enrichment for ONE lead
 *
 * Body: { leadId: string }
 *
 * Runs the full 7-source waterfall and persists results (success AND failure).
 * Designed to be called in parallel from LeadsTable (10 concurrent).
 */

interface EnrichSingleRequest {
  leadId: string;
}

export async function POST(request: Request) {
  let body: EnrichSingleRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.leadId) {
    return NextResponse.json({ success: false, error: "leadId is required" }, { status: 400 });
  }

  // Fetch lead from Supabase
  const { data: lead, error: fetchError } = await supabase
    .from("gtm_leads")
    .select("id, name, website, email, phone, city, category, score, decision_makers, email_dirigeant, dirigeant, dirigeant_linkedin")
    .eq("id", body.leadId)
    .single();

  if (fetchError || !lead) {
    return NextResponse.json(
      { success: false, error: "Lead not found", leadId: body.leadId },
      { status: 404 },
    );
  }

  // Skip if already has email or no website — but return EXISTING data (not nulls)
  if (lead.email) {
    return NextResponse.json({
      success: true,
      leadId: lead.id,
      bestEmail: lead.email,
      bestPhone: lead.phone,
      dirigeant: (lead as Record<string, unknown>).dirigeant || null,
      emailDirigeant: (lead as Record<string, unknown>).email_dirigeant || null,
      siret: null,
      confidence: 100,
      sourcesTried: ["existing"],
      durationMs: 0,
      skipped: true,
      decisionMakers: parseExistingDecisionMakers((lead as Record<string, unknown>).decision_makers),
    });
  }

  if (!lead.website) {
    return NextResponse.json({
      success: false,
      leadId: lead.id,
      error: "Pas de site web",
      bestEmail: null,
      bestPhone: null,
      dirigeant: null,
      siret: null,
      confidence: 0,
      sourcesTried: [],
      durationMs: 0,
    });
  }

  // Convert to EnrichmentLeadInput
  const enrichmentLead: EnrichmentLeadInput = {
    id: lead.id,
    name: lead.name || "",
    website: lead.website,
    city: lead.city || undefined,
    category: lead.category || undefined,
    score: lead.score ?? undefined,
    phone: lead.phone || undefined,
  };

  // Run the full waterfall
  try {
    const result = await runWaterfall(enrichmentLead, DEFAULT_WATERFALL_CONFIG);

    const foundSomething =
      result.bestEmail || result.bestPhone || result.siret || result.dirigeant;

    // Merge new DMs with existing ones from DB (preserve & deduplicate)
    const existingDMs = parseExistingDecisionMakers((lead as Record<string, unknown>).decision_makers);
    const mergedDMs = mergeDecisionMakers(existingDMs, result.decisionMakers ?? []);

    // Persist to Supabase — both success AND failure
    const updateData: Record<string, unknown> = {
      enrichment_source: result.sourcesTried.join(","),
      enrichment_confidence: foundSomething ? result.finalConfidence : 0,
      enrichment_status: foundSomething ? "enriched" : (existingDMs.length > 0 ? "enriched" : "failed"),
      enriched_at: new Date().toISOString(),
      has_mx: result.hasMx,
    };

    // Persist best email (prefer dirigeant > global for main email column)
    if (result.bestEmail) updateData.email = result.bestEmail;
    // Persist dirigeant email separately — preserve existing if waterfall found nothing new
    if (result.emailGlobal) updateData.email_global = result.emailGlobal;
    if (result.emailDirigeant) {
      updateData.email_dirigeant = result.emailDirigeant;
    } else if ((lead as Record<string, unknown>).email_dirigeant) {
      updateData.email_dirigeant = (lead as Record<string, unknown>).email_dirigeant;
    }
    if (result.bestPhone) updateData.phone = result.bestPhone;
    if (result.siret) updateData.siret = result.siret;
    // Preserve existing dirigeant scalars if waterfall found nothing new
    if (result.dirigeant) {
      updateData.dirigeant = result.dirigeant;
    } else if ((lead as Record<string, unknown>).dirigeant) {
      updateData.dirigeant = (lead as Record<string, unknown>).dirigeant;
    }
    if (result.dirigeantLinkedin) {
      updateData.dirigeant_linkedin = result.dirigeantLinkedin;
    } else if ((lead as Record<string, unknown>).dirigeant_linkedin) {
      updateData.dirigeant_linkedin = (lead as Record<string, unknown>).dirigeant_linkedin;
    }
    if (result.mxProvider) updateData.mx_provider = result.mxProvider;
    // ALWAYS write merged DMs (merged ≥ existing, never loses data)
    if (mergedDMs.length > 0) {
      updateData.decision_makers = mergedDMs;
    }

    // Await DB write — guarantee persistence before responding
    const { error: updateError } = await supabase
      .from("gtm_leads")
      .update(updateData)
      .eq("id", lead.id);

    if (updateError) {
      console.error(`[enrich/v2/single] DB update failed for ${lead.id}:`, updateError.message);
    }

    return NextResponse.json({
      success: true,
      leadId: lead.id,
      bestEmail: result.bestEmail,
      emailGlobal: result.emailGlobal,
      emailDirigeant: result.emailDirigeant,
      bestPhone: result.bestPhone,
      dirigeant: result.dirigeant,
      dirigeantLinkedin: result.dirigeantLinkedin,
      siret: result.siret,
      confidence: result.finalConfidence,
      sourcesTried: result.sourcesTried,
      durationMs: result.durationMs,
      decisionMakers: result.decisionMakers ?? [],
    });
  } catch (err) {
    // Waterfall threw — mark as failed (await to guarantee persistence)
    const { error: failUpdateError } = await supabase
      .from("gtm_leads")
      .update({
        enrichment_status: "failed",
        enrichment_confidence: 0,
        enriched_at: new Date().toISOString(),
      })
      .eq("id", lead.id);

    if (failUpdateError) {
      console.error(`[enrich/v2/single] DB failure-update failed for ${lead.id}:`, failUpdateError.message);
    }

    return NextResponse.json({
      success: false,
      leadId: lead.id,
      error: err instanceof Error ? err.message : "Waterfall error",
      bestEmail: null,
      bestPhone: null,
      dirigeant: null,
      siret: null,
      confidence: 0,
      sourcesTried: [],
      durationMs: 0,
    });
  }
}
