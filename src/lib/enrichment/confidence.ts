/**
 * Waterfall Enrichment Engine — Confidence Scoring
 *
 * Computes a 0-100 confidence score for enrichment results.
 * Higher confidence = more likely the data is correct and actionable.
 */

import type { EnrichmentResult } from "./types";

/* ------------------------------------------------------------------ */
/*  Per-Source Base Confidence                                         */
/* ------------------------------------------------------------------ */

const SOURCE_BASE_CONFIDENCE: Record<string, number> = {
  schema_org:         85,  // Structured data from official site — very reliable
  deep_scrape:        65,  // HTML regex — decent but can be noisy
  sirene:             90,  // Official French government registry
  email_permutation:  90,  // Double SMTP-verified only (eva + mailcheck)
  google_dork:        55,  // Indirect source — found via web search
  kaspr:              88,  // 500M+ contacts, cross-referenced
  linkedin_search:    40,  // Metadata source — finds LinkedIn URL for Kaspr
  dns_intel:          30,  // Metadata only, no direct contact info
};

/* ------------------------------------------------------------------ */
/*  Confidence Bonuses                                                 */
/* ------------------------------------------------------------------ */

/** Bonus applied when email domain matches the lead's website domain */
const BONUS_SAME_DOMAIN = 15;

/** Bonus when email starts with contact@/info@ (generic but real) */
const BONUS_GENERIC_PREFIX = -10; // Penalty — generic emails are less valuable

/** Bonus when we also found a phone number */
const BONUS_HAS_PHONE = 5;

/** Bonus when we also found SIRET (confirms company exists) */
const BONUS_HAS_SIRET = 5;

/** Bonus when we also found dirigeant name */
const BONUS_HAS_DIRIGEANT = 5;

/** Bonus for SMTP-verified email (90 base + 10 = 100 for email_permutation) */
const BONUS_SMTP_VERIFIED = 10;

/* ------------------------------------------------------------------ */
/*  Main Scoring Function                                              */
/* ------------------------------------------------------------------ */

/**
 * Compute the confidence score for a single enrichment result.
 * Takes into account the source reliability, data quality, and cross-signals.
 */
export function computeConfidence(
  result: EnrichmentResult,
  leadDomain?: string,
): number {
  // Start with base confidence for the source
  let score = SOURCE_BASE_CONFIDENCE[result.source] ?? 50;

  // --- Email quality bonuses ---
  if (result.email) {
    const emailLower = result.email.toLowerCase();
    const emailDomain = emailLower.split("@")[1] ?? "";

    // Email domain matches lead's website domain
    if (leadDomain && emailDomain.includes(leadDomain.replace(/^www\./, ""))) {
      score += BONUS_SAME_DOMAIN;
    }

    // Generic prefix penalty
    if (
      emailLower.startsWith("contact@") ||
      emailLower.startsWith("info@") ||
      emailLower.startsWith("accueil@")
    ) {
      score += BONUS_GENERIC_PREFIX;
    }

    // SMTP verified (set in metadata by verify-email source)
    if (result.metadata["smtp_verified"] === "true") {
      score += BONUS_SMTP_VERIFIED;
    }
  }

  // --- Cross-signal bonuses ---
  if (result.phone) {
    score += BONUS_HAS_PHONE;
  }
  if (result.siret) {
    score += BONUS_HAS_SIRET;
  }
  if (result.dirigeant) {
    score += BONUS_HAS_DIRIGEANT;
  }

  // Clamp to 0-100
  return Math.max(0, Math.min(100, score));
}

/* ------------------------------------------------------------------ */
/*  Multi-Source Aggregation                                           */
/* ------------------------------------------------------------------ */

const MULTI_SOURCE_BONUS = 20;

/**
 * Compute the final aggregated confidence from multiple source results.
 * If the same email is found by 2+ different sources, add a bonus.
 */
export function computeAggregateConfidence(
  results: EnrichmentResult[],
): number {
  if (results.length === 0) return 0;

  // Get the highest individual confidence
  const maxConfidence = Math.max(...results.map((r) => r.confidence));

  // Check for multi-source email confirmation
  const emailCounts = new Map<string, number>();
  for (const r of results) {
    if (r.email) {
      const key = r.email.toLowerCase();
      emailCounts.set(key, (emailCounts.get(key) ?? 0) + 1);
    }
  }

  // If any email was found by 2+ sources → bonus
  let multiSourceBonus = 0;
  for (const count of emailCounts.values()) {
    if (count >= 2) {
      multiSourceBonus = MULTI_SOURCE_BONUS;
      break;
    }
  }

  return Math.min(100, maxConfidence + multiSourceBonus);
}

/* ------------------------------------------------------------------ */
/*  Best Email Selection                                               */
/* ------------------------------------------------------------------ */

/**
 * Pick the best email from multiple source results.
 * Prefers: highest confidence → personal over generic → most sources confirming.
 */
export function selectBestEmail(
  results: EnrichmentResult[],
): { email: string; confidence: number; source: string } | null {
  const emailCandidates: Array<{
    email: string;
    confidence: number;
    source: string;
    sourceCount: number;
    isGeneric: boolean;
  }> = [];

  // Count how many sources found each email
  const emailSourceCount = new Map<string, number>();
  for (const r of results) {
    if (r.email) {
      const key = r.email.toLowerCase();
      emailSourceCount.set(key, (emailSourceCount.get(key) ?? 0) + 1);
    }
  }

  // Build candidate list
  for (const r of results) {
    if (!r.email) continue;
    const lower = r.email.toLowerCase();
    const isGeneric =
      lower.startsWith("contact@") ||
      lower.startsWith("info@") ||
      lower.startsWith("accueil@");

    emailCandidates.push({
      email: r.email,
      confidence: r.confidence,
      source: r.source,
      sourceCount: emailSourceCount.get(lower) ?? 1,
      isGeneric,
    });
  }

  if (emailCandidates.length === 0) return null;

  // Sort: multi-source first → personal over generic → highest confidence
  emailCandidates.sort((a, b) => {
    if (a.sourceCount !== b.sourceCount) return b.sourceCount - a.sourceCount;
    if (a.isGeneric !== b.isGeneric) return a.isGeneric ? 1 : -1;
    return b.confidence - a.confidence;
  });

  const best = emailCandidates[0];
  return {
    email: best.email,
    confidence: best.confidence,
    source: best.source,
  };
}
