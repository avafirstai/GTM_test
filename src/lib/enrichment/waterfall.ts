/**
 * Waterfall Enrichment Engine — Core Orchestrator
 *
 * Runs enrichment sources in priority order (free → paid).
 * Stops early when confidence reaches the threshold.
 * Aggregates results and picks the best email/phone/data.
 */

import type {
  EnrichmentLeadInput,
  EnrichmentResult,
  EnrichmentContext,
  EnrichmentPipelineResult,
  EnrichmentSourceFn,
  WaterfallConfig,
} from "./types";
import { DEFAULT_WATERFALL_CONFIG } from "./types";
import {
  computeConfidence,
  computeAggregateConfidence,
  selectBestEmail,
} from "./confidence";

/* ------------------------------------------------------------------ */
/*  Source Registry                                                     */
/* ------------------------------------------------------------------ */

/**
 * Registry mapping source names to their async functions.
 * Each source module registers itself here via `registerSource()`.
 */
const sourceRegistry = new Map<string, EnrichmentSourceFn>();

/** Register an enrichment source function */
export function registerSource(name: string, fn: EnrichmentSourceFn): void {
  sourceRegistry.set(name, fn);
}

/** Check if a source is registered */
export function hasSource(name: string): boolean {
  return sourceRegistry.has(name);
}

/* ------------------------------------------------------------------ */
/*  Domain Extraction                                                  */
/* ------------------------------------------------------------------ */

/** Extract clean domain from a website URL */
function extractDomain(website: string): string {
  try {
    let url = website.trim();
    if (!url.startsWith("http")) url = `https://${url}`;
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    // Fallback: strip protocol and www manually
    return website
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split("/")[0]
      .trim();
  }
}

/* ------------------------------------------------------------------ */
/*  Timeout Wrapper                                                    */
/* ------------------------------------------------------------------ */

