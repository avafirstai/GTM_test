/**
 * Waterfall Source 6.5 — LinkedIn Profile Search
 *
 * Priority: 6.5 (after Google Dork, before Kaspr)
 * Cost: FREE (uses Google CSE quota) or FREEMIUM (Apollo)
 * Purpose: Find the LinkedIn URL of the company's dirigeant.
 *   This URL is critical for Kaspr (next step) which converts
 *   LinkedIn profiles into verified emails + phone numbers.
 *
 * Requires:
 *   - Dirigeant name from SIRENE or deep_scrape (accumulated context)
 *   - Google CSE API key OR Apollo API key
 *
 * Does NOT return email directly — its value is setting
 * context.accumulated.linkedinUrl for Kaspr to use.
 *
 * Confidence: 40 (metadata source — enables Kaspr, not direct data)
 */

import type {
  EnrichmentResult,
  EnrichmentLeadInput,
  EnrichmentContext,
} from "../types";
import { registerSource } from "../waterfall";
import { findLinkedInUrl } from "./linkedin-finder";

/* ------------------------------------------------------------------ */
/*  Source Function                                                     */
/* ------------------------------------------------------------------ */

async function linkedinSearchSource(
  lead: EnrichmentLeadInput,
  context: EnrichmentContext,
): Promise<EnrichmentResult> {
  const emptyResult: EnrichmentResult = {
    email: null,
    phone: null,
    dirigeant: null,
    siret: null,
    source: "linkedin_search",
    confidence: 0,
    metadata: {},
  };

  // Skip if we already have a LinkedIn URL (from google_dork or other source)
  if (context.accumulated.linkedinUrl) {
    return {
      ...emptyResult,
      metadata: {
        skipped: "true",
        reason: "LinkedIn URL already known",
        existing_url: context.accumulated.linkedinUrl,
      },
    };
  }

  // We need a dirigeant name to search for
  const firstName = context.accumulated.dirigeantFirstName;
  const lastName = context.accumulated.dirigeantLastName;

  if (!firstName || !lastName) {
    return {
      ...emptyResult,
      metadata: { error: "No dirigeant name available for LinkedIn search" },
    };
  }

  // Use the linkedin-finder helper (Apollo → Google CSE → skip)
  const companyName = lead.name
    .replace(/\b(sarl|sas|sa|eurl|sasu|sci|snc)\b/gi, "")
    .trim();

  const result = await findLinkedInUrl(
    firstName,
    lastName,
    companyName,
    context.domain,
  );

  if (!result) {
    return {
      ...emptyResult,
      metadata: { error: "LinkedIn profile not found" },
    };
  }

  // Build metadata — the linkedin_url key is recognized by updateAccumulated
  const metadata: Record<string, string> = {
    linkedin_url: result.url,
    strategy: result.strategy,
    dirigeant_searched: `${firstName} ${lastName}`,
  };

  return {
    email: null, // This source doesn't find emails directly
    phone: null,
    dirigeant: context.accumulated.dirigeant, // Pass through
    siret: null,
    source: "linkedin_search",
    confidence: 0, // Will be set by computeConfidence
    metadata,
  };
}

/* ------------------------------------------------------------------ */
/*  Register Source                                                     */
/* ------------------------------------------------------------------ */

registerSource("linkedin_search", linkedinSearchSource);

export { linkedinSearchSource };
