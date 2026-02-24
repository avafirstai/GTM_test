import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/enrich/jobs/[id] — Get a single enrichment job by ID
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!id || id.length < 10) {
    return NextResponse.json(
      { success: false, error: "Invalid job ID" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("gtm_enrichment_jobs")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { success: false, error: "Job not found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ success: true, job: data });
}
