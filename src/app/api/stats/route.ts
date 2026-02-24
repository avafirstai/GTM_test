import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  // Only select the columns needed for aggregation (no name/address = less data)
  const { data: leads, error } = await supabase
    .from("gtm_leads")
    .select("city, phone, website, email, category, rating, reviews, score");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const totalLeads = leads.length;
  const withEmail = leads.filter((l) => l.email && l.email.trim() !== "").length;
  const withPhone = leads.filter((l) => l.phone && l.phone.trim() !== "").length;
  const withWebsite = leads.filter((l) => l.website && l.website.trim() !== "").length;

  const ratings = leads.filter((l) => l.rating !== null).map((l) => Number(l.rating));
  const avgRating = ratings.length > 0 ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : 0;

  const scores = leads.map((l) => l.score ?? 0);
  const avgScore = scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0;

  const totalReviews = leads.reduce((sum, l) => sum + (l.reviews ?? 0), 0);

  const highScore = leads.filter((l) => (l.score ?? 0) >= 80).length;
  const mediumScore = leads.filter((l) => (l.score ?? 0) >= 50 && (l.score ?? 0) < 80).length;
  const lowScore = leads.filter((l) => (l.score ?? 0) < 50).length;

  // Group by verticale
  const byVerticale: Record<string, number> = {};
  for (const l of leads) {
    if (l.category) {
      byVerticale[l.category] = (byVerticale[l.category] ?? 0) + 1;
    }
  }

  // Group by ville
  const byVille: Record<string, number> = {};
  for (const l of leads) {
    if (l.city) {
      byVille[l.city] = (byVille[l.city] ?? 0) + 1;
    }
  }

  // Category email rates
  const categoryMap: Record<string, { total: number; withEmail: number }> = {};
  for (const l of leads) {
    const cat = l.category ?? "Autre";
    if (!categoryMap[cat]) categoryMap[cat] = { total: 0, withEmail: 0 };
    categoryMap[cat].total += 1;
    if (l.email && l.email.trim() !== "") categoryMap[cat].withEmail += 1;
  }
  const categoryEmailRates = Object.entries(categoryMap)
    .map(([name, d]) => ({ name, total: d.total, withEmail: d.withEmail, rate: d.total > 0 ? Math.round((d.withEmail / d.total) * 1000) / 10 : 0 }))
    .sort((a, b) => b.total - a.total);

  // City email rates
  const cityMap: Record<string, { total: number; withEmail: number }> = {};
  for (const l of leads) {
    const city = l.city ?? "Autre";
    if (!cityMap[city]) cityMap[city] = { total: 0, withEmail: 0 };
    cityMap[city].total += 1;
    if (l.email && l.email.trim() !== "") cityMap[city].withEmail += 1;
  }
  const cityEmailRates = Object.entries(cityMap)
    .map(([name, d]) => ({ name, total: d.total, withEmail: d.withEmail, rate: d.total > 0 ? Math.round((d.withEmail / d.total) * 1000) / 10 : 0 }))
    .sort((a, b) => b.total - a.total);

  // Pipeline stages
  const pipeline = [
    { name: "Scrappe", count: totalLeads, color: "#6366f1" },
    { name: "Email Trouve", count: withEmail, color: "#8b5cf6" },
    { name: "Pret Campagne", count: withEmail, color: "#22c55e" },
    { name: "Contacte", count: 0, color: "#f59e0b" },
    { name: "Repondu", count: 0, color: "#06b6d4" },
    { name: "RDV Booke", count: 0, color: "#10b981" },
  ];

  // Apify runs (static — from original scraping config)
  const apifyRuns = [
    { runId: "WMS8gIAQ5rqzyghf0", datasetId: "1R95ndihhQhYmX7Pv", status: "SUCCEEDED", queriesCount: 30, verticale: "Formation Paris+Lyon", resultsCount: 447 },
    { runId: "JH3n4GsiBgmTidFfm", datasetId: "d75bTGRX0avyXyzJ8", status: "SUCCEEDED", queriesCount: 50, verticale: "Formation France Batch 1", resultsCount: 579 },
    { runId: "gLcR1g5PhdOFUwQRw", datasetId: "KVOtVsZexVIpJCvd7", status: "SUCCEEDED", queriesCount: 50, verticale: "Formation + Auto-ecole", resultsCount: 395 },
    { runId: "BwMU7MRjkqHZpNKL5", datasetId: "fBvNu8dFcJUjiwZAC", status: "SUCCEEDED", queriesCount: 50, verticale: "Multi-verticale Chunk 3", resultsCount: 947 },
    { runId: "XFD7PTtDDYQdWODxO", datasetId: "KFWY4BoPSH7GwZMig", status: "SUCCEEDED", queriesCount: 50, verticale: "Multi-verticale Chunk 4", resultsCount: 925 },
    { runId: "mOb8hvAId5vETHbYP", datasetId: "mKkV3YSzTfRSKPqWz", status: "SUCCEEDED", queriesCount: 50, verticale: "Multi-verticale Chunk 5", resultsCount: 912 },
    { runId: "EBJwkNWs9qnOnDr2H", datasetId: "SlXorLlzSLhf8CfcU", status: "SUCCEEDED", queriesCount: 50, verticale: "Multi-verticale Chunk 6", resultsCount: 921 },
    { runId: "VvsH1PuPTHa1vnIe7", datasetId: "6vTJdV8EPwbYz8qVR", status: "SUCCEEDED", queriesCount: 50, verticale: "Multi-verticale Chunk 7", resultsCount: 914 },
    { runId: "si1VpqXtNqdk1JK21", datasetId: "79cWMFzVOeYKTNj76", status: "SUCCEEDED", queriesCount: 50, verticale: "Multi-verticale Chunk 8", resultsCount: 855 },
    { runId: "UWkYvTtUA3E6OAJde", datasetId: "fB8yPUVaSzNYiw7XB", status: "SUCCEEDED", queriesCount: 50, verticale: "Multi-verticale Chunk 9", resultsCount: 870 },
    { runId: "bivuRtrsbFZhN2mDs", datasetId: "JHdQYQit3CPoZMfe1", status: "SUCCEEDED", queriesCount: 50, verticale: "Multi-verticale Chunk 10", resultsCount: 852 },
  ];

  const enrichment = {
    method: "Website scraping (aiohttp + BeautifulSoup)",
    cost: "0 EUR",
    successRate: totalLeads > 0 ? Math.round((withEmail / totalLeads) * 1000) / 10 : 0,
    totalEmailsFound: withEmail,
    totalLeadsProcessed: totalLeads,
    timestamp: new Date().toISOString(),
  };

  const stats = {
    totalLeads,
    withEmail,
    withoutEmail: totalLeads - withEmail,
    withPhone,
    withWebsite,
    highScore,
    mediumScore,
    lowScore,
    avgScore,
    avgRating,
    totalReviews,
    emailRate: totalLeads > 0 ? Math.round((withEmail / totalLeads) * 1000) / 10 : 0,
    phoneRate: totalLeads > 0 ? Math.round((withPhone / totalLeads) * 1000) / 10 : 0,
    websiteRate: totalLeads > 0 ? Math.round((withWebsite / totalLeads) * 1000) / 10 : 0,
    byVerticale,
    byVille,
    bySource: { "Google Maps Scraping": totalLeads },
    byScore: { high: highScore, medium: mediumScore, low: lowScore },
    lastUpdated: new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" }),
  };

  return NextResponse.json({
    stats,
    pipeline,
    apifyRuns,
    enrichment,
    categoryEmailRates,
    cityEmailRates,
  });
}
