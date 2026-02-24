import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { deduplicateLeads, buildBulkPayloads } from "@/lib/lead-utils";

export const dynamic = "force-dynamic";

/**
 * POST /api/orchestrate — Full GTM campaign orchestrator (non-streaming).
 *
 * Pipeline: Query Supabase → Validate + Dedup → Bulk Upload (500/batch) → Activate
 *
 * Body: {
 *   ville: string,                  // city filter (e.g. "Paris")
 *   niche: string,                  // verticale ID or category keyword
 *   count: number,                  // max leads to upload
 *   campaignId?: string,            // existing campaign ID (defaults to env)
 *   campaignName?: string,          // create new campaign with this name
 *   emailAccounts?: string[],       // Instantly email account IDs to assign
 *   autoLaunch?: boolean,           // activate campaign after upload (default: true)
 * }
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

  if (!apiKey) {
    return NextResponse.json(
      { error: "INSTANTLY_API_KEY not configured" },
      { status: 500 },
    );
  }

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
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ville = body.ville?.trim() || "";
  const niche = body.niche?.trim() || "";
  const count = Math.min(Math.max(body.count ?? 500, 1), 10000);

  if (!ville && !niche) {
    return NextResponse.json(
      { error: "At least one of 'ville' or 'niche' is required" },
      { status: 400 },
    );
  }

  try {
    // ─── Step 1: Resolve or create campaign ───
    let campaignId = body.campaignId || defaultCampaignId || "";

    if (body.campaignName && !body.campaignId) {
      const newCampaign = (await instantlyFetch("/campaigns", "POST", {
        name: body.campaignName,
      })) as InstantlyCampaignResponse;
      campaignId = newCampaign.id;
    }

    if (!campaignId) {
      return NextResponse.json(
        { error: "No campaign ID. Provide campaignId, campaignName, or set INSTANTLY_CAMPAIGN_ID" },
        { status: 400 },
      );
    }

    // ─── Step 2: Assign email accounts if provided ───
    if (body.emailAccounts && body.emailAccounts.length > 0) {
      try {
        await instantlyFetch(`/campaigns/${campaignId}/accounts`, "POST", {
          account_ids: body.emailAccounts,
        });
      } catch (err) {
        console.error("Failed to assign email accounts:", err instanceof Error ? err.message : err);
      }
    }

    // ─── Step 3: Query Supabase for matching leads ───
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
      return NextResponse.json(
        { error: `Database error: ${dbError.message}` },
        { status: 500 },
      );
    }

    if (!rawLeads || rawLeads.length === 0) {
      return NextResponse.json({
        success: true,
        campaign: { id: campaignId },
        uploaded: 0,
        errors: 0,
        total: 0,
        skippedInvalid: 0,
        skippedDuplicate: 0,
        message: `No leads with email found for ville="${ville}" niche="${niche}"`,
        filters: { ville, niche, count },
      });
    }

    // ─── Step 3b: Validate + Deduplicate ───
    const { unique: leads, duplicateCount } = deduplicateLeads(rawLeads);
    const skippedInvalid = rawLeads.length - leads.length - duplicateCount;

    if (leads.length === 0) {
      return NextResponse.json({
        success: true,
        campaign: { id: campaignId },
        uploaded: 0,
        errors: 0,
        total: rawLeads.length,
        skippedInvalid,
        skippedDuplicate: duplicateCount,
        message: "All leads filtered out (invalid emails or duplicates)",
        filters: { ville, niche, count },
      });
    }

    // ─── Step 4: Bulk Upload (500/batch) ───
    const batches = buildBulkPayloads(leads, campaignId);
    let totalUploaded = 0;
    let totalErrors = 0;
    let totalSkippedByInstantly = 0;
    const errorDetails: string[] = [];

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      try {
        const result = (await instantlyFetch("/leads", "POST", batch as unknown as Record<string, unknown>)) as InstantlyBulkResponse;

        totalUploaded += result.leads_uploaded ?? batch.leads.length;
        totalSkippedByInstantly += (result.already_in_campaign ?? 0) + (result.duplicate_email_count ?? 0);
        totalErrors += result.invalid_email_count ?? 0;
      } catch (err) {
        totalErrors += batch.leads.length;
        if (errorDetails.length < 5) {
          errorDetails.push(err instanceof Error ? err.message : "network error");
        }
      }
    }

    // ─── Step 5: Auto-launch campaign ───
    let campaignLaunched = false;
    let launchError: string | undefined;
    const shouldLaunch = body.autoLaunch !== false;

    if (shouldLaunch && totalUploaded > 0) {
      try {
        await instantlyFetch(`/campaigns/${campaignId}/activate`, "POST");
        campaignLaunched = true;
      } catch (err) {
        launchError = err instanceof Error ? err.message : "Failed to activate campaign";
      }
    }

    return NextResponse.json({
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
    return NextResponse.json(
      { error: message },
      { status: 502 },
    );
  }
}
