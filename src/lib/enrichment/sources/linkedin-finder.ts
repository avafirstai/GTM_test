/**
 * LinkedIn URL Finder — Helper for Kaspr Integration
 *
 * Not a waterfall source itself, but used by other sources
 * to find LinkedIn profile URLs for decision-makers.
 *
 * Strategies (in order of reliability):
 *   1. Apollo People Match API (if available)
 *   2. Google CSE dork: site:linkedin.com/in "name" "company"
 *   3. Direct URL construction (least reliable)
 *
 * Used by: kaspr.ts (needs LinkedIn URL as input)
 */

/* ------------------------------------------------------------------ */
/*  Strategy 1: Apollo People Match                                    */
/* ------------------------------------------------------------------ */

interface ApolloMatchResult {
  linkedin_url?: string;
  email?: string;
  name?: string;
}

async function findViaApollo(
  firstName: string,
  lastName: string,
  domain: string,
): Promise<string | null> {
  const apolloKey = process.env.APOLLO_API_KEY;
  if (!apolloKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const resp = await fetch("https://api.apollo.io/v1/people/match", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": apolloKey,
      },
      body: JSON.stringify({
        first_name: firstName,
        last_name: lastName,
        organization_domain: domain,
      }),
    });

    clearTimeout(timeout);

    if (!resp.ok) return null;

    const data = await resp.json();
    const person: ApolloMatchResult = data.person || data;

    return person.linkedin_url ?? null;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Strategy 2: Google CSE Dork                                        */
/* ------------------------------------------------------------------ */

async function findViaGoogleDork(
  firstName: string,
  lastName: string,
  company: string,
): Promise<string | null> {
  const apiKey = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!apiKey || !cx) return null;

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
/*  Strategy 3: Direct URL Construction (least reliable)               */
/* ------------------------------------------------------------------ */

function constructLinkedInUrl(
  firstName: string,
  lastName: string,
): string {
  const f = firstName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  const l = lastName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  // Most common LinkedIn URL pattern
  return `https://www.linkedin.com/in/${f}-${l}`;
}

/* ------------------------------------------------------------------ */
/*  Main Finder Function                                               */
/* ------------------------------------------------------------------ */

/**
 * Find the LinkedIn URL for a person.
 * Tries multiple strategies in order of reliability.
 * Returns null if no URL found.
 */
export async function findLinkedInUrl(
  firstName: string,
  lastName: string,
  company: string,
  domain: string,
): Promise<{ url: string; strategy: string } | null> {
  // Strategy 1: Apollo People Match (most reliable, uses free credits)
  const apolloUrl = await findViaApollo(firstName, lastName, domain);
  if (apolloUrl) {
    return { url: apolloUrl, strategy: "apollo_match" };
  }

  // Strategy 2: Google CSE dork (reliable, uses daily quota)
  const googleUrl = await findViaGoogleDork(firstName, lastName, company);
  if (googleUrl) {
    return { url: googleUrl, strategy: "google_dork" };
  }

  // Strategy 3 is too unreliable — don't use for Kaspr (wastes credits)
  // The constructed URL has very low probability of being correct
  // Only return it if explicitly needed for non-Kaspr uses

  return null;
}
