import { NextResponse } from 'next/server'
import { clientIp } from '@/lib/client-ip'
import { HANDOFF_COOKIE, HANDOFF_TTL_MS, isNonce, openHandoff } from '@/lib/auth/handoff'
import { parseHandoffVia } from '@/lib/auth/handoff-client'
import { serverAuthUsesRequestOrigin, isLoopbackHost, loopbackOrigin } from '@/lib/auth-origin'
import { rateLimit } from '@/lib/ratelimit'

// Step 1, run by the ORIGINATING context (in-app browser / home-screen PWA) after it has asked
// Supabase for the Google URL with skipBrowserRedirect — so the PKCE verifier already exists here.
//
// ⚠️ THE COOKIE IS THE POINT. Storing the row could happen anywhere; setting an httpOnly cookie in
// THIS jar is what later proves a redeem is coming from the context that started the flow.
export const dynamic = 'force-dynamic'

const appOrigin = () => new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn').origin

/**
 * The page's own origin in `next dev` or a local preview — the server's flag AND a loopback Host, never either alone
 * (src/lib/auth-origin.ts, the /auth/callback rule). Null anywhere else, so in production a Host header, which the
 * client controls, can never move what this route accepts.
 */
function localSelfOrigin(request: Request): string | null {
  const host = request.headers.get('host')
  return serverAuthUsesRequestOrigin() && isLoopbackHost(host) ? loopbackOrigin(host!) : null
}

/**
 * ⛔ sign-in-form.tsx's `authOrigin`, COMPUTED THE WAY IT COMPUTES IT — the hand-off's redirect_to is built from it,
 * so the pin below must equal it on every host the app is served from (opus gate O1, 2026-10-08):
 *   · `next dev` / a local preview (AUTH_USES_REQUEST_ORIGIN): the page's own origin — and the client's fetch here is
 *     same-origin, so that is this request's loopback Host (localSelfOrigin). (Accepted here; production GoTrue still
 *     refuses a loopback redirect_to once part C is in — see the Origin check in POST.)
 *   · everywhere else: NEXT_PUBLIC_APP_URL as inlined, character for character — NOT the visitor's host. The apex or
 *     www twin that 308s to the canonical one, a storefront subdomain: the client sends the canonical value from every
 *     one of them (the same inlined string in both bundles).
 *     The raw string, not `new URL(…).origin`: the client concatenates it as it is, so a trailing slash in the env
 *     makes its redirect_to `https://eno.vn//auth/callback?…`, and a normalized pin would refuse every hand-off.
 * route.test.ts pins the client's expressions (it reads sign-in-form.tsx), so a change there fails here first.
 */
function clientAuthOrigin(request: Request): string {
  return localSelfOrigin(request) ?? (process.env.NEXT_PUBLIC_APP_URL || appOrigin())
}

