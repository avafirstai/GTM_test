/**
 * Waterfall Source 6 — Google Custom Search / Dorking
 *
 * Priority: 6
 * Cost: FREEMIUM (100 queries/day free via Google Custom Search API)
 * Purpose: Find emails mentioned on external pages via Google search.
 *   Query: "@domain.com" to find pages mentioning emails for this domain.
 *
 * Requires: GOOGLE_CSE_API_KEY + GOOGLE_CSE_CX env vars
 *
 * Confidence: 55 (indirect source — found via web search)
 */

import type {
  EnrichmentResult,
  EnrichmentLeadInput,
  EnrichmentContext,
} from "../types";
import { registerSource } from "../waterfall";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface GoogleSearchResult {
  items?: Array<{
    title: string;
    link: string;
    snippet: string;
    pagemap?: Record<string, unknown>;
  }>;
  searchInformation?: {
    totalResults: string;
  };
}

/* ------------------------------------------------------------------ */
/*  Email Extraction from Snippets                                     */
/* ------------------------------------------------------------------ */

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

const EXCLUDED_DOMAINS = new Set([
  "example.com", "sentry.io", "wixpress.com", "wordpress.org",
  "googleapis.com", "schema.org", "w3.org", "facebook.com",
  "twitter.com", "instagram.com", "youtube.com", "google.com",
]);

function extractEmailsFromText(text: string, leadDomain: string): string[] {
  const matches = text.match(EMAIL_REGEX) || [];
  return matches
    .map((e) => e.toLowerCase())
    .filter((email) => {
      const domain = email.split("@")[1];
      if (!domain) return false;
      if (EXCLUDED_DOMAINS.has(domain)) return false;
      // Prefer same-domain or at least not obviously wrong
      return true;
    });
}

/* ------------------------------------------------------------------ */
/*  Google Custom Search API                                           */
/* ------------------------------------------------------------------ */

async function googleSearch(
  query: string,
  apiKey: string,
  cx: string,
): Promise<GoogleSearchResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const params = new URLSearchParams({
      key: apiKey,
      cx: cx,
      q: query,
      num: "5", // 5 results to save quota
    });

    const resp = await fetch(
      `https://www.googleapis.com/customsearch/v1?${params.toString()}`,
      {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      },
    );

    clearTimeout(timeout);

    if (!resp.ok) {
      // Rate limit or quota exceeded
      if (resp.status === 429 || resp.status === 403) {
        console.warn("[Google CSE] Quota exceeded or rate limited");
      }
      return null;
    }

    return await resp.json();
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  LinkedIn URL Extraction                                            */
/* ------------------------------------------------------------------ */

const LINKEDIN_REGEX =
  /https?:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9\-_%]+\/?/gi;

function extractLinkedInUrls(text: string): string[] {
  const matches = text.match(LINKEDIN_REGEX) || [];
  return [...new Set(matches.map((url) => url.replace(/\/$/, "")))];
}

/* ------------------------------------------------------------------ */
/*  Source Function                                                     */
/* ------------------------------------------------------------------ */

async function googleDorkSource(
  lead: EnrichmentLeadInput,
  context: EnrichmentContext,
): Promise<EnrichmentResult> {
  const domain = context.domain;
  const apiKey = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_CX;

  const emptyResult: EnrichmentResult = {
    email: null,
    phone: null,
    dirigeant: null,
    siret: null,
    source: "google_dork",
    confidence: 0,
    metadata: {},
  };

  // Skip if no API key configured
  if (!apiKey || !cx) {
    return {
      ...emptyResult,
      metadata: { error: "GOOGLE_CSE_API_KEY or GOOGLE_CSE_CX not configured" },
    };
  }

  // Build search queries — OPTIMIZED: 1 query when dirigeant known (saves CSE quota)
  // With dirigeant: LinkedIn URL is the priority (email comes from email_permutation)
  // Without dirigeant: email search is the fallback
  let queries: string[];
  if (context.accumulated.dirigeant) {
    const companyName = lead.name.replace(/\b(sarl|sas|sa|eurl|sasu)\b/gi, "").trim();
    queries = [
      `site:linkedin.com/in "${context.accumulated.dirigeant}" "${companyName}"`,
    ];
  } else {
    queries = [`"@${domain}" email`];
  }

  // Run the single query (saves 50% CSE quota when dirigeant known)
  const searchResult = await googleSearch(queries[0], apiKey, cx);

  // Extract emails AND LinkedIn URLs from results
  const allEmails: string[] = [];
  const allLinkedInUrls: string[] = [];
  let pagesFound = 0;

  if (searchResult?.items) {
    for (const item of searchResult.items) {
      pagesFound++;
      const text = `${item.title} ${item.snippet} ${item.link}`;

      // Extract emails (even from LinkedIn query — snippets may contain them)
      const emails = extractEmailsFromText(text, domain);
      allEmails.push(...emails);

      // Extract LinkedIn URLs
      const linkedInUrls = extractLinkedInUrls(text);
      allLinkedInUrls.push(...linkedInUrls);
    }
  }

  // If both queries returned nothing, early return
  if (pagesFound === 0) return emptyResult;

  // Deduplicate
  const uniqueEmails = [...new Set(allEmails)];
  const uniqueLinkedIn = [...new Set(allLinkedInUrls)];

  // Prefer same-domain emails
  const sameDomainEmails = uniqueEmails.filter((e) =>
    e.includes(domain),
  );
  const bestEmail =
    sameDomainEmails[0] ?? uniqueEmails[0] ?? null;

  // Build metadata
  const metadata: Record<string, string> = {
    pages_found: String(pagesFound),
    total_results: searchResult?.searchInformation?.totalResults ?? "0",
    emails_found: String(uniqueEmails.length),
  };

  if (uniqueLinkedIn.length > 0) {
    metadata["linkedin_url"] = uniqueLinkedIn[0];
    if (uniqueLinkedIn.length > 1) {
      metadata["linkedin_urls_count"] = String(uniqueLinkedIn.length);
    }
  }

  return {
    email: bestEmail,
    phone: null,
    dirigeant: null,
    siret: null,
    source: "google_dork",
    confidence: 0, // Will be set by computeConfidence
    metadata,
  };
}

/* ------------------------------------------------------------------ */
/*  Register Source                                                     */
/* ------------------------------------------------------------------ */

registerSource("google_dork", googleDorkSource);

export { googleDorkSource };
