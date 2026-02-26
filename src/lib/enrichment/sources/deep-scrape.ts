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
  DecisionMakerData,
} from "../types";
import { registerSource } from "../waterfall";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** Pages to scrape beyond the homepage — 2 levels deep */
const CONTACT_PATHS = [
  "/contact", "/nous-contacter", "/contactez-nous",
  "/about", "/a-propos", "/qui-sommes-nous",
  "/mentions-legales", "/legal",
  // Team pages — high value for dirigeant names
  "/equipe", "/notre-equipe", "/team", "/notre-team",
  "/l-equipe", "/lequipe",
];

/** Email regex — broad but effective */
const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

/** mailto: link regex */
const MAILTO_REGEX = /mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;

/** tel: link regex */
const TEL_REGEX = /href\s*=\s*["']tel:([^"']+)["']/gi;

/** French phone numbers: +33, 0033, or 0 prefix */
const FR_PHONE_REGEX =
  /(?:(?:\+33|0033|0)\s?[1-9])(?:[\s.\-]?\d{2}){4}/g;

/** SIRET regex — 14 digits, optionally spaced (123 456 789 00012) */
const SIRET_REGEX = /(?:siret|SIRET|Siret)\s*[:.]?\s*(\d{3}\s?\d{3}\s?\d{3}\s?\d{5})/;

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
    const timeout = setTimeout(() => controller.abort(), 6000);

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
/*  SIRET Extraction                                                   */
/* ------------------------------------------------------------------ */