// ⚠️ WS6 — NOT MIGRATED. This is the closest call in the handoff cluster — the throttled answer
// really is `{"error":"rate_limited"}` 429, byte-identical to `apiFail('rate_limited', 429)` — and it
// still fails on three counts:
//   · THE ORIGIN CHECK MUST RUN BEFORE THE LIMITER. `{"error":"bad_origin"}` 403 is decided first,
//     and the wrapper's fixed order (auth → rateLimit → body) puts `rateLimit:` ahead of any handler
//     code. Hoisting the limiter therefore lets a cross-origin caller — the exact traffic this route
//     refuses outright, "allowing absent let anything mint rows" — spend the honest visitor's per-IP
//     budget before being rejected.
//   · THE BODY HAS TWO DISTINCT 400 CODES. A malformed JSON body is `{"error":"bad_body"}`; a
//     well-formed body with a bad `nonce`/`authUrl` is `{"error":"bad_request"}`. `invalidBodyCode`
//     is ONE code covering both the parse failure and the schema failure, so migrating collapses
//     `bad_body` and `bad_request` into whichever one is chosen. (The two further 400s —
//     `{"error":"bad_url"}` and `{"error":"bad_url_host"}` — are a URL-shape check no zod schema in
//     `body:` should be asked to carry: it pins `parsed.origin` against
//     `NEXT_PUBLIC_SUPABASE_URL` and the pathname against exactly `/auth/v1/authorize`.)
//   · THE SUCCESS RESPONSE SETS THE httpOnly `HANDOFF_COOKIE`. "THE COOKIE IS THE POINT" — it is
//     what later proves a redeem comes from the context that started the flow. A plain-object return
//     cannot emit Set-Cookie.
// ⚠️ THE LIMITER KEY USED TO DIVERGE and no longer does: it read `cf-connecting-ip` raw while
// `rateLimit:` keyed on `clientIp(req)`, so the same caller sat in different buckets here and
// everywhere else — and, once clientIp() started verifying the edge proof, this route would have
// gone on trusting a header anyone can type. Both now go through clientIp().
export async function POST(request: Request) {
  // ⚠️ A MISSING Origin IS REFUSED IN PRODUCTION. Browsers always send it on a cross-origin POST, so
  // absent means a non-browser caller. Allowing absent (an earlier draft did) let anything mint rows.
  // ⚠️ The one other origin a production BUILD may post from is a local preview posting to itself (localSelfOrigin:
  // the LOCAL_AUTH flag and a loopback Host — a shape that cannot reach the box through Cloudflare). It lets a
  // `npm run preview:*` build pass THIS route; it does NOT make the preview's hand-off complete against production
  // GoTrue: once part C is installed, nginx's authorize guard (infra/vn-node/nginx/eno.conf, $eno_authz_redirect_ok)
  // answers 400 to any redirect_to but https://(www.)eno.(vn|forum)/…, and I8's --drop-localhost-redirect takes
  // http://localhost:3000/** out of GoTrue's allow-list. From then on a preview exercises the hand-off only as far as
  // GoTrue's authorize. A storefront subdomain stays refused here, as by src/proxy.ts's write guard: a storefront is a
  // read surface.
  const origin = request.headers.get('origin')
  const local = localSelfOrigin(request)
  if (process.env.NODE_ENV === 'production' && origin !== appOrigin() && (local === null || origin !== local)) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  // ⛔ `clientIp()`, NOT A RAW `cf-connecting-ip` READ. This limiter used to take the header
  // straight off the request, which meant it kept trusting a value anyone reaching the origin can
  // type — the exact hole the audit raised, bypassing the verification clientIp() now performs.
  // ⚠️ It also diverged from every other limiter in the codebase (no x-real-ip / XFF fallback), so
  // the same caller landed in different buckets here and elsewhere. Both notes above described that
  // divergence as a known quirk; it is now simply gone.
  const ip = clientIp(request)
  // ⚠️ NOT strict: this is the sign-in path, so a limiter blip must not lock people out.
  const rl = await rateLimit('handoff-open', ip, 20, '10 m').catch(() => ({ success: true, remaining: 0 }))
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  let body: { nonce?: unknown; authUrl?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'bad_body' }, { status: 400 }) }
  if (!isNonce(body.nonce) || typeof body.authUrl !== 'string') {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  // ⚠️ THIS PROJECT'S OWN SUPABASE AUTH ENDPOINT — NOT accounts.google.com, AND NOT *.supabase.co.
  //
  // /auth/escape serves this value as a 302, so an unvalidated URL turns it into an open redirector
  // aimed at someone mid-sign-in. The history matters because both obvious answers are wrong:
  //   · `*.supabase.co` — anyone can register a project on that domain, so it IS an open redirect.
  //   · `accounts.google.com` — safe, but it never matches, so it rejected EVERY real request and
  //     the whole feature was dead on arrival. `signInWithOAuth({skipBrowserRedirect})` does not
  //     return Google's URL; supabase-js builds `${supabaseUrl}/auth/v1/authorize?provider=…`
  //     (verified in @supabase/auth-js: `_getUrlForProvider(\`${this.url}/authorize\`, …)`) and it is
  //     Supabase that redirects on to Google. Caught by an external reviewer.
  //
  // So: exactly the configured project host, and exactly the authorize path. One host, pinned from
  // our own env — which is not a wildcard and therefore not a redirector.
  // ⚠️ ORIGIN AND PATHNAME ARE BOTH EXACT. Two near-misses an external reviewer caught in the first
  // version of this check, each of which reopens the redirector by a different door:
  //   · comparing `hostname` alone ignores scheme and PORT, so `https://host:8443/…` passes.
  //   · `pathname.startsWith('/auth/v1/authorize')` also accepts `/auth/v1/authorize-evil`, which is
  //     a DIFFERENT path on the same host — enough if any endpoint there ever redirects.
  // `URL.origin` folds scheme+host+port into one comparison, and `===` on the pathname admits
  // exactly one route. The query string — where PKCE and redirect_to live — is pinned below (2026-10-08).
  let parsed: URL
  try { parsed = new URL(body.authUrl) } catch { return NextResponse.json({ error: 'bad_url' }, { status: 400 }) }
  let expectedOrigin: string
  try { expectedOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').origin } catch { expectedOrigin = '' }
  const okOrigin = expectedOrigin !== '' && parsed.origin === expectedOrigin
  if (parsed.protocol !== 'https:' || !okOrigin || parsed.pathname !== '/auth/v1/authorize') {
    return NextResponse.json({ error: 'bad_url_host' }, { status: 400 })
  }
  // ⛔ No fragment (commit gate round 9, codex): a redirect whose Location carries none inherits the original's, so a
  // stored `#access_token=…` could ride the hops to a page that reads sessions from the fragment. supabase-js adds none,
  // so no `#` at all — an empty fragment (`…#`) parses to hash '' yet is stored and served as written.
  if (body.authUrl.includes('#')) return NextResponse.json({ error: 'bad_url' }, { status: 400 })

  // ⛔ AND THE QUERY IS PINNED TOO NOW (Sign in with Apple plan, A2). "Query string stays free" left the stored
  // URL able to name ANY provider, NO code_challenge — GoTrue then runs the IMPLICIT flow and puts the tokens,
  // provider_refresh_token included, in the redirect's fragment — and ANY redirect_to GoTrue accepts (any scheme
  // on SITE_URL's host, any loopback IP). /auth/escape 302s a visitor without the cookie straight to this URL, so
  // a crafted row was a session-delivery link aimed at whoever opened it. This hand-off is Google-only and
  // PKCE-only, and it only ever returns to THIS site's /auth/callback for THIS nonce, so that is all it accepts:
  //   · exactly one `provider`, and it is `google`;
  //   · exactly one well-formed S256 `code_challenge`;
  //   · exactly one `redirect_to`, equal to `${clientAuthOrigin}/auth/callback?handoff=<this nonce>`, optionally
  //     followed by `&via=<an allow-listed word>` (parseHandoffVia) — what sign-in-form.tsx builds;
  //   · and NO OTHER KEY. GoTrue adds `scopes` to Google's own and hands every other parameter on to Google
  //     (prompt, login_hint, access_type …), so a crafted row could open a consent screen asking for, say, Gmail —
  //     its provider_token bound for the context that minted the row. These four are exactly what supabase-js puts
  //     in this URL for signInWithOAuth({ redirectTo, skipBrowserRedirect }) (route.test.ts builds it with the real
  //     client, so an upgrade that adds one fails there, not in production).
  const q = parsed.searchParams
  const ALLOWED = new Set(['provider', 'redirect_to', 'code_challenge', 'code_challenge_method'])
  if ([...q.keys()].some((k) => !ALLOWED.has(k))) return NextResponse.json({ error: 'bad_url' }, { status: 400 })
  const one = (k: string) => (q.getAll(k).length === 1 ? q.get(k) : null)
  const challenge = one('code_challenge')
  const method = (one('code_challenge_method') ?? '').toLowerCase()
  if (one('provider') !== 'google' || !challenge || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge) || method !== 's256') {
    return NextResponse.json({ error: 'bad_url' }, { status: 400 })
  }
  const redirectTo = one('redirect_to')
  const base = `${clientAuthOrigin(request)}/auth/callback?handoff=${encodeURIComponent(body.nonce)}`
  let redirectOk = redirectTo === base
  if (!redirectOk && redirectTo?.startsWith(`${base}&via=`)) {
    const via = parseHandoffVia(redirectTo.slice(`${base}&via=`.length))
    redirectOk = via !== null && redirectTo === `${base}&via=${via}`
  }
  if (!redirectOk) return NextResponse.json({ error: 'bad_url' }, { status: 400 })

  await openHandoff(body.nonce, parsed.toString())

  const res = NextResponse.json({ ok: true })
  res.cookies.set(HANDOFF_COOKIE, body.nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // Lax, not Strict: the visitor returns by a top-level navigation. Safe because every endpoint
    // that acts on this cookie is POST with an Origin check, and Lax is not sent on a cross-site POST.
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(HANDOFF_TTL_MS / 1000),
  })
  return res
}
