import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Allow up to 60s for batch processing

/**
 * POST /api/enrich — Bulk email enrichment via website scraping.
 *
 * Accepts filters to select which leads to enrich:
 *   - category: string (filter by category/verticale)
 *   - city: string (filter by city)
 *   - leadIds: string[] (specific lead IDs)
 *   - technique: "website_scraping" | "pattern_guess" (enrichment method)
 *   - limit: number (max leads to process, default 50)
 *
 * Only processes leads that have a website but NO email.
 * Returns enrichment results with counts.
 */

interface EnrichRequest {
  category?: string;
  city?: string;
  leadIds?: string[];
  technique?: "website_scraping" | "pattern_guess";
  limit?: number;
}

interface EnrichResult {
  leadId: string;
  name: string;
  email: string | null;
  source: string;
  error?: string;
}

// Common email patterns found on websites
const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

// Domains to exclude (generic, not real contact emails)
const EXCLUDED_DOMAINS = [
  "example.com", "sentry.io", "wixpress.com", "wordpress.org",
  "wordpress.com", "gravatar.com", "schema.org", "googleapis.com",
  "googleusercontent.com", "w3.org", "facebook.com", "twitter.com",
  "instagram.com", "linkedin.com", "youtube.com", "google.com",
  "apple.com", "microsoft.com", "amazon.com",
];

const EXCLUDED_PREFIXES = [
  "noreply", "no-reply", "donotreply", "mailer-daemon",
  "postmaster", "webmaster", "hostmaster", "abuse",
];

function isValidContactEmail(email: string): boolean {
  const lower = email.toLowerCase();
  const domain = lower.split("@")[1];
  if (!domain) return false;
  if (EXCLUDED_DOMAINS.some((d) => domain.includes(d))) return false;
  if (EXCLUDED_PREFIXES.some((p) => lower.startsWith(p))) return false;
  if (lower.includes("..") || lower.startsWith(".")) return false;
  // Must have a reasonable TLD
  const tld = domain.split(".").pop();
  if (!tld || tld.length < 2 || tld.length > 10) return false;
  return true;
}

/**
 * Scrape a website URL to find contact emails.
 * Uses a simple fetch + regex approach (no headless browser needed).
 */
async function scrapeEmailFromWebsite(url: string): Promise<string | null> {
  try {
    // Normalize URL
    let fetchUrl = url.trim();
    if (!fetchUrl.startsWith("http")) {
      fetchUrl = `https://${fetchUrl}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(fetchUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AVA-GTM-Bot/1.0; email enrichment)",
        "Accept": "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (!resp.ok) return null;

    const html = await resp.text();

    // Extract all emails from the HTML
    const matches = html.match(EMAIL_REGEX) || [];
    const uniqueEmails = [...new Set(matches.map((e) => e.toLowerCase()))];

    // Filter to valid contact emails
    const validEmails = uniqueEmails.filter(isValidContactEmail);

    if (validEmails.length === 0) return null;

    // Prefer emails with the same domain as the website
    try {
      const siteDomain = new URL(fetchUrl).hostname.replace("www.", "");
      const sameDomain = validEmails.filter((e) => e.includes(siteDomain));
      if (sameDomain.length > 0) return sameDomain[0];
    } catch {
      // ignore URL parse errors
    }

    // Prefer contact/info emails
    const contactEmails = validEmails.filter(
      (e) => e.startsWith("contact") || e.startsWith("info") || e.startsWith("accueil")
    );
    if (contactEmails.length > 0) return contactEmails[0];

    return validEmails[0];
  } catch {
    return null;
  }
}

/**
 * Generate likely email patterns from business name and domain.
 */
function guessEmailFromPattern(name: string, website: string): string | null {
  try {
    let domain: string;
    try {
      const url = website.startsWith("http") ? website : `https://${website}`;
      domain = new URL(url).hostname.replace("www.", "");
    } catch {
      return null;
    }

    // Common French business email patterns
    const patterns = [
      `contact@${domain}`,
      `info@${domain}`,
      `accueil@${domain}`,
    ];

    // Return the most common pattern — will be validated later by the user
    return patterns[0];
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  let body: EnrichRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const technique = body.technique || "website_scraping";
  const limit = Math.min(Math.max(body.limit ?? 50, 1), 200);

  // Build query for leads needing enrichment (have website, no email)
  let query = supabase
    .from("gtm_leads")
    .select("id, name, website, email, city, category")
    .not("website", "is", null)
    .neq("website", "")
    .or("email.is.null,email.eq.")
    .limit(limit);

  // Apply filters
  if (body.leadIds && body.leadIds.length > 0) {
    query = query.in("id", body.leadIds);
  } else {
    if (body.category) {
      query = query.ilike("category", `%${body.category}%`);
    }
    if (body.city) {
      query = query.ilike("city", `%${body.city}%`);
    }
  }

  const { data: leads, error } = await query;

  if (error) {
    return NextResponse.json({ error: "Database query failed" }, { status: 500 });
  }

  if (!leads || leads.length === 0) {
    return NextResponse.json({
      success: true,
      processed: 0,
      found: 0,
      failed: 0,
      results: [],
      message: "Aucun lead a enrichir avec ces filtres (tous ont deja un email ou pas de site web)",
    });
  }

  // Process leads
  const results: EnrichResult[] = [];
  let foundCount = 0;
  let failedCount = 0;

  // Process in parallel batches of 5 to avoid overwhelming
  const BATCH_SIZE = 5;
  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    const batch = leads.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (lead): Promise<EnrichResult> => {
        let email: string | null = null;
        let source = technique;

        if (technique === "website_scraping") {
          email = await scrapeEmailFromWebsite(lead.website);
          source = "website_scraping";
        } else if (technique === "pattern_guess") {
          email = guessEmailFromPattern(lead.name || "", lead.website);
          source = "pattern_guess";
        }

        if (email) {
          // Update the lead in Supabase
          const { error: updateError } = await supabase
            .from("gtm_leads")
            .update({ email })
            .eq("id", lead.id);

          if (updateError) {
            return {
              leadId: lead.id,
              name: lead.name || "",
              email: null,
              source,
              error: "Failed to save email",
            };
          }

          return { leadId: lead.id, name: lead.name || "", email, source };
        }

        return {
          leadId: lead.id,
          name: lead.name || "",
          email: null,
          source,
          error: "No email found",
        };
      })
    );

    for (const r of batchResults) {
      results.push(r);
      if (r.email) foundCount++;
      else failedCount++;
    }
  }

  return NextResponse.json({
    success: true,
    processed: leads.length,
    found: foundCount,
    failed: failedCount,
    technique,
    results,
    timestamp: new Date().toISOString(),
  });
}
