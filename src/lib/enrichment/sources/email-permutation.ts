/**
 * Waterfall Source 8 — Email Permutation + STRICT Double SMTP Verification
 *
 * Priority: 8 (LAST RESORT — only after all other sources including Kaspr)
 * Cost: FREE
 * Purpose: Generate email candidates from dirigeant name + domain,
 *   then verify which ones actually exist via double SMTP check.
 *
 * STRICT POLICY: Only returns emails verified by BOTH disify.com
 * AND mailcheck.ai. If either service fails → email is REJECTED.
 * No guesses, no "syntax-only valid" emails. 100% verified or nothing.
 *
 * Requires: Dirigeant name from SIRENE (Phase 4) + domain from lead
 *
 * Flow:
 *   1. Get dirigeant name from accumulated context (SIRENE gave us this)
 *   2. Generate 12 email permutations (prenom.nom@, p.nom@, etc.)
 *   3. Double-verify each via disify.com + mailcheck.ai
 *   4. Return ONLY the first double-verified email (strict mode)
 *
 * Confidence: 90 base (double SMTP-verified = very reliable)
 */

import type {
  EnrichmentResult,
  EnrichmentLeadInput,
  EnrichmentContext,
  DecisionMakerData,
} from "../types";
import { registerSource } from "../waterfall";
import { verifyEmailSmtp } from "../smtp-verify";

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
/*  Source Function                                                     */
/* ------------------------------------------------------------------ */

/** Max DMs to run email permutations for (FREE but slow) */
const MAX_EMAIL_PERM_DMS = 5;

/**
 * Run email permutation + STRICT double SMTP verification for a single person.
 * Uses verifyEmailSmtp from smtp-verify.ts (eva + mailcheck double check).
 * Returns ONLY a double-SMTP-verified email or null. No guesses.
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

  // Verify all permutations in parallel using the shared double-check verifier
  const results = await Promise.allSettled(
    toVerify.map((email) => verifyEmailSmtp(email)),
  );

  // STRICT: Only return double-SMTP-verified emails. No syntax-only guesses.
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const { email, smtpVerified, disposable } = result.value;

    if (smtpVerified && !disposable) {
      return { email, smtpVerified: true };
    }
  }

  // No double-verified email found → return null (strict policy)
  return null;
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
    let successCount = 0;

    // Sequential to avoid hammering verification APIs
    for (const dm of dmsWithoutEmail) {
      const result = await findEmailForPerson(dm.firstName, dm.lastName, domain);
      if (result) {
        dm.email = result.email;
        successCount++;
        if (!bestEmail) {
          bestEmail = result.email;
        }
        // All results are double-SMTP-verified (strict mode) → confidence 90
        updatedDms.push({ ...dm, source: "email_permutation", confidence: 90 });
      }
    }

    const metadata: Record<string, string> = {
      strategy: "multi_dm_permutation_strict",
      dm_attempted: String(dmsWithoutEmail.length),
      dm_success: String(successCount),
    };

    if (bestEmail) {
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
    // No dirigeant name → generic fallback (strict: double SMTP only)
    const genericEmail = `contact@${domain}`;
    const verification = await verifyEmailSmtp(genericEmail);

    if (verification.smtpVerified) {
      return {
        ...emptyResult,
        email: genericEmail,
        metadata: {
          strategy: "generic_fallback_strict",
          smtp_verified: "true",
        },
      };
    }

    // Not double-SMTP verified → reject
    return emptyResult;
  }

  // Single DM permutation (strict double SMTP)
  const result = await findEmailForPerson(firstName, lastName, domain);

  const metadata: Record<string, string> = {
    strategy: "name_permutation_strict",
    dirigeant_first_name: firstName,
    dirigeant_last_name: lastName,
  };

  if (result) {
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
