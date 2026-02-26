/**
 * Waterfall Source 7 — Kaspr API (LinkedIn → Email + Phone)
 *
 * Priority: 7 (after linkedin_search — uses LinkedIn URLs found by earlier sources)
 * Cost: FREE (unlimited credits for user)
 * Purpose: Get verified professional email + phone from LinkedIn profile.
 *
 * Requires:
 *   - KASPR_API_KEY env var
 *   - LinkedIn URL of the dirigeant (from Google dork, linkedin_search, or context)
 *   - config.useKaspr = true
 *
 * API: POST https://api.developers.kaspr.io/profile/linkedin
 * Auth: Bearer API key in Authorization header
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
/*  Kaspr API Types (matches real API response format)                 */
/* ------------------------------------------------------------------ */

interface KasprRequest {
  name: string;
  id: string; // LinkedIn URL
}

interface KasprEmailEntry {
  email: string;
  valid: boolean | null;
  isCurrent?: boolean;
}

interface KasprPhoneEntry {
  phone: string;
  type?: string;
}

interface KasprProfile {
  id?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  companyName?: string;
  title?: string;
  /** Best professional email (scalar shortcut) */
  professionalEmail?: string | null;
  professionalEmails?: string[];
  personalEmail?: string | null;
  personalEmails?: string[];
  /** All emails with validity info */
  emails?: KasprEmailEntry[];
  /** Best phone (scalar shortcut) */
  phone?: string | null;
  starryPhone?: string | null;
  phones?: KasprPhoneEntry[];
  location?: string;
  fetchedAt?: string;
}

interface KasprResponse {
  profile?: KasprProfile;
  /** Legacy format (some endpoints may use 'data' instead of 'profile') */
  data?: KasprProfile;
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
          Authorization: `Bearer ${apiKey}`,
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

/**
 * Extract best email from Kaspr profile.
 * Priority: professionalEmail > personalEmail > emails[] list
 */
function selectBestKasprEmail(
  profile: KasprProfile,
): { email: string; type: string } | null {
  // 1. Professional email (highest priority — work email)
  if (profile.professionalEmail) {
    return { email: profile.professionalEmail, type: "work" };
  }
  // Fallback: check professionalEmails array
  if (profile.professionalEmails && profile.professionalEmails.length > 0) {
    return { email: profile.professionalEmails[0], type: "work" };
  }

  // 2. Personal email
  if (profile.personalEmail) {
    return { email: profile.personalEmail, type: "personal" };
  }
  if (profile.personalEmails && profile.personalEmails.length > 0) {
    return { email: profile.personalEmails[0], type: "personal" };
  }

  // 3. Generic emails list (last resort)
  if (profile.emails && profile.emails.length > 0) {
    // Prefer current emails
    const current = profile.emails.find((e) => e.isCurrent && e.email);
    if (current) return { email: current.email, type: "unknown" };
    const first = profile.emails.find((e) => e.email);
    if (first) return { email: first.email, type: "unknown" };
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  Source Function                                                     */
/* ------------------------------------------------------------------ */

/** Max DMs to call Kaspr for (free unlimited — generous cap) */
const MAX_KASPR_DM_CALLS = 5;

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
      if (settled.status !== "fulfilled") continue;
      const { dm, response } = settled.value;
      // Kaspr returns { profile: {...} } — fallback to { data: {...} } for compat
      const profile = response?.profile ?? response?.data;
      if (!profile) continue;

      successCount++;

      const dmEmail = selectBestKasprEmail(profile);
      const dmPhone = profile.phone ?? (profile.phones && profile.phones.length > 0 ? profile.phones[0].phone : null);

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

  // Kaspr returns { profile: {...} } — fallback to { data: {...} } for compat
  const profile = response?.profile ?? response?.data;
  if (!profile) {
    return {
      ...emptyResult,
      metadata: {
        error: response?.error ?? response?.message ?? "No data returned",
      },
    };
  }

  // Extract best email
  const bestEmailResult = selectBestKasprEmail(profile);

  // Extract best phone
  const bestPhone = profile.phone ??
    (profile.phones && profile.phones.length > 0 ? profile.phones[0].phone : null);

  // Build full name
  const fullName = profile.name ??
    `${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim() ??
    null;

  // Build metadata
  const metadata: Record<string, string> = {};

  if (profile.title) metadata["title"] = profile.title;
  if (profile.companyName) metadata["company"] = profile.companyName;
  if (profile.id) metadata["linkedin_url"] = profile.id;
  if (bestEmailResult) metadata["email_type"] = bestEmailResult.type;

  if (profile.emails && profile.emails.length > 0) {
    metadata["emails_found"] = String(profile.emails.length);
  }
  if (profile.phones && profile.phones.length > 0) {
    metadata["phones_found"] = String(profile.phones.length);
  }

  // Mark if we got a professional email (verified by Kaspr)
  if (profile.professionalEmail) {
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
