import { NextResponse } from 'next/server'
import crypto from 'crypto'
import type { ApiAuthResult } from './auth'
import type { RateLimitSnapshot } from '@/lib/ratelimit'

// Standard JSON envelopes + headers for /api/v1. Success returns the payload directly
// (list endpoints add a top-level `next_cursor`); errors are `{ error: { code, message } }`.
// Every response carries X-Request-Id; authed ones add the rate-limit headers below.

/**
 * THE RATE-LIMIT HEADERS, IN ONE PLACE, FOR /api/v1 ONLY.
 *
 * ⚠️ WHY THE RFC FORM AND NOT JUST `X-RateLimit-*`. An agent audit on 2026-08-23 flagged the
 * partner API for having no standard rate-limit headers: the `X-RateLimit-Limit` /
 * `X-RateLimit-Remaining` pair we already emitted is a de-facto convention with no
 * specification, no `reset`, and no way for a generic client to know the window — so an
 * autonomous caller cannot self-throttle, it can only discover the limit by being refused.
 * `RateLimit` / `RateLimit-Policy` — the two fields defined by the IETF HTTPAPI working group's
 * `draft-ietf-httpapi-ratelimit-headers` — are the interoperable form every agent framework
 * already parses.
 *
 * ⛔ NOT "THE RFC 9331 FAMILY". That citation sat here and was simply wrong: RFC 9331 is
 * "The Explicit Congestion Notification (ECN) Protocol for Low Latency, Low Loss, and Scalable
 * Throughput (L4S)" — an L4S/ECN transport spec with nothing to do with HTTP rate limiting. The
 * fields below come from the IETF DRAFT named above, which has no RFC number yet; do not attach
 * one to it. A wrong RFC in a comment is worse than none, because the next reader looks it up,
 * finds a real document about congestion control, and has to work out which half is mistaken.
 *
 * ⚠️ BOTH FORMS SHIP, AND THE OLD ONE IS NOT DEPRECATED HERE. `X-RateLimit-Limit`/`-Remaining`
 * are documented on /developers and read by `src/app/api/mcp/route.ts`; partners are already
 * branching on them. Adding headers is free, removing them is a wire break, so this adds.
 *
 * ⚠️ `reset` IS THE END OF THE CURRENT WINDOW SLOT, NOT "when you are unblocked" — the limiter
 * decays continuously. `src/lib/ratelimit.ts` (RateLimitSnapshot) carries the full caveat; the
 * number is measured against the database clock in the same statement as the check, so it is
 * never a JS-side guess.
 *
 * ⚠️ SCOPE: /api/v1 (plus /api/mcp, which shares resolveApiKey). Do NOT lift this onto public
 * site routes — those are edge-cached HTML, and a per-caller header on a cacheable response is
 * either wrong for the next visitor or a cache-key explosion.
 */
export function rateLimitHeaders(rate: RateLimitSnapshot): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(rate.limit),
    'X-RateLimit-Remaining': String(rate.remaining),
    // Structured-field dictionary, e.g. `limit=600, remaining=599, reset=42`.
    RateLimit: `limit=${rate.limit}, remaining=${rate.remaining}, reset=${rate.resetSec}`,
    // The quota policy itself: `600;w=60` — 600 requests per 60-second window.
    'RateLimit-Policy': `${rate.limit};w=${rate.windowSec}`,
  }
}

function baseHeaders(rate?: RateLimitSnapshot): Record<string, string> {
  const h: Record<string, string> = { 'X-Request-Id': crypto.randomUUID() }
  if (rate) Object.assign(h, rateLimitHeaders(rate))
  return h
}

export function apiOk(data: unknown, rate?: RateLimitSnapshot, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: baseHeaders(rate) })
}

export function apiError(status: number, code: string, message: string, rate?: RateLimitSnapshot): NextResponse {
  const headers = baseHeaders(rate)
  /**
   * ⚠️ `Retry-After` ONLY ON A 429, AND ONLY WHEN WE MEASURED ONE. RFC 9110 §10.2.3 gives it a
   * meaning on 503 and 3xx too, so emitting it on every error would be telling a client that a
   * 422 (a malformed body — permanently wrong, retrying changes nothing) is worth retrying. A
   * 429 is the one status here where the client's correct next action really is "wait, then
   * repeat the identical request".
   */
  if (status === 429 && rate) headers['Retry-After'] = String(rate.resetSec)
  return NextResponse.json({ error: { code, message } }, { status, headers })
}

// Turn a failed resolveApiKey() result into its response (handy guard at the top of a route).
// ⚠️ Passes `r.rate` through: a 429 is precisely the response a self-throttling client needs the
// headers on, and it is the one path that used to answer with none of them.
export function apiAuthError(r: Extract<ApiAuthResult, { ok: false }>): NextResponse {
  return apiError(r.status, r.code, r.message, r.rate)
}

/**
 * The most constraining of several limiters, for a route gated by more than one bucket (the
 * OAuth token endpoint ANDs a per-IP and a per-client limit). Reporting the *loosest* would
 * hand a client a budget it does not have; reporting both as two policies is legal in the draft
 * but no common client parses a multi-policy dictionary correctly. Fewest remaining wins, and
 * ties break on the sooner reset.
 */
export function tightestRate(...rates: RateLimitSnapshot[]): RateLimitSnapshot {
  return rates.reduce((a, b) =>
    b.remaining < a.remaining || (b.remaining === a.remaining && b.resetSec < a.resetSec) ? b : a,
  )
}
