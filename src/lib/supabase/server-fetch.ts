import 'server-only'

/**
 * fetch for the SERVER-SIDE Supabase clients: the auth calls made on every request go to the gateway over the container
 * network instead of hairpinning through Cloudflare (speed plan item 6).
 *
 * ⛔ MEASURED 2026-10-16, from inside eno-vn-app: GoTrue through https://sb.eno.vn 81–86 ms a call (257 ms cold) — box →
 * Cloudflare HKG → tunnel → nginx → the gateway on the same box — against 3–6 ms to http://supabase-envoy:8000. GoTrue
 * logged ~280 GET /user an hour from the box: every getCurrentProfile(), every `auth: 'profile'` route, getAdmin().
 *
 * ⛔ supabaseUrl STAYS https://sb.eno.vn — ONLY THE FETCH MOVES. The session cookie's NAME (sb-sb-auth-token), the PKCE
 * verifier cookie, the JWKS cache key, the OAuth URL a browser is sent to and every signed or public storage URL are BUILT
 * from supabaseUrl (supabase-js, @supabase/ssr), never from a response; pointing supabaseUrl at the gateway instead would
 * have renamed the cookie and signed everyone out.
 *
 * ⚠️ AN ALLOWLIST, BY METHOD AND EXACT PATH — never "everything under sb.eno.vn". The public route passes the nginx sb
 * vhost (infra/vn-node/nginx/eno.conf: the /authorize guard, the identities 403, the 64m body cap) and Cloudflare's rules,
 * and anything not listed here keeps them. Listed: the four calls the server makes per request or per session refresh
 * (for /token only the refresh and PKCE grants), none of which builds a link — GoTrue reads Host / X-Forwarded-Host only to shape mailer links
 * (internal/api/middleware.go isValidExternalHost, v2.189), which is why PUT /user (an email change mails one), /verify,
 * /otp, /admin/*, storage and rest stay public until each is measured on its own (plan review, 2026-10-16).
 * ⚠️ WHAT DOES CHANGE, STATED: GoTrue records the caller's address on a refreshed session and in its audit log. For these
 * server-made calls that was the box's public IP (through Cloudflare) and is now the gateway's container address — neither
 * is the user's, and nothing in this app reads either. GoTrue has no GOTRUE_RATE_LIMIT_HEADER today, so its per-IP limiters
 * apply on neither route; if one is ever set to a Cloudflare header, these calls will not carry it.
 *
 * ⚠️ A RUNTIME SWITCH, NOT NEXT_PUBLIC_*: SUPABASE_INTERNAL_FETCH=true comes from the box's infra/vn-node/apps.compose.yml
 * (beside LISTING_IMAGES_INTERNAL) and is read per call, so `next build`, the local preview, CI and scripts keep the public
 * route, and rollback is deleting that line and recreating the containers — no rebuild.
 *
 * ⚠️ ONE FALLBACK, TO THE PUBLIC ROUTE, ONCE — never on an HTTP status (both routes end at the same gateway container:
 * nginx's upstream 127.0.0.1:8000 is its published port, so a 5xx is the same on both), an abort, or a timeout the caller
 * set. A GET (getUser, the JWKS) retries after any network failure: it changes nothing on the server. A POST retries only
 * when the connection provably never opened (ECONNREFUSED, ENOTFOUND, EAI_AGAIN, UND_ERR_CONNECT_TIMEOUT) and its body can be sent
 * again (none, or a string): a POST /token that may have reached GoTrue must not be replayed — refresh tokens rotate, and
 * a second use of a spent one can end the session.
 */

/** The gateway on the container network — the same fixed target as src/app/listing-images/route.ts. Never request-derived. */
export const SUPABASE_INTERNAL_ORIGIN = 'http://supabase-envoy:8000'

/**
 * Exact pathname → the one method routed internally (and, for /token, the grants). Anything else — another method, a
 * trailing slash, another grant (id_token, password), an ambiguous query — stays public.
 */
const INTERNAL_ROUTES: Readonly<Record<string, { method: string; grants?: readonly string[] }>> = Object.freeze({
  '/auth/v1/user': { method: 'GET' }, // getUser()
  // The session refresh (every request near expiry) and the OAuth return's PKCE exchange — only those two grants.
  '/auth/v1/token': { method: 'POST', grants: ['refresh_token', 'pkce'] },
  '/auth/v1/logout': { method: 'POST' }, // signOut()
  '/auth/v1/.well-known/jwks.json': { method: 'GET' }, // getClaims()' key fetch, every 10 minutes per process
})

