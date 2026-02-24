import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  // Paginate to get ALL leads (Supabase REST defaults to max 1000 rows per request)
  type StatLead = { city: string; phone: string; website: string; email: string; category: string; rating: number; reviews: number; score: number };
  const leads: StatLead[] = [];
  const PAGE = 1000;
  let from = 0;

  for (;;) {
    const { data: page, error: pageErr } = await supabase
      .from("gtm_leads")
      .select("city, phone, website, email, category, rating, reviews, score")
      .range(from, from + PAGE - 1);

    if (pageErr) {
      return NextResponse.json({ error: pageErr.message }, { status: 500 });
    }
    if (!page || page.length === 0) break;
    leads.push(...page);
    if (page.length < PAGE) break;
    from += PAGE;
  }

  const error = null;
  void error; // consumed below for backward compat

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
    enrichment,
    categoryEmailRates,
    cityEmailRates,
  });
}
