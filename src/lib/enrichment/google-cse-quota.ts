/**
 * Google CSE Quota Tracker
 *
 * Tracks daily usage of Google Custom Search Engine API.
 * Free tier: 100 queries/day. Paid: $5 per 1,000 queries.
 *
 * Uses in-memory counter (resets on server restart).
 * Logs warnings at 80% and blocks at 100% of daily limit.
 */

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

/** Daily query limit. Set to 0 for unlimited (paid plan). */
function getDailyLimit(): number {
  const envLimit = process.env.GOOGLE_CSE_DAILY_LIMIT;
  if (envLimit === "0" || envLimit === "unlimited") return Infinity;
  return envLimit ? parseInt(envLimit, 10) : 100; // Default: free tier
}

/* ------------------------------------------------------------------ */
/*  In-memory counter                                                  */
/* ------------------------------------------------------------------ */

interface QuotaState {
  date: string; // YYYY-MM-DD
  count: number;
}

let quotaState: QuotaState = {
  date: new Date().toISOString().slice(0, 10),
  count: 0,
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Reset counter if day has changed */
function ensureCurrentDay(): void {
  const t = today();
  if (quotaState.date !== t) {
    quotaState = { date: t, count: 0 };
  }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Check if we can make a Google CSE query.
 * Returns true if quota allows, false if limit reached.
 */
export function canQueryGoogleCSE(): boolean {
  ensureCurrentDay();
  const limit = getDailyLimit();
  if (limit === Infinity) return true; // Paid plan: no limit
  return quotaState.count < limit;
}

/**
 * Record a Google CSE query (call AFTER successful API call).
 * Logs a warning when approaching the limit.
 */
export function recordGoogleCSEQuery(count: number = 1): void {
  ensureCurrentDay();
  quotaState.count += count;

  const limit = getDailyLimit();
  if (limit === Infinity) return; // Paid plan: no warnings

  const pct = (quotaState.count / limit) * 100;
  if (pct >= 100) {
    console.warn(
      `[Google CSE] QUOTA EXHAUSTED: ${quotaState.count}/${limit} queries today`,
    );
  } else if (pct >= 80) {
    console.warn(
      `[Google CSE] Quota warning: ${quotaState.count}/${limit} queries today (${Math.round(pct)}%)`,
    );
  }
}

/**
 * Get current quota status for monitoring/dashboard.
 */
export function getGoogleCSEQuotaStatus(): {
  date: string;
  used: number;
  limit: number;
  remaining: number;
  pctUsed: number;
} {
  ensureCurrentDay();
  const limit = getDailyLimit();
  const remaining = limit === Infinity ? Infinity : Math.max(0, limit - quotaState.count);
  return {
    date: quotaState.date,
    used: quotaState.count,
    limit,
    remaining,
    pctUsed: limit === Infinity ? 0 : Math.round((quotaState.count / limit) * 100),
  };
}
