import { supabase } from "@/lib/supabase";
import { deduplicateLeads, buildBulkPayloads } from "@/lib/lead-utils";

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

const INSTANTLY_API_BASE = "https://api.instantly.ai/api/v2";

const VERTICALE_CATEGORIES: Record<string, string[]> = {
  sante_dentaire: ["dentiste", "cabinet dentaire", "orthodontiste", "chirurgien-dentiste"],
  sante_medical: ["médecin", "cabinet médical", "centre médical", "médecin généraliste"],
  immobilier: ["agence immobilière", "agence de gestion locative", "syndic"],
  juridique: ["avocat", "cabinet d'avocats", "notaire", "huissier"],
  comptable: ["expert-comptable", "cabinet comptable", "cabinet d'audit"],
  formation: ["centre de formation", "auto-école", "école", "organisme de formation"],
  beaute: ["salon de coiffure", "institut de beauté", "spa", "barbier"],
  veterinaire: ["vétérinaire", "clinique vétérinaire"],
  restaurant_hg: ["restaurant", "traiteur", "hôtel restaurant"],
  artisan_premium: ["plombier", "électricien", "serrurier", "chauffagiste"],
  hotellerie: ["hôtel", "résidence hôtelière", "chambre d'hôtes"],
  cinema: ["cinéma", "salle de spectacle", "théâtre"],
  auto_ecole: ["auto-école", "école de conduite"],
  concession_auto: ["concession automobile", "garage automobile"],
  agence_voyage: ["agence de voyage", "tour-opérateur"],
};

interface InstantlyCampaignResponse {
  id: string;
  name: string;
  status: string;
}

interface InstantlyBulkResponse {
  status?: string;
  total_sent?: number;
  leads_uploaded?: number;
  already_in_campaign?: number;
  invalid_email_count?: number;
  duplicate_email_count?: number;
}

async function instantlyFetch(
  endpoint: string,
  method: string = "GET",
  body?: Record<string, unknown>,
): Promise<unknown> {
  const apiKey = process.env.INSTANTLY_API_KEY;
  if (!apiKey) throw new Error("INSTANTLY_API_KEY not configured");

  const resp = await fetch(`${INSTANTLY_API_BASE}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!resp.ok) {
    const errorText = await resp.text().catch(() => "unknown error");
    throw new Error(`Instantly API ${resp.status}: ${errorText.slice(0, 200)}`);
  }

  return resp.json();
}

export async function POST(request: Request) {
  const apiKey = process.env.INSTANTLY_API_KEY;
  const defaultCampaignId = process.env.INSTANTLY_CAMPAIGN_ID;

  // Parse body before starting stream
  let body: {
    ville?: string;
    niche?: string;
    count?: number;
    campaignId?: string;
    campaignName?: string;
    emailAccounts?: string[];
    autoLaunch?: boolean;
  };

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
      JSON.stringify({ error: "INSTANTLY_API_KEY not configured" }),
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
          send("error", { error: "No campaign ID. Provide campaignId, campaignName, or set INSTANTLY_CAMPAIGN_ID" });
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
            send("step", { step: 2, message: `Avertissement: ${err instanceof Error ? err.message : "erreur assignation comptes"}` });
          }
        } else {
          send("step", { step: 2, message: "Aucun compte email sélectionné (défaut)" });
        }

        // ─── Step 3: Query Supabase ───
        send("step", { step: 3, message: `Recherche leads: ville="${ville || "toutes"}" niche="${niche || "toutes"}" (max ${count})...` });

        let query = supabase
          .from("gtm_leads")
          .select("name, email, phone, website, city, category")
          .not("email", "is", null)
          .neq("email", "")
          .limit(count);

        if (ville) {
          query = query.ilike("city", `%${ville}%`);
        }

        if (niche) {
          const categories = VERTICALE_CATEGORIES[niche];
          if (categories && categories.length > 0) {
            const orFilter = categories.map((cat) => `category.ilike.%${cat}%`).join(",");
            query = query.or(orFilter);
          } else {
            query = query.ilike("category", `%${niche}%`);
          }
        }

        const { data: rawLeads, error: dbError } = await query;

        if (dbError) {
          send("error", { error: `Database error: ${dbError.message}` });
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
            message: `Aucun lead avec email trouvé pour ville="${ville}" niche="${niche}"`,
            filters: { ville, niche, count },
          });
          controller.close();
          return;
        }

        send("step", { step: 3, message: `${rawLeads.length} leads bruts trouvés` });

        // ─── Step 3b: Validate + Deduplicate ───
        send("step", { step: 3, message: "Validation emails + déduplication..." });

        const { unique: leads, duplicateCount } = deduplicateLeads(rawLeads);
        const skippedInvalid = rawLeads.length - leads.length - duplicateCount;

        send("step", { step: 3, message: `${leads.length} leads valides (${skippedInvalid} invalides, ${duplicateCount} doublons supprimés)` });

        if (leads.length === 0) {
          send("done", {
            success: true,
            campaign: { id: campaignId },
            uploaded: 0,
            errors: 0,
            total: rawLeads.length,
            skippedInvalid,
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
            const result = (await instantlyFetch("/leads", "POST", batch as unknown as Record<string, unknown>)) as InstantlyBulkResponse;

            const batchUploaded = result.leads_uploaded ?? batch.leads.length;
            const batchSkipped = (result.already_in_campaign ?? 0) + (result.duplicate_email_count ?? 0);
            const batchInvalid = result.invalid_email_count ?? 0;

            totalUploaded += batchUploaded;
            totalSkippedByInstantly += batchSkipped;
            totalErrors += batchInvalid;

            send("step", { step: 4, message: `Batch ${batchNum}: ${batchUploaded} uploadés, ${batchSkipped} déjà présents, ${batchInvalid} invalides` });
          } catch (err) {
            totalErrors += batch.leads.length;
            const errMsg = err instanceof Error ? err.message : "network error";
            if (errorDetails.length < 5) {
              errorDetails.push(`Batch ${batchNum}: ${errMsg}`);
            }
            send("step", { step: 4, message: `Batch ${batchNum}: ERREUR — ${errMsg}` });
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
            launchError = err instanceof Error ? err.message : "Failed to activate";
            send("step", { step: 5, message: `Avertissement: ${launchError}` });
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
          skippedInvalid,
          skippedDuplicate: duplicateCount,
          skippedByInstantly: totalSkippedByInstantly,
          campaignLaunched,
          launchError,
          filters: { ville, niche, count },
          errorDetails: errorDetails.length > 0 ? errorDetails : undefined,
          timestamp: new Date().toISOString(),
        });

      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`));
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
