/**
 * Waterfall Source 8 — Kaspr API (LinkedIn → Email + Phone)
 *
 * Priority: 8 (LAST — most expensive, used as last resort)
 * Cost: PAID (1 credit per data point — work email, direct email, phone)
 * Purpose: Get verified professional email + phone from LinkedIn profile.
 *
 * Requires:
 *   - KASPR_API_KEY env var
 *   - LinkedIn URL of the dirigeant (from Apollo, Google dork, or context)
 *   - config.useKaspr = true (opt-in only)
 *   - lead.score >= config.minScoreForPaid
 *
 * API: POST https://api.developers.kaspr.io/profile/linkedin
 * Auth: Raw API key in Authorization header (NOT Bearer)
 * Input: { name: string, id: string } (id = LinkedIn URL)
 * Returns: work email, direct email, phone, title, company
 *
 * Confidence: 88 (500M+ contacts, cross-referenced on 150+ sources)
 */

import type {
  EnrichmentResult,
  EnrichmentLeadInput,
  EnrichmentContext,
  DecisionMakerData,
} from "../types";
import { registerSource } from "../waterfall";

/* ------------------------------------------------------------------ */
/*  Kaspr API Types                                                    */
/* ------------------------------------------------------------------ */

interface KasprRequest {
  name: string;
  id: string; // LinkedIn URL
}

interface KasprEmailResult {
  email: string;
  type: string; // "work" | "direct" | "personal"
  verified: boolean;
}

interface KasprPhoneResult {
  phone: string;
  type: string; // "work" | "direct" | "personal"
}

interface KasprResponse {
  status: string;
  data?: {
    first_name?: string;
    last_name?: string;
    full_name?: string;
    title?: string;
    company?: string;
    emails?: KasprEmailResult[];
    phones?: KasprPhoneResult[];
    linkedin_url?: string;
  };
  error?: string;
  message?: string;
}

/* ------------------------------------------------------------------ */
/*  Kaspr API Call                                                     */
/* ------------------------------------------------------------------ */

