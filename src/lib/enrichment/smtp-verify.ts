/**
 * Universal SMTP Email Verification
 *
 * Verifies any email address via eva.pingutil.com (free, no auth, unlimited).
 * Used by the waterfall to verify ALL emails found by any source,
 * not just email_permutation.
 *
 * Returns: { valid, smtpVerified, disposable }
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SmtpVerifyResult {
  email: string;
  /** Basic syntax + DNS check passed */
  valid: boolean;
  /** Full SMTP RCPT TO check passed (mailbox exists) */
  smtpVerified: boolean;
  /** Email is from a disposable/temporary domain */
  disposable: boolean;
}

/* ------------------------------------------------------------------ */
/*  Cache — avoid re-verifying the same email multiple times           */
/* ------------------------------------------------------------------ */

const verifyCache = new Map<string, SmtpVerifyResult>();

/** Clear the verification cache (for testing) */
export function clearVerifyCache(): void {
  verifyCache.clear();
}

/* ------------------------------------------------------------------ */
/*  Verify a single email                                              */
/* ------------------------------------------------------------------ */

/**
 * Verify an email address via eva.pingutil.com.
 * Free, no auth required, unlimited queries.
 * Caches results to avoid duplicate checks within the same enrichment run.
 */
export async function verifyEmailSmtp(email: string): Promise<SmtpVerifyResult> {
  const lower = email.toLowerCase().trim();

  // Cache hit
  const cached = verifyCache.get(lower);
  if (cached) return cached;

  const fallback: SmtpVerifyResult = {
    email: lower,
    valid: /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/.test(lower),
    smtpVerified: false,
    disposable: false,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(
      `https://api.eva.pingutil.com/email?email=${encodeURIComponent(lower)}`,
      {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      },
    );

    clearTimeout(timeout);

    if (resp.ok) {
      const data = await resp.json();
      const result: SmtpVerifyResult = {
        email: lower,
        valid: data.status === "valid" || data.data?.valid_syntax === true,
        smtpVerified: data.data?.smtp_check === true,
        disposable: data.data?.disposable === true,
      };
      verifyCache.set(lower, result);
      return result;
    }
  } catch {
    // API failed — return syntax-only fallback
  }

  verifyCache.set(lower, fallback);
  return fallback;
}

/* ------------------------------------------------------------------ */
/*  Batch verify (with concurrency control)                            */
/* ------------------------------------------------------------------ */

/**
 * Verify multiple emails with controlled concurrency.
 * Returns a map of email → verification result.
 */
export async function verifyEmailsBatch(
  emails: string[],
  concurrency: number = 3,
): Promise<Map<string, SmtpVerifyResult>> {
  const results = new Map<string, SmtpVerifyResult>();
  const unique = [...new Set(emails.map((e) => e.toLowerCase().trim()))];

  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map((email) => verifyEmailSmtp(email)),
    );
    for (const s of settled) {
      if (s.status === "fulfilled") {
        results.set(s.value.email, s.value);
      }
    }
  }

  return results;
}
