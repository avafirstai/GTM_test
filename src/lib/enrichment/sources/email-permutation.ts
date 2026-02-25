/**
 * Waterfall Source 5 — Email Permutation + Verification
 *
 * Priority: 5
 * Cost: FREE to FREEMIUM (depends on verification API)
 * Purpose: Generate email candidates from dirigeant name + domain,
 *   then verify which ones actually exist via email verification API.
 *
 * Requires: Dirigeant name from SIRENE (Phase 4) + domain from lead
 *
 * Flow:
 *   1. Get dirigeant name from accumulated context (SIRENE gave us this)
 *   2. Generate 8+ email permutations (prenom.nom@, p.nom@, etc.)
 *   3. Verify each via /api/enrich/verify-email (SMTP check or API)
 *   4. Return the first verified email
 *
 * Confidence: 50 base (generated pattern), +20 if SMTP verified = 70
 */

import type {
  EnrichmentResult,
  EnrichmentLeadInput,
  EnrichmentContext,
  DecisionMakerData,
} from "../types";
import { registerSource } from "../waterfall";

/* ------------------------------------------------------------------ */
/*  Accent Normalization                                               */
/* ------------------------------------------------------------------ */

/**
 * Remove French accents and normalize for email generation.
 * éèêë → e, àâ → a, ùûü → u, ôö → o, ïî → i, ç → c
 */
function removeAccents(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Clean a name part for email use.
 * Removes special chars, hyphens → nothing or kept, etc.
 */
function cleanNamePart(name: string): string {
  return removeAccents(name)
    .replace(/['']/g, "") // O'Brien → obrien
    .replace(/\s+/g, "")  // Multi-word → single
    .replace(/[^a-z]/g, ""); // Only keep letters
}

/* ------------------------------------------------------------------ */
/*  Permutation Generator                                              */
/* ------------------------------------------------------------------ */

/**
 * Generate all common email permutations from first + last name.
 * Returns deduplicated list of email candidates.
 */
function generatePermutations(
  firstName: string,
  lastName: string,
  domain: string,
): string[] {
  const f = cleanNamePart(firstName);
  const l = cleanNamePart(lastName);

  if (!f || !l) return [];

  const fi = f[0]; // First initial

  // Ordered by FR frequency: prenom.nom, prenom, j.nom, nom.prenom, nom, ...
  const permutations = [
    `${f}.${l}@${domain}`,        // 1. jean.dupont@ — THE FR standard
    `${f}@${domain}`,              // 2. jean@ — très courant TPE/PME
    `${fi}.${l}@${domain}`,        // 3. j.dupont@ — format pro
    `${l}.${f}@${domain}`,         // 4. dupont.jean@ — variante
    `${l}@${domain}`,              // 5. dupont@ — courant TPE
    `${f}${l}@${domain}`,          // 6. jeandupont@
    `${fi}${l}@${domain}`,         // 7. jdupont@
    `${l}${f}@${domain}`,          // 8. dupontjean@
    `${f}-${l}@${domain}`,         // 9. jean-dupont@
    `${f}_${l}@${domain}`,         // 10. jean_dupont@
    `${fi}${l[0]}@${domain}`,      // 11. jd@ — rare initials
    `contact@${domain}`,           // 12. generic fallback
  ];

  // Deduplicate
  return [...new Set(permutations)];
}

/* ------------------------------------------------------------------ */
/*  Email Verification                                                 */
/* ------------------------------------------------------------------ */

interface VerifyResult {
  email: string;
  valid: boolean;
  smtpVerified: boolean;
}

/**
 * Verify an email address using the /api/enrich/verify-email endpoint.
 * Falls back to a free API if the local endpoint is not available.
 */
async function verifyEmail(email: string): Promise<VerifyResult> {
  // Strategy: Try eva.pingutil.com (free, no auth, unlimited)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(
      `https://api.eva.pingutil.com/email?email=${encodeURIComponent(email)}`,
      {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      },
    );

    clearTimeout(timeout);

    if (resp.ok) {
      const data = await resp.json();
      return {
        email,
        valid: data.status === "valid" || data.data?.valid_syntax === true,
        smtpVerified: data.data?.smtp_check === true,
      };
    }
  } catch {
    // API failed — fall back to syntax check only
  }

  // Fallback: basic syntax validation (no SMTP check)
  const syntaxValid = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(email);
  return {
    email,
    valid: syntaxValid,
    smtpVerified: false,
  };
}

