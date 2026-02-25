/**
 * Waterfall Enrichment Engine — Shared Types
 *
 * Central type definitions for the multi-source enrichment pipeline.
 * Every source module imports from here.
 */

/* ------------------------------------------------------------------ */
/*  Source Configuration                                               */
/* ------------------------------------------------------------------ */

/** Identifies a single enrichment source in the waterfall */
export interface EnrichmentSource {
  /** Unique key: "dns_intel" | "schema_org" | "deep_scrape" | "sirene" | etc. */
  name: string;
  /** Execution order — lower = tried first (1-based) */
  priority: number;
  /** Whether this source is active in the current run */
  enabled: boolean;
  /** Tier for UI grouping: free sources first, paid last */
  tier: "free" | "fr_public" | "freemium" | "paid";
}

/* ------------------------------------------------------------------ */
/*  Per-Source Result                                                   */
/* ------------------------------------------------------------------ */

/** Result returned by each individual enrichment source */
export interface EnrichmentResult {
  /** Best email found by this source (null = not found) */
  email: string | null;
  /** Best phone found (E.164 or FR format) */
  phone: string | null;
  /** Company director / decision-maker name */
  dirigeant: string | null;
  /** French SIRET number (14 digits) */
  siret: string | null;
  /** Which source produced this result */
  source: string;
  /** Confidence score 0-100 for the primary data found */
  confidence: number;
  /** Extra data: linkedin_url, title, mx_provider, naf_code, etc. */
  metadata: Record<string, string>;
  /** Whether to skip email-related sources for this lead (e.g. no MX) */
  skipEmailSources?: boolean;
  /** Duration of this source in ms */
  durationMs?: number;
  /** Multiple decision-makers found by this source */
  dirigeants?: DecisionMakerData[];
}

/* ------------------------------------------------------------------ */
/*  Enriched Email (per-email provenance)                              */
/* ------------------------------------------------------------------ */