/** Run a source function with a timeout. Returns null on timeout. */
async function runWithTimeout(
  fn: EnrichmentSourceFn,
  lead: EnrichmentLeadInput,
  context: EnrichmentContext,
  timeoutMs: number,
): Promise<EnrichmentResult | null> {
  return Promise.race([
    fn(lead, context),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

/* ------------------------------------------------------------------ */
/*  Accumulator — merge source results into shared context             */
/* ------------------------------------------------------------------ */

function updateAccumulated(
  context: EnrichmentContext,
  result: EnrichmentResult,
): void {
  // Merge dirigeant
  if (result.dirigeant && !context.accumulated.dirigeant) {
    context.accumulated.dirigeant = result.dirigeant;

    // Try to split into first/last name
    const parts = result.dirigeant.trim().split(/\s+/);
    if (parts.length >= 2) {
      context.accumulated.dirigeantFirstName = parts[0];
      context.accumulated.dirigeantLastName = parts.slice(1).join(" ");
    }
  }

  // Merge SIRET
  if (result.siret && !context.accumulated.siret) {
    context.accumulated.siret = result.siret;
  }

  // Merge LinkedIn URL from metadata
  const linkedinUrl =
    result.metadata["linkedin_url"] || result.metadata["dirigeant_linkedin"];
  if (linkedinUrl && !context.accumulated.linkedinUrl) {
    context.accumulated.linkedinUrl = linkedinUrl;
  }

  // Merge MX provider from metadata
  const mxProvider = result.metadata["mx_provider"];
  if (mxProvider && !context.accumulated.mxProvider) {
    context.accumulated.mxProvider = mxProvider;
  }

  // Merge hasMx flag
  if (result.metadata["has_mx"] === "true") {
    context.accumulated.hasMx = true;
  } else if (result.metadata["has_mx"] === "false") {
    context.accumulated.hasMx = false;
  }

  // Collect emails (deduplicated)
  if (result.email) {
    const lower = result.email.toLowerCase();
    if (!context.accumulated.emails.includes(lower)) {
      context.accumulated.emails.push(lower);
    }
  }

  // Collect phones (deduplicated)
  if (result.phone) {
    if (!context.accumulated.phones.includes(result.phone)) {
      context.accumulated.phones.push(result.phone);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Main Waterfall Runner                                              */
/* ------------------------------------------------------------------ */

/**
 * Run the full waterfall enrichment pipeline for a single lead.
 *
 * Executes sources in priority order. Stops early when:
 * - Confidence reaches `stopOnConfidence` threshold
 * - Max number of sources attempted
 * - All sources have been tried
 *
 * Kaspr (paid) is only used if `config.useKaspr` is true AND
 * the lead score >= `config.minScoreForPaid`.
 */
export async function runWaterfall(
  lead: EnrichmentLeadInput,
  config: WaterfallConfig = DEFAULT_WATERFALL_CONFIG,
): Promise<EnrichmentPipelineResult> {
  const startTime = Date.now();
  const domain = extractDomain(lead.website);

  // Initialize shared context
  const context: EnrichmentContext = {
    domain,
    accumulated: {
      dirigeant: null,
      dirigeantFirstName: null,
      dirigeantLastName: null,
      siret: null,
      linkedinUrl: null,
      mxProvider: null,
      hasMx: true, // Assume true until DNS check says otherwise
      emails: [],
      phones: [],
    },
  };

  // Pre-populate with any existing lead data
  if (lead.email) {
    context.accumulated.emails.push(lead.email.toLowerCase());
  }
  if (lead.phone) {
    context.accumulated.phones.push(lead.phone);
  }

  const allResults: EnrichmentResult[] = [];
  const sourcesTried: string[] = [];
  let skipEmailSources = false;

  // Sort sources by priority (ascending = tried first)
  const sortedSources = [...config.sources]
    .filter((s) => s.enabled)
    .sort((a, b) => a.priority - b.priority);

  for (const source of sortedSources) {
    // --- Guard: max sources reached ---
    if (sourcesTried.length >= config.maxSources) {
      break;
    }

    // --- Guard: Kaspr opt-in check ---
    if (source.name === "kaspr") {
      if (!config.useKaspr) continue;
      if ((lead.score ?? 0) < config.minScoreForPaid) continue;
      // Need a LinkedIn URL to call Kaspr
      if (!context.accumulated.linkedinUrl) continue;
    }

    // --- Guard: skip email sources if domain has no MX ---
    if (skipEmailSources && isEmailSource(source.name)) {
      continue;
    }

    // --- Guard: source function must be registered ---
    const sourceFn = sourceRegistry.get(source.name);
    if (!sourceFn) {
      // Source not yet implemented — skip silently
      continue;
    }

    // --- Execute source with timeout ---
    sourcesTried.push(source.name);
    const sourceStart = Date.now();

    let result: EnrichmentResult | null = null;
    try {
      result = await runWithTimeout(
        sourceFn,
        lead,
        context,
        config.timeoutPerSource,
      );
    } catch (err) {
      // Source threw an error — log and continue to next source
      console.error(
        `[Waterfall] Source ${source.name} failed:`,
        err instanceof Error ? err.message : "unknown error",
      );
    }

    if (!result) {
      // Timeout or error — continue to next source
      continue;
    }

    // Record duration
    result.durationMs = Date.now() - sourceStart;

    // Compute confidence for this result
    result.confidence = computeConfidence(result, domain);

    // Update accumulated context with new data
    updateAccumulated(context, result);

    // Check if this source signals to skip email sources (e.g. no MX records)
    if (result.skipEmailSources) {
      skipEmailSources = true;
    }

    allResults.push(result);

    // --- Early stop: confidence threshold reached ---
    const aggregateConfidence = computeAggregateConfidence(allResults);
    if (aggregateConfidence >= config.stopOnConfidence) {
      break;
    }
  }

  // --- Aggregate final results ---
  const bestEmailResult = selectBestEmail(allResults);
  const finalConfidence =
    allResults.length > 0 ? computeAggregateConfidence(allResults) : 0;

  // Find best phone (first non-null from highest confidence source)
  const bestPhone =
    allResults
      .filter((r) => r.phone)
      .sort((a, b) => b.confidence - a.confidence)[0]?.phone ?? null;

  // Find dirigeant LinkedIn URL from metadata
  const dirigeantLinkedin = context.accumulated.linkedinUrl;

  return {
    leadId: lead.id,
    bestEmail: bestEmailResult?.email ?? null,
    bestPhone: bestPhone,
    dirigeant: context.accumulated.dirigeant,
    dirigeantLinkedin,
    siret: context.accumulated.siret,
    mxProvider: context.accumulated.mxProvider,
    hasMx: context.accumulated.hasMx,
    allResults,
    finalConfidence,
    sourcesTried,
    durationMs: Date.now() - startTime,
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Sources that specifically look for email addresses */
const EMAIL_SOURCES = new Set([
  "schema_org",
  "deep_scrape",
  "email_permutation",
  "google_dork",
  "apollo",
  "kaspr",
]);

function isEmailSource(name: string): boolean {
  return EMAIL_SOURCES.has(name);
}

/* ------------------------------------------------------------------ */
/*  Batch Runner (multiple leads)                                      */
/* ------------------------------------------------------------------ */

/**
 * Run the waterfall pipeline on a batch of leads.
 * Processes `concurrency` leads in parallel at a time.
 */
export async function runWaterfallBatch(
  leads: EnrichmentLeadInput[],
  config: WaterfallConfig = DEFAULT_WATERFALL_CONFIG,
  concurrency: number = 3,
): Promise<EnrichmentPipelineResult[]> {
  const results: EnrichmentPipelineResult[] = [];

  for (let i = 0; i < leads.length; i += concurrency) {
    const batch = leads.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((lead) => runWaterfall(lead, config)),
    );

    for (const settled of batchResults) {
      if (settled.status === "fulfilled") {
        results.push(settled.value);
      } else {
        // Log error but don't crash the batch
        console.error(
          "[Waterfall] Batch lead failed:",
          settled.reason instanceof Error
            ? settled.reason.message
            : "unknown error",
        );
      }
    }
  }

  return results;
}
