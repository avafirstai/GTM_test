/**
 * Shared lead processing utilities for GTM orchestrator.
 *
 * Single source of truth for:
 * - Instantly API client (with timeout + sanitized errors)
 * - Verticale category mapping
 * - Email validation (format + disposable domain blacklist)
 * - Lead deduplication (in-memory Set)
 * - Name parsing (first_name + last_name)
 * - Supabase query builder
 * - Batch building for Instantly bulk API
 */

import { supabase } from "@/lib/supabase";

// ─── Instantly API client ───

const INSTANTLY_API_BASE = "https://api.instantly.ai/api/v2";
const INSTANTLY_TIMEOUT_MS = 30_000;

export interface InstantlyCampaignResponse {
  id: string;
  name: string;
  status: string;
}

export interface InstantlyBulkResponse {
  status?: string;
  total_sent?: number;
  leads_uploaded?: number;
  already_in_campaign?: number;
  invalid_email_count?: number;
  duplicate_email_count?: number;
}

/**
 * Fetch from Instantly API v2 with timeout and sanitized errors.
 * Throws a generic message — never leaks API response bodies to clients.
 */
export async function instantlyFetch(
  endpoint: string,
  method: string = "GET",
  body?: Record<string, unknown>,
): Promise<unknown> {
  const apiKey = process.env.INSTANTLY_API_KEY;
  if (!apiKey) throw new Error("Instantly API key not configured");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INSTANTLY_TIMEOUT_MS);

  try {
    const resp = await fetch(`${INSTANTLY_API_BASE}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!resp.ok) {
      // Log full error server-side for debugging, but throw sanitized message
      const errorText = await resp.text().catch(() => "");
      console.error(`[Instantly] ${method} ${endpoint} → ${resp.status}: ${errorText.slice(0, 300)}`);
      throw new Error(`Instantly API error (${resp.status})`);
    }

    return resp.json();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Instantly API timeout");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Verticale categories ───

export const VERTICALE_CATEGORIES: Record<string, string[]> = {
  sante_dentaire: ["dentiste", "cabinet dentaire", "orthodontiste", "chirurgien-dentiste"],
  sante_medical: ["médecin", "cabinet médical", "centre médical", "médecin généraliste"],
  immobilier: ["agence immobilière", "agence de gestion locative", "syndic"],
  juridique: ["avocat", "cabinet d'avocats", "notaire", "huissier"],
  comptable: ["expert-comptable", "cabinet comptable", "cabinet d'audit"],
  formation: ["centre de formation", "auto-école", "école", "organisme de formation"],
  beaute: ["salon de coiffure", "institut de beauté", "spa", "barbier"],
  veterinaire: ["vétérinaire", "clinique vétérinaire"],
  restaurant_hg: ["restaurant", "traiteur", "hôtel restaurant"],
  artisan_premium: ["plombier", "électricien", "serrurier", "chauffagiste"],
  hotellerie: ["hôtel", "résidence hôtelière", "chambre d'hôtes"],
  cinema: ["cinéma", "salle de spectacle", "théâtre"],
  auto_ecole: ["auto-école", "école de conduite"],
  concession_auto: ["concession automobile", "garage automobile"],
  agence_voyage: ["agence de voyage", "tour-opérateur"],
};

// ─── Request body schema ───

export interface OrchestrateBody {
  ville?: string;
  niche?: string;
  count?: number;
  campaignId?: string;
  campaignName?: string;
  emailAccounts?: string[];
  autoLaunch?: boolean;
}

// ─── Supabase lead query ───

export interface RawLead {
  name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  city: string | null;
  category: string | null;
}

/**
 * Query Supabase for matching leads with email, filtered by city/niche.
 */
export async function queryLeads(
  ville: string,
  niche: string,
  count: number,
): Promise<{ data: RawLead[] | null; error: string | null }> {
  let query = supabase
    .from("gtm_leads")
    .select("name, email, phone, website, city, category")
    .not("email", "is", null)
    .neq("email", "")
    .limit(count);

  if (ville) {
    query = query.ilike("city", `%${ville}%`);
  }

  if (niche) {
    const categories = VERTICALE_CATEGORIES[niche];
    if (categories && categories.length > 0) {
      const orFilter = categories.map((cat) => `category.ilike.%${cat}%`).join(",");
      query = query.or(orFilter);
    } else {
      query = query.ilike("category", `%${niche}%`);
    }
  }

  const { data, error } = await query;
  return {
    data: data as RawLead[] | null,
    error: error ? error.message : null,
  };
}

// ─── Email validation ───

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

/** Domains known to be disposable, catch-all, or generic junk */
const BLOCKED_DOMAINS = new Set([
  "example.com", "example.fr", "test.com", "test.fr",
  "mailinator.com", "guerrillamail.com", "tempmail.com", "throwaway.email",
  "yopmail.com", "yopmail.fr", "trashmail.com", "sharklasers.com",
  "guerrillamailblock.com", "grr.la", "discard.email",
  "temp-mail.org", "fakeinbox.com", "mailnesia.com",
  "noreply.com", "no-reply.com",
  "10minutemail.com", "guerrillamail.info", "maildrop.cc",
  "tempail.com", "throwaway.com", "mailcatch.com",
]);

/** Email prefixes that are typically role-based / not personal */
const JUNK_PREFIXES = new Set([
  "noreply", "no-reply", "no_reply", "donotreply", "do-not-reply",
  "mailer-daemon", "postmaster", "webmaster", "abuse",
  "bounce", "unsubscribe", "root", "admin",
]);

/**
 * Validate an email for outreach quality.
 * Returns null if invalid, normalized lowercase email if valid.
 */
export function validateEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 254) return null;
  if (!EMAIL_REGEX.test(email)) return null;

  const [prefix, domain] = email.split("@");
  if (!prefix || !domain) return null;
  if (BLOCKED_DOMAINS.has(domain)) return null;
  if (JUNK_PREFIXES.has(prefix)) return null;

  return email;
}

// ─── Name parsing ───

interface ParsedName {
  firstName: string;
  lastName: string;
  companyName: string;
}

/**
 * Parse a business name into contact name fields.
 * Best-effort: splits on spaces, takes first word as firstName.
 */
export function parseName(rawName: string | null | undefined): ParsedName {
  const name = (rawName || "").trim().slice(0, 200);
  if (!name) {
    return { firstName: "Contact", lastName: "", companyName: "" };
  }

  const parts = name.split(/\s+/);
  if (parts.length >= 2) {
    return {
      firstName: parts[0],
      lastName: parts.slice(1).join(" "),
      companyName: name,
    };
  }

  return {
    firstName: name.slice(0, 30) || "Contact",
    lastName: "",
    companyName: name,
  };
}

// ─── Deduplication ───

export interface DeduplicateResult<T> {
  unique: T[];
  duplicateCount: number;
  invalidCount: number;
}

/**
 * Dedup leads by email. Returns unique leads, duplicate count, and invalid count.
 */
export function deduplicateLeads<T extends { email?: string | null }>(
  leads: T[],
): DeduplicateResult<T> {
  const seen = new Set<string>();
  const unique: T[] = [];
  let duplicateCount = 0;
  let invalidCount = 0;

  for (const lead of leads) {
    const email = validateEmail(lead.email);
    if (!email) {
      invalidCount++;
      continue;
    }

    if (seen.has(email)) {
      duplicateCount++;
      continue;
    }

    seen.add(email);
    unique.push(lead);
  }

  return { unique, duplicateCount, invalidCount };
}

// ─── Instantly bulk payload builder ───

interface InstantlyLeadPayload {
  email: string;
  first_name: string;
  last_name: string;
  company_name: string;
  phone?: string;
  website?: string;
  custom_variables?: Record<string, string>;
}

export interface InstantlyBulkPayload {
  campaign_id: string;
  skip_if_in_workspace: boolean;
  skip_if_in_campaign: boolean;
  leads: InstantlyLeadPayload[];
}

/**
 * Build Instantly bulk upload payload from leads.
 * Max 500 leads per batch (API limit).
 */
export function buildBulkPayloads(
  leads: RawLead[],
  campaignId: string,
): InstantlyBulkPayload[] {
  const BATCH_SIZE = 500;
  const batches: InstantlyBulkPayload[] = [];

  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    const chunk = leads.slice(i, i + BATCH_SIZE);
    const instantlyLeads: InstantlyLeadPayload[] = [];

    for (const lead of chunk) {
      const email = validateEmail(lead.email);
      if (!email) continue;

      const { firstName, lastName, companyName } = parseName(lead.name);

      const payload: InstantlyLeadPayload = {
        email,
        first_name: firstName,
        last_name: lastName,
        company_name: companyName,
      };

      if (lead.phone) payload.phone = lead.phone;
      if (lead.website) payload.website = lead.website;

      // Extra data as custom variables
      const customVars: Record<string, string> = {};
      if (lead.city) customVars.city = lead.city;
      if (lead.category) customVars.lt_category = lead.category;

      if (Object.keys(customVars).length > 0) {
        payload.custom_variables = customVars;
      }

      instantlyLeads.push(payload);
    }

    if (instantlyLeads.length > 0) {
      batches.push({
        campaign_id: campaignId,
        skip_if_in_workspace: true,
        skip_if_in_campaign: true,
        leads: instantlyLeads,
      });
    }
  }

  return batches;
}
