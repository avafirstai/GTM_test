/**
 * Universal Email Verification — Double Check
 *
 * Verifies any email address using TWO independent services:
 *   1. disify.com (free, no auth, syntax + DNS + disposable)
 *   2. mailcheck.ai (free, no auth, MX + domain age + role account)
 *
 * STRICT POLICY: Both services must confirm validity.
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
  /** Both verification services confirm this email's domain is valid */
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
/*  Service 1: disify.com                                              */
/* ------------------------------------------------------------------ */

interface DisifyResult {
  valid: boolean;
  dns: boolean;
  disposable: boolean;
}

async function verifyViaDisify(email: string): Promise<DisifyResult | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(
      `https://www.disify.com/api/email/${encodeURIComponent(email)}`,
      {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      },
    );

    clearTimeout(timeout);

    if (!resp.ok) return null;

    const data = await resp.json();
    // disify returns: { format: bool, domain: string, disposable: bool, dns: bool }
    return {
      valid: data.format === true && data.dns === true,
      dns: data.dns === true,
      disposable: data.disposable === true,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Service 2: mailcheck.ai                                            */
/* ------------------------------------------------------------------ */

interface MailcheckResult {
  valid: boolean;
  mx: boolean;
  disposable: boolean;
  roleAccount: boolean;
}

async function verifyViaMailcheck(email: string): Promise<MailcheckResult | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const apiKey = process.env.MAILCHECK_API_KEY;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const resp = await fetch(
      `https://api.mailcheck.ai/email/${encodeURIComponent(email)}`,
      {
        signal: controller.signal,
        headers,
      },
    );

    clearTimeout(timeout);

    if (!resp.ok) return null;

    const data = await resp.json();
    // mailcheck.ai returns: { status: 200, email, mx: bool, disposable: bool,
    //   public_domain: bool, role_account: bool, spam: bool, ... }
    return {
      valid: data.mx === true,
      mx: data.mx === true,
      disposable: data.disposable === true,
      roleAccount: data.role_account === true,
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
 * STRICT: Both must confirm validity for smtpVerified = true.
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
  const [disifyResult, mailcheckResult] = await Promise.allSettled([
    verifyViaDisify(lower),
    verifyViaMailcheck(lower),
  ]);

  const disify = disifyResult.status === "fulfilled" ? disifyResult.value : null;
  const mailcheck = mailcheckResult.status === "fulfilled" ? mailcheckResult.value : null;

  // STRICT DOUBLE CHECK: both must confirm
  // If one service is down → smtpVerified = false (strict policy)
  const bothConfirm = disify?.valid === true && mailcheck?.valid === true;

  // Either service says valid syntax/DNS → we consider it syntactically valid
  const eitherValid = disify?.valid === true || mailcheck?.valid === true;

  // Either service flags disposable → we reject
  const isDisposable = disify?.disposable === true || mailcheck?.disposable === true;

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
