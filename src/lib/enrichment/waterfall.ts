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
  EnrichedEmail,
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
  // Merge dirigeants (array-based accumulation with field-level merge)
  // When the same person is found by multiple sources, merge non-null fields
  // so that e.g. deep_scrape finds the name, google_dork adds linkedinUrl,
  // and kaspr adds verified email — all on the same DM object.
  if (result.dirigeants && result.dirigeants.length > 0) {
    for (const dm of result.dirigeants) {
      const normName = dm.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const existingIdx = context.accumulated.decisionMakers.findIndex((existing) => {
        const existNorm = existing.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        return existNorm === normName;
      });
      if (existingIdx >= 0) {
        // Same person — merge fields (non-null/non-empty wins, higher confidence wins)
        const ex = context.accumulated.decisionMakers[existingIdx];
        context.accumulated.decisionMakers[existingIdx] = {
          name: dm.name || ex.name,
          firstName: dm.firstName || ex.firstName,
          lastName: dm.lastName || ex.lastName,
          title: dm.title || ex.title,
          email: dm.email || ex.email,
          phone: dm.phone || ex.phone,
          linkedinUrl: dm.linkedinUrl || ex.linkedinUrl,
          source: dm.email ? dm.source : (dm.linkedinUrl && !ex.linkedinUrl ? dm.source : ex.source),
          confidence: Math.max(dm.confidence ?? 0, ex.confidence ?? 0),
        };
      } else {
        context.accumulated.decisionMakers.push(dm);
      }
    }
  }

  // Backward compat: keep scalar dirigeant from first DM
  if (!context.accumulated.dirigeant && context.accumulated.decisionMakers.length > 0) {
    const first = context.accumulated.decisionMakers[0];
    context.accumulated.dirigeant = first.name;
    context.accumulated.dirigeantFirstName = first.firstName;
    context.accumulated.dirigeantLastName = first.lastName;
  }

  // Legacy path: single dirigeant from sources not yet returning dirigeants[]
  if (result.dirigeant && !context.accumulated.dirigeant) {
    context.accumulated.dirigeant = result.dirigeant;
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
      decisionMakers: [],
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

  console.log(
    `[Waterfall] START leadId=${lead.id} domain=${domain} sources=[${sortedSources.map((s) => s.name).join(",")}]`,
  );

  for (const source of sortedSources) {
    // --- Guard: max sources reached ---
    if (sourcesTried.length >= config.maxSources) {
      console.log(`[Waterfall] SKIP source=${source.name} reason=maxSources(${config.maxSources})`);
      break;
    }

    // --- Guard: Kaspr opt-in check ---
    if (source.name === "kaspr") {
      if (!config.useKaspr) {
        console.log(`[Waterfall] SKIP source=kaspr reason=useKaspr=false`);
        continue;
      }
      if (config.minScoreForPaid > 0 && (lead.score ?? 0) < config.minScoreForPaid) {
        console.log(`[Waterfall] SKIP source=kaspr reason=score(${lead.score ?? 0})<minScore(${config.minScoreForPaid})`);
        continue;
      }
      // Check BOTH scalar linkedinUrl AND individual DM linkedinUrls
      // The multi-DM path in kaspr.ts filters DMs with linkedinUrl independently,
      // but the waterfall guard was only checking the scalar — causing Kaspr to be
      // skipped even when individual DMs had LinkedIn URLs from google_dork/linkedin_search
      const hasAnyLinkedInUrl = context.accumulated.linkedinUrl ||
        context.accumulated.decisionMakers.some((dm) => dm.linkedinUrl);
      if (!hasAnyLinkedInUrl) {
        console.log(`[Waterfall] SKIP source=kaspr reason=noLinkedInUrl (scalar=${context.accumulated.linkedinUrl ?? "null"}, dms_with_linkedin=${context.accumulated.decisionMakers.filter((dm) => dm.linkedinUrl).length})`);
        continue;
      }
    }

    // --- Guard: skip MX-dependent email sources if domain has no MX ---
    if (skipEmailSources && isEmailSource(source.name)) {
      console.log(`[Waterfall] SKIP source=${source.name} reason=noMxRecords`);
      continue;
    }

    // --- Guard: source function must be registered ---
    const sourceFn = sourceRegistry.get(source.name);
    if (!sourceFn) {
      console.warn(`[Waterfall] WARN source=${source.name} not registered — skipping`);
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
      console.error(
        `[Waterfall] Source ${source.name} THREW:`,
        err instanceof Error ? err.message : "unknown error",
      );
    }

    if (!result) {
      const elapsed = Date.now() - sourceStart;
      const isTimeout = elapsed >= config.timeoutPerSource * 0.9;
      console.log(
        `[Waterfall] source=${source.name} result=null reason=${isTimeout ? "TIMEOUT" : "error"} duration=${elapsed}ms timeout=${config.timeoutPerSource}ms`,
      );
      continue;
    }

    // Record duration
    result.durationMs = Date.now() - sourceStart;

    // Compute confidence for this result
    result.confidence = computeConfidence(result, domain);

    // Update accumulated context with new data
    updateAccumulated(context, result);

    console.log(
      `[Waterfall] source=${source.name} email=${result.email ?? "null"} phone=${result.phone ?? "null"} dirigeant=${result.dirigeant ?? "null"} confidence=${result.confidence} duration=${result.durationMs}ms`,
    );

    // Check if this source signals to skip MX-dependent email sources
    if (result.skipEmailSources) {
      skipEmailSources = true;
      console.log(`[Waterfall] source=${source.name} set skipEmailSources=true (no MX)`);
    }

    allResults.push(result);

    // --- Early stop: confidence threshold reached ---
    const aggregateConfidence = computeAggregateConfidence(allResults);
    if (aggregateConfidence >= config.stopOnConfidence) {
      // NEVER early-stop before ALL sources (including Kaspr) have had a chance.
      // Quality > speed: Kaspr (source #8) provides verified personal emails
      // that are far more valuable than early generic emails at 80% confidence.
      const MIN_SOURCES_BEFORE_EARLY_STOP = 8;
      if (sourcesTried.length < MIN_SOURCES_BEFORE_EARLY_STOP) {
        console.log(
          `[Waterfall] SKIP early-stop: confidence=${aggregateConfidence} but only ${sourcesTried.length}/${MIN_SOURCES_BEFORE_EARLY_STOP} sources tried (quality>speed)`,
        );
      } else {
        console.log(`[Waterfall] EARLY STOP confidence=${aggregateConfidence}>=${config.stopOnConfidence}`);
        break;
      }
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

  // --- Classify emails: global (generic) vs dirigeant (personal) ---
  const { emailGlobal, emailDirigeant } = classifyEmails(
    allResults,
    context.accumulated.dirigeant,
    context.accumulated.dirigeantFirstName,
    context.accumulated.dirigeantLastName,
  );

  // bestEmail = best overall (prefer dirigeant > global for outreach)
  const bestEmail = emailDirigeant ?? emailGlobal ?? bestEmailResult?.email ?? null;

  // --- Build enrichmentEmails: full provenance for EVERY email found ---
  const enrichmentEmails = buildEnrichmentEmails(
    allResults,
    context.accumulated.decisionMakers,
    bestEmail,
    emailGlobal,
    emailDirigeant,
    context.accumulated.dirigeantFirstName,
    context.accumulated.dirigeantLastName,
  );

  console.log(
    `[Waterfall] DONE leadId=${lead.id} bestEmail=${bestEmail ?? "null"} emailGlobal=${emailGlobal ?? "null"} emailDirigeant=${emailDirigeant ?? "null"} bestPhone=${bestPhone ?? "null"} dirigeant=${context.accumulated.dirigeant ?? "null"} emails_found=${enrichmentEmails.length} sources=[${sourcesTried.join(",")}] confidence=${finalConfidence} duration=${Date.now() - startTime}ms`,
  );

  return {
    leadId: lead.id,
    bestEmail,
    emailGlobal,
    emailDirigeant,
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
    decisionMakers: context.accumulated.decisionMakers,
    enrichmentEmails,
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Build the full enrichmentEmails array with provenance for every email discovered.
 * Deduplicates by email address (keeps highest-confidence entry per email).
 * Classifies each as global/dirigeant/unknown and marks the bestEmail.
 */
function buildEnrichmentEmails(
  allResults: EnrichmentResult[],
  decisionMakers: Array<{ name: string; email: string | null; source: string; confidence: number }>,
  bestEmail: string | null,
  emailGlobal: string | null,
  emailDirigeant: string | null,
  firstName: string | null,
  lastName: string | null,
): EnrichedEmail[] {
  // Map: lowercase email → best EnrichedEmail entry
  const emailMap = new Map<string, EnrichedEmail>();

  const normFirst = firstName?.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") ?? "";
  const normLast = lastName?.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") ?? "";

  function classifyType(email: string, source: string): "global" | "dirigeant" | "unknown" {
    const lower = email.toLowerCase();
    // Already classified by the pipeline
    if (emailDirigeant && lower === emailDirigeant.toLowerCase()) return "dirigeant";
    if (emailGlobal && lower === emailGlobal.toLowerCase()) return "global";

    const prefix = lower.split("@")[0] ?? "";
    if (GENERIC_PREFIXES.has(prefix)) return "global";

    // Kaspr + email_permutation always target the dirigeant
    if (source === "kaspr" || source === "email_permutation") return "dirigeant";

    // Name match check
    if (normFirst && normLast) {
      const isNameMatch =
        prefix === `${normFirst}.${normLast}` ||
        prefix === `${normFirst[0]}.${normLast}` ||
        prefix === `${normFirst}${normLast}` ||
        prefix === `${normLast}.${normFirst}` ||
        prefix === `${normLast}` ||
        (prefix.includes(normFirst) && prefix.includes(normLast));
      if (isNameMatch) return "dirigeant";
    }

    return "unknown";
  }

  function findPersonName(email: string): string | null {
    const lower = email.toLowerCase();
    for (const dm of decisionMakers) {
      if (dm.email && dm.email.toLowerCase() === lower) return dm.name;
    }
    return null;
  }

  // 1. Emails from source results (scalar email per source)
  for (const r of allResults) {
    if (!r.email) continue;
    const lower = r.email.toLowerCase();
    const existing = emailMap.get(lower);
    // Keep entry with highest confidence
    if (!existing || r.confidence > existing.confidence) {
      emailMap.set(lower, {
        email: r.email.toLowerCase(),
        source: r.source,
        confidence: r.confidence,
        type: classifyType(r.email, r.source),
        isBest: false,
        personName: findPersonName(r.email),
      });
    }
  }

  // 2. Emails from decision-makers (multi-DM mode — Kaspr, linkedin_search, etc.)
  for (const dm of decisionMakers) {
    if (!dm.email) continue;
    const lower = dm.email.toLowerCase();
    const existing = emailMap.get(lower);
    if (!existing || dm.confidence > existing.confidence) {
      emailMap.set(lower, {
        email: dm.email.toLowerCase(),
        source: dm.source,
        confidence: dm.confidence,
        type: "dirigeant",
        isBest: false,
        personName: dm.name,
      });
    }
  }

  // 3. Mark the bestEmail
  if (bestEmail) {
    const entry = emailMap.get(bestEmail.toLowerCase());
    if (entry) entry.isBest = true;
  }

  // Sort: isBest first, then dirigeant > global > unknown, then by confidence desc
  const typeOrder: Record<string, number> = { dirigeant: 0, global: 1, unknown: 2 };
  return Array.from(emailMap.values()).sort((a, b) => {
    if (a.isBest !== b.isBest) return a.isBest ? -1 : 1;
    const typeA = typeOrder[a.type] ?? 3;
    const typeB = typeOrder[b.type] ?? 3;
    if (typeA !== typeB) return typeA - typeB;
    return b.confidence - a.confidence;
  });
}

/**
 * Generic email prefixes — company-wide, not personal.
 */
const GENERIC_PREFIXES = new Set([
  "contact", "info", "accueil", "hello", "bonjour", "reception",
  "admin", "service", "direction", "commercial", "support", "sales",
  "office", "team", "mail", "noreply", "no-reply",
]);

/**
 * Classify all discovered emails into two buckets:
 * - emailGlobal: generic company email (contact@, info@, etc.)
 * - emailDirigeant: personal email matching the dirigeant name
 *
 * Uses name matching, source context, and email prefix analysis.
 */
function classifyEmails(
  results: EnrichmentResult[],
  dirigeant: string | null,
  firstName: string | null,
  lastName: string | null,
): { emailGlobal: string | null; emailDirigeant: string | null } {
  let emailGlobal: string | null = null;
  let emailDirigeant: string | null = null;

  // Collect all unique emails with their source info
  const emailEntries: Array<{
    email: string;
    source: string;
    confidence: number;
    isFromKaspr: boolean;
    isFromPermutation: boolean;
  }> = [];

  for (const r of results) {
    if (!r.email) continue;
    emailEntries.push({
      email: r.email.toLowerCase(),
      source: r.source,
      confidence: r.confidence,
      isFromKaspr: r.source === "kaspr",
      isFromPermutation: r.source === "email_permutation",
    });
  }

  // Normalize dirigeant name for matching
  const normFirst = firstName
    ?.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") ?? "";
  const normLast = lastName
    ?.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") ?? "";

  for (const entry of emailEntries) {
    const prefix = entry.email.split("@")[0] ?? "";

    // Check if this is a generic email
    const isGeneric = GENERIC_PREFIXES.has(prefix);

    // Check if this email matches the dirigeant name
    let isDirigeantMatch = false;
    if (normFirst && normLast) {
      isDirigeantMatch =
        prefix === `${normFirst}.${normLast}` ||
        prefix === `${normFirst[0]}.${normLast}` ||
        prefix === `${normFirst}${normLast}` ||
        prefix === `${normLast}.${normFirst}` ||
        prefix === `${normLast}` ||
        (prefix.includes(normFirst) && prefix.includes(normLast));
    }

    // Kaspr and email_permutation results are always dirigeant-targeted
    if (entry.isFromKaspr || entry.isFromPermutation) {
      isDirigeantMatch = true;
    }

    if (isGeneric) {
      if (!emailGlobal || entry.confidence > 0) {
        emailGlobal = entry.email;
      }
    } else if (isDirigeantMatch) {
      if (!emailDirigeant || entry.confidence > (emailEntries.find((e) => e.email === emailDirigeant)?.confidence ?? 0)) {
        emailDirigeant = entry.email;
      }
    } else {
      // Non-generic, non-dirigeant — treat as global (could be another employee)
      if (!emailGlobal) {
        emailGlobal = entry.email;
      }
    }
  }

  return { emailGlobal, emailDirigeant };
}

/**
 * Sources that REQUIRE MX records to work (they verify/generate emails).
 * schema_org and deep_scrape are NOT in this set — they find emails
 * published on web pages via HTML parsing, independent of MX records.
 * Kaspr is NOT here — it enriches from LinkedIn profiles, not domain MX.
 */
const EMAIL_SOURCES = new Set([
  "email_permutation",
  "google_dork",
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
