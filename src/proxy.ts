import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { storefrontBaseHost, storefrontHandleFromHost } from '@/lib/storefront-host'

// Edge-ingress guard. When EDGE_SECRET is set, every /api/* request (except crons,
// which are invoked off-Cloudflare with their own CRON_SECRET bearer) must carry the
// secret header that a Cloudflare Transform Rule injects on the way in. This blocks
// attackers hitting the Vercel origin (*.vercel.app) DIRECTLY — which would otherwise
// let them spoof `cf-connecting-ip` and bypass every IP-keyed rate limit (and drain the
// paid AI/translate/geocode routes).
//
// No-op until EDGE_SECRET is configured, so it's safe to ship before the Cloudflare
// rule + Vercel Deployment Protection are set up. To enable: (1) add a Cloudflare
// Transform Rule that sets request header `x-eno-edge: <secret>` for eno.vn, (2) set
// EDGE_SECRET=<same secret> on Vercel, (3) turn on Vercel Deployment Protection so the
// *.vercel.app origin isn't publicly reachable at all.
// Native-shell Phase 2 · M3: the LOCAL shell (capacitor://localhost on iOS,
// https://localhost on Android) calls /api/* cross-origin with Bearer auth (M2) —
// no cookies, so allow-credentials stays OFF. Only these exact app origins are
// reflected; browsers keep plain same-origin behavior.
const APP_ORIGINS = new Set(['capacitor://localhost', 'https://localhost'])

function withCors(res: NextResponse, origin: string | null): NextResponse {
  if (origin && APP_ORIGINS.has(origin)) {
    res.headers.set('Access-Control-Allow-Origin', origin)
    res.headers.set('Vary', 'Origin')
    res.headers.set('Access-Control-Allow-Headers', 'authorization, content-type')
    res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS')
    res.headers.set('Access-Control-Max-Age', '86400')
  }
  return res
}

/**
 * ⛔ WRITES MUST COME FROM THE CANONICAL ORIGIN. This lands BEFORE the change it exists to protect
 * — the session cookie is still host-scoped today — and that order is deliberate: the guard is
 * inert while no other host carries a session, and shipping it first means the cookie widening is
 * a one-line change against a boundary that is already proven in production rather than a change
 * that introduces the hole and the fix in the same breath.
 *
 * ⚠️ SO DO NOT READ THIS AS DESCRIBING TODAY'S COOKIE. Owner, 2026-08-30, chose a session that
 * follows a buyer onto a shop's storefront so they stay signed in there. The cost of that choice is
 * precise, and is why this is here: a subdomain is
 * SAME-SITE with the apex, so `SameSite=Lax` stops being a boundary — a page served at
 * `apple.eno.vn` can issue a state-changing request to the app and the browser will attach the
 * visitor's session. Nothing in this codebase used CSRF tokens, because until now same-site was
 * the boundary.
 *
 * So the boundary moves here: a mutating `/api/*` request must present the canonical origin. A
 * storefront is a READ surface — browse, search, view — and every action that writes (save, chat,
 * offer, post) must navigate the visitor to the canonical host, where they arrive already signed in
 * thanks to the very cookie this guards. That keeps the UX the owner asked for and denies a shop
 * the ability to act as its own visitor.
 *
 * ⛔ THAT NAVIGATION IS NOT BUILT YET, AND A STOREFRONT CANNOT BE REACHED UNTIL IT IS. Reviewers
 * were right that the sentence above describes an intention rather than code: `<Header>` and
 * `<ListingsExplorer>` render unchanged under a shop's host, so their save/chat/sign-in calls would
 * 403 here. Nothing reaches that state today — there is no wildcard DNS, no nginx vhost, and no
 * shop that passes the verification gate — so the ordering is safe rather than lucky. It is also
 * the reason the cookie must not be widened before those call sites are moved: the two changes are
 * one feature and must not be separated in the other direction.
 *
 * ⚠️ ABSENT `Origin` IS ALLOWED, DELIBERATELY. Browsers send it on every mutating fetch, so its
 * absence means a non-browser caller — a cron, a shop's backend on `/api/v1`, Stripe, the Supabase
 * auth hook — and those authenticate with their own credentials (see the exempt list below), not
 * with a cookie a browser attached. Rejecting a missing Origin would break all of them and protect
 * nothing: an attacker who can set arbitrary headers is not the threat model here, a victim's
 * BROWSER is, and a browser cannot be told to omit it.
 *
 * ⚠️ NOT A REPLACEMENT FOR THE EDGE PIN BELOW. That one answers "did this reach us through
 * Cloudflare"; this one answers "which page asked for it". Both are cheap and they fail
 * differently.
 */
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * The host storefronts hang off. Shared with the server resolver and the URL builder — see
 * `storefrontBaseHost`, which is where the `www` stripping and the reason for it live.
 */
