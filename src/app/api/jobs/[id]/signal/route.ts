import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);

const ALLOWED_TABLES = ["gtm_scraping_jobs", "gtm_enrichment_jobs"] as const;
type JobTable = (typeof ALLOWED_TABLES)[number];

const ALLOWED_SIGNALS = ["stop", "pause"] as const;
type Signal = (typeof ALLOWED_SIGNALS)[number];

interface SignalRequest {
  table: string;
  signal: string;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: SignalRequest;
  try {
    body = (await request.json()) as SignalRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { table, signal } = body;

  if (!ALLOWED_TABLES.includes(table as JobTable)) {
    return NextResponse.json({ error: "Invalid table" }, { status: 400 });
  }

  if (!ALLOWED_SIGNALS.includes(signal as Signal)) {
    return NextResponse.json({ error: "Invalid signal" }, { status: 400 });
  }

  const { error } = await supabase
    .from(table)
    .update({ signal })
    .eq("id", id)
    .eq("status", "running");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
