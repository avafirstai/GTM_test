/**
 * Google Places API (New) — Text Search client
 *
 * Uses the Places API v1 (searchText) to find businesses by query.
 * Server-side only — GOOGLE_PLACES_API_KEY must be set in env.
 *
 * Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
 */

const API_URL = "https://places.googleapis.com/v1/places:searchText";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.types",
  "places.googleMapsUri",
].join(",");

/** Delay between requests to avoid rate limiting */
const REQUEST_DELAY_MS = 120;

export interface PlaceResult {
  placeId: string;
  name: string;
  address: string;
  phone: string;
  website: string;
  rating: number;
  reviews: number;
  types: string[];
  mapsUrl: string;
}

interface GooglePlaceResponse {
  places?: Array<{
    id?: string;
    displayName?: { text?: string; languageCode?: string };
    formattedAddress?: string;
    nationalPhoneNumber?: string;
    internationalPhoneNumber?: string;
    websiteUri?: string;
    rating?: number;
    userRatingCount?: number;
    types?: string[];
    googleMapsUri?: string;
  }>;
  nextPageToken?: string;
}

function getApiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    throw new Error(
      "GOOGLE_PLACES_API_KEY is not set. Add it to .env.local",
    );
  }
  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Search Google Places with a text query.
 *
 * @param query - e.g. "dentiste Paris"
 * @param maxPages - max pagination pages (1 page = 20 results, max 3 pages = 60)
 * @returns Array of PlaceResult
 */
export async function searchPlaces(
  query: string,
  maxPages: number = 1,
): Promise<PlaceResult[]> {
  const apiKey = getApiKey();
  const allResults: PlaceResult[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const body: Record<string, unknown> = {
      textQuery: query,
      languageCode: "fr",
      regionCode: "FR",
    };
    if (pageToken) {
      body.pageToken = pageToken;
    }

    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "unknown");
      throw new Error(
        `Google Places API error ${res.status}: ${errText.slice(0, 200)}`,
      );
    }

    const data: GooglePlaceResponse = await res.json();

    if (data.places) {
      for (const p of data.places) {
        if (!p.id) continue;
        allResults.push({
          placeId: p.id,
          name: p.displayName?.text ?? "",
          address: p.formattedAddress ?? "",
          phone:
            p.nationalPhoneNumber ?? p.internationalPhoneNumber ?? "",
          website: p.websiteUri ?? "",
          rating: p.rating ?? 0,
          reviews: p.userRatingCount ?? 0,
          types: p.types ?? [],
          mapsUrl: p.googleMapsUri ?? "",
        });
      }
    }

    pageToken = data.nextPageToken;
    if (!pageToken) break;

    // Delay between pages to stay within rate limits
    await sleep(REQUEST_DELAY_MS);
  }

  return allResults;
}

/**
 * Search all categories for a verticale in a city.
 * Deduplicates by placeId across categories.
 */
export async function searchVerticaleInCity(
  categories: string[],
  city: string,
  maxPagesPerQuery: number = 1,
): Promise<PlaceResult[]> {
  const seen = new Set<string>();
  const results: PlaceResult[] = [];

  for (const category of categories) {
    const query = `${category} ${city}`;
    const places = await searchPlaces(query, maxPagesPerQuery);

    for (const place of places) {
      if (!seen.has(place.placeId)) {
        seen.add(place.placeId);
        results.push(place);
      }
    }

    // Delay between category queries
    await sleep(REQUEST_DELAY_MS);
  }

  return results;
}
