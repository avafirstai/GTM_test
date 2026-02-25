/**
 * Waterfall Enrichment Engine — Main Entry Point
 *
 * Import this file to initialize all sources and access the waterfall runner.
 *
 * Usage:
 *   import { runWaterfall, runWaterfallBatch } from "@/lib/enrichment";
 */

// --- Register all sources (side-effect imports) ---
// Each source auto-registers itself via registerSource() on import
import "./sources/dns-intel";
import "./sources/schema-org";
import "./sources/deep-scrape";
import "./sources/sirene";
import "./sources/email-permutation";
import "./sources/google-dork";
import "./sources/linkedin-search";
import "./sources/kaspr";

// --- Re-export public API ---
export { runWaterfall, runWaterfallBatch } from "./waterfall";
export { computeConfidence, computeAggregateConfidence, selectBestEmail } from "./confidence";
export { findLinkedInUrl } from "./sources/linkedin-finder";
export type {
  EnrichmentResult,
  EnrichmentPipelineResult,
  EnrichmentLeadInput,
  EnrichmentContext,
  EnrichmentSource,
  EnrichmentSourceFn,
  WaterfallConfig,
} from "./types";
export {
  DEFAULT_SOURCES,
  DEFAULT_WATERFALL_CONFIG,
} from "./types";
