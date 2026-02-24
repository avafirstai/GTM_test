import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/enrich/sources — Health check for enrichment sources
 *
 * Returns which sources have their API keys configured.
 */
export async function GET() {
  const sources = [
    {
      name: "dns_intel",
      label: "DNS / MX Pre-check",
      configured: true, // No API key needed
      tier: "free" as const,
    },
    {
      name: "schema_org",
      label: "Schema.org / JSON-LD",
      configured: true, // No API key needed
      tier: "free" as const,
    },
    {
      name: "deep_scrape",
      label: "Deep HTML Scraping",
      configured: true, // No API key needed
      tier: "free" as const,
    },
    {
      name: "sirene",
      label: "SIRENE / INSEE",
      configured: true, // Uses free public API
      tier: "fr_public" as const,
    },
    {
      name: "email_permutation",
      label: "Email Permutation",
      configured: true, // No API key needed
      tier: "fr_public" as const,
    },
    {
      name: "google_dork",
      label: "Google Dorking",
      configured: !!process.env.GOOGLE_CSE_API_KEY && !!process.env.GOOGLE_CSE_CX,
      tier: "freemium" as const,
    },
    {
      name: "kaspr",
      label: "Kaspr (LinkedIn)",
      configured: !!process.env.KASPR_API_KEY,
      tier: "paid" as const,
    },
  ];

  return NextResponse.json({
    success: true,
    sources,
    totalConfigured: sources.filter((s) => s.configured).length,
    total: sources.length,
  });
}
