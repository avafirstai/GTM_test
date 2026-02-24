import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * POST /api/launch — Upload leads from Supabase to Instantly campaign.
 *
 * Body: { campaignId?: string, category?: string, city?: string, limit?: number }
 *
 * Process:
 *   1. Query Supabase for leads with email (filtered by category/city if provided)
 *   2. Upload each lead to Instantly via POST /api/v2/leads
 *   3. Return results (uploaded count, errors, etc.)
 */

const INSTANTLY_API_BASE = "https://api.instantly.ai/api/v2";

interface LeadRow {
  name: string;
  email: string;
  phone: string | null;
  website: string | null;
  city: string | null;
  category: string | null;
}

interface UploadResult {
  uploaded: number;
  errors: number;
  skipped: number;
  total: number;
  errorDetails: string[];
}

export async function POST(request: Request) {
  const apiKey = process.env.INSTANTLY_API_KEY;
  const defaultCampaignId = process.env.INSTANTLY_CAMPAIGN_ID;

  if (!apiKey) {
    return NextResponse.json(
      { error: "INSTANTLY_API_KEY not configured" },
      { status: 500 }
    );
  }

  let body: {
    campaignId?: string;
    category?: string;
    city?: string;
    limit?: number;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const campaignId = body.campaignId || defaultCampaignId;
  if (!campaignId) {
    return NextResponse.json(
      { error: "No campaignId provided and INSTANTLY_CAMPAIGN_ID not configured" },
      { status: 400 }
    );
  }

  const uploadLimit = Math.min(body.limit ?? 500, 5000);

  // 1. Query leads with email from Supabase
  let query = supabase
    .from("gtm_leads")
    .select("name, email, phone, website, city, category")
    .not("email", "is", null)
    .neq("email", "")
    .limit(uploadLimit);

  if (body.category) {
    query = query.eq("category", body.category);
  }
  if (body.city) {
    query = query.eq("city", body.city);
  }

  const { data: leads, error: dbError } = await query;

  if (dbError) {
    return NextResponse.json(
      { error: `Database error: ${dbError.message}` },
      { status: 500 }
    );
  }

  if (!leads || leads.length === 0) {
    return NextResponse.json({
      uploaded: 0,
      errors: 0,
      skipped: 0,
      total: 0,
      message: "No leads with email found matching filters",
    });
  }

  // 2. Upload to Instantly one by one
  const result: UploadResult = {
    uploaded: 0,
    errors: 0,
    skipped: 0,
    total: leads.length,
    errorDetails: [],
  };

  for (const lead of leads as LeadRow[]) {
    if (!lead.email || lead.email.trim() === "") {
      result.skipped++;
      continue;
    }

    const firstName = extractFirstName(lead.name || "");

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
        result.uploaded++;
      } else {
        result.errors++;
        if (result.errorDetails.length < 5) {
          const errText = await resp.text().catch(() => "unknown");
          result.errorDetails.push(`${resp.status}: ${errText.slice(0, 100)}`);
        }
      }
    } catch (err) {
      result.errors++;
      if (result.errorDetails.length < 5) {
        result.errorDetails.push(err instanceof Error ? err.message : "network error");
      }
    }
  }

  return NextResponse.json(result);
}

function extractFirstName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return parts[0];
  }
  return name.trim().slice(0, 20) || "Contact";
}
