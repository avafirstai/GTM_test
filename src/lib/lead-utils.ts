/**
 * Shared lead processing utilities for GTM orchestrator.
 *
 * - Email validation (format + disposable domain blacklist)
 * - Lead deduplication (in-memory Set)
 * - Name parsing (first_name + last_name)
 * - Batch building for Instantly bulk API
 */

// ─── Email validation ───

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/** Domains known to be disposable, catch-all, or generic junk */
const BLOCKED_DOMAINS = new Set([
  "example.com", "example.fr", "test.com", "test.fr",
  "mailinator.com", "guerrillamail.com", "tempmail.com", "throwaway.email",
  "yopmail.com", "yopmail.fr", "trashmail.com", "sharklasers.com",
  "guerrillamailblock.com", "grr.la", "discard.email",
  "temp-mail.org", "fakeinbox.com", "mailnesia.com",
  "noreply.com", "no-reply.com",
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

  const domain = email.split("@")[1];
  if (!domain) return null;
  if (BLOCKED_DOMAINS.has(domain)) return null;

  const prefix = email.split("@")[0];
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
  const name = (rawName || "").trim();
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

/**
 * Dedup leads by email. Returns only unique leads (first occurrence wins).
 */
export function deduplicateLeads<T extends { email?: string | null }>(
  leads: T[],
): { unique: T[]; duplicateCount: number } {
  const seen = new Set<string>();
  const unique: T[] = [];
  let duplicateCount = 0;

  for (const lead of leads) {
    const email = validateEmail(lead.email);
    if (!email) continue;

    if (seen.has(email)) {
      duplicateCount++;
      continue;
    }

    seen.add(email);
    unique.push(lead);
  }

  return { unique, duplicateCount };
}

// ─── Instantly bulk payload builder ───

interface LeadRecord {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  city?: string | null;
  category?: string | null;
}

interface InstantlyLeadPayload {
  email: string;
  first_name: string;
  last_name: string;
  company_name: string;
  phone?: string;
  website?: string;
  custom_variables?: Record<string, string>;
}

interface InstantlyBulkPayload {
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
  leads: LeadRecord[],
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

      // Custom variables for extra data
      const customVars: Record<string, string> = {};
      if (lead.website) customVars.website = lead.website;
      if (lead.city) customVars.city = lead.city;
      if (lead.phone) customVars.phone = lead.phone;
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