function canonicalHost(): string {
  return storefrontBaseHost(process.env.NEXT_PUBLIC_APP_URL)
}

/**
 * The origins a browser may legitimately be on when it writes.
 *
 * ⛔ APEX **AND** `www`, AND GETTING THIS WRONG WOULD HAVE 403'd SIGN-IN FOR REAL USERS. A reviewer
 * caught it: both Cloudflare zones serve the apex and the `www` host — their cache rules literally
 * match `http.host in {apex www}` — and the services edition's canonical is `https://www.eno.forum`
 * while the marketplace's is the apex. So pinning to the single build-time URL 403s every mutating
 * request from whichever of the pair is not canonical: sign-in, save, message, offer, post. `www`
 * is an infra label here, so it is not rewritten either — it serves the ordinary app, and every
 * write from it would have died.
 */
function writeOrigins(): Set<string> | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL
  if (!raw) return null
  try {
    const u = new URL(raw)
    const host = u.host.replace(/^www\./, '')
    return new Set([`${u.protocol}//${host}`, `${u.protocol}//www.${host}`])
  } catch {
    return null
  }
}

function crossOriginWrite(req: NextRequest): boolean {
  if (!MUTATING.has(req.method)) return false
  const origin = req.headers.get('origin')
  if (!origin) return false // non-browser caller — see the note above
  if (APP_ORIGINS.has(origin)) return false // native shell, Bearer-authed, no cookies
  const allowed = writeOrigins()
  if (!allowed) return false // unconfigured build: do not invent a boundary that can lock the app
  return !allowed.has(origin)
}

