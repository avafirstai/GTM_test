import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") || "2000"), 5000);
  const offset = Number(searchParams.get("offset") || "0");
  const sortBy = searchParams.get("sortBy") || "score";
  const sortDir = searchParams.get("sortDir") || "desc";
  const search = searchParams.get("search") || "";
  const cities = searchParams.getAll("city").filter(Boolean);
  const categories = searchParams.getAll("category").filter(Boolean);
  const hasEmail = searchParams.get("hasEmail") || "";
  const enrichmentStatus = searchParams.get("enrichmentStatus") || "";

  let query = supabase
    .from("gtm_leads")
    .select(
      "id, name, city, phone, website, email, category, rating, reviews, score, address, apify_run, created_at, siret, dirigeant, dirigeant_linkedin, mx_provider, has_mx, enrichment_source, enrichment_confidence, enriched_at, enrichment_status, enrichment_attempts, enrichment_failed_at, google_maps_url, source",
      { count: "exact" }
    );

  // Filters — sanitize search to prevent PostgREST filter injection
  if (search) {
    const safeSearch = search.replace(/[%_(),."'\\]/g, "");
    if (safeSearch.length > 0) {
      query = query.or(
        `name.ilike.%${safeSearch}%,city.ilike.%${safeSearch}%,email.ilike.%${safeSearch}%,category.ilike.%${safeSearch}%`
      );
    }
  }
  if (cities.length === 1) {
    query = query.eq("city", cities[0]);
  } else if (cities.length > 1) {
    query = query.in("city", cities);
  }
  if (categories.length === 1) {
    query = query.eq("category", categories[0]);
  } else if (categories.length > 1) {
    query = query.in("category", categories);
  }
  if (hasEmail === "yes") {
    query = query.not("email", "is", null).neq("email", "");
  } else if (hasEmail === "no") {
    query = query.or("email.is.null,email.eq.");
  }
  if (enrichmentStatus) {
    const allowedStatuses = ["pending", "enriched", "failed", "skipped"];
    if (allowedStatuses.includes(enrichmentStatus)) {
      query = query.eq("enrichment_status", enrichmentStatus);
    }
  }

  // Sort — only allow safe column names
  const allowedSorts = ["score", "name", "city", "rating", "reviews", "created_at", "enrichment_confidence", "enriched_at"];
  const safeSortBy = allowedSorts.includes(sortBy) ? sortBy : "score";
  const ascending = sortDir === "asc";

  query = query
    .order(safeSortBy, { ascending })
    .range(offset, offset + limit - 1);

  const { data: leads, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    leads: leads || [],
    total: count || 0,
    limit,
    offset,
  });
}
