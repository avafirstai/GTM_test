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
  DecisionMakerData,
} from "../types";
import { registerSource } from "../waterfall";
import { findLinkedInUrl } from "./linkedin-finder";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** Max DMs to search LinkedIn for (saves API quota) */
const MAX_LINKEDIN_SEARCH_DMS = 2;

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

  const companyName = lead.name
    .replace(/\b(sarl|sas|sa|eurl|sasu|sci|snc)\b/gi, "")
    .trim();

  // Multi-DM mode: find LinkedIn for DMs that don't have one yet
  const dmsWithoutLinkedIn = context.accumulated.decisionMakers
    .filter((dm) => !dm.linkedinUrl && dm.firstName && dm.lastName)
    .slice(0, MAX_LINKEDIN_SEARCH_DMS);

  if (dmsWithoutLinkedIn.length > 0) {
    const searchPromises = dmsWithoutLinkedIn.map((dm) =>
      findLinkedInUrl(dm.firstName, dm.lastName, companyName, context.domain)
        .then((result) => ({ dm, result })),
    );

    const results = await Promise.allSettled(searchPromises);

    const updatedDms: DecisionMakerData[] = [];
    const metadata: Record<string, string> = {
      dm_searched: String(dmsWithoutLinkedIn.length),
    };
    let found = 0;

    for (const settled of results) {
      if (settled.status !== "fulfilled" || !settled.value.result) continue;
      const { dm, result } = settled.value;
      dm.linkedinUrl = result.url;
      found++;
      updatedDms.push({ ...dm, source: "linkedin_search" });
    }

    metadata["linkedin_found"] = String(found);

    // Also set scalar backward compat if first DM got a URL
    if (found > 0) {
      metadata["linkedin_url"] = updatedDms[0].linkedinUrl ?? "";
    }

    return {
      ...emptyResult,
      metadata,
      dirigeants: updatedDms.length > 0 ? updatedDms : undefined,
    };
  }

  // Legacy fallback: single dirigeant scalar
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

  const firstName = context.accumulated.dirigeantFirstName;
  const lastName = context.accumulated.dirigeantLastName;

  if (!firstName || !lastName) {
    return {
      ...emptyResult,
      metadata: { error: "No dirigeant name available for LinkedIn search" },
    };
  }

  const result = await findLinkedInUrl(firstName, lastName, companyName, context.domain);

  if (!result) {
    return {
      ...emptyResult,
      metadata: { error: "LinkedIn profile not found" },
    };
  }

  const metadata: Record<string, string> = {
    linkedin_url: result.url,
    strategy: result.strategy,
    dirigeant_searched: `${firstName} ${lastName}`,
  };

  return {
    email: null,
    phone: null,
    dirigeant: context.accumulated.dirigeant,
    siret: null,
    source: "linkedin_search",
    confidence: 0,
    metadata,
  };
}

/* ------------------------------------------------------------------ */
/*  Register Source                                                     */
/* ------------------------------------------------------------------ */

registerSource("linkedin_search", linkedinSearchSource);

export { linkedinSearchSource };
