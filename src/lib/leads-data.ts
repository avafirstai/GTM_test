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
  enrichment_status: "pending" | "in_progress" | "completed" | "failed";
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
  ville: string;
  verticale: string;
  pipeline: string;
  scoreMin: number;
  scoreMax: number;
  hasEmail: "all" | "yes" | "no";
  source: string;
}

// API response from /api/leads
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
}

interface LeadsApiResponse {
  leads: ApiLead[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Map Supabase column names to the Lead interface used by components.
 */
function mapApiLeadToLead(api: ApiLead): Lead {
  return {
    id: api.id ?? `lead-${Math.random().toString(36).slice(2, 10)}`,
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
    source: "Google Maps Scraping",
    instantly_status: "not_imported",
    verticale: api.category || "",
    decision_makers: [],
    enrichment_status: api.email ? "completed" : "pending",
  };
}

/**
 * Fetch leads from the /api/leads endpoint (Supabase-backed).
 */
export async function fetchLeads(params?: {
  limit?: number;
  offset?: number;
  search?: string;
  city?: string;
  category?: string;
  hasEmail?: string;
  sortBy?: string;
  sortDir?: string;
}): Promise<{ leads: Lead[]; total: number }> {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set("limit", String(params.limit));
  if (params?.offset) searchParams.set("offset", String(params.offset));
  if (params?.search) searchParams.set("search", params.search);
  if (params?.city) searchParams.set("city", params.city);
  if (params?.category) searchParams.set("category", params.category);
  if (params?.hasEmail) searchParams.set("hasEmail", params.hasEmail);
  if (params?.sortBy) searchParams.set("sortBy", params.sortBy);
  if (params?.sortDir) searchParams.set("sortDir", params.sortDir);

  const res = await fetch(`/api/leads?${searchParams.toString()}`);
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