/** The internal GET's own cap — see supabaseServerFetch. */
let INTERNAL_GET_TIMEOUT_MS = 10_000
/** Test seam: a shorter cap, so its behaviour can be shown without waiting 10 s. */
export function setInternalSupabaseTimeoutsForTests(t: { get?: number } = {}) {
  INTERNAL_GET_TIMEOUT_MS = t.get ?? 10_000
}

// Connection never established — so the request was never sent (undici's connect timeout included: no socket, no bytes).
const NEVER_SENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'])
// Every fallback is counted; the log says so at most once a minute, with the running count and the latest reason — a
// gateway that keeps failing stays visible without a line per request.
let fallbacks = 0
let lastFallbackLog = 0
function noteFallback(reason: string) {
  fallbacks++
  const now = Date.now()
  if (now - lastFallbackLog < 60_000) return
  lastFallbackLog = now
  console.warn(`[supabase-fetch] ${SUPABASE_INTERNAL_ORIGIN} failed (${reason}) — used the public route; ${fallbacks} fallback(s) since start`)
}

/** The internal URL for this call, or null when it stays on the public route. Exported for the tests. */
export function internalSupabaseUrl(input: unknown, method: string): string | null {
  if (process.env.SUPABASE_INTERNAL_FETCH !== 'true') return null
  // A Request object is passed through untouched: no Supabase library sends one, and re-wrapping a streamed body needs
  // `duplex`, which a rewrite here would have to get right for a case that never happens.
  if (typeof input !== 'string' && !(input instanceof URL)) return null
  let url: URL, pub: URL
  try {
    url = new URL(String(input))
    pub = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '')
  } catch {
    return null
  }
  // The exact parsed ORIGIN — scheme, host and port — never a hostname or prefix test: sb.eno.vn.evil.test stays out.
  if (url.origin !== pub.origin) return null
  if (!Object.hasOwn(INTERNAL_ROUTES, url.pathname)) return null
  const route = INTERNAL_ROUTES[url.pathname]
  if (route.method !== method) return null
  if (route.grants) {
    // Exactly one grant_type, and a listed one: a repeated parameter is the kind of ambiguity GoTrue and this check could
    // read differently.
    const grants = url.searchParams.getAll('grant_type')
    if (grants.length !== 1 || !route.grants.includes(grants[0])) return null
  }
  return SUPABASE_INTERNAL_ORIGIN + url.pathname + url.search
}

export const supabaseServerFetch: typeof fetch = async (input, init) => {
  const method = (init?.method || 'GET').toUpperCase()
  const internal = internalSupabaseUrl(input, method)
  if (!internal) return fetch(input, init)
  // ⚠️ AN INTERNAL GET HAS ITS OWN 10 s CAP (gate review, 2026-10-16): a gateway that accepts the connection and then
  // never answers would otherwise hold getUser() for undici's 300 s; after the cap it tries the public route. A POST gets
  // NO cap of ours: aborting a refresh GoTrue may still complete strands the rotated token (the next refresh then reuses a
  // spent one), so it waits as long as it would have anyway.
  const own = method === 'GET' ? AbortSignal.timeout(INTERNAL_GET_TIMEOUT_MS) : null
  const callerSignal = init?.signal ?? undefined
  try {
    // The same method, headers (apikey, Authorization) and body — only the address differs (and a GET's signal also
    // carries the cap above).
    if (!own) return await fetch(internal, init)
    return await fetch(internal, { ...init, signal: callerSignal ? AbortSignal.any([callerSignal, own]) : own })
  } catch (e) {
    const name = (e as { name?: unknown } | null)?.name
    const code = (e as { cause?: { code?: unknown } } | null)?.cause?.code
    const body = init?.body
    const callerGaveUp = !!callerSignal?.aborted
    const capped = !!own?.aborted && !callerGaveUp
    // A GET (getUser, the JWKS) changes nothing on the server, so ANY network failure — a reset, a dropped socket, the
    // cap above — may try the public route. Never when the caller gave up (its own abort or timeout). A POST only when the
    // connection provably never opened (the refresh-token rule above) — never after the cap.
    const networkFailure = capped || (name !== 'AbortError' && name !== 'TimeoutError')
    const sendAgain =
      !callerGaveUp && networkFailure &&
      (method === 'GET' || (!capped && typeof code === 'string' && NEVER_SENT.has(code) && (body == null || typeof body === 'string')))
    if (!sendAgain) throw e
    noteFallback(capped ? `no answer in ${INTERNAL_GET_TIMEOUT_MS} ms` : String(code ?? name ?? 'network error'))
    return fetch(input, init)
  }
}
