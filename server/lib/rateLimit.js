/**
 * lib/rateLimit.js — per-IP request throttling.
 *
 * Nothing in the router capped request volume before this: account lockout
 * (auth/service.js) stops brute-forcing ONE username, but nothing stopped
 * one IP from trying a thousand different usernames a minute, hammering
 * /candidates/check-duplicate to enumerate national ids, or flooding the
 * webhook endpoints.
 *
 * Fixed windows, in-memory, per process. That is a real limitation, stated
 * plainly: it resets on restart and does not share state across replicas.
 * For a single Node process — which is what this server is — it is the
 * right amount of machinery. The moment this runs as more than one
 * instance behind a load balancer, this needs to move to a shared store
 * (the sessions table's own Postgres connection, or Redis); the interface
 * below (`hit(key, limit, windowMs)`) is deliberately narrow so that swap
 * touches one file.
 */

const buckets = new Map();

/**
 * Records one hit for `key` and reports whether the caller is over budget.
 * Returns { limited, remaining, retryAfterSec }.
 */
const hit = (key, limit, windowMs) => {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  return {
    limited: b.count > limit,
    remaining: Math.max(0, limit - b.count),
    retryAfterSec: Math.ceil((b.resetAt - now) / 1000)
  };
};

/* Sweeps expired buckets so the map does not grow without bound under
   sustained traffic from many distinct IPs. */
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}, 60_000).unref();

/**
 * General budget for any request: generous enough that no legitimate
 * recruiter workflow (paging through candidates, ⌘K search-as-you-type)
 * comes close, tight enough to blunt a scripted flood from one address.
 */
const GENERAL = { limit: 300, windowMs: 60_000 };

/**
 * Tight budget for the endpoints an attacker actually wants: signing in,
 * requesting a password reset, confirming MFA. These are cheap for a
 * script to hammer and expensive for the account behind them.
 */
const SENSITIVE = { limit: 20, windowMs: 5 * 60_000 };
const SENSITIVE_PREFIXES = [
  '/api/v1/auth/session',
  '/api/v1/auth/password/forgot',
  '/api/v1/auth/password/reset',
  '/api/v1/auth/mfa/confirm'
];

/**
 * Applies both budgets. Returns null when the request may proceed, or
 * { status, retryAfterSec } when it must be rejected with 429.
 */
export const check = (ip, path) => {
  const addr = ip || 'unknown';

  const general = hit(`g:${addr}`, GENERAL.limit, GENERAL.windowMs);
  if (general.limited) return { retryAfterSec: general.retryAfterSec };

  if (SENSITIVE_PREFIXES.some((p) => path.startsWith(p))) {
    const sensitive = hit(`s:${addr}`, SENSITIVE.limit, SENSITIVE.windowMs);
    if (sensitive.limited) return { retryAfterSec: sensitive.retryAfterSec };
  }

  return null;
};

/* Exposed for tests: lets a suite reset state between cases instead of
   waiting out real windows. */
export const _reset = () => buckets.clear();
