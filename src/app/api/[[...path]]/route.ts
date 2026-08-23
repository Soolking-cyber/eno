import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import crypto from 'crypto'

/**
 * THE JSON 404 FOR EVERY UNMATCHED /api PATH.
 *
 * ⛔ WHAT THIS FIXES, MEASURED 2026-08-23. `/api/v1/listings` already answered
 * `401 application/json {"error":{"code":"unauthorized","message":"…"}}` — correct. But
 * `/api/v1/health`, `/api/v1` and `/api/nope` answered `404 text/html` with the ENTIRE React app
 * shell, because nothing matched and Next fell through to the app-router not-found page. That is
 * why the is-agentic scan reported "API does not return JSON error responses (or no API detected)"
 * as an ESSENTIAL failure on BOTH editions: the first thing an agent does is probe a path it
 * guessed, and the first thing it got back was a document, not an error.
 *
 * ⚠️ AND AN HTML 404 IS WORSE THAN NO ANSWER. A 404 with `content-type: text/html` and a full
 * `<html>` body reads to a naive client as "the route exists and rendered something" — several
 * agent frameworks only branch on content-type, or scrape the body for a hint. Returning the same
 * envelope the real routes return means a probe fails in a way the caller can actually parse.
 *
 * ⚠️ THE ENVELOPE IS COPIED, NOT INVENTED. `{ error: { code, message } }` is exactly what
 * `apiError()` in src/lib/api/respond.ts puts on the wire for all of /api/v1, and `not_found` is
 * the vocabulary's existing code for this case (73 handlers use it — see `SharedApiErrorCode` in
 * src/lib/api/errors.ts). `apiError()` itself is not called only because this response needs two
 * things it does not offer: the extra `hint` member and `Cache-Control: no-store`. The shape below
 * must stay byte-compatible with it; the OpenAPI `Error` schema does not set
 * `additionalProperties: false`, so `hint` is an additive extension, not a second error format.
 *
 * ⚠️ WHY AN OPTIONAL CATCH-ALL `[[...path]]`, AND WHY IT SHADOWS NOTHING. Next sorts routes by
 * per-segment specificity — static (0) < dynamic (1) < catch-all (2) < optional catch-all (3); see
 * `getSegmentSpecificity` in next/dist/shared/lib/router/utils/sortable-routes.js and the identical
 * ordering baked into `_smoosh` in sorted-routes.js. So every one of the ~200 concrete routes under
 * src/app/api wins on segment 1 (`listings` beats `[[...path]]`), at any depth, and this file is
 * the last thing tried. The OPTIONAL form is chosen over `[...path]` so bare `/api` — one of the
 * three measured HTML 404s — is covered too; that is legal precisely because there is no
 * `src/app/api/route.ts` (a concrete route at the same path is Next error E458), and no direct
 * child of /api is a dynamic segment, so there is no slug-name collision either.
 *
 * ⚠️ IT ALSO DOES NOT DISTURB THE TWO THINGS THAT AIM INTO /api. `src/proxy.ts` matches
 * `/api/:path*` in middleware and only ever calls `NextResponse.next()` (or answers a CORS
 * preflight, or 403s a missing edge header) — middleware runs before routing and does not care
 * which file eventually handles the request. And `rewrites()` in next.config.ts points at
 * `/api/well-known/aasa`, `/api/feeds/facebook-catalog` and `/api/feeds/google-shopping`, all three
 * real static routes that outrank this one.
 *
 * ⚠️ A `route.svc.ts` PATH NOW LANDS HERE ON THE MARKETPLACE BUILD, AND THAT IS THE POINT. Those
 * handlers are folded out of the eno.vn artifact by `pageExtensions`, so their URLs used to serve
 * the HTML shell; they now serve this generic 404, which says nothing about what the other edition
 * hosts. Keep it that way — no route name and nothing edition-specific may appear in the strings
 * below, because this file ships in BOTH artifacts.
 *
 * NOT rate-limited, on purpose: this is where scanner and bot traffic ends up, and every path
 * through it is constant work with no database call, no auth lookup and no logging. Metering it
 * would mean doing MORE work for junk traffic than answering it costs.
 */

export const runtime = 'nodejs'
// Never let this be treated as a cacheable/static route: the body names the method and path that
// missed, so a single stored copy would answer for a different probe.
export const dynamic = 'force-dynamic'

// The two recovery documents that actually exist at the root on both editions
// (src/app/openapi.json/route.ts, src/app/llms.txt/route.ts). Relative paths only — hardcoding a
// host here would be wrong on one of the two builds, which is the same bug that put
// `const ISSUER = 'https://eno.vn'` into the OAuth metadata.
const HINT =
  'This path does not exist. Fetch /openapi.json for the machine-readable API description, or /llms.txt for the site index.'

function notFound(req: NextRequest, withBody: boolean): NextResponse {
  // The path is echoed so a caller can see WHICH probe missed — agents commonly try
  // /api/openapi.yaml, /api/v1/health, /api/docs, and being told the exact miss is what lets them
  // correct the guess. It is attacker-controlled, so control characters are stripped and the length
  // is capped: this is a JSON string served as application/json, not a markup context, but a 404
  // body is still not a place to relay an unbounded input back to whoever sent it.
  const path = req.nextUrl.pathname.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // A 404 here is a routing fact, not a resource. A cached one would outlive the deploy that adds
    // the endpoint the caller was looking for.
    'Cache-Control': 'no-store',
    // The same correlation header every /api/v1 response carries (src/lib/api/respond.ts), so a
    // partner reporting "your API 404s me" hands over an id that can be searched for.
    'X-Request-Id': crypto.randomUUID(),
  }
  // HEAD must not carry a body; the status line and the content type are the whole answer.
  if (!withBody) return new NextResponse(null, { status: 404, headers })
  return NextResponse.json(
    { error: { code: 'not_found', message: `No API route matches ${req.method} ${path}.`, hint: HINT } },
    { status: 404, headers },
  )
}

// Every method an agent plausibly tries. Next routes only the methods a file exports, so an omitted
// verb would answer 405 with an EMPTY body — a second contentless failure mode for exactly the
// caller this file exists to help.
export function GET(req: NextRequest) { return notFound(req, true) }
export function POST(req: NextRequest) { return notFound(req, true) }
export function PUT(req: NextRequest) { return notFound(req, true) }
export function PATCH(req: NextRequest) { return notFound(req, true) }
export function DELETE(req: NextRequest) { return notFound(req, true) }
export function HEAD(req: NextRequest) { return notFound(req, false) }
// OPTIONS reaches this only for a path that does not exist. A preflight from the native-shell
// origins is already answered 204 by src/proxy.ts before routing, so a 404 here cannot break the
// app's own CORS — it tells a probing client the truth, which is that there is nothing at this path
// to negotiate with.
export function OPTIONS(req: NextRequest) { return notFound(req, true) }
