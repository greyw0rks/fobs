/**
 * A token bucket, in process.
 *
 * This exists because every state-changing route in this app signs a devnet
 * transaction or writes a follow row, and none of them were bounded. A loop
 * against `POST /api/trades` is a loop of real devnet transactions from the
 * operator's SOL; a loop against `POST /api/auth/dev` is a loop of sessions.
 * Neither is a hypothetical attack on a demo — a stuck client retry does it.
 *
 * Deliberately not a distributed limiter. Like the event bus, state is
 * per-process, so N instances allow N× the rate. That is a real limitation and
 * the honest one to ship at this size: the alternative is a Redis dependency to
 * protect a devnet demo. The interface is the part that would survive; swapping
 * the store behind `take()` is the fix, and it is contained to this file.
 *
 * The `globalThis` pattern is the same as `lib/server/events.ts` and for the
 * same reason: Next re-evaluates modules on hot reload, and a limiter that
 * resets on every save is a limiter that silently does nothing during
 * development — which is exactly when it is being tested.
 */

type Bucket = { tokens: number; updatedAt: number };

const globalForLimits = globalThis as unknown as {
  fobsRateBuckets?: Map<string, Bucket>;
};

const buckets: Map<string, Bucket> = (globalForLimits.fobsRateBuckets ??= new Map());

export type RateLimitRule = {
  /** Bucket capacity — the burst this key may spend at once. */
  capacity: number;
  /** Tokens added per second. */
  refillPerSecond: number;
};

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  /** Seconds until the next token. Only meaningful when `ok` is false. */
  retryAfter: number;
};

/**
 * Spend one token for `key`.
 *
 * A caller that is refused is not charged, so a retry storm cannot push the
 * bucket further into debt and starve the user once they stop.
 */
export function take(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: rule.capacity, updatedAt: now };

  const elapsed = Math.max(0, now - bucket.updatedAt) / 1000;
  const tokens = Math.min(rule.capacity, bucket.tokens + elapsed * rule.refillPerSecond);

  if (tokens < 1) {
    // Record the refill even on refusal. Otherwise a long gap between attempts
    // would be re-applied on every call and the bucket would never refill.
    buckets.set(key, { tokens, updatedAt: now });
    return { ok: false, remaining: 0, retryAfter: Math.ceil((1 - tokens) / rule.refillPerSecond) };
  }

  const remaining = tokens - 1;
  buckets.set(key, { tokens: remaining, updatedAt: now });
  return { ok: true, remaining: Math.floor(remaining), retryAfter: 0 };
}

/**
 * Drop buckets that have been full for a while.
 *
 * Without this the map grows with every distinct IP that ever made a request,
 * for the life of the process. Called opportunistically from `enforce` rather
 * than on a timer, so there is no interval to leak.
 */
function sweep(now: number) {
  if (buckets.size < 1000) return;
  for (const [key, bucket] of buckets) {
    if (now - bucket.updatedAt > 600_000) buckets.delete(key);
  }
}

/**
 * Who to charge.
 *
 * A signed-in user is charged as themselves, so one person cannot spend another
 * person's budget by sharing an IP (a campus, an office, a carrier NAT). Only
 * unauthenticated requests fall back to the IP, where there is nothing better to
 * use. The header is client-controlled, which is fine: this is a misuse bound,
 * not an authorisation decision.
 */
export function rateLimitKey(request: Request, userId: string | null): string {
  if (userId) return `user:${userId}`;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return `ip:${forwarded || request.headers.get("x-real-ip") || "unknown"}`;
}

/**
 * Charge a request, or produce the 429 to return.
 *
 * Returns null when the request may proceed, so a route reads:
 *
 *   const limited = enforce(request, viewer?.id ?? null, RULES.trade);
 *   if (limited) return limited;
 *
 * `Retry-After` is set because a client that is told to back off can, and one
 * that is not will simply retry immediately.
 */
export function enforce(
  request: Request,
  userId: string | null,
  rule: RateLimitRule
): Response | null {
  const now = Date.now();
  sweep(now);

  const result = take(rateLimitKey(request, userId), rule);
  if (result.ok) return null;

  return Response.json(
    {
      error: `Too many requests. Try again in ${result.retryAfter}s.`,
      retryAfter: result.retryAfter
    },
    { status: 429, headers: { "retry-after": String(result.retryAfter) } }
  );
}

/**
 * The rules, in one place so the limits are readable side by side.
 *
 * `trade` is the loosest of the writes because a trade costs a devnet round trip
 * and a person clicking buy across five assets is normal use, not abuse. `follow`
 * is tighter because it is cheap and toggled rapidly by hand. `dev` is tightest:
 * it mints sessions.
 */
export const RULES = {
  trade: { capacity: 10, refillPerSecond: 0.1 },
  fomo: { capacity: 10, refillPerSecond: 0.1 },
  follow: { capacity: 20, refillPerSecond: 0.5 },
  dev: { capacity: 5, refillPerSecond: 0.05 },
  onboarding: { capacity: 3, refillPerSecond: 0.02 }
} as const satisfies Record<string, RateLimitRule>;
