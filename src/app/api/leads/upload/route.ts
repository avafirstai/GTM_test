import { NextResponse } from "next/server";
import {
  instantlyFetch,
  validateEmail,
  parseName,
  type InstantlyBulkResponse,
  type InstantlyBulkPayload,
} from "@/lib/lead-utils";

export const dynamic = "force-dynamic";

/**
 * POST /api/leads/upload — Upload specific leads directly to Instantly campaign.
 *
 * Input: { leads: [{ email, name?, phone?, website?, city?, category? }] }
 * Uses the configured INSTANTLY_CAMPAIGN_ID.
 */

interface UploadLeadInput {
  email: string;
  name?: string;
  phone?: string;
  website?: string;
  city?: string;
  category?: string;
}

interface UploadBody {
  leads: UploadLeadInput[];
  campaignId?: string;
}

export async function POST(request: Request) {
  const apiKey = process.env.INSTANTLY_API_KEY;
  const defaultCampaignId = process.env.INSTANTLY_CAMPAIGN_ID;

  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: "Instantly API key not configured" },
      { status: 500 },
    );
  }

  let body: UploadBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (!body.leads || !Array.isArray(body.leads) || body.leads.length === 0) {
    return NextResponse.json(
      { success: false, error: "leads array is required and must not be empty" },
      { status: 400 },
    );
  }

  const campaignId = body.campaignId || defaultCampaignId;
  if (!campaignId) {
    return NextResponse.json(
      { success: false, error: "No campaign ID configured — set INSTANTLY_CAMPAIGN_ID" },
      { status: 400 },
    );
  }

  // Build Instantly-compatible leads
  const BATCH_SIZE = 500;
  const validLeads: { email: string; first_name: string; last_name: string; company_name: string; phone?: string; website?: string; custom_variables?: Record<string, string> }[] = [];
  let invalidCount = 0;

  const seen = new Set<string>();
  for (const lead of body.leads) {
    const email = validateEmail(lead.email);
    if (!email) {
      invalidCount++;
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);

    const { firstName, lastName, companyName } = parseName(lead.name);
    const payload: typeof validLeads[number] = {
      email,
      first_name: firstName,
      last_name: lastName,
      company_name: companyName,
    };
    if (lead.phone) payload.phone = lead.phone;
    if (lead.website) payload.website = lead.website;

    const customVars: Record<string, string> = {};
    if (lead.city) customVars.city = lead.city;
    if (lead.category) customVars.lt_category = lead.category;
    if (Object.keys(customVars).length > 0) payload.custom_variables = customVars;

    validLeads.push(payload);
  }

  if (validLeads.length === 0) {
    return NextResponse.json({
      success: true,
      uploaded: 0,
      invalid: invalidCount,
      message: "No valid leads to upload",
    });
  }

  // Upload in batches
  let totalUploaded = 0;
  let totalErrors = 0;

  try {
    for (let i = 0; i < validLeads.length; i += BATCH_SIZE) {
      const chunk = validLeads.slice(i, i + BATCH_SIZE);
      const batchPayload: InstantlyBulkPayload = {
        campaign_id: campaignId,
        skip_if_in_workspace: true,
        skip_if_in_campaign: true,
        leads: chunk,
      };

      const result = (await instantlyFetch(
        "/leads",
        "POST",
        batchPayload as unknown as Record<string, unknown>,
      )) as InstantlyBulkResponse;

      totalUploaded += result.leads_uploaded ?? chunk.length;
      totalErrors += result.invalid_email_count ?? 0;
    }

    return NextResponse.json({
      success: true,
      uploaded: totalUploaded,
      errors: totalErrors,
      invalid: invalidCount,
      total: body.leads.length,
      campaignId,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[Upload] Failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json(
      { success: false, error: "Upload to Instantly failed" },
      { status: 502 },
    );
  }
}