function extractSiret(html: string): string | null {
  const textOnly = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const match = SIRET_REGEX.exec(textOnly);
  if (match?.[1]) {
    return match[1].replace(/\s/g, ""); // Remove spaces → pure 14 digits
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  HTML Entity Decoding                                               */
/* ------------------------------------------------------------------ */

/** Decode common HTML entities that corrupt extracted emails/phones */
function decodeHtmlEntities(html: string): string {
  return html
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\\u003e/gi, ">")
    .replace(/\\u003c/gi, "<")
    .replace(/\\u0026/gi, "&");
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

function cleanExtractedEmail(raw: string): string {
  // Strip leading/trailing HTML artifacts: > < &gt; &lt; etc.
  return raw
    .replace(/^[<>;\s]+/, "")
    .replace(/[<>;\s]+$/, "")
    .toLowerCase()
    .trim();
}

function isValidContactEmail(email: string): boolean {
  const lower = cleanExtractedEmail(email);
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

  // Decode HTML entities first so &#64; → @, \u003e → >, etc.
  const decoded = decodeHtmlEntities(html);

  // 1. Extract from mailto: links (highest quality)
  let match: RegExpExecArray | null;
  const mailtoRegex = new RegExp(MAILTO_REGEX.source, "gi");
  while ((match = mailtoRegex.exec(decoded)) !== null) {
    const email = cleanExtractedEmail(match[1]);
    if (isValidContactEmail(email)) {
      emails.add(email);
    }
  }

  // 2. Deobfuscate the HTML text, then regex
  const deobfuscated = deobfuscateText(decoded);

  const emailRegex = new RegExp(EMAIL_REGEX.source, "g");
  while ((match = emailRegex.exec(deobfuscated)) !== null) {
    const email = cleanExtractedEmail(match[0]);
    if (isValidContactEmail(email)) {
      emails.add(email);
    }
  }

  // 3. Extract from meta tags (often hidden from visible HTML)
  const metaEmailRegex = /<meta[^>]*content\s*=\s*["']([^"']*@[^"']*\.[a-zA-Z]{2,})["'][^>]*>/gi;
  while ((match = metaEmailRegex.exec(decoded)) !== null) {
    const email = cleanExtractedEmail(match[1]);
    if (isValidContactEmail(email)) {
      emails.add(email);
    }
  }

  // 4. Extract from <link rel="author" href="mailto:...">
  const linkAuthorRegex = /<link[^>]*href\s*=\s*["']mailto:([^"']+)["'][^>]*>/gi;
  while ((match = linkAuthorRegex.exec(decoded)) !== null) {
    const email = cleanExtractedEmail(match[1]);
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
/*  Dirigeant Name Extraction from Team Pages                          */
/* ------------------------------------------------------------------ */

/** Titles that indicate a dirigeant / decision-maker in French */
const DIRIGEANT_TITLE_REGEX =
  /(?:g[ée]rant[e]?|fondateur|fondatrice|directeur|directrice|pr[ée]sident[e]?|CEO|PDG|DG|DGA|dirigeant[e]?|co-fondateur|co-fondatrice|co-g[ée]rant[e]?|managing\s+director|owner|propri[ée]taire|associ[ée][e]?|chef\s+d['']entreprise|responsable)/i;

/** French name regex pattern — reused across strategies */
const FRENCH_NAME_PATTERN = /[A-ZÀ-ÖÙ-Ü][a-zà-öù-ü]+(?:\s+[A-ZÀ-ÖÙ-Ü][a-zà-öù-ü]+){1,3}/;

/**
 * Words that NEVER appear in real French first/last names.
 * If ANY word in the candidate name matches → reject as garbage.
 * Covers: UI elements, legal text, social media, business categories,
 * navigation, departments, common French non-name words.
 */
const GARBAGE_WORDS = new Set([
  // --- Navigation / UI elements ---
  "precedent", "suivant", "voir", "plus", "moins", "accueil", "menu",
  "fermer", "ouvrir", "retour", "haut", "bas", "page", "lien", "lire",
  "cliquer", "cliquez", "telecharger", "envoyer", "valider", "annuler",
  "rechercher", "filtrer", "trier", "afficher", "masquer", "partager",
  "imprimer", "copier", "coller", "modifier", "supprimer", "ajouter",
  "connexion", "inscription", "deconnexion", "panier", "commander",
  // --- Social media ---
  "facebook", "instagram", "twitter", "linkedin", "youtube", "tiktok",
  "pinterest", "snapchat", "whatsapp", "telegram",
  // --- Legal / RGPD ---
  "donnees", "personnelles", "propriete", "intellectuelle", "mentions",
  "legales", "conditions", "generales", "politique", "confidentialite",
  "cookies", "rgpd", "cnil", "droits", "reserves", "copyright",
  "numerique", "economie", "protection", "utilisation", "traitement",
  // --- Business categories / real estate ---
  "immobilier", "immobiliere", "agence", "maison", "appartement",
  "terrain", "location", "vente", "achat", "louer", "estimer", "acheter",
  "vendre", "estimation", "programme", "neuf", "ancien", "investissement",
  "promotion", "construction", "renovation", "gestion", "syndic",
  "copropriete", "patrimoine", "transaction", "mandat", "bien", "biens",
  // --- Business generic ---
  "entreprise", "societe", "groupe", "service", "services", "relation",
  "clients", "client", "equipe", "notre", "votre", "contact", "accueil",
  "reception", "standard", "secretariat", "administration", "commercial",
  "technique", "support", "ressources", "humaines", "comptabilite",
  "marketing", "communication", "informatique", "logistique", "qualite",
  // --- Common French words (never in names) ---
  "avec", "dans", "pour", "sans", "sous", "sur", "vers", "chez",
  "entre", "comme", "tout", "tous", "toute", "toutes", "autre", "autres",
  "cette", "sont", "nous", "vous", "leur", "elle", "elles",
  "mais", "donc", "alors", "aussi", "bien", "tres", "plus", "moins",
  "city", "guide", "home", "green", "casa", "residence", "Bonaparte",
  // --- Web / tech terms (never names) ---
  "site", "web", "page", "mail", "email", "internet", "adresse", "nom",
  "prenom", "formulaire", "blog", "forum", "boutique", "catalogue",
  "espace", "portail", "plateforme", "application", "version", "mise",
  "jour", "flux", "carte", "plan", "photo", "video", "image", "fichier",
  // --- Legal / professional terms ---
  "cabinet", "etude", "office", "bureau", "siege", "agences", "filiale",
  "droit", "avocat", "avocats", "notaire", "notaires", "huissier",
  "maitre", "expert", "conseil", "juridique", "judiciaire", "legal",
  // --- Articles / determiners (catch "Les Cookies" etc.) ---
  "les", "des", "une", "aux", "ces", "ses", "mes", "tes",
  "mon", "ton", "son", "vos", "nos", "leurs",
  // --- Titles / roles (not names) ---
  "assistante", "assistant", "stagiaire", "comptable", "secretaire",
  "responsable", "collaborateur", "collaboratrice", "negociateur",
  "negociatrice", "conseiller", "conseillere", "charge", "chargee",
  "directeur", "directrice", "gerant", "gerante", "president", "presidente",
  "associe", "associee", "fondateur", "fondatrice", "avocat", "avocate",
  // --- Addresses / places ---
  "boulevard", "avenue", "rue", "place", "chemin", "impasse", "allee",
  "route", "passage", "square", "quai", "cours", "rond-point",
  "cedex", "batiment", "etage", "porte", "numero", "lot", "zone",
  // --- Descriptors (not names) ---
  "contenu", "utilisateur", "utilisateurs",
  "informations", "information", "actualites", "actualite", "nouveautes",
  "evenements", "evenement", "offres", "offre", "solutions", "solution",
  "produits", "produit", "activites", "activite", "projets", "projet",
  "references", "reference", "partenaires", "partenaire", "histoire",
  "savoir", "faire", "propos",
  // --- Company form suffixes ---
  "sarl", "sas", "eurl", "sasu", "sci", "snc",
]);

/** Validate a candidate name: must look like a real human name */
function isValidCandidateName(name: string): boolean {
  const parts = name.split(/\s+/);
  if (parts.length < 2 || parts.length > 4) return false;
  if (name.length > 40 || name.length < 5) return false;

  const normalized = name.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Check each word against the garbage set
  const words = normalized.split(/\s+/);
  for (const word of words) {
    if (GARBAGE_WORDS.has(word)) return false;
  }

  // Every word must start with uppercase in the original (proper noun check)
  for (const part of parts) {
    if (!/^[A-ZÀ-ÖÙ-Ü]/.test(part)) return false;
  }

  // Reject if ALL words are uppercase (likely an acronym or title, not a name)
  if (parts.every((p) => p === p.toUpperCase()) && parts.length <= 2) return false;

  return true;
}

/** Max dirigeants to extract from HTML (avoid noise) */
const MAX_HTML_DIRIGEANTS = 5;

/**
 * Extract ALL dirigeant names + titles from an HTML team page.
 * Uses 3 strategies in order of reliability:
 *   Strategy 0: HTML structure-aware (adjacent elements)
 *   Strategy 1: Text-based "Name – Title" pattern
 *   Strategy 2: Proximity search around title keywords
 *
 * Returns ALL matches (up to MAX_HTML_DIRIGEANTS), deduplicated by name.
 */
function extractAllDirigeantFromHtml(
  html: string,
): Array<{ name: string; title: string }> {
  const results: Array<{ name: string; title: string }> = [];
  const seenNames = new Set<string>();

  /** Push a match if not already seen (deduplicate by normalized name) */
  function addIfNew(name: string, title: string): void {
    if (results.length >= MAX_HTML_DIRIGEANTS) return;
    const norm = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (seenNames.has(norm)) return;
    seenNames.add(norm);
    results.push({ name, title });
  }

  // --- Strategy 0: HTML structure-aware ---
  // Many French sites structure teams as:
  //   <h3>Jean Dupont</h3><p>Gérant</p>
  //   <span class="name">Jean Dupont</span><span class="role">Fondateur</span>
  // Look for pairs of adjacent HTML elements where one is a name and one is a title
  const htmlPairRegex =
    /<(?:h[1-6]|span|p|div|strong|b|em|li)[^>]*>\s*([^<]{3,50}?)\s*<\/(?:h[1-6]|span|p|div|strong|b|em|li)>\s*(?:<[^>]*>\s*)*<(?:h[1-6]|span|p|div|strong|b|em|li)[^>]*>\s*([^<]{3,80}?)\s*<\/(?:h[1-6]|span|p|div|strong|b|em|li)>/gi;

  let match: RegExpExecArray | null;
  while ((match = htmlPairRegex.exec(html)) !== null) {
    const text1 = match[1].trim();
    const text2 = match[2].trim();

    // Check if text1 is name + text2 is title
    if (FRENCH_NAME_PATTERN.test(text1) && DIRIGEANT_TITLE_REGEX.test(text2)) {
      if (isValidCandidateName(text1)) {
        addIfNew(text1, text2.trim());
      }
    }
    // Check reverse: text1 is title + text2 is name
    if (DIRIGEANT_TITLE_REGEX.test(text1) && FRENCH_NAME_PATTERN.test(text2)) {
      if (isValidCandidateName(text2)) {
        addIfNew(text2, text1.trim());
      }
    }
  }

  // --- Strategy 1: Text-based "Name – Title" pattern ---
  // Match patterns like "Name – Title", "Name, Title", "Name | Title"
  const nameNearTitleRegex =
    /([A-ZÀ-ÖÙ-Ü][a-zà-öù-ü]+(?:\s+[A-ZÀ-ÖÙ-Ü][a-zà-öù-ü]+){1,3})\s*[,\-–—|:]\s*((?:g[ée]rant[e]?|fondateur|fondatrice|directeur|directrice|pr[ée]sident[e]?|CEO|PDG|DG|DGA|dirigeant[e]?|co-fondateur|co-fondatrice|co-g[ée]rant[e]?|managing\s+director|propri[ée]taire|associ[ée][e]?|chef\s+d['']entreprise)[a-zéè]*(?:\s+g[ée]n[ée]ral[e]?)?)/gi;

  while ((match = nameNearTitleRegex.exec(html)) !== null) {
    const name = match[1].trim();
    const title = match[2].trim();
    if (isValidCandidateName(name)) {
      addIfNew(name, title);
    }
  }

  // --- Strategy 2: Proximity search around title keywords ---
  // Strip HTML tags first
  const textOnly = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

  // Search for ALL occurrences of title keywords
  const globalTitleRegex = new RegExp(DIRIGEANT_TITLE_REGEX.source, "gi");
  let titleMatch: RegExpExecArray | null;
  while ((titleMatch = globalTitleRegex.exec(textOnly)) !== null) {
    if (results.length >= MAX_HTML_DIRIGEANTS) break;
    // Look 200 chars before and after the title keyword
    const start = Math.max(0, titleMatch.index - 200);
    const end = Math.min(textOnly.length, titleMatch.index + 200);
    const ctx = textOnly.slice(start, end);

    // Find a capitalized name near the title
    const nameRegex = /([A-ZÀ-ÖÙ-Ü][a-zà-öù-ü]+(?:\s+[A-ZÀ-ÖÙ-Ü][a-zà-öù-ü]+){1,2})/g;
    let nameMatch: RegExpExecArray | null;
    while ((nameMatch = nameRegex.exec(ctx)) !== null) {
      const candidateName = nameMatch[1].trim();
      if (isValidCandidateName(candidateName)) {
        addIfNew(candidateName, titleMatch[0]);
        break; // One name per title occurrence to avoid noise
      }
    }
  }

  return results;
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
  let foundSiret: string | null = null;

  // Collect ALL dirigeants across ALL pages, deduplicated by normalized name
  const allRawDirigeants: Array<{ name: string; title: string }> = [];
  const seenDirigeantNames = new Set<string>();

  for (let i = 0; i < htmlResults.length; i++) {
    const result = htmlResults[i];
    if (result.status !== "fulfilled" || !result.value) continue;
    pagesScraped++;

    const html = result.value;
    allEmails.push(...extractEmails(html));
    allPhones.push(...extractPhones(html));

    // Extract SIRET from legal pages (obligation légale FR)
    if (!foundSiret) {
      foundSiret = extractSiret(html);
    }

    // Extract ALL dirigeants from each page (subpages first, homepage last)
    // Skip homepage (i=0) — we try it as fallback below (less reliable, more noise)
    if (i > 0) {
      const pageDirigeants = extractAllDirigeantFromHtml(html);
      for (const d of pageDirigeants) {
        const norm = d.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (!seenDirigeantNames.has(norm)) {
          seenDirigeantNames.add(norm);
          allRawDirigeants.push(d);
        }
      }
    }
  }

  // Fallback: check homepage for dirigeants if none found on subpages
  if (allRawDirigeants.length === 0 && htmlResults[0]?.status === "fulfilled" && htmlResults[0].value) {
    const homepageDirigeants = extractAllDirigeantFromHtml(htmlResults[0].value);
    for (const d of homepageDirigeants) {
      const norm = d.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (!seenDirigeantNames.has(norm)) {
        seenDirigeantNames.add(norm);
        allRawDirigeants.push(d);
      }
    }
  }

  // Convert raw dirigeants to DecisionMakerData[]
  const dirigeants: DecisionMakerData[] = allRawDirigeants.map((d) => {
    const parts = d.name.trim().split(/\s+/);
    const firstName = parts[0] ?? "";
    const lastName = parts.slice(1).join(" ");
    return {
      name: d.name,
      firstName,
      lastName,
      title: d.title,
      email: null,
      phone: null,
      linkedinUrl: null,
      source: "deep_scrape",
      confidence: 65,
    };
  });

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

  if (dirigeants.length > 0) {
    metadata["dirigeant_title"] = allRawDirigeants[0].title;
    metadata["dirigeants_found"] = String(dirigeants.length);
  }

  if (foundSiret) {
    metadata["siret_source"] = "mentions_legales";
  }

  return {
    email: bestEmail,
    phone: bestPhone,
    dirigeant: dirigeants[0]?.name ?? null, // Backward compat scalar
    siret: foundSiret,
    source: "deep_scrape",
    confidence: 0, // Will be set by computeConfidence
    metadata,
    dirigeants, // Full array of all decision-makers found
  };
}

/* ------------------------------------------------------------------ */
/*  Register Source                                                     */
/* ------------------------------------------------------------------ */

registerSource("deep_scrape", deepScrapeSource);

export { deepScrapeSource };
