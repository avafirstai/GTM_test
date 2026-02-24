import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * POST /api/orchestrate — Full GTM campaign orchestrator.
 *
 * Takes a ville + niche + count → queries Supabase leads → uploads to Instantly campaign.
 * Optionally creates a new campaign or uses an existing one.
 * Optionally assigns specific email accounts.
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
 *
 * Returns: { success, campaign, uploaded, errors, leads, campaignLaunched }
 */

const INSTANTLY_API_BASE = "https://api.instantly.ai/api/v2";

// Map verticale IDs to Google Maps category keywords for Supabase filtering
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
      // Create a new campaign in Instantly
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
        // Non-fatal: log but continue
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

    // Filter by ville (city)
    if (ville) {
      query = query.ilike("city", `%${ville}%`);
    }

    // Filter by niche (verticale categories or direct category match)
    if (niche) {
      const categories = VERTICALE_CATEGORIES[niche];
      if (categories && categories.length > 0) {
        // Build OR filter for all category keywords
        const orFilter = categories.map((cat) => `category.ilike.%${cat}%`).join(",");
        query = query.or(orFilter);
      } else {
        // Direct category match
        query = query.ilike("category", `%${niche}%`);
      }
    }

    const { data: leads, error: dbError } = await query;

    if (dbError) {
      return NextResponse.json(
        { error: `Database error: ${dbError.message}` },
        { status: 500 },
      );
    }

    if (!leads || leads.length === 0) {
      return NextResponse.json({
        success: true,
        campaign: { id: campaignId },
        uploaded: 0,
        errors: 0,
        total: 0,
        message: `No leads with email found for ville="${ville}" niche="${niche}"`,
        filters: { ville, niche, count },
      });
    }

    // ─── Step 4: Upload leads to Instantly ───
    let uploaded = 0;
    let errors = 0;
    const errorDetails: string[] = [];

    for (const lead of leads) {
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
    }

    // ─── Step 5: Auto-launch campaign if leads were uploaded ───
    let campaignLaunched = false;
    let launchError: string | undefined;
    const shouldLaunch = body.autoLaunch !== false; // default: true

    if (shouldLaunch && uploaded > 0) {
      try {
        await instantlyFetch(`/campaigns/${campaignId}/activate`, "POST");
        campaignLaunched = true;
      } catch (err) {
        // Non-fatal: campaign created + leads uploaded, just not activated
        launchError = err instanceof Error ? err.message : "Failed to activate campaign";
      }
    }

    return NextResponse.json({
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
    return NextResponse.json(
      { error: message },
      { status: 502 },
    );
  }
}