/* ------------------------------------------------------------------ */
/*  Source Function                                                     */
/* ------------------------------------------------------------------ */

/** Max DMs to run email permutations for (FREE but slow) */
const MAX_EMAIL_PERM_DMS = 5;

/**
 * Run email permutation + SMTP verification for a single person.
 * Returns the best verified email or null.
 */
async function findEmailForPerson(
  firstName: string,
  lastName: string,
  domain: string,
): Promise<{ email: string; smtpVerified: boolean } | null> {
  const permutations = generatePermutations(firstName, lastName, domain);
  if (permutations.length === 0) return null;

  const maxVerifications = 12;
  const toVerify = permutations.slice(0, maxVerifications);

  const results = await Promise.allSettled(
    toVerify.map((email) => verifyEmail(email)),
  );

  let bestEmail: string | null = null;
  let bestSmtpVerified = false;

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { email, valid, smtpVerified } = result.value;

    if (smtpVerified) {
      return { email, smtpVerified: true };
    }
    if (valid && !bestEmail) {
      bestEmail = email;
    }
  }

  return bestEmail ? { email: bestEmail, smtpVerified: bestSmtpVerified } : null;
}

async function emailPermutationSource(
  lead: EnrichmentLeadInput,
  context: EnrichmentContext,
): Promise<EnrichmentResult> {
  const domain = context.domain;

  const emptyResult: EnrichmentResult = {
    email: null,
    phone: null,
    dirigeant: null,
    siret: null,
    source: "email_permutation",
    confidence: 0,
    metadata: {},
  };

  // Multi-DM mode: find emails for DMs that don't have one yet
  const dmsWithoutEmail = context.accumulated.decisionMakers
    .filter((dm) => !dm.email && dm.firstName && dm.lastName)
    .slice(0, MAX_EMAIL_PERM_DMS);

  if (dmsWithoutEmail.length > 0) {
    const updatedDms: DecisionMakerData[] = [];
    let bestEmail: string | null = null;
    let bestSmtpVerified = false;
    let successCount = 0;

    // Sequential (not parallel) to avoid hammering eva.pingutil
    for (const dm of dmsWithoutEmail) {
      const result = await findEmailForPerson(dm.firstName, dm.lastName, domain);
      if (result) {
        dm.email = result.email;
        successCount++;
        if (!bestEmail) {
          bestEmail = result.email;
          bestSmtpVerified = result.smtpVerified;
        }
        updatedDms.push({ ...dm, source: "email_permutation", confidence: result.smtpVerified ? 70 : 50 });
      }
    }

    const metadata: Record<string, string> = {
      strategy: "multi_dm_permutation",
      dm_attempted: String(dmsWithoutEmail.length),
      dm_success: String(successCount),
    };

    if (bestSmtpVerified) {
      metadata["smtp_verified"] = "true";
    }

    return {
      email: bestEmail,
      phone: null,
      dirigeant: context.accumulated.dirigeant,
      siret: null,
      source: "email_permutation",
      confidence: 0,
      metadata,
      dirigeants: updatedDms.length > 0 ? updatedDms : undefined,
    };
  }

  // Legacy fallback: single dirigeant scalar
  const firstName = context.accumulated.dirigeantFirstName;
  const lastName = context.accumulated.dirigeantLastName;

  if (!firstName || !lastName) {
    // No dirigeant name → generic fallback
    const genericEmail = `contact@${domain}`;
    const verification = await verifyEmail(genericEmail);

    if (verification.valid) {
      return {
        ...emptyResult,
        email: genericEmail,
        metadata: {
          strategy: "generic_fallback",
          smtp_verified: String(verification.smtpVerified),
        },
      };
    }

    return emptyResult;
  }

  // Single DM permutation
  const result = await findEmailForPerson(firstName, lastName, domain);

  const metadata: Record<string, string> = {
    strategy: "name_permutation",
    dirigeant_first_name: firstName,
    dirigeant_last_name: lastName,
  };

  if (result?.smtpVerified) {
    metadata["smtp_verified"] = "true";
  }

  return {
    email: result?.email ?? null,
    phone: null,
    dirigeant: context.accumulated.dirigeant,
    siret: null,
    source: "email_permutation",
    confidence: 0,
    metadata,
  };
}

/* ------------------------------------------------------------------ */
/*  Register Source                                                     */
/* ------------------------------------------------------------------ */

registerSource("email_permutation", emailPermutationSource);

export { emailPermutationSource };
