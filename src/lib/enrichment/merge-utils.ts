/**
 * merge-utils.ts — Preserve & Merge decision makers across enrichment runs.
 *
 * When re-enriching a lead, the waterfall starts with an empty decisionMakers[].
 * Without merging, a re-run that finds fewer DMs would overwrite the richer
 * existing data. These helpers ensure we NEVER lose previously found data:
 *   merged result ≥ existing (always additive, never destructive).
 */

import type { DecisionMakerData } from "./types";

// ----------------------------------------------------------------
// Parse existing decision_makers JSONB from Supabase
// ----------------------------------------------------------------

/**
 * Safely parse the raw `decision_makers` column from Supabase into typed array.
 * Handles: null, undefined, non-array, malformed objects.
 */
export function parseExistingDecisionMakers(raw: unknown): DecisionMakerData[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (d): d is Record<string, unknown> => d !== null && typeof d === "object",
    )
    .map((d) => ({
      name: typeof d.name === "string" ? d.name : "",
      firstName: typeof d.firstName === "string" ? d.firstName : "",
      lastName: typeof d.lastName === "string" ? d.lastName : "",
      title: typeof d.title === "string" ? d.title : null,
      email: typeof d.email === "string" ? d.email : null,
      phone: typeof d.phone === "string" ? d.phone : null,
      linkedinUrl:
        typeof d.linkedinUrl === "string"
          ? d.linkedinUrl
          : typeof d.linkedin_url === "string"
            ? d.linkedin_url
            : null,
      source: typeof d.source === "string" ? d.source : "unknown",
      confidence: typeof d.confidence === "number" ? d.confidence : 0,
    }))
    .filter((d) => d.name.length > 0);
}

// ----------------------------------------------------------------
// Normalize name for deduplication (same logic as waterfall.ts:92)
// ----------------------------------------------------------------

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

// ----------------------------------------------------------------
// Merge: existing + incoming → deduplicated, preserving best fields
// ----------------------------------------------------------------

/**
 * Merge two DecisionMakerData arrays.
 * - Same person (by normalized name) → merge fields, non-null wins, higher confidence wins
 * - Different person → add to result
 * - Result length is always ≥ existing.length (never lose data)
 */
export function mergeDecisionMakers(
  existing: DecisionMakerData[],
  incoming: DecisionMakerData[],
): DecisionMakerData[] {
  const merged = existing.map((dm) => ({ ...dm })); // shallow copy to avoid mutation

  for (const inc of incoming) {
    const normInc = normalizeName(inc.name);
    if (!normInc) continue; // skip nameless entries

    const existingIdx = merged.findIndex(
      (ex) => normalizeName(ex.name) === normInc,
    );

    if (existingIdx >= 0) {
      // Same person found — merge fields (non-null/non-empty wins)
      const ex = merged[existingIdx];
      merged[existingIdx] = {
        name: inc.name || ex.name,
        firstName: inc.firstName || ex.firstName,
        lastName: inc.lastName || ex.lastName,
        title: inc.title || ex.title,
        email: inc.email || ex.email,
        phone: inc.phone || ex.phone,
        linkedinUrl: inc.linkedinUrl || ex.linkedinUrl,
        source: inc.source || ex.source,
        confidence: Math.max(inc.confidence ?? 0, ex.confidence ?? 0),
      };
    } else {
      // New person — add
      merged.push({ ...inc });
    }
  }

  return merged;
}
