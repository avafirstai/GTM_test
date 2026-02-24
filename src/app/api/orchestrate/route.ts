import { NextResponse } from "next/server";
import {
  instantlyFetch,
  queryLeads,
  deduplicateLeads,
  buildBulkPayloads,
  type OrchestrateBody,
  type InstantlyCampaignResponse,
  type InstantlyBulkResponse,
  type InstantlyBulkPayload,
} from "@/lib/lead-utils";

export const dynamic = "force-dynamic";

/**
 * POST /api/orchestrate — Full GTM campaign orchestrator (non-streaming).
 *
 * Pipeline: Query Supabase → Validate + Dedup → Bulk Upload (500/batch) → Activate
 */
export async function POST(request: Request) {
  const apiKey = process.env.INSTANTLY_API_KEY;
  const defaultCampaignId = process.env.INSTANTLY_CAMPAIGN_ID;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Instantly API key not configured" },
      { status: 500 },
    );
  }

  let body: OrchestrateBody;
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
        { error: "No campaign ID provided" },
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
        console.error("[Orchestrate] Failed to assign email accounts:", err instanceof Error ? err.message : "unknown");
      }
    }

    // ─── Step 3: Query Supabase for matching leads ───
    const { data: rawLeads, error: dbError } = await queryLeads(ville, niche, count);

    if (dbError) {
      return NextResponse.json(
        { error: "Database query failed" },
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
        message: "No leads with email found for the given filters",
        filters: { ville, niche, count },
      });
    }

    // ─── Step 3b: Validate + Deduplicate ───
    const { unique: leads, duplicateCount, invalidCount } = deduplicateLeads(rawLeads);

    if (leads.length === 0) {
      return NextResponse.json({
        success: true,
        campaign: { id: campaignId },
        uploaded: 0,
        errors: 0,
        total: rawLeads.length,
        skippedInvalid: invalidCount,
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
        const result = (await instantlyFetch(
          "/leads",
          "POST",
          batch as unknown as Record<string, unknown>,
        )) as InstantlyBulkResponse;

        totalUploaded += result.leads_uploaded ?? batch.leads.length;
        totalSkippedByInstantly += (result.already_in_campaign ?? 0) + (result.duplicate_email_count ?? 0);
        totalErrors += result.invalid_email_count ?? 0;
      } catch (err) {
        totalErrors += batch.leads.length;
        if (errorDetails.length < 5) {
          errorDetails.push(`Batch ${i + 1}: upload failed`);
        }
        console.error(`[Orchestrate] Batch ${i + 1} failed:`, err instanceof Error ? err.message : "unknown");
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
        launchError = "Campaign activation failed";
        console.error("[Orchestrate] Activation failed:", err instanceof Error ? err.message : "unknown");
      }
    }

    return NextResponse.json({
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
    console.error("[Orchestrate] Unexpected error:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json(
      { error: "Orchestration failed" },
      { status: 502 },
    );
  }
}
