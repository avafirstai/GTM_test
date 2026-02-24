import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/enrich/people — Find decision-makers for a company via Apollo.io
 *
 * Body: { domain: string, leadId: string, limit?: number }
 *
 * Apollo.io API v1: POST /v1/mixed_people/search
 * Finds people at a company by domain, filtered to decision-maker titles.
 *
 * Returns: { success, people: [{ name, title, email, linkedin_url, confidence }] }
 */

interface PeopleRequest {
  domain: string;
  leadId: string;
  limit?: number;
}

interface ApolloPersonResult {
  name: string;
  title: string;
  email: string;
  linkedin_url: string;
  confidence: number;
}

// Decision-maker title keywords (FR + EN) — broad enough to catch
// founders, directors, managers in French SMBs
const DM_TITLE_KEYWORDS = [
  "directeur", "directrice", "gerant", "gerante", "fondateur", "fondatrice",
  "president", "presidente", "pdg", "ceo", "coo", "cto", "cfo", "cmo",
  "owner", "founder", "director", "manager", "responsable", "chef",
  "associe", "associee", "partner", "head", "vp", "vice",
];

function isDMTitle(title: string): boolean {
  if (!title) return false;
  const lower = title.toLowerCase();
  return DM_TITLE_KEYWORDS.some((kw) => lower.includes(kw));
}

function cleanDomain(raw: string): string {
  try {
    let d = raw.trim();
    if (!d.startsWith("http")) d = `https://${d}`;
    const hostname = new URL(d).hostname.replace(/^www\./, "");
    return hostname;
  } catch {
    // Fallback: strip protocol and www manually
    return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }
}

export async function POST(request: Request) {
  const apolloKey = process.env.APOLLO_API_KEY;
  if (!apolloKey) {
    return NextResponse.json(
      { success: false, error: "APOLLO_API_KEY not configured" },
      { status: 503 },
    );
  }

  let body: PeopleRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (!body.domain || typeof body.domain !== "string") {
    return NextResponse.json(
      { success: false, error: "domain is required" },
      { status: 400 },
    );
  }

  const domain = cleanDomain(body.domain);
  const limit = Math.min(Math.max(body.limit ?? 5, 1), 20);

  try {
    // Apollo.io People Search — finds people at a company by domain
    const apolloRes = await fetch("https://api.apollo.io/v1/mixed_people/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": apolloKey,
      },
      body: JSON.stringify({
        q_organization_domains: domain,
        page: 1,
        per_page: limit * 2, // Request extra to filter DM titles
        person_titles: [], // Let Apollo return all, we filter ourselves
      }),
    });

    if (!apolloRes.ok) {
      const errorText = await apolloRes.text().catch(() => "Unknown error");
      console.error(`[Apollo] People search failed: ${apolloRes.status} — ${errorText.slice(0, 200)}`);
      return NextResponse.json(
        { success: false, error: `Apollo API error: ${apolloRes.status}` },
        { status: 502 },
      );
    }

    const apolloData = await apolloRes.json();
    const rawPeople: Array<{
      first_name?: string;
      last_name?: string;
      name?: string;
      title?: string;
      email?: string;
      linkedin_url?: string;
      email_status?: string;
    }> = apolloData.people || [];

    // Map + filter to decision-makers with available data
    const people: ApolloPersonResult[] = [];
    for (const p of rawPeople) {
      const name = p.name || [p.first_name, p.last_name].filter(Boolean).join(" ");
      const title = p.title || "";

      // Skip if no name
      if (!name.trim()) continue;

      // Compute confidence score
      let confidence = 30; // Base: person exists in Apollo
      if (p.email) confidence += 30;
      if (p.email_status === "verified") confidence += 20;
      if (isDMTitle(title)) confidence += 15;
      if (p.linkedin_url) confidence += 5;

      people.push({
        name: name.trim(),
        title,
        email: p.email || "",
        linkedin_url: p.linkedin_url || "",
        confidence: Math.min(confidence, 100),
      });
    }

    // Sort: DM titles first, then by confidence desc
    people.sort((a, b) => {
      const aIsDM = isDMTitle(a.title) ? 0 : 1;
      const bIsDM = isDMTitle(b.title) ? 0 : 1;
      if (aIsDM !== bIsDM) return aIsDM - bIsDM;
      return b.confidence - a.confidence;
    });

    // Limit to requested count
    const trimmed = people.slice(0, limit);

    return NextResponse.json({
      success: true,
      domain,
      leadId: body.leadId || "",
      people: trimmed,
      totalFound: rawPeople.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error(
      "[Apollo] People search exception:",
      err instanceof Error ? err.message : "unknown",
    );
    return NextResponse.json(
      { success: false, error: "Failed to search Apollo" },
      { status: 502 },
    );
  }
}
