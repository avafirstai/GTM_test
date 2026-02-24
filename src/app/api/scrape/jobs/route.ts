import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/scrape/jobs — List scraping jobs
 *
 * Query params:
 *   status?: "running" | "completed" | "failed" | "pending"
 *   limit?: number (default 10, max 50)
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const limitParam = url.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(limitParam) || 10, 1), 50);

  let query = supabase
    .from("gtm_scraping_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json(
      { success: false, error: "Failed to fetch scraping jobs" },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, jobs: data ?? [] });
}