export function proxy(req: NextRequest) {
  const origin = req.headers.get('origin')

  /**
   * STOREFRONT HOSTS — `apple.eno.vn` serves `apple`'s catalogue.
   *
   * ⚠️ SHAPE ONLY. This runs on the edge runtime with no database, so it cannot ask whether the
   * shop is verified; it rewrites on the host's SHAPE and the page resolves eligibility (see
   * `storefront.ts`) and 404s if the shop may not have a subdomain today. Splitting it that way is
   * what keeps a Postgres round trip off every request to the apex.
   *
   * ⚠️ ONLY THE ROOT PATH IS REWRITTEN. A listing, a search, an account page all render the
   * ordinary app under the shop's host, which is what makes the storefront feel like a section of
   * eno rather than a copy of it. Rewriting everything would need a shop-scoped variant of every
   * route, and would silently hide the parts a shop does not have.
   */
  // ⛔ THE GUARD RUNS FIRST. The rewrite below used to return before it, so a mutating request to a
  // storefront's ROOT — a Server Action posts to the page's own URL — skipped the origin check
  // entirely. Two reviewers found it independently. Order is the fix: nothing gets to routing
  // without passing here.
  if (crossOriginWrite(req)) {
    return withCors(new NextResponse('Forbidden', { status: 403 }), origin)
  }

  const handle = storefrontHandleFromHost(req.headers.get('host'), canonicalHost())
  // ⚠️ READS ONLY. A rewrite changes which route handles a request, so applying it to a POST would
  // hand a storefront's Server Action to a page that never expects one.
  if (handle && req.nextUrl.pathname === '/' && (req.method === 'GET' || req.method === 'HEAD')) {
    const url = req.nextUrl.clone()
    url.pathname = `/s/${handle}`
    return NextResponse.rewrite(url)
  }

  /**
   * ⛔ `/s/<handle>` IS THE REWRITE TARGET AND MUST NOT BE REACHABLE AS A URL. A reviewer walked
   * straight to `https://eno.vn/s/apple` and got the storefront: the page's own comment says it is
   * internal and that two public URLs would split the shop's ranking, and nothing enforced it.
   * The rule is that this path is only ever legitimate on the host it belongs to — reaching it any
   * other way, including on the correct host by typing it, is not a storefront visit.
   * ⚠️ REWRITTEN TO A PATH THAT CANNOT EXIST rather than 404'd here, so Next renders the app's own
   * not-found page and a probe cannot tell an internal route from any other miss.
   */
  if (req.nextUrl.pathname.startsWith('/s/')) {
    const asked = req.nextUrl.pathname.slice(3).split('/')[0]
    if (!handle || handle !== asked) {
      const url = req.nextUrl.clone()
      url.pathname = '/_not-found'
      return NextResponse.rewrite(url)
    }
  }
  // Preflights carry no app auth by design — answer them before the edge pin.
  if (req.method === 'OPTIONS' && origin && APP_ORIGINS.has(origin)) {
    return withCors(new NextResponse(null, { status: 204 }), origin)
  }
  /**
   * ⛔ THE EDGE PIN IS `/api/*` ONLY, AND THE MATCHER WIDENING NEARLY TOOK THE HOME PAGE DOWN WITH
   * IT. Everything below was written when `config.matcher` was `'/api/:path*'`, so it never needed
   * to test the pathname — being here meant being an API request. Adding `'/'` and `'/s/:path*'`
   * for the storefront rewrite quietly broke that assumption: a plain `GET /` would fall past the
   * exempt list (every entry of which starts `/api/`) and hit the `x-eno-edge` check, so the day
   * `EDGE_SECRET` is finally set the busiest page in the app would 403 for every visitor. It is
   * unset today, which is the only reason this was a landmine rather than an outage. A reviewer
   * derived it from the matcher change alone.
   * ⚠️ THIS GUARD IS WHY THE MATCHER STAYS EXPLICIT rather than becoming a catch-all with
   * exclusions: every path added there has to be checked against this block.
   */
  if (!req.nextUrl.pathname.startsWith('/api/')) return withCors(NextResponse.next(), origin)
  const secret = process.env.EDGE_SECRET
  if (!secret) return withCors(NextResponse.next(), origin)
  // SERVER-TO-SERVER routes that legitimately hit the origin OFF Cloudflare and carry
  // their OWN auth — they must bypass the edge header or they break the moment EDGE_SECRET
  // is set: crons (CRON_SECRET, Vercel Cron/Cloud Scheduler), the Supabase Send-SMS auth
  // hook (Standard-Webhooks HMAC, called by Supabase Auth → killing it kills phone-OTP
  // signup/login), the product feeds (Basic-Auth, fetched by Google Merchant/Meta), and
  // the partner API `/api/v1/*` — reached server-to-server off Cloudflare by shops' own
  // backends/agents, so it carries its OWN per-key auth (NOT the IP-keyed rate limits the
  // edge pin protects). /api/v1 is LIVE (analytics/listings/media/oauth/shop/webhooks) and
  // every route authenticates via per-key API auth — the edge pin is not its guard.
  const { pathname } = req.nextUrl
  if (
    pathname.startsWith('/api/cron/') ||
    pathname === '/api/auth/send-sms' ||
    pathname.startsWith('/api/feeds/') ||
    pathname.startsWith('/api/v1/') ||
    pathname === '/api/mcp' || // partner MCP server — key-authed like /api/v1, reached by AI clients off-Cloudflare
    // ⚠️ STRIPE CANNOT SEND `x-eno-edge`, so without this the webhook 403s the moment EDGE_SECRET is
    // set — and the failure is invisible from our side: Stripe retries, gives up, and a PAID visa
    // case never completes its send_for_review handoff. Dormant today only because EDGE_SECRET is
    // unset. Its auth is its own and stronger than the pin: an HMAC over the RAW body
    // (verifyStripeSignature), the same posture as the Supabase send-sms hook above.
    // Services-only in practice — the route is `route.svc.ts`, so it does not exist in the
    // marketplace artifact at all; this list is shared, and naming it here is harmless there.
    pathname === '/api/payments/stripe/webhook'
  ) {
    return withCors(NextResponse.next(), origin)
  }
  if (req.headers.get('x-eno-edge') !== secret) {
    return withCors(new NextResponse('Forbidden', { status: 403 }), origin)
  }
  return withCors(NextResponse.next(), origin)
}

/**
 * ⚠️ TWO ENTRIES, AND THE SECOND ONE IS NEW — the matcher was `/api/:path*` alone until storefront
 * subdomains needed a host-based rewrite, which can only happen before routing.
 *
 * ⛔ THE ROOT PATH ONLY, NOT A CATCH-ALL. `'/'` is the entire page surface this needs: a storefront
 * rewrites its home page and serves the ordinary app everywhere else. The obvious alternative —
 * matching everything and excluding `_next`, static files and the image optimiser with a negative
 * lookahead — would put this function on the hot path of every asset request on the busiest page
 * in the app, to do nothing. Adding a second storefront-scoped path later means adding it here
 * explicitly, which is a change someone has to think about rather than one that happens by
 * default.
 */
export const config = { matcher: ['/api/:path*', '/', '/s/:path*'] }
