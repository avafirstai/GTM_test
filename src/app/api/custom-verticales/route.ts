import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/custom-verticales — List all user-added verticales
 */
export async function GET() {
  const { data, error } = await supabase
    .from("gtm_custom_verticales")
    .select("id, name, emoji, google_maps_categories, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ verticales: data ?? [] });
}

/**
 * POST /api/custom-verticales — Add a custom verticale
 * Body: { name: string, emoji?: string, googleMapsCategories: string[] }
 */
export async function POST(request: Request) {
  let body: { name?: string; emoji?: string; googleMapsCategories?: string[] };
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

  const categories = (body.googleMapsCategories ?? [])
    .map((c) => c.trim())
    .filter(Boolean);
  if (categories.length === 0) {
    return NextResponse.json(
      { error: "At least one Google Maps category is required" },
      { status: 400 },
    );
  }

  // Generate slug from name
  const id = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

  const emoji = (body.emoji ?? "").trim() || "🏢";

  const { data, error } = await supabase
    .from("gtm_custom_verticales")
    .upsert(
      { id, name, emoji, google_maps_categories: categories },
      { onConflict: "id" },
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ verticale: data }, { status: 201 });
}
