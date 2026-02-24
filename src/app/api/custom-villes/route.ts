import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/custom-villes — List all user-added villes
 */
export async function GET() {
  const { data, error } = await supabase
    .from("gtm_custom_villes")
    .select("name, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ villes: (data ?? []).map((v) => v.name) });
}

/**
 * POST /api/custom-villes — Add a custom ville
 * Body: { name: string }
 */
export async function POST(request: Request) {
  let body: { name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  if (!name || name.length < 2) {
    return NextResponse.json(
      { error: "name is required (min 2 chars)" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("gtm_custom_villes")
    .upsert({ name }, { onConflict: "name" })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ville: data.name }, { status: 201 });
}
