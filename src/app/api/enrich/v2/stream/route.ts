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
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const BATCH_SIZE = 3;
const LEAD_TIMEOUT_MS = 120_000; // 2 min per lead — skip if exceeded

/* ------------------------------------------------------------------ */
/*  Request body                                                       */
/* ------------------------------------------------------------------ */

interface EnrichStreamRequest {
  // Existing (backward compat)
  category?: string;
  city?: string;
  leadIds?: string[];
  limit?: number;
  sources?: string[];
  stopOnConfidence?: number;
  useKaspr?: boolean;
  minScoreForPaid?: number;
  // New: multi-select filters
  categories?: string[];
  cities?: string[];
}

/* ------------------------------------------------------------------ */
/*  Per-lead timeout wrapper                                           */
/* ------------------------------------------------------------------ */

function enrichWithTimeout(
  lead: EnrichmentLeadInput,
  config: WaterfallConfig,
): Promise<EnrichmentPipelineResult> {
  return Promise.race([
    runWaterfall(lead, config),
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error("LEAD_TIMEOUT")), LEAD_TIMEOUT_MS),
    ),
  ]);
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

  // ----------------------------------------------------------------
  // Query leads needing enrichment
  // ONLY pending leads — failed/skipped/enriched are excluded
  // ----------------------------------------------------------------
  let query = supabase
    .from("gtm_leads")
    .select("id, name, website, email, phone, city, category, score, enrichment_attempts")
    .not("website", "is", null)
    .neq("website", "")
    .or("email.is.null,email.eq.")
    .eq("enrichment_status", "pending") // <-- KEY: only pending leads
    .limit(limit);

  if (body.leadIds && body.leadIds.length > 0) {
    query = query.in("id", body.leadIds);
  } else {
    // Multi-select categories (new) or single category (backward compat)
    const cats = body.categories && body.categories.length > 0
      ? body.categories
      : body.category
        ? [body.category]
        : [];

    if (cats.length === 1) {
      query = query.ilike("category", `%${cats[0]}%`);
    } else if (cats.length > 1) {
      // OR filter for multiple categories
      const orFilter = cats.map((c) => `category.ilike.%${c}%`).join(",");
      query = query.or(orFilter);
    }

    // Multi-select cities (new) or single city (backward compat)
    const cits = body.cities && body.cities.length > 0
      ? body.cities
      : body.city
        ? [body.city]
        : [];

    if (cits.length === 1) {
      query = query.ilike("city", `%${cits[0]}%`);
    } else if (cits.length > 1) {
      const orFilter = cits.map((c) => `city.ilike.%${c}%`).join(",");
      query = query.or(orFilter);
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
    // Return SSE stream (not JSON) so the frontend reader handles it uniformly
    const enc = new TextEncoder();
    const emptyStream = new ReadableStream({
      start(ctrl) {
        ctrl.enqueue(
          enc.encode(
            `event: done\ndata: ${JSON.stringify({
              processed: 0,
              enriched: 0,
              failed: 0,
              skipped: 0,
              summary: null,
              sourceStats: {},
            })}\n\n`,
          ),
        );
        ctrl.close();
      },
    });
    return new Response(emptyStream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
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
        categories: body.categories ?? (body.category ? [body.category] : []),
        cities: body.cities ?? (body.city ? [body.city] : []),
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
        send("job_created", { jobId, totalLeads: enrichmentLeads.length });

        let enrichedCount = 0;
        let processedCount = 0;
        let failedCount = 0;
        let skippedCount = 0;
        const sourceStats: Record<
          string,
          { tried: number; emailFound: number; phoneFound: number; siretFound: number }
        > = {};
        const allResults: EnrichmentPipelineResult[] = [];

        for (let i = 0; i < enrichmentLeads.length; i += BATCH_SIZE) {
          // Check for pause/stop signal from user
          if (i > 0) {
            const { data: jobCheck } = await supabase
              .from("gtm_enrichment_jobs")
              .select("signal")
              .eq("id", jobId)
              .single();

            const sig = jobCheck?.signal as string | null;
            if (sig === "pause" || sig === "stop") {
              const finalStatus = sig === "stop" ? "stopped" : "paused";

              const partialSummary = {
                totalEmails: allResults.filter((r) => r.bestEmail).length,
                totalPhones: allResults.filter((r) => r.bestPhone).length,
                totalSiret: allResults.filter((r) => r.siret).length,
                totalDirigeants: allResults.filter((r) => r.dirigeant).length,
                avgConfidence: allResults.length > 0
                  ? Math.round(allResults.reduce((sum, r) => sum + r.finalConfidence, 0) / allResults.length)
                  : 0,
                avgDurationMs: allResults.length > 0
                  ? Math.round(allResults.reduce((sum, r) => sum + r.durationMs, 0) / allResults.length)
                  : 0,
              };

              await supabase
                .from("gtm_enrichment_jobs")
                .update({
                  status: finalStatus,
                  signal: null,
                  progress_processed: processedCount,
                  progress_enriched: enrichedCount,
                  summary: partialSummary,
                  source_stats: sourceStats,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", jobId);

              send(finalStatus, {
                reason: sig === "stop" ? "Arrete par l'utilisateur" : "Mis en pause",
                processed: processedCount,
                total: enrichmentLeads.length,
                enriched: enrichedCount,
                failed: failedCount,
                skipped: skippedCount,
                summary: partialSummary,
                sourceStats,
              });
              controller.close();
              return;
            }
          }

          const batch = enrichmentLeads.slice(i, i + BATCH_SIZE);

          // Emit lead_start for each lead in the batch
          for (let b = 0; b < batch.length; b++) {
            const lead = batch[b];
            send("lead_start", {
              leadId: lead.id,
              name: lead.name,
              website: lead.website,
              index: i + b + 1,
              total: enrichmentLeads.length,
            });
          }

          const batchResults = await Promise.allSettled(
            batch.map((lead) => enrichWithTimeout(lead, config)),
          );

          for (let b = 0; b < batchResults.length; b++) {
            const settled = batchResults[b];
            const lead = batch[b];
            processedCount++;

            // ---------------------------------------------------
            // Handle rejected promises (timeout or crash)
            // ---------------------------------------------------
            if (settled.status === "rejected") {
              const errMsg = settled.reason instanceof Error
                ? settled.reason.message
                : "Unknown error";
              const isTimeout = errMsg === "LEAD_TIMEOUT";
              const newStatus = isTimeout ? "skipped" : "failed";

              if (isTimeout) {
                skippedCount++;
              } else {
                failedCount++;
              }

              // Mark lead in DB
              const currentAttempts = (leads.find((l) => l.id === lead.id) as Record<string, unknown>)?.enrichment_attempts;
              const attempts = (typeof currentAttempts === "number" ? currentAttempts : 0) + 1;

              const { error: dbErrFail } = await supabase
                .from("gtm_leads")
                .update({
                  enrichment_status: newStatus,
                  enrichment_attempts: attempts,
                  enrichment_failed_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                })
                .eq("id", lead.id);

              if (dbErrFail) {
                send("db_warning", {
                  leadId: lead.id,
                  error: dbErrFail.message,
                  phase: "mark_failed",
                });
              }

              send("lead_error", {
                leadId: lead.id,
                name: lead.name,
                error: errMsg,
                status: newStatus,
              });

              // Emit progress
              const percent = Math.round((processedCount / enrichmentLeads.length) * 100);
              send("progress", {
                processed: processedCount,
                total: enrichmentLeads.length,
                enriched: enrichedCount,
                failed: failedCount,
                skipped: skippedCount,
                percent,
              });

              continue;
            }

            // ---------------------------------------------------
            // Handle fulfilled promises
            // ---------------------------------------------------
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

            // Determine enrichment outcome
            const foundSomething = !!(result.bestEmail || result.bestPhone || result.siret || result.dirigeant);
            const currentAttempts2 = (leads.find((l) => l.id === result.leadId) as Record<string, unknown>)?.enrichment_attempts;
            const attempts2 = (typeof currentAttempts2 === "number" ? currentAttempts2 : 0) + 1;

            if (foundSomething) {
              enrichedCount++;

              const updateData: Record<string, unknown> = {
                enrichment_status: "enriched",
                enrichment_attempts: attempts2,
                enrichment_source: result.sourcesTried.join(","),
                enrichment_confidence: result.finalConfidence,
                enriched_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              };

              if (result.bestEmail) updateData.email = result.bestEmail;
              if (result.bestPhone) updateData.phone = result.bestPhone;
              if (result.siret) updateData.siret = result.siret;
              if (result.dirigeant) updateData.dirigeant = result.dirigeant;
              if (result.dirigeantLinkedin) updateData.dirigeant_linkedin = result.dirigeantLinkedin;
              if (result.mxProvider) updateData.mx_provider = result.mxProvider;
              updateData.has_mx = result.hasMx;

              const { error: dbErrEnrich } = await supabase
                .from("gtm_leads")
                .update(updateData)
                .eq("id", result.leadId);

              if (dbErrEnrich) {
                send("db_warning", {
                  leadId: result.leadId,
                  error: dbErrEnrich.message,
                  phase: "save_enriched",
                });
              }
            } else {
              // Nothing found — mark as failed
              failedCount++;

              const { error: dbErrNone } = await supabase
                .from("gtm_leads")
                .update({
                  enrichment_status: "failed",
                  enrichment_attempts: attempts2,
                  enrichment_failed_at: new Date().toISOString(),
                  enrichment_source: result.sourcesTried.join(","),
                  updated_at: new Date().toISOString(),
                })
                .eq("id", result.leadId);

              if (dbErrNone) {
                send("db_warning", {
                  leadId: result.leadId,
                  error: dbErrNone.message,
                  phase: "mark_failed",
                });
              }
            }

            // Emit lead result
            send("lead_done", {
              leadId: result.leadId,
              name: lead.name,
              status: foundSomething ? "enriched" : "failed",
              bestEmail: result.bestEmail ?? null,
              bestPhone: result.bestPhone ?? null,
              dirigeant: result.dirigeant ?? null,
              siret: result.siret ?? null,
              confidence: result.finalConfidence,
              sourcesTried: result.sourcesTried,
            });

            // Emit progress after each lead
            const percent = Math.round((processedCount / enrichmentLeads.length) * 100);
            send("progress", {
              processed: processedCount,
              total: enrichmentLeads.length,
              enriched: enrichedCount,
              failed: failedCount,
              skipped: skippedCount,
              percent,
            });
          }

          // Update job progress in DB (fire-and-forget with error handling)
          supabase
            .from("gtm_enrichment_jobs")
            .update({
              progress_processed: processedCount,
              progress_enriched: enrichedCount,
              updated_at: new Date().toISOString(),
            })
            .eq("id", jobId)
            .then(({ error: dbErr }) => {
              if (dbErr) {
                send("db_warning", {
                  error: dbErr.message,
                  phase: "job_progress",
                });
              }
            });
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

        // Persist individual lead results for restore on page revisit
        const leadResults = allResults.map((r) => ({
          leadId: r.leadId,
          bestEmail: r.bestEmail ?? null,
          bestPhone: r.bestPhone ?? null,
          dirigeant: r.dirigeant ?? null,
          siret: r.siret ?? null,
          confidence: r.finalConfidence,
          sourcesTried: r.sourcesTried,
        }));

        // Mark job completed in DB
        await supabase
          .from("gtm_enrichment_jobs")
          .update({
            status: "completed",
            progress_processed: processedCount,
            progress_enriched: enrichedCount,
            summary,
            source_stats: sourceStats,
            lead_results: leadResults,
            updated_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          })
          .eq("id", jobId);

        // Emit done with full stats
        send("done", {
          processed: processedCount,
          enriched: enrichedCount,
          failed: failedCount,
          skipped: skippedCount,
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
