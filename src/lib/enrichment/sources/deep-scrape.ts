/**
 * Waterfall Source 3 — Deep HTML Scraping (Enhanced)
 *
 * Priority: 3
 * Cost: FREE (0 API calls — fetch + regex)
 * Purpose: Scrape multiple pages (/, /contact, /about, /mentions-legales)
 *   and extract emails + phones using advanced regex + deobfuscation.
 *
 * Improvements over the basic `/api/enrich` scraper:
 *   1. Scrapes 4 pages (not just homepage)
 *   2. Extracts mailto: and tel: links
 *   3. Deobfuscates [at] → @, [dot] → .
 *   4. FR phone regex (fixed + mobile)
 *   5. Prefers same-domain emails over external
 *
 * Confidence: 65 (HTML regex — decent but can be noisy)
 */

import type {
  EnrichmentResult,
  EnrichmentLeadInput,
  EnrichmentContext,
} from "../types";
import { registerSource } from "../waterfall";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** Pages to scrape beyond the homepage */
const CONTACT_PATHS = ["/contact", "/nous-contacter", "/about", "/a-propos", "/mentions-legales"];

/** Email regex — broad but effective */
const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

/** mailto: link regex */
const MAILTO_REGEX = /mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;

/** tel: link regex */
const TEL_REGEX = /href\s*=\s*["']tel:([^"']+)["']/gi;

/** French phone numbers: +33, 0033, or 0 prefix */
const FR_PHONE_REGEX =
  /(?:(?:\+33|0033|0)\s?[1-9])(?:[\s.\-]?\d{2}){4}/g;

/** Obfuscated email patterns */
const OBFUSCATION_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\s*\[at\]\s*/gi, replacement: "@" },
  { pattern: /\s*\(at\)\s*/gi, replacement: "@" },
  { pattern: /\s*\{at\}\s*/gi, replacement: "@" },
  { pattern: /\s*\[dot\]\s*/gi, replacement: "." },
  { pattern: /\s*\(dot\)\s*/gi, replacement: "." },
  { pattern: /\s*\{dot\}\s*/gi, replacement: "." },
  { pattern: /\s*\[point\]\s*/gi, replacement: "." },
  { pattern: /\s*\(point\)\s*/gi, replacement: "." },
  { pattern: /\s+arobase\s+/gi, replacement: "@" },
  { pattern: /\s+at\s+/gi, replacement: "@" },
];

/** Domains to exclude (not real contact emails) */
const EXCLUDED_DOMAINS = new Set([
  "example.com", "sentry.io", "wixpress.com", "wordpress.org",
  "wordpress.com", "gravatar.com", "schema.org", "googleapis.com",
  "googleusercontent.com", "w3.org", "facebook.com", "twitter.com",
  "instagram.com", "linkedin.com", "youtube.com", "google.com",
  "apple.com", "microsoft.com", "amazon.com", "cloudflare.com",
  "gstatic.com", "jquery.com", "bootstrapcdn.com", "unpkg.com",
  "jsdelivr.net", "cdnjs.cloudflare.com",
]);

const EXCLUDED_PREFIXES = [
  "noreply", "no-reply", "donotreply", "mailer-daemon",
  "postmaster", "webmaster", "hostmaster", "abuse",
  "support@wordpress", "support@wix",
];

/* ------------------------------------------------------------------ */
/*  HTML Fetch                                                         */
/* ------------------------------------------------------------------ */

async function fetchPage(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      },
      redirect: "follow",
    });

    clearTimeout(timeout);
    if (!resp.ok) return null;

    const contentType = resp.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("xhtml")) {
      return null;
    }

    return await resp.text();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Email Extraction                                                   */
/* ------------------------------------------------------------------ */

