/**
 * Waterfall Source 1 — DNS / MX Intelligence (Pre-Check)
 *
 * Priority: 1 (runs FIRST — before any other source)
 * Cost: FREE (Google Public DNS API)
 * Purpose: Determine if a domain can receive email.
 *   - If no MX records → flag `skipEmailSources = true` → save credits
 *   - Detect mail provider (Google Workspace, Microsoft 365, OVH, etc.)
 *   - Enrich metadata with SPF, provider info
 *
 * API: https://dns.google/resolve?name={domain}&type=MX (free, unlimited)
 */

import type {
  EnrichmentResult,
  EnrichmentLeadInput,
  EnrichmentContext,
} from "../types";
import { registerSource } from "../waterfall";

/* ------------------------------------------------------------------ */
/*  MX Provider Detection                                              */
/* ------------------------------------------------------------------ */

interface MxProviderPattern {
  pattern: string;
  provider: string;
}

const MX_PATTERNS: MxProviderPattern[] = [
  { pattern: "google", provider: "google" },
  { pattern: "googlemail", provider: "google" },
  { pattern: "outlook", provider: "microsoft" },
  { pattern: "microsoft", provider: "microsoft" },
  { pattern: "protection.outlook", provider: "microsoft" },
  { pattern: "ovh", provider: "ovh" },
  { pattern: "mail.ovh", provider: "ovh" },
  { pattern: "gandi", provider: "gandi" },
  { pattern: "ionos", provider: "ionos" },
  { pattern: "zoho", provider: "zoho" },
  { pattern: "protonmail", provider: "protonmail" },
  { pattern: "mxplan", provider: "ovh" },
  { pattern: "infomaniak", provider: "infomaniak" },
  { pattern: "o2switch", provider: "o2switch" },
  { pattern: "hostinger", provider: "hostinger" },
  { pattern: "yahoo", provider: "yahoo" },
  { pattern: "icloud", provider: "apple" },
  { pattern: "titan.email", provider: "titan" },
  { pattern: "emailsrvr.com", provider: "rackspace" },
  { pattern: "pphosted.com", provider: "proofpoint" },
  { pattern: "messagelabs", provider: "symantec" },
  { pattern: "mimecast", provider: "mimecast" },
  { pattern: "barracuda", provider: "barracuda" },
];

function detectMxProvider(mxRecords: string[]): string | null {
  const allMx = mxRecords.join(" ").toLowerCase();
  for (const { pattern, provider } of MX_PATTERNS) {
    if (allMx.includes(pattern)) {
      return provider;
    }
  }
  return "other";
}

/* ------------------------------------------------------------------ */
/*  DNS Lookup via Google Public DNS API                                */
/* ------------------------------------------------------------------ */

interface DnsAnswer {
  name: string;
  type: number;
  TTL: number;
  data: string;
}

interface DnsResponse {
  Status: number;
  Answer?: DnsAnswer[];
}

async function lookupMx(domain: string): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const resp = await fetch(
      `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`,
      {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      },
    );
    clearTimeout(timeout);

    if (!resp.ok) return [];

    const data: DnsResponse = await resp.json();

    // Status 0 = NOERROR, anything else = no records
    if (data.Status !== 0 || !data.Answer) return [];

    // MX records are type 15
    return data.Answer.filter((a) => a.type === 15).map((a) => a.data);
  } catch {
    clearTimeout(timeout);
    return [];
  }
}

async function lookupTxt(domain: string): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const resp = await fetch(
      `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=TXT`,
      {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      },
    );
    clearTimeout(timeout);

    if (!resp.ok) return [];

    const data: DnsResponse = await resp.json();
    if (data.Status !== 0 || !data.Answer) return [];

    // TXT records are type 16
    return data.Answer.filter((a) => a.type === 16).map((a) => a.data);
  } catch {
    clearTimeout(timeout);
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  SPF Analysis                                                       */
/* ------------------------------------------------------------------ */

function extractSpfProviders(txtRecords: string[]): string[] {
  const providers: string[] = [];
  for (const txt of txtRecords) {
    const lower = txt.toLowerCase();
    if (!lower.includes("v=spf1")) continue;

    // Extract "include:" directives
    const includes = lower.match(/include:([^\s"]+)/g) || [];
    for (const inc of includes) {
      const domain = inc.replace("include:", "");
      if (domain.includes("google")) providers.push("google");
      else if (domain.includes("outlook") || domain.includes("microsoft"))
        providers.push("microsoft");
      else if (domain.includes("ovh")) providers.push("ovh");
      else if (domain.includes("zoho")) providers.push("zoho");
      else if (domain.includes("sendinblue") || domain.includes("brevo"))
        providers.push("brevo");
      else if (domain.includes("sendgrid")) providers.push("sendgrid");
      else if (domain.includes("mailchimp")) providers.push("mailchimp");
    }
  }
  return [...new Set(providers)];
}

/* ------------------------------------------------------------------ */
/*  Source Function                                                     */
/* ------------------------------------------------------------------ */

async function dnsIntelSource(
  lead: EnrichmentLeadInput,
  context: EnrichmentContext,
): Promise<EnrichmentResult> {
  const domain = context.domain;

  // Run MX and TXT lookups in parallel
  const [mxRecords, txtRecords] = await Promise.all([
    lookupMx(domain),
    lookupTxt(domain),
  ]);

  const hasMx = mxRecords.length > 0;
  const mxProvider = hasMx ? detectMxProvider(mxRecords) : null;
  const spfProviders = extractSpfProviders(txtRecords);

  // Build metadata
  const metadata: Record<string, string> = {
    has_mx: String(hasMx),
    mx_records: mxRecords.slice(0, 5).join(", "), // Cap at 5 records
  };

  if (mxProvider) {
    metadata["mx_provider"] = mxProvider;
  }
  if (spfProviders.length > 0) {
    metadata["spf_providers"] = spfProviders.join(", ");
  }

  // Check for marketing tools in SPF (useful for outreach strategy)
  const hasMarketingTools = spfProviders.some((p) =>
    ["brevo", "sendgrid", "mailchimp"].includes(p),
  );
  if (hasMarketingTools) {
    metadata["uses_marketing_email"] = "true";
  }

  return {
    email: null, // DNS doesn't find emails directly
    phone: null,
    dirigeant: null,
    siret: null,
    source: "dns_intel",
    confidence: 0, // Will be set by computeConfidence
    metadata,
    skipEmailSources: !hasMx, // KEY: if no MX, skip all email sources
  };
}

/* ------------------------------------------------------------------ */
/*  Register Source                                                     */
/* ------------------------------------------------------------------ */

registerSource("dns_intel", dnsIntelSource);

export { dnsIntelSource };
