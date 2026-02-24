import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * POST /api/orchestrate/stream — Streaming GTM orchestrator with SSE progress.
 *
 * Same logic as /api/orchestrate but streams real-time progress events:
 *   step: { step, message }           — current step being executed
 *   progress: { uploaded, errors, total } — lead upload progress
 *   done: { ...full result }          — final result
 *   error: { error }                  — fatal error
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

        const { data: leads, error: dbError } = await query;

        if (dbError) {
          send("error", { error: `Database error: ${dbError.message}` });
          controller.close();
          return;
        }

        if (!leads || leads.length === 0) {
          send("done", {
            success: true,
            campaign: { id: campaignId },
            uploaded: 0,
            errors: 0,
            total: 0,
            campaignLaunched: false,
            message: `Aucun lead avec email trouvé pour ville="${ville}" niche="${niche}"`,
            filters: { ville, niche, count },
          });
          controller.close();
          return;
        }

        send("step", { step: 3, message: `${leads.length} leads trouvés avec email` });

        // ─── Step 4: Upload leads ───
        send("step", { step: 4, message: `Upload de ${leads.length} leads vers Instantly...` });

        let uploaded = 0;
        let errors = 0;
        const errorDetails: string[] = [];

        for (let i = 0; i < leads.length; i++) {
          const lead = leads[i];
          if (!lead.email || lead.email.trim() === "") continue;

          const parts = (lead.name || "").trim().split(/\s+/);
          const firstName = parts.length >= 2 ? parts[0] : (lead.name || "").trim().slice(0, 20) || "Contact";

          const payload: Record<string, string> = {
            email: lead.email.trim(),
            first_name: firstName,
            company_name: lead.name || "",
            campaign: campaignId,
          };

          if (lead.website) payload.website = lead.website;
          if (lead.city) payload.city = lead.city;
          if (lead.phone) payload.phone = lead.phone;
          if (lead.category) payload.lt_category = lead.category;

          try {
            const resp = await fetch(`${INSTANTLY_API_BASE}/leads`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(payload),
            });

            if (resp.ok) {
              uploaded++;
            } else {
              errors++;
              if (errorDetails.length < 5) {
                const errText = await resp.text().catch(() => "unknown");
                errorDetails.push(`${resp.status}: ${errText.slice(0, 100)}`);
              }
            }
          } catch (err) {
            errors++;
            if (errorDetails.length < 5) {
              errorDetails.push(err instanceof Error ? err.message : "network error");
            }
          }

          // Send progress every 5 leads or on last one
          if ((i + 1) % 5 === 0 || i === leads.length - 1) {
            send("progress", {
              uploaded,
              errors,
              current: i + 1,
              total: leads.length,
              percent: Math.round(((i + 1) / leads.length) * 100),
            });
          }
        }

        send("step", { step: 4, message: `Upload terminé: ${uploaded} OK, ${errors} erreurs` });

        // ─── Step 5: Auto-launch campaign ───
        let campaignLaunched = false;
        let launchError: string | undefined;
        const shouldLaunch = body.autoLaunch !== false;

        if (shouldLaunch && uploaded > 0) {
          send("step", { step: 5, message: "Activation de la campagne..." });
          try {
            await instantlyFetch(`/campaigns/${campaignId}/activate`, "POST");
            campaignLaunched = true;
            send("step", { step: 5, message: "Campagne activée ! Les emails vont partir." });
          } catch (err) {
            launchError = err instanceof Error ? err.message : "Failed to activate";
            send("step", { step: 5, message: `Avertissement: ${launchError}` });
          }
        } else if (uploaded === 0) {
          send("step", { step: 5, message: "Aucun lead uploadé — campagne non activée" });
        }

        // ─── Final result ───
        send("done", {
          success: true,
          campaign: { id: campaignId, name: body.campaignName || null },
          uploaded,
          errors,
          total: leads.length,
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
