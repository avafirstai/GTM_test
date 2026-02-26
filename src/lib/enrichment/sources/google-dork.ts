/**
 * Waterfall Source 5 — Brave Search / Web Dorking
 *
 * Priority: 5
 * Cost: FREE (Brave Search HTML scraping, no API key needed)
 * Purpose: Find emails mentioned on external pages via web search.
 *   Query: "@domain.com" to find pages mentioning emails for this domain.
 *   Also searches for LinkedIn URLs for decision-makers.
 *
 * Confidence: 55 (indirect source — found via web search)
 */

import type {
  EnrichmentResult,
  EnrichmentLeadInput,
  EnrichmentContext,
  DecisionMakerData,
} from "../types";
import { registerSource } from "../waterfall";

/* ------------------------------------------------------------------ */
/*  Shared                                                             */
/* ------------------------------------------------------------------ */

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface BraveSearchResult {
  emails: string[];
  linkedInUrls: string[];
  pagesFound: number;
}

/* ------------------------------------------------------------------ */
/*  Email Extraction from HTML                                         */
/* ------------------------------------------------------------------ */

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

const EXCLUDED_DOMAINS = new Set([
  "example.com", "sentry.io", "wixpress.com", "wordpress.org",
  "googleapis.com", "schema.org", "w3.org", "facebook.com",
  "twitter.com", "instagram.com", "youtube.com", "google.com",
  "brave.com", "search.brave.com",
]);

function extractEmailsFromText(text: string): string[] {
  const matches = text.match(EMAIL_REGEX) || [];
  return matches
    .map((e) => e.toLowerCase())
    .filter((email) => {
      const domain = email.split("@")[1];
      if (!domain) return false;
      if (EXCLUDED_DOMAINS.has(domain)) return false;
      return true;
    });
}

/* ------------------------------------------------------------------ */
/*  LinkedIn URL Extraction                                            */
/* ------------------------------------------------------------------ */

const LINKEDIN_REGEX =
  /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[a-zA-Z0-9\-_%]+\/?/gi;

function extractLinkedInUrls(text: string): string[] {
  const matches = text.match(LINKEDIN_REGEX) || [];
  return [...new Set(matches.map((url) => url.replace(/\/$/, "")))];
}

/* ------------------------------------------------------------------ */
/*  Brave Search (replaces Google CSE)                                 */
/* ------------------------------------------------------------------ */

