import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/enrich/people — DEPRECATED
 *
 * Apollo integration has been removed. Decision-maker discovery
 * is now handled by the waterfall enrichment pipeline
 * (sources: deep_scrape → sirene → google_dork → linkedin_search → kaspr).
 */
export async function POST() {
  return NextResponse.json(
    {
      success: false,
      error: "Apollo removed — use waterfall enrichment (/api/enrich/v2/single or /api/enrich/v2/stream)",
      people: [],
    },
    { status: 503 },
  );
}
