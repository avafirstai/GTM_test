import {
  instantlyFetch,
  queryLeads,
  deduplicateLeads,
  buildBulkPayloads,
  type OrchestrateBody,
  type InstantlyCampaignResponse,
  type InstantlyBulkResponse,
} from "@/lib/lead-utils";

export const dynamic = "force-dynamic";

/**
 * POST /api/orchestrate/stream — Streaming GTM orchestrator with SSE progress.
 *
 * Pipeline: Query Supabase → Validate + Dedup → Bulk Upload (500/batch) → Activate
 *
 * Events:
 *   step: { step, message }                        — current step
 *   progress: { uploaded, errors, total, percent }  — batch upload progress
 *   done: { ...full result }                        — final result
 *   error: { error }                                — fatal error
 */
export async function POST(request: Request) {
  const apiKey = process.env.INSTANTLY_API_KEY;
  const defaultCampaignId = process.env.INSTANTLY_CAMPAIGN_ID;

  // Pre-stream validation (returns JSON errors, not SSE)
  let body: OrchestrateBody;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "Instantly API key not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const ville = body.ville?.trim() || "";
  const niche = body.niche?.trim() || "";
  const count = Math.min(Math.max(body.count ?? 500, 1), 10000);

  if (!ville && !niche) {
    return new Response(
      JSON.stringify({ error: "At least one of 'ville' or 'niche' is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Stream SSE response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      }

      try {
        // ─── Step 1: Resolve or create campaign ───
        send("step", { step: 1, message: "Préparation de la campagne..." });

        let campaignId = body.campaignId || defaultCampaignId || "";

        if (body.campaignName && !body.campaignId) {
          send("step", { step: 1, message: `Création campagne "${body.campaignName}"...` });
          const newCampaign = (await instantlyFetch("/campaigns", "POST", {
            name: body.campaignName,
          })) as InstantlyCampaignResponse;
          campaignId = newCampaign.id;
          send("step", { step: 1, message: `Campagne créée: ${campaignId.slice(0, 8)}...` });
        }

        if (!campaignId) {
          send("error", { error: "No campaign ID provided" });
          controller.close();
          return;
        }

        // ─── Step 2: Assign email accounts ───
        if (body.emailAccounts && body.emailAccounts.length > 0) {
          send("step", { step: 2, message: `Assignation de ${body.emailAccounts.length} compte(s) email...` });
          try {
            await instantlyFetch(`/campaigns/${campaignId}/accounts`, "POST", {
              account_ids: body.emailAccounts,
            });
            send("step", { step: 2, message: `${body.emailAccounts.length} compte(s) assigné(s)` });
          } catch (err) {
            send("step", { step: 2, message: `Avertissement: assignation comptes échouée` });
            console.error("[Stream] Account assignment failed:", err instanceof Error ? err.message : "unknown");
          }
        } else {
          send("step", { step: 2, message: "Aucun compte email sélectionné (défaut)" });
        }

        // ─── Step 3: Query Supabase ───
        send("step", { step: 3, message: `Recherche leads: ville="${ville || "toutes"}" niche="${niche || "toutes"}" (max ${count})...` });

        const { data: rawLeads, error: dbError } = await queryLeads(ville, niche, count);

        if (dbError) {
          send("error", { error: "Database query failed" });
          console.error("[Stream] DB error:", dbError);
          controller.close();
          return;
        }

        if (!rawLeads || rawLeads.length === 0) {
          send("done", {
            success: true,
            campaign: { id: campaignId },
            uploaded: 0,
            errors: 0,
            total: 0,
            skippedInvalid: 0,
            skippedDuplicate: 0,
            campaignLaunched: false,
            message: "Aucun lead avec email trouvé pour ces filtres",
            filters: { ville, niche, count },
          });
          controller.close();
          return;
        }

        send("step", { step: 3, message: `${rawLeads.length} leads bruts trouvés` });

        // ─── Step 3b: Validate + Deduplicate ───
        send("step", { step: 3, message: "Validation emails + déduplication..." });

        const { unique: leads, duplicateCount, invalidCount } = deduplicateLeads(rawLeads);

        send("step", { step: 3, message: `${leads.length} leads valides (${invalidCount} invalides, ${duplicateCount} doublons supprimés)` });

        if (leads.length === 0) {
          send("done", {
            success: true,
            campaign: { id: campaignId },
            uploaded: 0,
            errors: 0,
            total: rawLeads.length,
            skippedInvalid: invalidCount,
            skippedDuplicate: duplicateCount,
            campaignLaunched: false,
            message: "Tous les leads ont été filtrés (emails invalides ou doublons)",
            filters: { ville, niche, count },
          });
          controller.close();
          return;
        }

        // ─── Step 4: Bulk Upload (500/batch) ───
        const batches = buildBulkPayloads(leads, campaignId);
        send("step", { step: 4, message: `Upload de ${leads.length} leads en ${batches.length} batch(es) de max 500...` });

        let totalUploaded = 0;
        let totalErrors = 0;
        let totalSkippedByInstantly = 0;
        const errorDetails: string[] = [];

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
          const batch = batches[batchIndex];
          const batchNum = batchIndex + 1;

          send("step", { step: 4, message: `Batch ${batchNum}/${batches.length}: ${batch.leads.length} leads...` });

          try {
            const result = (await instantlyFetch(
              "/leads",
              "POST",
              batch as unknown as Record<string, unknown>,
            )) as InstantlyBulkResponse;

            const batchUploaded = result.leads_uploaded ?? batch.leads.length;
            const batchSkipped = (result.already_in_campaign ?? 0) + (result.duplicate_email_count ?? 0);
            const batchInvalid = result.invalid_email_count ?? 0;

            totalUploaded += batchUploaded;
            totalSkippedByInstantly += batchSkipped;
            totalErrors += batchInvalid;

            send("step", { step: 4, message: `Batch ${batchNum}: ${batchUploaded} uploadés, ${batchSkipped} déjà présents, ${batchInvalid} invalides` });
          } catch (err) {
            totalErrors += batch.leads.length;
            if (errorDetails.length < 5) {
              errorDetails.push(`Batch ${batchNum}: upload failed`);
            }
            send("step", { step: 4, message: `Batch ${batchNum}: ERREUR — upload échoué` });
            console.error(`[Stream] Batch ${batchNum} failed:`, err instanceof Error ? err.message : "unknown");
          }

          // Progress after each batch
          const processedLeads = Math.min((batchIndex + 1) * 500, leads.length);
          send("progress", {
            uploaded: totalUploaded,
            errors: totalErrors,
            current: processedLeads,
            total: leads.length,
            percent: Math.round((processedLeads / leads.length) * 100),
          });
        }

        send("step", { step: 4, message: `Upload terminé: ${totalUploaded} OK, ${totalErrors} erreurs, ${totalSkippedByInstantly} déjà dans Instantly` });

        // ─── Step 5: Auto-launch campaign ───
        let campaignLaunched = false;
        let launchError: string | undefined;
        const shouldLaunch = body.autoLaunch !== false;

        if (shouldLaunch && totalUploaded > 0) {
          send("step", { step: 5, message: "Activation de la campagne..." });
          try {
            await instantlyFetch(`/campaigns/${campaignId}/activate`, "POST");
            campaignLaunched = true;
            send("step", { step: 5, message: "Campagne activée ! Les emails vont partir." });
          } catch (err) {
            launchError = "Campaign activation failed";
            send("step", { step: 5, message: "Avertissement: activation échouée" });
            console.error("[Stream] Activation failed:", err instanceof Error ? err.message : "unknown");
          }
        } else if (totalUploaded === 0) {
          send("step", { step: 5, message: "Aucun lead uploadé — campagne non activée" });
        }

        // ─── Final result ───
        send("done", {
          success: true,
          campaign: { id: campaignId, name: body.campaignName || null },
          uploaded: totalUploaded,
          errors: totalErrors,
          total: rawLeads.length,
          validLeads: leads.length,
          skippedInvalid: invalidCount,
          skippedDuplicate: duplicateCount,
          skippedByInstantly: totalSkippedByInstantly,
          campaignLaunched,
          launchError,
          filters: { ville, niche, count },
          errorDetails: errorDetails.length > 0 ? errorDetails : undefined,
          timestamp: new Date().toISOString(),
        });

      } catch (err) {
        console.error("[Stream] Unexpected error:", err instanceof Error ? err.message : "unknown");
        send("error", { error: "Orchestration failed" });
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
