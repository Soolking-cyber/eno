import { NextResponse } from 'next/server'
import { SITE_NAME } from '@/lib/edition'
import { markdownResponse, SITE_ORIGIN } from '../markdown-response'

/**
 * The markdown representation of a 404, reached by the `fallback` rewrite in next.config.ts.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 * An agent audit on 2026-08-23 scored "agent-friendly 404s" a PARTIAL on both editions: "Nonexistent
 * paths return a real HTTP 404. For full credit, include a short markdown body (site map links,
 * where to look next) so agents can recover." The status code was already right; the body was
 * ~56KB of React shell with nothing an agent could act on. This is the body.
 *
 * ── WHY `fallback` AND NOT `beforeFiles`/`afterFiles` — THE HARD PART, MEASURED ─────────────────
 * A 404 is by definition an UNKNOWN path, so the negotiation cannot be enumerated per-path the way
 * `/`, `/privacy` and `/terms` are. The only wildcard source that is SAFE here is one Next
 * guarantees runs after routing has already failed. Read from the installed runtime rather than
 * from the docs — node_modules/next/dist/server/lib/router-utils/resolve-routes.js builds its route
 * list in this literal order:
 *
 *     headers -> redirects -> middleware -> rewrites.beforeFiles -> `check_fs`
 *       -> rewrites.afterFiles -> `after files check: true` (this is where DYNAMIC routes resolve)
 *       -> rewrites.fallback
 *
 * So `fallback` is the last group in the array and cannot shadow anything:
 *   · `beforeFiles` with a `/:path*` source WOULD shadow every real page. `/about` sent with
 *     `Accept: text/markdown` would be rewritten here and answer 404 — a working page turned into a
 *     dead end for exactly the clients this feature is for. It would also sit alongside the three
 *     existing `beforeFiles` entries and, on any future reordering, eat `/`, `/privacy` and
 *     `/terms`. REJECTED.
 *   · `afterFiles` with a `/:path*` source is no better: it runs BEFORE dynamic routes, so it would
 *     shadow `[handle]`, `/listings/[slug]`, `/c/[slug]` and every other dynamic segment. REJECTED.
 *   · A `beforeFiles` source with a negative lookahead over the real routes cannot work even in
 *     principle: `src/app/[handle]` resolves against a DATABASE table, so the set of valid
 *     single-segment paths is not knowable at build time. REJECTED.
 *
 * ⚠️ AND THE SAME ORDERING IS THIS MECHANISM'S ONE REAL LIMIT, SO DO NOT OVERSELL IT. `fallback`
 * fires only when NO route matched. A 404 produced by a route that DID match and then called
 * `notFound()` never reaches it. Measured against production 2026-08-23:
 *     /nope/xyz/abc      no route matches            -> reaches fallback ✅
 *     /nope-xyz          matches src/app/[handle]    -> never reaches fallback ❌
 *     /help/nope-topic   matches src/app/help/[id]   -> never reaches fallback ❌
 * Those three are covered by the HTML recovery block in src/app/not-found.tsx instead — except that
 * on that path the HTML is empty too; see the measurement recorded at the head of that file. Fixing
 * it means changing where `[handle]` throws, which is outside this change.
 *
 * ⚠️ THE `has` CLAUSE IS `acceptsMarkdown()`, THE SAME FUNCTION THE OTHER THREE USE. It is the one
 * thing standing between this route and a browser: without it every 404 on the site would answer
 * `text/markdown`. That matcher has an unusually expensive history (two codex-caught parser bugs,
 * a q=0 refusal case, a token-boundary case) and reusing it is not a style preference — a second
 * hand-rolled Accept regex is a second place for those bugs to come back.
 */

/**
 * ⚠️ EXPLICIT, NOT INHERITED — same reasoning as src/app/md/home/route.ts. The safety of every
 * route in this directory rests on `no-store`, and a route handler's cacheability is exactly the
 * kind of framework default that moves in a major bump.
 */
export const dynamic = 'force-dynamic'

