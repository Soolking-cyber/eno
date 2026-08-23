import { NextResponse, type NextRequest } from 'next/server'
import { EDITION, SITE_NAME } from '@/lib/edition'
import { OAUTH_ISSUER } from '@/lib/api/oauth'
import { API_RATE_PER_MIN, API_RATE_WINDOW_SEC } from '@/lib/api/auth'
import { rateLimit } from '@/lib/ratelimit'
import { apiOk, apiError } from '@/lib/api/respond'
import { clientIp } from '@/lib/client-ip'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET /api/v1/status — the one PUBLIC, unauthenticated, rate-limited operation ──────────────
//
// ⛔ WHY THIS ROUTE EXISTS AT ALL, BECAUSE IT LOOKS REDUNDANT NEXT TO /openapi.json.
// An agent audit on 2026-08-23 scored the partner API's rate-limit headers as UNVERIFIED, with
// the finding: "Rate-limit response headers documented at https://eno.vn/openapi.json but not
// verified on a live response (REST API is auth-gated)." The headers were real and correct; the
// scanner simply could never SEE one, because every endpoint reachable without a credential
// rejects BEFORE the limiter runs and therefore has no honest budget to publish:
//   · GET  /api/v1/listings    → 401, `X-Request-Id` only. resolveApiKey rejects a missing or
//     malformed key without touching a bucket (see the ApiAuthResult comment in
//     src/lib/api/auth.ts). Measured on production 2026-08-23: exactly one x-request-id header,
//     no RateLimit, no X-RateLimit-*.
//   · POST /api/v1/oauth/token → 401, no rate headers at all. Deliberate, and NOT to be
//     "fixed": `oauthError()` in the token route only attaches them once the limiter has run,
//     because "an unauthenticated caller learning the exact throttle on the credential endpoint
//     is a gift to a brute-forcer". Measured on production the same day: cache-control/pragma
//     and nothing else.
// Both of those are documented security choices and both stay exactly as they are. The gap they
// leave is a DISCOVERY gap, not a correctness one, and the honest way to close it is to publish
// a response an anonymous caller is genuinely entitled to — not to leak the authenticated
// budget onto a rejection.
//
// So this endpoint earns its place twice over: an agent that finds the API gets a machine-
// readable index of every discovery document in one hop (rather than guessing at four URLs),
// and it gets a live, real `RateLimit` / `RateLimit-Policy` pair it can parse to learn the
// header shape before it ever holds a credential.
//
// ⚠️ THE NUMBERS HERE DESCRIBE THIS ENDPOINT, NOT THE PARTNER-API BUDGET — the same trap the
// token route's headers carry. A client that reads `RateLimit` here and infers its /api/v1
// quota from it would under-use that quota by 10x, which is why `rate_limit.authenticated`
// states the 600/min per-key policy outright in the body instead of leaving it to be inferred.

/**
 * ⚠️ 60/min PER IP, AND DELIBERATELY NOT `API_RATE_PER_MIN`. This is the only /api/v1 bucket an
 * anonymous caller can reach, so it is the only one where the "caller" is an IP rather than a
 * revocable key: there is no credential to pull if it misbehaves. 60/min is far more than any
 * real discovery client needs (an agent reads this once per session, not once per request) and
 * far less than a useful flood.
 *
 * ⚠️ IP KEYING IS WEAKER HERE THAN ELSEWHERE IN THE APP, AND THE REASON IS IN src/proxy.ts.
 * The edge pin (`x-eno-edge`) exempts `/api/v1/*` on purpose — partner backends reach it
 * server-to-server, off Cloudflare — and that exemption is documented there as safe precisely
 * because /api/v1 "carries its OWN per-key auth (NOT the IP-keyed rate limits the edge pin
 * protects)". This route is the first /api/v1 bucket that IS IP-keyed, so a caller that can
 * reach the origin directly could spoof `cf-connecting-ip` and rotate buckets. That is accepted
 * rather than overlooked: the whole handler is one `rl_check` against an UNLOGGED table plus a
 * few string constants — there is no listing query and no per-request data to drain — so
 * the worst outcome of a dodged bucket is the same cost Cloudflare's own edge is already
 * absorbing for every other public path.
 */
export const STATUS_RATE_PER_MIN = 60

/**
 * ⚠️ `no-store` IS LOAD-BEARING, NOT HYGIENE. The response carries per-caller limiter state in
 * its headers, and src/lib/api/respond.ts says exactly why that must never be cached: "a
 * per-caller header on a cacheable response is either wrong for the next visitor or a cache-key
 * explosion". A shared cache in front of this route would hand caller B the `remaining` measured
 * for caller A, which is the one way an honest header becomes a lie.
 */
function noStore(res: NextResponse): NextResponse {
  res.headers.set('Cache-Control', 'no-store')
  return res
}

