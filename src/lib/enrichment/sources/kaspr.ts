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

  // Guard: Need a LinkedIn URL
  const linkedinUrl = context.accumulated.linkedinUrl;
  if (!linkedinUrl) {
    return {
      ...emptyResult,
      metadata: { error: "No LinkedIn URL available" },
    };
  }

  // Build name for Kaspr
  const name =
    context.accumulated.dirigeant ??
    `${context.accumulated.dirigeantFirstName ?? ""} ${context.accumulated.dirigeantLastName ?? ""}`.trim() ??
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
  const bestEmail = selectBestKasprEmail(data.emails ?? []);

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
  if (bestEmail) metadata["email_type"] = bestEmail.type;

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
    email: bestEmail?.email ?? null,
    phone: bestPhone,
    dirigeant: fullName || null,
    siret: null, // Kaspr doesn't provide SIRET
    source: "kaspr",
    confidence: 0, // Will be set by computeConfidence
    metadata,
  };
}

/* ------------------------------------------------------------------ */
/*  Register Source                                                     */
/* ------------------------------------------------------------------ */

registerSource("kaspr", kasprSource);

export { kasprSource };