/**
 * ⚠️ EVERY LINK BELOW EXISTS ON BOTH EDITIONS, AND THAT IS A LICENSING REQUIREMENT RATHER THAN a
 * convenience. This file compiles into both builds. eno.vn is a licensed sàn TMĐT and may not show,
 * link to or describe visa, itinerary or PayPal surfaces — so the one response whose whole job is
 * to say "that path is absent" must not be the place that reveals which paths exist elsewhere. The
 * set is deliberately identical to the HTML 404's recovery block in src/app/not-found.tsx, whose
 * header carries the full argument for why each entry is edition-safe.
 *
 * ⚠️ AND THE DISCOVERY PROBLEM IS SOLVED BY THE THREE MACHINE DOCUMENTS, NOT BY LISTING PAGES HERE.
 * sitemap.xml and llms.txt are generated per deployment, so each one names only what that
 * deployment may serve. Enumerating categories or sections in this file would be a second,
 * hand-maintained site map that drifts from both — and it is the copy that would drift toward
 * naming a services surface.
 */
const BODY = `# 404 — no such page on ${SITE_NAME}

> The requested path does not exist on this site. This is a real 404, not a temporary failure or a
> block: retrying the same URL will not help. Use one of the entry points below instead.

## Where to look next

- [Home / search](${SITE_ORIGIN}/) — this is the search page, not a landing page. Every listing is
  here, filterable by category, brand, area and price.
- [Browse by brand](${SITE_ORIGIN}/brands) — a crawlable index of the brands this deployment
  actually holds.
- [Help center](${SITE_ORIGIN}/help) — accounts, messaging, offers and safety.
- [Contact](${SITE_ORIGIN}/contact) — who operates this site, the support address, and the
  registered company details.

## Machine-readable indexes

- [${SITE_ORIGIN}/sitemap.xml](${SITE_ORIGIN}/sitemap.xml) — every URL this deployment serves.
- [${SITE_ORIGIN}/llms.txt](${SITE_ORIGIN}/llms.txt) — what this site is for and when to use it.
- [${SITE_ORIGIN}/openapi.json](${SITE_ORIGIN}/openapi.json) — OpenAPI 3.1 description of the
  Partner API. The API is authenticated; the spec is readable without a key.

## If you were following a listing link

A listing that has sold keeps its URL and answers **200** with a sold page, so it never becomes a
404. ⚠️ A 404 on a listing path does NOT prove the identifier was never valid: listings can be
deleted (DELETE /api/v1/listings/{id}) and a sold one is served as a real page rather than a 404, so
a formerly good id can stop resolving. Treat it as "not retrievable now", not "never existed" — search
from the home page rather than retrying variants of the URL.
`

// ⛔ EVERY METHOD, NOT JUST GET, AND 405 IS THE BUG THIS PREVENTS.
// The fallback rewrite in next.config.ts matches on path and Accept — not on method — so a POST or
// HEAD to an unmatched path with a markdown Accept lands here too. With only `GET` exported, Next's
// autoImplementMethods answers 405 Method Not Allowed with an empty body, and 405 asserts THE PATH
// EXISTS: an agent probing a nonexistent route would conclude it had found one and merely used the
// wrong verb. That is precisely the "never let an agent believe every path exists" failure this
// whole route was written to fix, reintroduced through the method axis. A reviewer caught it.
// HEAD is handled by Next from GET automatically; the rest share one 404 body.
export async function GET() {
  /**
   * ⚠️ THE HEADERS COME FROM `markdownResponse` AND THE STATUS IS APPLIED ON TOP — the helper is
   * not given a status parameter, deliberately. Its header set (`no-store`, `Vary: Accept`, and the
   * documented ABSENCE of `x-robots-tag`) is a safety contract with a long comment attached, and
   * three sibling routes depend on it; widening its signature to serve one caller invites the next
   * caller to pass something the comment does not cover. Re-wrapping keeps the contract byte-for-
   * byte and puts the one difference — the status — where it can be read in isolation.
   *
   * ⚠️ THE STATUS IS LOAD-BEARING. `fallback` rewrites are served in place, so whatever this
   * handler returns IS the response for the unknown path. A 200 here would convert every unmatched
   * URL into a soft-404 for exactly the agents and crawlers this document is written for — the one
   * thing the audit already confirmed the site was getting right.
   */
  const negotiated = markdownResponse(BODY)
  return new NextResponse(negotiated.body, { status: 404, headers: negotiated.headers })
}

export const POST = GET
export const PUT = GET
export const PATCH = GET
export const DELETE = GET
export const OPTIONS = GET
