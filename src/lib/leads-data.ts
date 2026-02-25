// Lead types and API client — data served from /api/leads (Supabase)
// NO static data bundled — everything is fetched at runtime

export interface Lead {
  id: string;
  nom_entreprise: string;
  type_etablissement: string;
  ville: string;
  adresse: string;
  telephone: string;
  email: string;
  site_web: string;
  note_google: number;
  nb_avis_google: number;
  score: number;
  pitch_angle: string;
  statut_pipeline: "nouveau" | "contacte" | "repondu" | "rdv_booke" | "deal_won" | "perdu";
  date_scraping: string;
  source: string;
  instantly_status: "imported" | "pending" | "not_imported";
  verticale: string;
  decision_makers: DecisionMaker[];
  enrichment_status: "pending" | "enriched" | "failed" | "skipped";
  enrichment_attempts: number;
  enrichment_failed_at: string | null;
  google_maps_url: string;
  // Enrichment data columns
  siret: string | null;
  dirigeant: string | null;
  dirigeant_linkedin: string | null;
  mx_provider: string | null;
  has_mx: boolean;
  enrichment_source: string | null;
  enrichment_confidence: number | null;
  enriched_at: string | null;
}

export interface DecisionMaker {
  name: string;
  title: string;
  email: string;
  linkedin_url: string;
  confidence: number;
}

export type SortField = "nom_entreprise" | "ville" | "score" | "note_google" | "nb_avis_google" | "statut_pipeline" | "date_scraping";
export type SortDirection = "asc" | "desc";

export interface LeadFilters {
  search: string;
  ville: string[];
  verticale: string[];
  pipeline: string;
  scoreMin: number;
  scoreMax: number;
  hasEmail: "all" | "yes" | "no";
  source: string;
  enrichmentStatus: "all" | "enriched" | "failed" | "pending";
}

// API response from /api/leads — includes all enrichment columns from Supabase
interface ApiLead {
  id: string;
  name: string;
  city: string;
  phone: string;
  website: string;
  email: string;
  category: string;
  rating: number;
  reviews: number;
  score: number;
  address: string;
  apify_run: string;
  created_at: string;
  google_maps_url: string | null;
  source: string | null;
  // Enrichment columns from DB
  enrichment_status: string | null;
  enrichment_attempts: number | null;
  enrichment_failed_at: string | null;
  siret: string | null;
  dirigeant: string | null;
  dirigeant_linkedin: string | null;
  mx_provider: string | null;
  has_mx: boolean | null;
  enrichment_source: string | null;
  enrichment_confidence: number | null;
  enriched_at: string | null;
}

interface LeadsApiResponse {
  leads: ApiLead[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Derive enrichment_status from DB value or heuristic fallback.
 */
function deriveEnrichmentStatus(api: ApiLead): Lead["enrichment_status"] {
  // Use DB value if present and valid
  const dbStatus = api.enrichment_status;
  if (dbStatus === "enriched" || dbStatus === "failed" || dbStatus === "skipped" || dbStatus === "pending") {
    return dbStatus;
  }
  // Fallback heuristic for leads without the column populated yet
  if (api.enriched_at) return "enriched";
  if (api.email) return "enriched";
  return "pending";
}

/**
 * Map Supabase column names to the Lead interface used by components.
 */
function mapApiLeadToLead(api: ApiLead): Lead {
  return {
    id: api.id || `lead-${api.name || ""}-${api.city || ""}`,
    nom_entreprise: api.name || "",
    type_etablissement: api.category || "",
    ville: api.city || "",
    adresse: api.address || "",
    telephone: api.phone || "",
    email: api.email || "",
    site_web: api.website || "",
    note_google: api.rating ?? 0,
    nb_avis_google: api.reviews ?? 0,
    score: api.score ?? 0,
    pitch_angle: "",
    statut_pipeline: "nouveau",
    date_scraping: api.created_at || new Date().toISOString(),
    source: api.source || "Google Maps Scraping",
    instantly_status: "not_imported",
    verticale: api.category || "",
    decision_makers: [],
    enrichment_status: deriveEnrichmentStatus(api),
    enrichment_attempts: api.enrichment_attempts ?? 0,
    enrichment_failed_at: api.enrichment_failed_at ?? null,
    google_maps_url: api.google_maps_url || "",
    // Enrichment data
    siret: api.siret ?? null,
    dirigeant: api.dirigeant ?? null,
    dirigeant_linkedin: api.dirigeant_linkedin ?? null,
    mx_provider: api.mx_provider ?? null,
    has_mx: api.has_mx ?? false,
    enrichment_source: api.enrichment_source ?? null,
    enrichment_confidence: api.enrichment_confidence ?? null,
    enriched_at: api.enriched_at ?? null,
  };
}

/**
 * Fetch leads from the /api/leads endpoint (Supabase-backed).
 */
export async function fetchLeads(params?: {
  limit?: number;
  offset?: number;
  search?: string;
  city?: string | string[];
  category?: string | string[];
  hasEmail?: string;
  sortBy?: string;
  sortDir?: string;
  enrichmentStatus?: string;
}): Promise<{ leads: Lead[]; total: number }> {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set("limit", String(params.limit));
  if (params?.offset) searchParams.set("offset", String(params.offset));
  if (params?.search) searchParams.set("search", params.search);
  // Support single or multi-value city/category
  if (params?.city) {
    const cities = Array.isArray(params.city) ? params.city : [params.city];
    for (const c of cities) searchParams.append("city", c);
  }
  if (params?.category) {
    const cats = Array.isArray(params.category) ? params.category : [params.category];
    for (const c of cats) searchParams.append("category", c);
  }
  if (params?.hasEmail) searchParams.set("hasEmail", params.hasEmail);
  if (params?.sortBy) searchParams.set("sortBy", params.sortBy);
  if (params?.sortDir) searchParams.set("sortDir", params.sortDir);
  if (params?.enrichmentStatus) searchParams.set("enrichmentStatus", params.enrichmentStatus);

  const res = await fetch(`/api/leads?${searchParams.toString()}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to fetch leads: ${res.status}`);
  }

  const data: LeadsApiResponse = await res.json();
  return {
    leads: data.leads.map(mapApiLeadToLead),
    total: data.total,
  };
}

/**
 * Legacy sync function — returns empty array.
 * Use fetchLeads() instead for actual data.
 * Kept for backward compatibility during migration.
 */
export function getLeads(): Lead[] {
  return [];
}

export function getLeadStats() {
  return {
    total: 0,
    displayed: 0,
    withEmail: 0,
    withoutEmail: 0,
    avgScore: 0,
    byPipeline: {
      nouveau: 0,
      contacte: 0,
      repondu: 0,
      rdv_booke: 0,
      deal_won: 0,
      perdu: 0,
    },
    byVille: {} as Record<string, number>,
    byVerticale: {} as Record<string, number>,
  };
}
