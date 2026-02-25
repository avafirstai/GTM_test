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
  DecisionMakerData,
} from "../types";
import { registerSource } from "../waterfall";
import { canQueryGoogleCSE, recordGoogleCSEQuery } from "../google-cse-quota";

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

    // Record successful query against quota
    recordGoogleCSEQuery(1);

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

/** Max DMs to search LinkedIn for via Google CSE (saves quota: 100/day) */
const MAX_GOOGLE_DORK_DM_QUERIES = 2;

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

  // Check quota before making any API calls
  if (!canQueryGoogleCSE()) {
    console.warn("[Google CSE] Skipping — daily quota exhausted");
    return {
      ...emptyResult,
      metadata: { error: "google_cse_quota_exhausted" },
    };
  }

  const companyName = lead.name.replace(/\b(sarl|sas|sa|eurl|sasu)\b/gi, "").trim();
  const dms = context.accumulated.decisionMakers;

  // Multi-DM mode: search LinkedIn for top N DMs without a LinkedIn URL
  const dmsToSearch = dms
    .filter((dm) => !dm.linkedinUrl && dm.name.length > 0)
    .slice(0, MAX_GOOGLE_DORK_DM_QUERIES);

  // Collect all results across queries
  const allEmails: string[] = [];
  const allLinkedInUrls: string[] = [];
  let pagesFound = 0;
  const linkedInMatches: Array<{ dmName: string; url: string }> = [];

  if (dmsToSearch.length > 0) {
    // Multi-DM: search LinkedIn for each DM (cap at MAX_GOOGLE_DORK_DM_QUERIES)
    const searchPromises = dmsToSearch.map((dm) =>
      googleSearch(
        `site:linkedin.com/in "${dm.name}" "${companyName}"`,
        apiKey,
        cx,
      ).then((result) => ({ dm, result })),
    );

    const searchResults = await Promise.allSettled(searchPromises);

    for (const settled of searchResults) {
      if (settled.status !== "fulfilled" || !settled.value.result?.items) continue;
      const { dm, result: searchResult } = settled.value;
      const items = searchResult.items ?? [];

      for (const item of items) {
        pagesFound++;
        const text = `${item.title} ${item.snippet} ${item.link}`;

        const emails = extractEmailsFromText(text, domain);
        allEmails.push(...emails);

        const linkedInUrls = extractLinkedInUrls(text);
        allLinkedInUrls.push(...linkedInUrls);

        // Assign first LinkedIn URL found to this DM
        if (linkedInUrls.length > 0 && !dm.linkedinUrl) {
          dm.linkedinUrl = linkedInUrls[0];
          linkedInMatches.push({ dmName: dm.name, url: linkedInUrls[0] });
        }
      }
    }
  } else if (context.accumulated.dirigeant) {
    // Legacy: single dirigeant scalar (backward compat for sources not yet returning DMs)
    const searchResult = await googleSearch(
      `site:linkedin.com/in "${context.accumulated.dirigeant}" "${companyName}"`,
      apiKey,
      cx,
    );

    if (searchResult?.items) {
      for (const item of searchResult.items) {
        pagesFound++;
        const text = `${item.title} ${item.snippet} ${item.link}`;
        allEmails.push(...extractEmailsFromText(text, domain));
        allLinkedInUrls.push(...extractLinkedInUrls(text));
      }
    }
  } else {
    // No DMs, no dirigeant: fallback to email search
    const searchResult = await googleSearch(`"@${domain}" email`, apiKey, cx);

    if (searchResult?.items) {
      for (const item of searchResult.items) {
        pagesFound++;
        const text = `${item.title} ${item.snippet} ${item.link}`;
        allEmails.push(...extractEmailsFromText(text, domain));
        allLinkedInUrls.push(...extractLinkedInUrls(text));
      }
    }
  }

  // If nothing found, early return
  if (pagesFound === 0) return emptyResult;

  // Deduplicate
  const uniqueEmails = [...new Set(allEmails)];
  const uniqueLinkedIn = [...new Set(allLinkedInUrls)];

  // Prefer same-domain emails
  const sameDomainEmails = uniqueEmails.filter((e) => e.includes(domain));
  const bestEmail = sameDomainEmails[0] ?? uniqueEmails[0] ?? null;

  // Build metadata
  const metadata: Record<string, string> = {
    pages_found: String(pagesFound),
    emails_found: String(uniqueEmails.length),
    dm_queries: String(dmsToSearch.length),
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