async function callKasprApi(
  linkedinUrl: string,
  name: string,
  apiKey: string,
): Promise<KasprResponse | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000); // Kaspr can be slow

  try {
    const body: KasprRequest = {
      name: name,
      id: linkedinUrl,
    };

    const resp = await fetch(
      "https://api.developers.kaspr.io/profile/linkedin",
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: apiKey, // Raw key, NOT Bearer
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );

    clearTimeout(timeout);

    if (!resp.ok) {
      const errorText = await resp.text().catch(() => "Unknown");
      console.error(
        `[Kaspr] API error: ${resp.status} — ${errorText.slice(0, 200)}`,
      );
      return null;
    }

    return await resp.json();
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  LinkedIn URL Builder (fallback when no URL found by prior sources) */
/* ------------------------------------------------------------------ */

/**
 * Build a best-guess LinkedIn URL from a name.
 * LinkedIn profile slugs follow the pattern: /in/prenom-nom-xxxxx
 * We try the clean version without the random suffix — Kaspr may resolve it.
 */
function buildLinkedInGuess(firstName: string, lastName: string): string | null {
  const clean = (s: string) =>
    s.toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")  // Remove accents
      .replace(/[^a-z\s-]/g, "")         // Keep only letters, spaces, hyphens
      .trim()
      .replace(/\s+/g, "-");             // Spaces → hyphens

  const first = clean(firstName);
  const last = clean(lastName);
  if (!first || !last) return null;

  return `https://www.linkedin.com/in/${first}-${last}`;
}

/* ------------------------------------------------------------------ */
/*  Email Selection                                                    */
/* ------------------------------------------------------------------ */

function selectBestKasprEmail(
  emails: KasprEmailResult[],
): { email: string; type: string } | null {
  if (!emails || emails.length === 0) return null;

  // Priority: work verified → work unverified → direct verified → direct → personal
  const priority = ["work", "direct", "personal"];

  const sorted = [...emails].sort((a, b) => {
    // Verified first
    if (a.verified !== b.verified) return a.verified ? -1 : 1;
    // Then by type priority
    const aIdx = priority.indexOf(a.type);
    const bIdx = priority.indexOf(b.type);
    return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
  });

  return { email: sorted[0].email, type: sorted[0].type };
}

/* ------------------------------------------------------------------ */
/*  Source Function                                                     */
/* ------------------------------------------------------------------ */

/** Max DMs to call Kaspr for (paid credits — explicit cap) */
const MAX_KASPR_DM_CALLS = 3;

async function kasprSource(
  lead: EnrichmentLeadInput,
  context: EnrichmentContext,
): Promise<EnrichmentResult> {
  const apiKey = process.env.KASPR_API_KEY;

  const emptyResult: EnrichmentResult = {
    email: null,
    phone: null,
    dirigeant: null,
    siret: null,
    source: "kaspr",
    confidence: 0,
    metadata: {},
  };

  // Guard: API key required
  if (!apiKey) {
    return {
      ...emptyResult,
      metadata: { error: "KASPR_API_KEY not configured" },
    };
  }

  // Multi-DM mode: call Kaspr for each DM without email
  // Build LinkedIn URL guess from name when no URL found by prior sources
  const dmsForKaspr = context.accumulated.decisionMakers
    .filter((dm) => !dm.email)
    .map((dm) => {
      if (dm.linkedinUrl) return dm;
      // Fallback: build LinkedIn URL from name
      const guessUrl = buildLinkedInGuess(dm.firstName, dm.lastName);
      if (guessUrl) {
        return { ...dm, linkedinUrl: guessUrl };
      }
      return dm;
    })
    .filter((dm) => dm.linkedinUrl)
    .slice(0, MAX_KASPR_DM_CALLS);

  if (dmsForKaspr.length > 0) {
    // Parallel Kaspr calls for all eligible DMs
    const kasprPromises = dmsForKaspr.map((dm) =>
      callKasprApi(dm.linkedinUrl!, dm.name, apiKey)
        .then((response) => ({ dm, response })),
    );

    const results = await Promise.allSettled(kasprPromises);

    const updatedDms: DecisionMakerData[] = [];
    let bestEmail: string | null = null;
    let bestPhone: string | null = null;
    const metadata: Record<string, string> = {
      dm_calls: String(dmsForKaspr.length),
    };
    let successCount = 0;

    for (const settled of results) {
      if (settled.status !== "fulfilled" || !settled.value.response?.data) continue;
      const { dm, response } = settled.value;
      const data = response.data;
      if (!data) continue;

      successCount++;

      const dmEmail = selectBestKasprEmail(data.emails ?? []);
      const dmPhone = data.phones && data.phones.length > 0 ? data.phones[0].phone : null;

      if (dmEmail) dm.email = dmEmail.email;
      if (dmPhone) dm.phone = dmPhone;

      // Backward compat: first DM email/phone becomes the scalar
      if (!bestEmail && dmEmail) bestEmail = dmEmail.email;
      if (!bestPhone && dmPhone) bestPhone = dmPhone;

      updatedDms.push({ ...dm, source: "kaspr", confidence: 88 });
    }

    metadata["kaspr_success"] = String(successCount);

    return {
      email: bestEmail,
      phone: bestPhone,
      dirigeant: null,
      siret: null,
      source: "kaspr",
      confidence: 0,
      metadata,
      dirigeants: updatedDms.length > 0 ? updatedDms : undefined,
    };
  }

  // Legacy fallback: single LinkedIn URL from scalar accumulated context
  // Or build one from dirigeant name
  let linkedinUrl = context.accumulated.linkedinUrl;
  const firstName = context.accumulated.dirigeantFirstName;
  const lastName = context.accumulated.dirigeantLastName;

  if (!linkedinUrl && firstName && lastName) {
    linkedinUrl = buildLinkedInGuess(firstName, lastName);
  }

  if (!linkedinUrl) {
    return {
      ...emptyResult,
      metadata: { error: "No LinkedIn URL and no dirigeant name to build one" },
    };
  }

  // Build name for Kaspr
  const name =
    context.accumulated.dirigeant ??
    `${firstName ?? ""} ${lastName ?? ""}`.trim() ??
    lead.name;

  // Call Kaspr API
  const response = await callKasprApi(linkedinUrl, name, apiKey);

  if (!response || !response.data) {
    return {
      ...emptyResult,
      metadata: {
        error: response?.error ?? response?.message ?? "No data returned",
      },
    };
  }

  const { data } = response;

  // Extract best email
  const bestEmailResult = selectBestKasprEmail(data.emails ?? []);

  // Extract best phone (prefer work → direct → personal)
  const bestPhone =
    data.phones && data.phones.length > 0 ? data.phones[0].phone : null;

  // Build full name
  const fullName = data.full_name ??
    `${data.first_name ?? ""} ${data.last_name ?? ""}`.trim() ??
    null;

  // Build metadata
  const metadata: Record<string, string> = {};

  if (data.title) metadata["title"] = data.title;
  if (data.company) metadata["company"] = data.company;
  if (data.linkedin_url) metadata["linkedin_url"] = data.linkedin_url;
  if (bestEmailResult) metadata["email_type"] = bestEmailResult.type;

  if (data.emails && data.emails.length > 0) {
    metadata["emails_found"] = String(data.emails.length);
  }
  if (data.phones && data.phones.length > 0) {
    metadata["phones_found"] = String(data.phones.length);
  }

  // Mark if we got verified data
  const hasVerifiedEmail = data.emails?.some((e) => e.verified) ?? false;
  if (hasVerifiedEmail) {
    metadata["smtp_verified"] = "true";
  }

  return {
    email: bestEmailResult?.email ?? null,
    phone: bestPhone,
    dirigeant: fullName || null,
    siret: null,
    source: "kaspr",
    confidence: 0,
    metadata,
  };
}

/* ------------------------------------------------------------------ */
/*  Register Source                                                     */
/* ------------------------------------------------------------------ */

registerSource("kaspr", kasprSource);

export { kasprSource };
