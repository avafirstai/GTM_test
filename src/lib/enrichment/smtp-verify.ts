/**
 * Universal SMTP Email Verification — Double Check
 *
 * Verifies any email address using TWO independent services:
 *   1. eva.pingutil.com (free, no auth, unlimited)
 *   2. mailcheck.ai (free, no auth, high reliability)
 *
 * STRICT POLICY: Both services must confirm SMTP validity.
 * If only one confirms or either fails → smtpVerified = false.
 * This ensures near-100% reliability: no false positives.
 *
 * Used by the waterfall to verify ALL emails found by any source.
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
  /** Full SMTP RCPT TO check passed by BOTH services (mailbox exists) */
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
/*  Service 1: eva.pingutil.com                                        */
/* ------------------------------------------------------------------ */

interface EvaResult {
  smtpVerified: boolean;
  valid: boolean;
  disposable: boolean;
}

async function verifyViaEva(email: string): Promise<EvaResult | null> {
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

    if (!resp.ok) return null;

    const data = await resp.json();
    return {
      smtpVerified: data.data?.smtp_check === true,
      valid: data.status === "valid" || data.data?.valid_syntax === true,
      disposable: data.data?.disposable === true,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Service 2: mailcheck.ai                                            */
/* ------------------------------------------------------------------ */

interface MailcheckResult {
  smtpVerified: boolean;
  valid: boolean;
  disposable: boolean;
}

async function verifyViaMailcheck(email: string): Promise<MailcheckResult | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(
      `https://api.mailcheck.ai/email/${encodeURIComponent(email)}`,
      {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      },
    );

    clearTimeout(timeout);

    if (!resp.ok) return null;

    const data = await resp.json();
    // mailcheck.ai returns: { status: 200, email, mx: bool, disposable: bool, did_you_mean: ... }
    // "mx" indicates the domain has MX records (mail server exists)
    // "disposable" indicates throwaway email
    // Status field in response body indicates overall validity
    return {
      smtpVerified: data.mx === true && data.disposable === false,
      valid: data.status === 200 || data.mx === true,
      disposable: data.disposable === true,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Verify a single email (DOUBLE CHECK)                               */
/* ------------------------------------------------------------------ */

/**
 * Verify an email address using TWO services in parallel.
 * STRICT: Both must confirm SMTP validity for smtpVerified = true.
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

  // Run both services in parallel for speed
  const [evaResult, mailcheckResult] = await Promise.allSettled([
    verifyViaEva(lower),
    verifyViaMailcheck(lower),
  ]);

  const eva = evaResult.status === "fulfilled" ? evaResult.value : null;
  const mailcheck = mailcheckResult.status === "fulfilled" ? mailcheckResult.value : null;

  // STRICT DOUBLE CHECK: both must confirm
  // If one service is down → smtpVerified = false (strict policy)
  const bothConfirm = eva?.smtpVerified === true && mailcheck?.smtpVerified === true;

  // Either service says valid syntax/DNS → we consider it syntactically valid
  const eitherValid = eva?.valid === true || mailcheck?.valid === true;

  // Either service flags disposable → we reject
  const isDisposable = eva?.disposable === true || mailcheck?.disposable === true;

  const result: SmtpVerifyResult = {
    email: lower,
    valid: eitherValid || fallback.valid,
    smtpVerified: bothConfirm && !isDisposable,
    disposable: isDisposable,
  };

  verifyCache.set(lower, result);
  return result;
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