/** A single email discovered during enrichment, with full provenance */
export interface EnrichedEmail {
  email: string;
  /** Which enrichment source found this email */
  source: string;
  /** Confidence score 0-100 */
  confidence: number;
  /** "global" (contact@, info@) | "dirigeant" (personal) | "unknown" */
  type: "global" | "dirigeant" | "unknown";
  /** Is this the one selected as bestEmail? */
  isBest: boolean;
  /** Name of the person this email belongs to (if known) */
  personName: string | null;
  /** Whether this email passed SMTP verification */
  smtpVerified?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Decision Maker (per-person data)                                   */
/* ------------------------------------------------------------------ */

/** A single decision-maker discovered during enrichment */
export interface DecisionMakerData {
  name: string;
  firstName: string;
  lastName: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  /** Which enrichment source found this person */
  source: string;
  /** Confidence score 0-100 */
  confidence: number;
}

/* ------------------------------------------------------------------ */
/*  Waterfall Configuration                                            */
/* ------------------------------------------------------------------ */

/** Controls how the waterfall engine behaves */
export interface WaterfallConfig {
  /** Ordered list of sources to try */
  sources: EnrichmentSource[];
  /** Stop cascade when best confidence >= this threshold (default 80) */
  stopOnConfidence: number;
  /** Max number of sources to attempt per lead */
  maxSources: number;
  /** Timeout per individual source in ms (default 10000) */
  timeoutPerSource: number;
  /** Only use Kaspr if explicitly opted-in (saves credits) */
  useKaspr: boolean;
  /** Minimum lead score to use paid sources (default 30) */
  minScoreForPaid: number;
}

/* ------------------------------------------------------------------ */
/*  Pipeline (aggregate) Result                                        */
/* ------------------------------------------------------------------ */

/** Final result after running all applicable sources for one lead */
export interface EnrichmentPipelineResult {
  leadId: string;
  /** Best email across all sources (highest confidence) — backward compat */
  bestEmail: string | null;
  /** Generic company email (contact@, info@, etc.) */
  emailGlobal: string | null;
  /** Personal email of the dirigeant / decision-maker */
  emailDirigeant: string | null;
  /** Best phone across all sources */
  bestPhone: string | null;
  /** Director / decision-maker name */
  dirigeant: string | null;
  /** Director's LinkedIn URL if found */
  dirigeantLinkedin: string | null;
  /** SIRET number */
  siret: string | null;
  /** MX provider (google, outlook, ovh, etc.) */
  mxProvider: string | null;
  /** Whether domain has MX records */
  hasMx: boolean;
  /** All individual source results for transparency */
  allResults: EnrichmentResult[];
  /** Aggregated confidence (max + multi-source bonus) */
  finalConfidence: number;
  /** Sources that were tried, in order */
  sourcesTried: string[];
  /** Total pipeline duration in ms */
  durationMs: number;
  /** All decision-makers found across sources with their emails/phones/LinkedIn */
  decisionMakers: DecisionMakerData[];
  /** ALL emails found with full provenance (source, confidence, type) */
  enrichmentEmails: EnrichedEmail[];
}

/* ------------------------------------------------------------------ */
/*  Lead Input (what we pass into the waterfall)                       */
/* ------------------------------------------------------------------ */

/** Minimal lead data needed by the enrichment pipeline */
export interface EnrichmentLeadInput {
  id: string;
  name: string;
  website: string;
  city?: string;
  category?: string;
  score?: number;
  /** Pre-existing email (skip if already enriched) */
  email?: string;
  /** Pre-existing phone */
  phone?: string;
}

/* ------------------------------------------------------------------ */
/*  Source Function Signature                                           */
/* ------------------------------------------------------------------ */

/** Every source module must export a function matching this signature */
export type EnrichmentSourceFn = (
  lead: EnrichmentLeadInput,
  context: EnrichmentContext,
) => Promise<EnrichmentResult>;

/** Shared context passed to each source (accumulated data from prior sources) */
export interface EnrichmentContext {
  /** Domain extracted from lead.website */
  domain: string;
  /** Data accumulated from previous sources in the cascade */
  accumulated: {
    dirigeant: string | null;
    dirigeantFirstName: string | null;
    dirigeantLastName: string | null;
    siret: string | null;
    linkedinUrl: string | null;
    mxProvider: string | null;
    hasMx: boolean;
    emails: string[];
    phones: string[];
    /** All decision-makers accumulated from all sources */
    decisionMakers: DecisionMakerData[];
  };
}

/* ------------------------------------------------------------------ */
/*  Default Config                                                     */
/* ------------------------------------------------------------------ */

export const DEFAULT_SOURCES: EnrichmentSource[] = [
  { name: "dns_intel",          priority: 1, enabled: true,  tier: "free" },
  { name: "schema_org",         priority: 2, enabled: true,  tier: "free" },
  { name: "deep_scrape",        priority: 3, enabled: true,  tier: "free" },
  { name: "sirene",             priority: 4, enabled: true,  tier: "fr_public" },
  { name: "email_permutation",  priority: 5, enabled: true,  tier: "fr_public" },
  { name: "google_dork",        priority: 6, enabled: true,  tier: "freemium" }, // Graceful no-op if GOOGLE_CSE env vars missing
  { name: "linkedin_search",   priority: 7, enabled: true,  tier: "freemium" }, // Graceful no-op if Apollo/CSE env vars missing
  { name: "kaspr",              priority: 8, enabled: true,  tier: "paid" },     // Requires KASPR_API_KEY env var
];

export const DEFAULT_WATERFALL_CONFIG: WaterfallConfig = {
  sources: DEFAULT_SOURCES,
  stopOnConfidence: 80,
  maxSources: 8,
  timeoutPerSource: 300_000, // 5 min per source — quality > speed
  useKaspr: true,
  minScoreForPaid: 30,
};
