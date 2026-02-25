/**
 * Waterfall Source 4 — SIRENE / INSEE (French Company Registry)
 *
 * Priority: 4
 * Cost: FREE (0 auth, unlimited — recherche-entreprises.api.gouv.fr)
 * Purpose: Find company SIRET, dirigeant, address, activity code
 *   from the official French government registry (40M+ businesses).
 *
 * This enriches METADATA — no email directly, but:
 *   - SIRET confirms the company exists (confidence boost)
 *   - Dirigeant name enables email permutation (Phase 5)
 *   - NAF code + effectif = lead qualification data
 *
 * Confidence: 90 (official government registry)
 */

import type {
  EnrichmentResult,
  EnrichmentLeadInput,
  EnrichmentContext,
} from "../types";
import { registerSource } from "../waterfall";

/* ------------------------------------------------------------------ */
/*  API Types (recherche-entreprises.api.gouv.fr)                      */
/* ------------------------------------------------------------------ */

interface SireneSearchResult {
  results: SireneCompany[];
  total_results: number;
}

interface SireneCompany {
  siren: string;
  nom_complet: string;
  nom_raison_sociale: string;
  sigle?: string;
  nombre_etablissements: number;
  nombre_etablissements_ouverts: number;
  siege: SireneEtablissement;
  activite_principale: string;
  categorie_entreprise?: string;
  tranche_effectif_salarie?: string;
  date_creation?: string;
  etat_administratif?: string;
  nature_juridique?: string;
  dirigeants?: SireneDirigeant[];
  complements?: {
    collectivite_territoriale?: unknown;
    convention_collective_renseignee?: boolean;
    est_bio?: boolean;
    est_entrepreneur_individuel?: boolean;
    est_entrepreneur_spectacle?: boolean;
    est_ess?: boolean;
    est_finess?: boolean;
    est_rge?: boolean;
    est_uai?: boolean;
  };
}

interface SireneEtablissement {
  siret: string;
  adresse: string;
  commune: string;
  code_postal: string;
  departement?: string;
  region?: string;
  latitude?: string;
  longitude?: string;
  activite_principale?: string;
  tranche_effectif_salarie?: string;
  date_creation?: string;
}

interface SireneDirigeant {
  nom?: string;
  prenoms?: string;
  qualite?: string;
  type_dirigeant?: string;
}

/* ------------------------------------------------------------------ */
/*  Company Name Normalization                                         */
/* ------------------------------------------------------------------ */

/**
 * Normalize company name for better search matching.
 * French business names often have legal suffixes (SARL, SAS, etc.)
 */
