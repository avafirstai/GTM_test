/**
 * Waterfall Source 2 — Schema.org / JSON-LD Extractor
 *
 * Priority: 2
 * Cost: FREE (0 API calls — just fetch + parse)
 * Purpose: Extract structured data (email, phone, address, name)
 *   from JSON-LD blocks on the website's homepage.
 *
 * ~30% of French business sites have JSON-LD with LocalBusiness /
 * Organization types. This is HIGHLY reliable structured data.
 *
 * Confidence: 85 (structured data = very reliable)
 */

import type {
  EnrichmentResult,
  EnrichmentLeadInput,
  EnrichmentContext,
} from "../types";
import { registerSource } from "../waterfall";

/* ------------------------------------------------------------------ */
/*  HTML Fetch                                                         */
/* ------------------------------------------------------------------ */

async function fetchHtml(url: string): Promise<string | null> {
  try {
    let fetchUrl = url.trim();
    if (!fetchUrl.startsWith("http")) fetchUrl = `https://${fetchUrl}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(fetchUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AVA-GTM-Bot/2.0; +https://avafirstai.com)",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });

    clearTimeout(timeout);
    if (!resp.ok) return null;

    return await resp.text();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  JSON-LD Parser                                                     */
/* ------------------------------------------------------------------ */

/**
 * Extract all JSON-LD blocks from HTML.
 * Returns an array of parsed JSON objects.
 */
function extractJsonLd(html: string): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];

  // Match <script type="application/ld+json">...</script>
  const regex =
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === "object") {
            results.push(item as Record<string, unknown>);
          }
        }
      } else if (parsed && typeof parsed === "object") {
        results.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Invalid JSON — skip
    }
  }

  return results;
}

/* ------------------------------------------------------------------ */
/*  Data Extraction from JSON-LD                                       */
/* ------------------------------------------------------------------ */

const BUSINESS_TYPES = new Set([
  "LocalBusiness",
  "Organization",
  "MedicalBusiness",
  "Dentist",
  "LegalService",
  "ProfessionalService",
  "HealthAndBeautyBusiness",
  "Store",
  "Restaurant",
  "FinancialService",
  "InsuranceAgency",
  "RealEstateAgent",
  "AutoRepair",
  "HomeAndConstructionBusiness",
  "SportsActivityLocation",
  "EntertainmentBusiness",
  "FoodEstablishment",
  "LodgingBusiness",
  "MedicalClinic",
  "Physician",
  "VeterinaryCare",
  "Pharmacy",
  "Optician",
  "Attorney",
  "AccountingService",
  "AutomotiveBusiness",
  "ChildCare",
  "DryCleaningOrLaundry",
  "EducationalOrganization",
  "GovernmentOffice",
  "Library",
  "TravelAgency",
]);

interface ExtractedData {
  email: string | null;
  phone: string | null;
  name: string | null;
  founder: string | null;
  address: string | null;
  url: string | null;
}

function getStringField(
  obj: Record<string, unknown>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string" && val.trim().length > 0) {
      return val.trim();
    }
  }
  return null;
}

function extractFromEntity(obj: Record<string, unknown>): ExtractedData {
  const data: ExtractedData = {
    email: null,
    phone: null,
    name: null,
    founder: null,
    address: null,
    url: null,
  };

  // Direct fields
  data.email = getStringField(obj, "email");
  data.phone = getStringField(obj, "telephone");
  data.name = getStringField(obj, "name", "legalName");
  data.url = getStringField(obj, "url");

  // Founder / employee
  const founder = obj["founder"] || obj["employee"];
  if (founder && typeof founder === "object" && !Array.isArray(founder)) {
    const founderObj = founder as Record<string, unknown>;
    data.founder = getStringField(founderObj, "name");
  }

  // ContactPoint — often has email + phone
  const contactPoint = obj["contactPoint"];
  if (contactPoint) {
    const points = Array.isArray(contactPoint)
      ? contactPoint
      : [contactPoint];
    for (const cp of points) {
      if (cp && typeof cp === "object") {
        const cpObj = cp as Record<string, unknown>;
        if (!data.email) data.email = getStringField(cpObj, "email");
        if (!data.phone) data.phone = getStringField(cpObj, "telephone");
      }
    }
  }

  // Address
  const address = obj["address"];
  if (address && typeof address === "object" && !Array.isArray(address)) {
    const addrObj = address as Record<string, unknown>;
    const parts = [
      getStringField(addrObj, "streetAddress"),
      getStringField(addrObj, "postalCode"),
      getStringField(addrObj, "addressLocality"),
    ].filter(Boolean);
    if (parts.length > 0) {
      data.address = parts.join(", ");
    }
  }

  return data;
}

function isBusinessType(obj: Record<string, unknown>): boolean {
  const type = obj["@type"];
  if (typeof type === "string") return BUSINESS_TYPES.has(type);
  if (Array.isArray(type))
    return type.some((t) => typeof t === "string" && BUSINESS_TYPES.has(t));
  return false;
}

/* ------------------------------------------------------------------ */
/*  Email Validation                                                   */
/* ------------------------------------------------------------------ */

const EMAIL_REGEX = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

const EXCLUDED_DOMAINS = new Set([
  "example.com",
  "sentry.io",
  "wixpress.com",
  "wordpress.org",
  "schema.org",
  "googleapis.com",
  "w3.org",
]);

function isValidEmail(email: string, leadDomain: string): boolean {
  if (!EMAIL_REGEX.test(email)) return false;
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (EXCLUDED_DOMAINS.has(domain)) return false;
  // Prefer same-domain emails but accept others too
  return true;
}

/* ------------------------------------------------------------------ */
/*  Source Function                                                     */
/* ------------------------------------------------------------------ */

async function schemaOrgSource(
  lead: EnrichmentLeadInput,
  context: EnrichmentContext,
): Promise<EnrichmentResult> {
  const domain = context.domain;
  const url = lead.website.startsWith("http")
    ? lead.website
    : `https://${lead.website}`;

  const html = await fetchHtml(url);

  const emptyResult: EnrichmentResult = {
    email: null,
    phone: null,
    dirigeant: null,
    siret: null,
    source: "schema_org",
    confidence: 0,
    metadata: {},
  };

  if (!html) return emptyResult;

  const jsonLdBlocks = extractJsonLd(html);
  if (jsonLdBlocks.length === 0) return emptyResult;

  // Extract data from all business-type entities
  let bestEmail: string | null = null;
  let bestPhone: string | null = null;
  let bestFounder: string | null = null;
  let bestName: string | null = null;
  let bestAddress: string | null = null;
  const metadata: Record<string, string> = {};

  for (const block of jsonLdBlocks) {
    // Handle @graph arrays
    const entities: Record<string, unknown>[] = [];
    if (Array.isArray(block["@graph"])) {
      for (const item of block["@graph"]) {
        if (item && typeof item === "object") {
          entities.push(item as Record<string, unknown>);
        }
      }
    } else {
      entities.push(block);
    }

    for (const entity of entities) {
      if (!isBusinessType(entity)) continue;

      const data = extractFromEntity(entity);

      if (data.email && isValidEmail(data.email, domain) && !bestEmail) {
        bestEmail = data.email;
      }
      if (data.phone && !bestPhone) {
        bestPhone = data.phone;
      }
      if (data.founder && !bestFounder) {
        bestFounder = data.founder;
      }
      if (data.name && !bestName) {
        bestName = data.name;
      }
      if (data.address && !bestAddress) {
        bestAddress = data.address;
      }
    }
  }

  // Build metadata
  metadata["json_ld_count"] = String(jsonLdBlocks.length);
  if (bestName) metadata["business_name"] = bestName;
  if (bestAddress) metadata["address"] = bestAddress;

  return {
    email: bestEmail,
    phone: bestPhone,
    dirigeant: bestFounder,
    siret: null, // JSON-LD rarely has SIRET
    source: "schema_org",
    confidence: 0, // Will be set by computeConfidence
    metadata,
  };
}

/* ------------------------------------------------------------------ */
/*  Register Source                                                     */
/* ------------------------------------------------------------------ */

registerSource("schema_org", schemaOrgSource);

export { schemaOrgSource };
