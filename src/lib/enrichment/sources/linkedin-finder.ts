/**
 * LinkedIn URL Finder — Multi-Strategy Helper for Kaspr Integration
 *
 * Not a waterfall source itself, but used by linkedin-search.ts
 * to find LinkedIn profile URLs for decision-makers.
 *
 * 2-strategy cascade (tries in order, returns first success):
 *   1. Brave Search      — scrape search.brave.com (free, unlimited, no API key)
 *   2. LinkedIn direct    — HEAD/GET linkedin.com/in/prenom-nom (free, unlimited)
 *
 * Used by: linkedin-search.ts → kaspr.ts (needs LinkedIn URL as input)
 */

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
/*  Strategy 1: Brave Search (free, no API key, no quota)              */
/* ------------------------------------------------------------------ */

/**
 * Search Brave organically and extract LinkedIn URLs from the HTML.
 * Brave Search renders results server-side (unlike Google which is JS-only).
 * Returns the most relevant LinkedIn /in/ URL, or null.
 */
async function findViaBraveSearch(
  firstName: string,
  lastName: string,
  company: string,
): Promise<string | null> {
  const query = `site:linkedin.com/in "${firstName} ${lastName}" "${company}"`;
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

    if (!resp.ok) return null;

    const html = await resp.text();

    // Check for CAPTCHA / rate-limiting
    if (html.includes("captcha") || html.includes("are you a robot")) {
      console.warn("[LinkedIn Finder] Brave Search blocked by CAPTCHA");
      return null;
    }

    // Extract all LinkedIn /in/ URLs from the page
    const matches = html.match(LINKEDIN_IN_REGEX);
    if (!matches || matches.length === 0) return null;

    // Build target slug for relevance matching
    const targetSlug = buildLinkedInSlug(firstName, lastName);

    // Deduplicate and prefer URLs containing the target name
    const seen = new Set<string>();
    const candidates: string[] = [];

    for (const match of matches) {
      const cleaned = decodeURIComponent(match)
        .replace(/\/$/, "")
        .replace(/&amp;.*$/, "")
        .toLowerCase();
      if (seen.has(cleaned)) continue;
      seen.add(cleaned);

      if (cleaned.includes("/in/")) {
        candidates.push(cleaned);
      }
    }

    if (candidates.length === 0) return null;

    // Prefer the URL that contains the person's name slug
    const bestMatch = candidates.find((url) => url.includes(targetSlug));
    return bestMatch ?? candidates[0];
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
/*  Main Finder Function — 2-Strategy Cascade                          */
/* ------------------------------------------------------------------ */

/**
 * Find the LinkedIn URL for a person using 2 strategies in order.
 * Returns the first successful result, or null if all fail.
 *
 * Strategy order:
 *   1. Brave Search (free, no API key, server-side HTML)
 *   2. LinkedIn direct check (free, checks if guessed URL is real)
 */
export async function findLinkedInUrl(
  firstName: string,
  lastName: string,
  company: string,
  _domain: string,
): Promise<{ url: string; strategy: string } | null> {
  // Strategy 1: Brave Search (most reliable, no quota)
  const braveUrl = await findViaBraveSearch(firstName, lastName, company);
  if (braveUrl) {
    return { url: braveUrl, strategy: "brave_search" };
  }

  // Strategy 2: LinkedIn direct check (free, no API quota)
  const directUrl = await findViaLinkedInDirect(firstName, lastName);
  if (directUrl) {
    return { url: directUrl, strategy: "linkedin_direct" };
  }

  return null;
}
