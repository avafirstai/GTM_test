import { supabase } from "@/lib/supabase";
import { searchVerticaleInCity } from "@/lib/google-places";
import { VERTICALES, VILLES_FRANCE } from "@/lib/verticales";
import type { PlaceResult } from "@/lib/google-places";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 min max (Vercel Pro)

/* ------------------------------------------------------------------ */
/*  Request body                                                       */
/* ------------------------------------------------------------------ */

interface ScrapeStreamRequest {
  verticaleIds: string[];
  villes: string[];
  maxPagesPerQuery?: number;
}

/* ------------------------------------------------------------------ */
/*  POST /api/scrape/stream — SSE streaming scraping                   */
/* ------------------------------------------------------------------ */

export async function POST(request: Request) {
  let body: ScrapeStreamRequest;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Validate
  if (!body.verticaleIds || body.verticaleIds.length === 0) {
    return new Response(
      JSON.stringify({ error: "verticaleIds is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  if (!body.villes || body.villes.length === 0) {
    return new Response(
      JSON.stringify({ error: "villes is required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Fetch custom verticales and villes from Supabase to allow user-added entries
  const [customVertRes, customVilleRes] = await Promise.all([
    supabase.from("gtm_custom_verticales").select("id, name, emoji, google_maps_categories"),
    supabase.from("gtm_custom_villes").select("name"),
  ]);
  const customVerticales = customVertRes.data ?? [];
  const customVilleNames = (customVilleRes.data ?? []).map((v: { name: string }) => v.name);

  // Validate verticaleIds — accept both built-in and custom
  const validVertIds = new Set([
    ...VERTICALES.map((v) => v.id),
    ...customVerticales.map((cv: { id: string }) => cv.id),
  ]);
  const invalidVerts = body.verticaleIds.filter((id) => !validVertIds.has(id));
  if (invalidVerts.length > 0) {
    return new Response(
      JSON.stringify({ error: `Invalid verticaleIds: ${invalidVerts.join(", ")}` }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Validate villes — accept both built-in and custom
  const validVilles = new Set([...VILLES_FRANCE, ...customVilleNames]);
  const invalidVilles = body.villes.filter((v) => !validVilles.has(v));
  if (invalidVilles.length > 0) {
    return new Response(
      JSON.stringify({ error: `Invalid villes: ${invalidVilles.join(", ")}` }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const maxPagesPerQuery = Math.min(Math.max(body.maxPagesPerQuery ?? 1, 1), 3);

  // Build a unified lookup map for both built-in and custom verticales
  const vertLookup = new Map<string, { name: string; categories: string[] }>();
  for (const v of VERTICALES) {
    vertLookup.set(v.id, { name: v.name, categories: v.googleMapsCategories });
  }
  for (const cv of customVerticales) {
    if (!vertLookup.has(cv.id)) {
      vertLookup.set(cv.id, {
        name: (cv as { name: string }).name,
        categories: (cv as { google_maps_categories: string[] }).google_maps_categories ?? [],
      });
    }
  }

  // Build combos
  const combos: Array<{
    verticaleId: string;
    verticaleName: string;
    categories: string[];
    ville: string;
  }> = [];

  for (const vId of body.verticaleIds) {
    const vert = vertLookup.get(vId);
    if (!vert) continue;
    for (const ville of body.villes) {
      combos.push({
        verticaleId: vId,
        verticaleName: vert.name,
        categories: vert.categories,
        ville,
      });
    }
  }

  // Create scraping job
  const { data: job, error: jobError } = await supabase
    .from("gtm_scraping_jobs")
    .insert({
      status: "running",
      verticale_ids: body.verticaleIds,
      villes: body.villes,
      total_combos: combos.length,
      processed_combos: 0,
      total_new_leads: 0,
      total_duplicates: 0,
    })
    .select("id")
    .single();

  if (jobError || !job) {
    return new Response(
      JSON.stringify({ error: "Failed to create scraping job" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const jobId = job.id as string;

  // SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: Record<string, unknown>) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      }

      try {
        send("job_created", { jobId });

        let processedCombos = 0;
        let totalNewLeads = 0;
        let totalDuplicates = 0;
        const globalSeenPlaceIds = new Set<string>();

        for (let i = 0; i < combos.length; i++) {
          const combo = combos[i];

          send("combo_start", {
            verticale: combo.verticaleName,
            verticaleId: combo.verticaleId,
            ville: combo.ville,
            index: i + 1,
            total: combos.length,
          });

          let places: PlaceResult[] = [];
          try {
            places = await searchVerticaleInCity(
              combo.categories,
              combo.ville,
              maxPagesPerQuery,
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Search failed";
            send("combo_error", {
              verticale: combo.verticaleName,
              verticaleId: combo.verticaleId,
              ville: combo.ville,
              error: msg,
            });
            processedCombos++;
            continue;
          }

          let comboNew = 0;
          let comboDup = 0;

          // Dedup against global set
          const newPlaces: PlaceResult[] = [];
          for (const place of places) {
            if (globalSeenPlaceIds.has(place.placeId)) {
              comboDup++;
            } else {
              globalSeenPlaceIds.add(place.placeId);
              newPlaces.push(place);
            }
          }

          // Upsert new places into gtm_leads
          if (newPlaces.length > 0) {
            // Batch upsert (Supabase supports upsert with onConflict)
            const rows = newPlaces.map((p) => ({
              place_id: p.placeId,
              name: p.name,
              address: p.address,
              city: combo.ville,
              phone: p.phone || null,
              website: p.website || null,
              category: combo.verticaleName,
              rating: p.rating || null,
              reviews: p.reviews || null,
              google_maps_url: p.mapsUrl || null,
              source: "google_places_api",
              score: computeLeadScore(p),
            }));

            const { data: upserted, error: upsertErr } = await supabase
              .from("gtm_leads")
              .upsert(rows, { onConflict: "place_id", ignoreDuplicates: false })
              .select("id");

            if (upsertErr) {
              // Log upsert error to SSE so frontend can see it
              send("db_warning", {
                verticale: combo.verticaleName,
                ville: combo.ville,
                error: upsertErr.message,
                code: upsertErr.code,
                hint: upsertErr.hint ?? null,
                phase: "upsert",
              });

              // Fallback: try plain insert
              const { data: inserted, error: insertErr } = await supabase
                .from("gtm_leads")
                .insert(rows)
                .select("id");

              if (insertErr) {
                send("db_warning", {
                  verticale: combo.verticaleName,
                  ville: combo.ville,
                  error: insertErr.message,
                  code: insertErr.code,
                  hint: insertErr.hint ?? null,
                  phase: "insert_fallback",
                });
                comboNew = 0; // Both failed — 0 leads actually saved
              } else {
                comboNew = inserted?.length ?? 0;
              }
            } else {
              comboNew = upserted?.length ?? newPlaces.length;
            }
          }

          // Track DB-level duplicates
          comboDup += Math.max(0, newPlaces.length - comboNew);

          totalNewLeads += comboNew;
          totalDuplicates += comboDup;
          processedCombos++;

          send("combo_done", {
            verticale: combo.verticaleName,
            verticaleId: combo.verticaleId,
            ville: combo.ville,
            newLeads: comboNew,
            duplicates: comboDup,
            totalFound: places.length,
          });

          const percent = Math.round((processedCombos / combos.length) * 100);
          send("progress", {
            processed: processedCombos,
            total: combos.length,
            percent,
            totalNewLeads,
            totalDuplicates,
          });

          // Update job progress (fire-and-forget)
          supabase
            .from("gtm_scraping_jobs")
            .update({
              processed_combos: processedCombos,
              total_new_leads: totalNewLeads,
              total_duplicates: totalDuplicates,
              updated_at: new Date().toISOString(),
            })
            .eq("id", jobId)
            .then(() => {});
        }

        // Build summary
        const summary = {
          totalCombos: combos.length,
          totalNew: totalNewLeads,
          totalDuplicates,
          totalPlacesFound: globalSeenPlaceIds.size,
          verticales: body.verticaleIds.length,
          villes: body.villes.length,
        };

        // Mark job completed
        await supabase
          .from("gtm_scraping_jobs")
          .update({
            status: "completed",
            processed_combos: processedCombos,
            total_new_leads: totalNewLeads,
            total_duplicates: totalDuplicates,
            summary,
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);

        send("done", {
          totalCombos: combos.length,
          totalNewLeads,
          totalDuplicates,
          summary,
        });
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Unknown error";

        await supabase
          .from("gtm_scraping_jobs")
          .update({
            status: "failed",
            summary: { error: errorMessage },
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);

        send("error", { message: errorMessage });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Score computation — same logic as existing leads                    */
/* ------------------------------------------------------------------ */

function computeLeadScore(place: PlaceResult): number {
  let score = 30; // base
  if (place.website) score += 20;
  if (place.phone) score += 15;
  if (place.rating >= 4.0) score += 15;
  else if (place.rating >= 3.0) score += 8;
  if (place.reviews >= 50) score += 10;
  else if (place.reviews >= 10) score += 5;
  if (place.address) score += 10;
  return Math.min(score, 100);
}