async function braveSearch(query: string): Promise<BraveSearchResult> {
  const result: BraveSearchResult = { emails: [], linkedInUrls: [], pagesFound: 0 };

  const searchUrl = `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const resp = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      },
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (!resp.ok) return result;

    const html = await resp.text();

    // Check for CAPTCHA
    if (html.includes("captcha") || html.includes("are you a robot")) {
      console.warn("[Brave Search] Blocked by CAPTCHA");
      return result;
    }

    // Extract data from the full HTML
    result.pagesFound = 1; // We got a result page
    result.emails = extractEmailsFromText(html);
    result.linkedInUrls = extractLinkedInUrls(html);

    return result;
  } catch {
    clearTimeout(timeout);
    return result;
  }
}

/* ------------------------------------------------------------------ */
/*  Source Function                                                     */
/* ------------------------------------------------------------------ */

/** Max DMs to search LinkedIn for via Brave Search */
const MAX_BRAVE_DM_QUERIES = 3;

async function googleDorkSource(
  lead: EnrichmentLeadInput,
  context: EnrichmentContext,
): Promise<EnrichmentResult> {
  const domain = context.domain;

  const emptyResult: EnrichmentResult = {
    email: null,
    phone: null,
    dirigeant: null,
    siret: null,
    source: "google_dork",
    confidence: 0,
    metadata: {},
  };

  const companyName = lead.name.replace(/\b(sarl|sas|sa|eurl|sasu)\b/gi, "").trim();
  const dms = context.accumulated.decisionMakers;

  // Multi-DM mode: search LinkedIn for top N DMs without a LinkedIn URL
  const dmsToSearch = dms
    .filter((dm) => !dm.linkedinUrl && dm.name.length > 0)
    .slice(0, MAX_BRAVE_DM_QUERIES);

  // Collect all results across queries
  const allEmails: string[] = [];
  const allLinkedInUrls: string[] = [];
  let totalPages = 0;
  const linkedInMatches: Array<{ dmName: string; url: string }> = [];

  if (dmsToSearch.length > 0) {
    // Multi-DM: search LinkedIn for each DM
    const searchPromises = dmsToSearch.map((dm) =>
      braveSearch(
        `site:linkedin.com/in "${dm.name}" "${companyName}"`,
      ).then((result) => ({ dm, result })),
    );

    const searchResults = await Promise.allSettled(searchPromises);

    for (const settled of searchResults) {
      if (settled.status !== "fulfilled") continue;
      const { dm, result: searchResult } = settled.value;

      totalPages += searchResult.pagesFound;
      allEmails.push(...searchResult.emails);
      allLinkedInUrls.push(...searchResult.linkedInUrls);

      // Assign first LinkedIn URL found to this DM
      if (searchResult.linkedInUrls.length > 0 && !dm.linkedinUrl) {
        dm.linkedinUrl = searchResult.linkedInUrls[0];
        linkedInMatches.push({ dmName: dm.name, url: searchResult.linkedInUrls[0] });
      }
    }
  } else if (context.accumulated.dirigeant) {
    // Legacy: single dirigeant scalar
    const searchResult = await braveSearch(
      `site:linkedin.com/in "${context.accumulated.dirigeant}" "${companyName}"`,
    );

    totalPages += searchResult.pagesFound;
    allEmails.push(...searchResult.emails);
    allLinkedInUrls.push(...searchResult.linkedInUrls);
  } else {
    // No DMs, no dirigeant: fallback to email search
    const searchResult = await braveSearch(`"@${domain}" email`);

    totalPages += searchResult.pagesFound;
    allEmails.push(...searchResult.emails);
    allLinkedInUrls.push(...searchResult.linkedInUrls);
  }

  // If nothing found, early return
  if (totalPages === 0) return emptyResult;

  // Deduplicate
  const uniqueEmails = [...new Set(allEmails)];
  const uniqueLinkedIn = [...new Set(allLinkedInUrls)];

  // Prefer same-domain emails
  const sameDomainEmails = uniqueEmails.filter((e) => e.includes(domain));
  const bestEmail = sameDomainEmails[0] ?? uniqueEmails[0] ?? null;

  // Build metadata
  const metadata: Record<string, string> = {
    pages_found: String(totalPages),
    emails_found: String(uniqueEmails.length),
    dm_queries: String(dmsToSearch.length),
    search_engine: "brave",
  };

  if (uniqueLinkedIn.length > 0) {
    metadata["linkedin_url"] = uniqueLinkedIn[0];
    if (uniqueLinkedIn.length > 1) {
      metadata["linkedin_urls_count"] = String(uniqueLinkedIn.length);
    }
  }

  if (linkedInMatches.length > 0) {
    metadata["linkedin_matches"] = JSON.stringify(linkedInMatches);
  }

  // Build updated dirigeants array with LinkedIn URLs assigned
  const updatedDirigeants: DecisionMakerData[] = dmsToSearch.map((dm) => ({
    ...dm,
    source: dm.linkedinUrl ? "google_dork" : dm.source,
  }));

  return {
    email: bestEmail,
    phone: null,
    dirigeant: null,
    siret: null,
    source: "google_dork",
    confidence: 0, // Will be set by computeConfidence
    metadata,
    dirigeants: updatedDirigeants.length > 0 ? updatedDirigeants : undefined,
  };
}

/* ------------------------------------------------------------------ */
/*  Register Source                                                     */
/* ------------------------------------------------------------------ */

registerSource("google_dork", googleDorkSource);

export { googleDorkSource };