export async function GET(req: NextRequest) {
  /**
   * Fail-OPEN (the `rateLimit` default; no `{ strict: true }`), which is the opposite of the
   * stance resolveApiKey takes one file over — and the difference is the asset behind the door.
   * There, a limiter outage that returned success:true would make every API key unlimited while
   * the database is already unhealthy. Here there is no asset: the endpoint returns constants.
   * Failing closed would mean a limiter blip 429s the one document an agent reads to find out
   * how to talk to us, during the exact incident when it most wants to know.
   *
   * ⚠️ ON THAT FAILURE PATH THE PUBLISHED SNAPSHOT IS `remaining: 0, reset: <full window>` (see
   * the catch branch in src/lib/ratelimit.ts). That is a conservative statement, not a fabricated
   * one — it tells a client to back off for a bound that cannot be too short — and it is
   * indistinguishable from a genuine last-request-in-the-window result, which is why it is
   * published rather than suppressed.
   */
  const rate = await rateLimit('apiv1-status', clientIp(req), STATUS_RATE_PER_MIN, '1 m')
  if (!rate.success) {
    // apiError attaches `Retry-After: <resetSec>` on a 429 and only on a 429 — the one status
    // where "wait, then repeat the identical request" is genuinely the client's next move.
    return noStore(
      apiError(429, 'rate_limited', 'Too many requests to this endpoint. `Retry-After` says how long to wait.', rate),
    )
  }

  const body = {
    service: `${SITE_NAME} Partner API`,
    /**
     * Which build of this one codebase answered. `marketplace` | `services` — the flag from
     * src/lib/edition.ts, inlined at build time, so it cannot be wrong about its own deployment
     * the way a runtime toggle can. It is published because a client that has followed a redirect
     * or a stale link needs to know which host it actually reached; it deliberately says nothing
     * about which product surfaces the two editions differ on.
     */
    edition: EDITION,
    api_version: 'v1',
    /**
     * ⚠️ LIVENESS ONLY, AND THE FIELD IS DOCUMENTED AS SUCH IN THE SPEC. This handler probes no
     * dependency: the limiter call fails open, so a completely unreachable database still returns
     * `"ok"`. There is no `database: "ok"` field beside it for exactly that reason — this route
     * cannot truthfully compute one, and a health field that is structurally incapable of saying
     * "unhealthy" is worse than no health field, because something will page on it.
     */
    status: 'ok',
    time: new Date().toISOString(),
    /**
     * ⚠️ EVERY URL IS DERIVED FROM `OAUTH_ISSUER`, NOT FROM A FOURTH COPY OF THE ORIGIN
     * DERIVATION. src/lib/api/oauth.ts, src/app/api/v1/openapi.json/route.ts, layout.tsx and
     * llms.txt each derive `NEXT_PUBLIC_APP_URL || https://${SITE_NAME}` and each carries a
     * comment saying the others must agree; importing the exported constant is the only version
     * of that promise a compiler keeps. It matters here more than anywhere: this document's whole
     * job is to hand out the other documents' addresses, and until 2026-08-23 the issuer it now
     * borrows was hardcoded `'https://eno.vn'` on BOTH editions — so a hand-rolled origin here
     * would be re-committing the leak that fix closed.
     *
     * All five targets were confirmed to be real routes in this build, not aspirational ones:
     * src/app/openapi.json/route.ts, the two `/.well-known/*` rewrites in next.config.ts
     * (afterFiles → src/app/api/well-known/*), src/app/developers, src/app/llms.txt.
     */
    documentation: {
      openapi: `${OAUTH_ISSUER}/openapi.json`,
      oauth_authorization_server: `${OAUTH_ISSUER}/.well-known/oauth-authorization-server`,
      oauth_protected_resource: `${OAUTH_ISSUER}/.well-known/oauth-protected-resource`,
      developers: `${OAUTH_ISSUER}/developers`,
      llms_txt: `${OAUTH_ISSUER}/llms.txt`,
    },
    /**
     * ⚠️ READ OFF THE SAME SNAPSHOT OBJECT THE HEADERS ARE BUILT FROM — never re-derived. The
     * `reset` below was measured against the DATABASE clock inside the same SQL statement that
     * did the check (src/lib/ratelimit.ts explains why that is not a detail), and rebuilding a
     * `{ limit, remaining }` pair here from constants is precisely how that field silently
     * becomes a JS-side guess. Body and headers agree by construction, and the test asserts it.
     */
    rate_limit: {
      limit: rate.limit,
      remaining: rate.remaining,
      reset: rate.resetSec,
      window_seconds: rate.windowSec,
      keyed_by: 'ip',
      // Stated outright so nobody infers the API budget from this endpoint's much smaller one.
      // ⚠️ BOTH NUMBERS IMPORTED. `window_seconds` was the literal 60 sitting beside the imported
      // limit — so a change to the authenticated window would have left this document confidently
      // stating the old budget, in the one endpoint whose entire job is to state the budget.
      authenticated: { limit: API_RATE_PER_MIN, window_seconds: API_RATE_WINDOW_SEC, keyed_by: 'api_key' },
    },
  }

  // apiOk(data, rate) → X-Request-Id + RateLimit + RateLimit-Policy + the two X-RateLimit-*
  // aliases, from the one helper every other /api/v1 response uses. Nothing bespoke: if the
  // header contract moves, this route moves with it.
  return noStore(apiOk(body, rate))
}
