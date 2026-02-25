/**
 * LinkedIn URL Finder — Helper for Kaspr Integration
 *
 * Not a waterfall source itself, but used by other sources
 * to find LinkedIn profile URLs for decision-makers.
 *
 * Strategy: Google CSE dork — site:linkedin.com/in "name" "company"
 *
 * Used by: kaspr.ts (needs LinkedIn URL as input)
 */

import { canQueryGoogleCSE, recordGoogleCSEQuery } from "../google-cse-quota";

/* ------------------------------------------------------------------ */
/*  Google CSE Dork                                                    */
/* ------------------------------------------------------------------ */

async function findViaGoogleDork(
  firstName: string,
  lastName: string,
  company: string,
): Promise<string | null> {
  const apiKey = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!apiKey || !cx) return null;

  // Check quota before making API call
  if (!canQueryGoogleCSE()) {
    console.warn("[LinkedIn Finder] Skipping — Google CSE daily quota exhausted");
    return null;
  }

  const query = `site:linkedin.com/in "${firstName} ${lastName}" "${company}"`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const params = new URLSearchParams({
      key: apiKey,
      cx: cx,
      q: query,
      num: "3",
    });

    const resp = await fetch(
      `https://www.googleapis.com/customsearch/v1?${params.toString()}`,
      {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      },
    );

    clearTimeout(timeout);

    if (!resp.ok) return null;

    // Record successful query against quota
    recordGoogleCSEQuery(1);

    const data = await resp.json();
    const items = data.items || [];

    // Find first result with a LinkedIn /in/ URL
    for (const item of items) {
      const link: string = item.link ?? "";
      if (link.includes("linkedin.com/in/")) {
        return link.replace(/\/$/, "");
      }
    }

    return null;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Main Finder Function                                               */
/* ------------------------------------------------------------------ */

/**
 * Find the LinkedIn URL for a person via Google CSE dork.
 * Returns null if no URL found or if GOOGLE_CSE env vars are missing.
 */
export async function findLinkedInUrl(
  firstName: string,
  lastName: string,
  company: string,
  _domain: string,
): Promise<{ url: string; strategy: string } | null> {
  // Google CSE dork (reliable, uses daily quota)
  const googleUrl = await findViaGoogleDork(firstName, lastName, company);
  if (googleUrl) {
    return { url: googleUrl, strategy: "google_dork" };
  }

  return null;
}
