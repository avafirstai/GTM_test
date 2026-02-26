/**
 * LinkedIn URL Finder — Multi-Strategy Helper for Kaspr Integration
 *
 * Not a waterfall source itself, but used by linkedin-search.ts
 * to find LinkedIn profile URLs for decision-makers.
 *
 * 3-strategy cascade (tries in order, returns first success):
 *   1. Google CSE dork   — site:linkedin.com/in "name" "company" (100/day quota)
 *   2. LinkedIn direct    — HEAD/GET linkedin.com/in/prenom-nom (free, unlimited)
 *   3. Google organic     — scrape Google search results (free, rate-limited)
 *
 * Used by: linkedin-search.ts → kaspr.ts (needs LinkedIn URL as input)
 */

import { canQueryGoogleCSE, recordGoogleCSEQuery } from "../google-cse-quota";

/* ------------------------------------------------------------------ */
/*  Shared Helpers                                                     */
/* ------------------------------------------------------------------ */

/** Build a best-guess LinkedIn slug from a name: prenom-nom */
function buildLinkedInSlug(firstName: string, lastName: string): string {
  const clean = (s: string) =>
    s.toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")  // Remove accents
      .replace(/[^a-z\s-]/g, "")         // Keep only letters, spaces, hyphens
      .trim()
      .replace(/\s+/g, "-");             // Spaces → hyphens

  return `${clean(firstName)}-${clean(lastName)}`;
}

/** Browser-like User-Agent to avoid bot detection */
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Regex to extract LinkedIn /in/ URLs from text */
const LINKEDIN_IN_REGEX =
  /https?:\/\/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[a-zA-Z0-9\-_%]+\/?/gi;

/* ------------------------------------------------------------------ */
/*  Strategy 1: Google CSE Dork                                        */
/* ------------------------------------------------------------------ */

async function findViaGoogleCSE(
  firstName: string,
  lastName: string,
  company: string,
): Promise<string | null> {
  const apiKey = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!apiKey || !cx) return null;

  if (!canQueryGoogleCSE()) {
    console.warn("[LinkedIn Finder] Skipping Google CSE — daily quota exhausted");
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

    recordGoogleCSEQuery(1);

    const data = await resp.json();
    const items = data.items || [];

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
/*  Strategy 2: LinkedIn Direct Check                                  */
/* ------------------------------------------------------------------ */

/**
 * Build the guessed LinkedIn URL and fetch it directly.
 * Check if the profile exists by looking for og:type=profile in meta tags.
 *
 * LinkedIn may block unauthenticated requests (status 999), so this is
 * a best-effort strategy. Returns null on any non-success response.
 */
async function findViaLinkedInDirect(
  firstName: string,
  lastName: string,
): Promise<string | null> {
  const slug = buildLinkedInSlug(firstName, lastName);
  if (!slug || slug === "-") return null;

  const url = `https://www.linkedin.com/in/${slug}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      },
      redirect: "follow",
    });

    clearTimeout(timeout);

    if (!resp.ok) return null;

    // Read a limited portion of the HTML to check for profile indicators
    const html = await resp.text();
    const head = html.slice(0, 15000); // Only check <head> area

    // Indicators that this is a real LinkedIn profile page:
    // 1. og:type = "profile"
    // 2. canonical link contains /in/
    // 3. title contains the person's name (not "Page Not Found")
    const isProfile =
      head.includes('og:type" content="profile"') ||
      head.includes('og:type" content="profile.person"') ||
      (head.includes("linkedin.com/in/") && !head.includes("Page Not Found"));

    if (isProfile) {
      // Extract canonical URL if present (may have a suffix like -12345)
      const canonicalMatch = head.match(
        /rel="canonical"\s+href="(https?:\/\/[^"]*linkedin\.com\/in\/[^"]+)"/,
      );
      if (canonicalMatch?.[1]) {
        return canonicalMatch[1].replace(/\/$/, "");
      }
      return url;
    }

    return null;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Strategy 3: Google Organic Search                                  */
/* ------------------------------------------------------------------ */

/**
 * Search Google organically (no API key) and extract LinkedIn URLs
 * from the search results HTML.
 *
 * Risk: Google may serve CAPTCHA or rate-limit. Fails gracefully.
 */
async function findViaGoogleOrganic(
  firstName: string,
  lastName: string,
  company: string,
): Promise<string | null> {
  const query = `"${firstName} ${lastName}" "${company}" site:linkedin.com/in`;
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=5&hl=fr`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

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

    if (!resp.ok) return null;

    const html = await resp.text();

    // Check for CAPTCHA / consent page
    if (html.includes("captcha") || html.includes("consent.google.com")) {
      console.warn("[LinkedIn Finder] Google organic blocked by CAPTCHA");
      return null;
    }

    // Extract all LinkedIn /in/ URLs from the page
    const matches = html.match(LINKEDIN_IN_REGEX);
    if (!matches || matches.length === 0) return null;

    // Deduplicate and return first valid /in/ URL
    const seen = new Set<string>();
    for (const match of matches) {
      const cleaned = decodeURIComponent(match)
        .replace(/\/$/, "")
        .replace(/&amp;.*$/, "");
      if (!seen.has(cleaned) && cleaned.includes("/in/")) {
        return cleaned;
      }
      seen.add(cleaned);
    }

    return null;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Main Finder Function — 3-Strategy Cascade                          */
/* ------------------------------------------------------------------ */

/**
 * Find the LinkedIn URL for a person using 3 strategies in order.
 * Returns the first successful result, or null if all fail.
 *
 * Strategy order:
 *   1. Google CSE dork (reliable API, 100/day quota)
 *   2. LinkedIn direct check (free, checks if guessed URL is real)
 *   3. Google organic scrape (free, rate-limited by Google)
 */
export async function findLinkedInUrl(
  firstName: string,
  lastName: string,
  company: string,
  _domain: string,
): Promise<{ url: string; strategy: string } | null> {
  // Strategy 1: Google CSE dork (most reliable)
  const cseUrl = await findViaGoogleCSE(firstName, lastName, company);
  if (cseUrl) {
    return { url: cseUrl, strategy: "google_cse" };
  }

  // Strategy 2: LinkedIn direct check (free, no API quota)
  const directUrl = await findViaLinkedInDirect(firstName, lastName);
  if (directUrl) {
    return { url: directUrl, strategy: "linkedin_direct" };
  }

  // Strategy 3: Google organic search (free, may be rate-limited)
  const organicUrl = await findViaGoogleOrganic(firstName, lastName, company);
  if (organicUrl) {
    return { url: organicUrl, strategy: "google_organic" };
  }

  return null;
}