function deobfuscateText(text: string): string {
  let result = text;
  for (const { pattern, replacement } of OBFUSCATION_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function isValidContactEmail(email: string): boolean {
  const lower = email.toLowerCase();
  const domain = lower.split("@")[1];
  if (!domain) return false;
  if (EXCLUDED_DOMAINS.has(domain)) return false;
  if (EXCLUDED_PREFIXES.some((p) => lower.startsWith(p))) return false;
  if (lower.includes("..") || lower.startsWith(".")) return false;
  // Reject obviously non-email strings (e.g. image files)
  if (/\.(png|jpg|jpeg|gif|svg|webp|css|js)$/i.test(lower)) return false;
  // Must have reasonable TLD
  const tld = domain.split(".").pop();
  if (!tld || tld.length < 2 || tld.length > 10) return false;
  return true;
}

function extractEmails(html: string): string[] {
  const emails = new Set<string>();

  // 1. Extract from mailto: links (highest quality)
  let match: RegExpExecArray | null;
  const mailtoRegex = new RegExp(MAILTO_REGEX.source, "gi");
  while ((match = mailtoRegex.exec(html)) !== null) {
    const email = match[1].toLowerCase().trim();
    if (isValidContactEmail(email)) {
      emails.add(email);
    }
  }

  // 2. Deobfuscate the HTML text, then regex
  const deobfuscated = deobfuscateText(html);

  const emailRegex = new RegExp(EMAIL_REGEX.source, "g");
  while ((match = emailRegex.exec(deobfuscated)) !== null) {
    const email = match[0].toLowerCase().trim();
    if (isValidContactEmail(email)) {
      emails.add(email);
    }
  }

  return [...emails];
}

/* ------------------------------------------------------------------ */
/*  Phone Extraction                                                   */
/* ------------------------------------------------------------------ */

function normalizePhone(raw: string): string {
  // Remove all non-digit characters except +
  return raw.replace(/[^\d+]/g, "");
}

function extractPhones(html: string): string[] {
  const phones = new Set<string>();

  // 1. Extract from tel: links
  let match: RegExpExecArray | null;
  const telRegex = new RegExp(TEL_REGEX.source, "gi");
  while ((match = telRegex.exec(html)) !== null) {
    const phone = normalizePhone(match[1]);
    if (phone.length >= 10) {
      phones.add(phone);
    }
  }

  // 2. Regex for French phone numbers
  const frPhoneRegex = new RegExp(FR_PHONE_REGEX.source, "g");
  while ((match = frPhoneRegex.exec(html)) !== null) {
    const phone = normalizePhone(match[0]);
    if (phone.length >= 10) {
      phones.add(phone);
    }
  }

  return [...phones];
}

/* ------------------------------------------------------------------ */
/*  Email Ranking                                                      */
/* ------------------------------------------------------------------ */

function rankEmails(
  emails: string[],
  leadDomain: string,
): string[] {
  // Prioritize:
  // 1. Same domain as lead
  // 2. contact@/info@ (generic but real)
  // 3. Others

  return [...emails].sort((a, b) => {
    const aDomain = a.split("@")[1] ?? "";
    const bDomain = b.split("@")[1] ?? "";

    // Same domain first
    const aSameDomain = aDomain.includes(leadDomain) ? 0 : 1;
    const bSameDomain = bDomain.includes(leadDomain) ? 0 : 1;
    if (aSameDomain !== bSameDomain) return aSameDomain - bSameDomain;

    // Personal emails > generic
    const aIsGeneric =
      a.startsWith("contact@") || a.startsWith("info@") || a.startsWith("accueil@");
    const bIsGeneric =
      b.startsWith("contact@") || b.startsWith("info@") || b.startsWith("accueil@");
    if (aIsGeneric !== bIsGeneric) return aIsGeneric ? 1 : -1;

    return 0;
  });
}

/* ------------------------------------------------------------------ */
/*  Source Function                                                     */
/* ------------------------------------------------------------------ */

async function deepScrapeSource(
  lead: EnrichmentLeadInput,
  context: EnrichmentContext,
): Promise<EnrichmentResult> {
  const domain = context.domain;
  const baseUrl = lead.website.startsWith("http")
    ? lead.website.replace(/\/+$/, "")
    : `https://${lead.website.replace(/\/+$/, "")}`;

  // Build list of URLs to scrape
  const urls = [baseUrl];
  for (const path of CONTACT_PATHS) {
    urls.push(`${baseUrl}${path}`);
  }

  // Fetch all pages in parallel (with error tolerance)
  const htmlResults = await Promise.allSettled(urls.map(fetchPage));

  // Collect all HTML
  const allEmails: string[] = [];
  const allPhones: string[] = [];
  let pagesScraped = 0;

  for (const result of htmlResults) {
    if (result.status !== "fulfilled" || !result.value) continue;
    pagesScraped++;

    const html = result.value;
    allEmails.push(...extractEmails(html));
    allPhones.push(...extractPhones(html));
  }

  // Deduplicate
  const uniqueEmails = [...new Set(allEmails)];
  const uniquePhones = [...new Set(allPhones)];

  // Rank emails
  const rankedEmails = rankEmails(uniqueEmails, domain);
  const bestEmail = rankedEmails[0] ?? null;
  const bestPhone = uniquePhones[0] ?? null;

  // Metadata
  const metadata: Record<string, string> = {
    pages_scraped: String(pagesScraped),
    emails_found: String(uniqueEmails.length),
    phones_found: String(uniquePhones.length),
  };

  if (uniqueEmails.length > 1) {
    metadata["all_emails"] = uniqueEmails.slice(0, 5).join(", ");
  }

  return {
    email: bestEmail,
    phone: bestPhone,
    dirigeant: null, // HTML scraping rarely finds dirigeant names reliably
    siret: null,
    source: "deep_scrape",
    confidence: 0, // Will be set by computeConfidence
    metadata,
  };
}

/* ------------------------------------------------------------------ */
/*  Register Source                                                     */
/* ------------------------------------------------------------------ */

registerSource("deep_scrape", deepScrapeSource);

export { deepScrapeSource };
