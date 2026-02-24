import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Import waterfall engine
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
export const maxDuration = 300; // 5 min for large batches

/* ------------------------------------------------------------------ */
/*  Request body                                                       */
/* ------------------------------------------------------------------ */

interface EnrichStreamRequest {
  category?: string;
  city?: string;
  leadIds?: string[];
  limit?: number;
  sources?: string[];
  stopOnConfidence?: number;
  useKaspr?: boolean;
  minScoreForPaid?: number;
}

/* ------------------------------------------------------------------ */
/*  POST /api/enrich/v2/stream — SSE streaming enrichment              */
/* ------------------------------------------------------------------ */

export async function POST(request: Request) {
  let body: EnrichStreamRequest;
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

  // Query leads needing enrichment
  let query = supabase
    .from("gtm_leads")
    .select("id, name, website, email, phone, city, category, score")
    .not("website", "is", null)
    .neq("website", "")
    .or("email.is.null,email.eq.")
    .limit(limit);

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
      message: "Aucun lead a enrichir",
    });
  }

  // Create job in Supabase for persistence
  const { data: job, error: jobError } = await supabase
    .from("gtm_enrichment_jobs")
    .insert({
      status: "running",
      config: {
        limit,
        sources: body.sources,
        category: body.category,
        city: body.city,
        useKaspr: body.useKaspr,
        stopOnConfidence: body.stopOnConfidence,
      },
      progress_total: leads.length,
      progress_processed: 0,
      progress_enriched: 0,
    })
    .select("id")
    .single();

  if (jobError || !job) {
    return NextResponse.json(
      { success: false, error: "Failed to create enrichment job" },
      { status: 500 },
    );
  }

  const jobId = job.id as string;

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

  // SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: Record<string, unknown>) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      }

      try {
        // Emit job_created
        send("job_created", { jobId });

        const BATCH_SIZE = 3;
        let enrichedCount = 0;
        let processedCount = 0;
        const sourceStats: Record<
          string,
          { tried: number; emailFound: number; phoneFound: number; siretFound: number }
        > = {};
        const allResults: EnrichmentPipelineResult[] = [];

        for (let i = 0; i < enrichmentLeads.length; i += BATCH_SIZE) {
          const batch = enrichmentLeads.slice(i, i + BATCH_SIZE);
          const batchResults = await Promise.allSettled(
            batch.map((lead) => runWaterfall(lead, config)),
          );

          for (const settled of batchResults) {
            if (settled.status !== "fulfilled") continue;
            const result = settled.value;
            allResults.push(result);
            processedCount++;

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

            // Emit lead result
            send("lead_result", {
              leadId: result.leadId,
              bestEmail: result.bestEmail,
              bestPhone: result.bestPhone,
              dirigeant: result.dirigeant,
              siret: result.siret,
              confidence: result.finalConfidence,
              sourcesTried: result.sourcesTried,
            });
          }

          // Emit progress after each batch
          const percent = Math.round((processedCount / enrichmentLeads.length) * 100);
          send("progress", {
            processed: processedCount,
            total: enrichmentLeads.length,
            enriched: enrichedCount,
            percent,
          });

          // Update job progress in DB (fire-and-forget)
          supabase
            .from("gtm_enrichment_jobs")
            .update({
              progress_processed: processedCount,
              progress_enriched: enrichedCount,
              updated_at: new Date().toISOString(),
            })
            .eq("id", jobId)
            .then(() => {});
        }

        // Build summary
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

        // Mark job completed in DB
        await supabase
          .from("gtm_enrichment_jobs")
          .update({
            status: "completed",
            progress_processed: processedCount,
            progress_enriched: enrichedCount,
            summary,
            source_stats: sourceStats,
            updated_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          })
          .eq("id", jobId);

        // Emit done
        send("done", {
          processed: processedCount,
          enriched: enrichedCount,
          summary,
          sourceStats,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";

        // Mark job failed in DB
        await supabase
          .from("gtm_enrichment_jobs")
          .update({
            status: "failed",
            error: errorMessage,
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);

        send("error", { message: errorMessage });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