function normalizeCompanyName(name: string): string {
  return name
    .replace(/\b(sarl|sas|sa|eurl|sasu|sci|snc|gmbh|ltd|llc|inc)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/*  SIRENE API Search                                                  */
/* ------------------------------------------------------------------ */

async function searchSirene(
  companyName: string,
  city?: string,
): Promise<SireneCompany | null> {
  const normalizedName = normalizeCompanyName(companyName);

  // Build query params
  const params = new URLSearchParams({
    q: normalizedName,
    per_page: "3",
    page: "1",
  });

  // Add city filter for precision
  if (city) {
    params.set("commune", city);
  }

  // Only active companies
  params.set("etat_administratif", "A");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const resp = await fetch(
      `https://recherche-entreprises.api.gouv.fr/search?${params.toString()}`,
      {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "AVA-GTM-Bot/2.0",
        },
      },
    );

    clearTimeout(timeout);
    if (!resp.ok) return null;

    const data: SireneSearchResult = await resp.json();
    if (!data.results || data.results.length === 0) return null;

    // Return the best match (first result = most relevant)
    return data.results[0];
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Dirigeant Extraction                                               */
/* ------------------------------------------------------------------ */

function extractBestDirigeant(
  dirigeants: SireneDirigeant[] | undefined,
): { fullName: string; firstName: string; lastName: string } | null {
  if (!dirigeants || dirigeants.length === 0) return null;

  // Priority: Gérant > Président > Directeur > others
  const priorityOrder = [
    "gerant", "gerante",
    "president", "presidente",
    "directeur general", "directrice generale",
    "directeur", "directrice",
  ];

  // Sort by priority
  const sorted = [...dirigeants]
    .filter((d) => d.nom && d.type_dirigeant === "personne physique")
    .sort((a, b) => {
      const aIdx = priorityOrder.findIndex((q) =>
        (a.qualite ?? "").toLowerCase().includes(q),
      );
      const bIdx = priorityOrder.findIndex((q) =>
        (b.qualite ?? "").toLowerCase().includes(q),
      );
      return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
    });

  const best = sorted[0];
  if (!best?.nom) return null;

  const firstName = (best.prenoms ?? "").split(" ")[0] ?? "";
  const lastName = best.nom;
  const fullName = `${firstName} ${lastName}`.trim();

  return { fullName, firstName, lastName };
}

/* ------------------------------------------------------------------ */
/*  Source Function                                                     */
/* ------------------------------------------------------------------ */

async function sireneSource(
  lead: EnrichmentLeadInput,
  context: EnrichmentContext,
): Promise<EnrichmentResult> {
  const emptyResult: EnrichmentResult = {
    email: null,
    phone: null,
    dirigeant: null,
    siret: null,
    source: "sirene",
    confidence: 0,
    metadata: {},
  };

  // Strategy: 3 attempts with decreasing precision
  // 1. Name + city (most precise)
  let company = await searchSirene(lead.name, lead.city);

  // 2. Name only — no city filter (HQ may be in a different city)
  if (!company) {
    company = await searchSirene(lead.name);
  }

  // 3. Domain name as query (e.g. "dupont-dentiste" from dupont-dentiste.fr)
  if (!company && context.domain) {
    const domainName = context.domain
      .replace(/\.(fr|com|net|org|eu|paris|bzh|io|co)$/i, "")
      .replace(/[-_]/g, " ")
      .trim();
    if (domainName.length >= 3 && domainName.toLowerCase() !== lead.name.toLowerCase()) {
      company = await searchSirene(domainName, lead.city);
    }
  }

  if (!company) return emptyResult;

  // Extract dirigeant
  const dirigeantInfo = extractBestDirigeant(company.dirigeants);

  // Build metadata
  const metadata: Record<string, string> = {
    siren: company.siren,
    nom_complet: company.nom_complet,
    activite_principale: company.activite_principale ?? "",
  };

  if (company.siege.adresse) {
    metadata["adresse"] = company.siege.adresse;
  }
  if (company.siege.commune) {
    metadata["commune"] = company.siege.commune;
  }
  if (company.siege.code_postal) {
    metadata["code_postal"] = company.siege.code_postal;
  }
  if (company.tranche_effectif_salarie) {
    metadata["effectif"] = company.tranche_effectif_salarie;
  }
  if (company.date_creation) {
    metadata["date_creation"] = company.date_creation;
  }
  if (company.categorie_entreprise) {
    metadata["categorie"] = company.categorie_entreprise;
  }
  if (company.nature_juridique) {
    metadata["nature_juridique"] = company.nature_juridique;
  }

  // Dirigeant metadata
  if (dirigeantInfo) {
    metadata["dirigeant_first_name"] = dirigeantInfo.firstName;
    metadata["dirigeant_last_name"] = dirigeantInfo.lastName;
  }

  // Dirigeant qualité
  if (company.dirigeants?.[0]?.qualite) {
    metadata["dirigeant_qualite"] = company.dirigeants[0].qualite;
  }

  return {
    email: null, // SIRENE doesn't have emails
    phone: null, // SIRENE doesn't have phones
    dirigeant: dirigeantInfo?.fullName ?? null,
    siret: company.siege.siret,
    source: "sirene",
    confidence: 0, // Will be set by computeConfidence
    metadata,
  };
}

/* ------------------------------------------------------------------ */
/*  Register Source                                                     */
/* ------------------------------------------------------------------ */

registerSource("sirene", sireneSource);

export { sireneSource };
