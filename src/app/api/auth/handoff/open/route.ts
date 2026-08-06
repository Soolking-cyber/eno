import { NextResponse } from 'next/server'
import { HANDOFF_COOKIE, HANDOFF_TTL_MS, isNonce, openHandoff } from '@/lib/auth/handoff'
import { rateLimit } from '@/lib/ratelimit'

// Step 1, run by the ORIGINATING context (in-app browser / home-screen PWA) after it has asked
// Supabase for the Google URL with skipBrowserRedirect — so the PKCE verifier already exists here.
//
// ⚠️ THE COOKIE IS THE POINT. Storing the row could happen anywhere; setting an httpOnly cookie in
// THIS jar is what later proves a redeem is coming from the context that started the flow.
export const dynamic = 'force-dynamic'

const appOrigin = () => new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn').origin

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
// Also worth recording: the limiter key here is `request.headers.get('cf-connecting-ip') ||
// 'unknown'`, while `rateLimit:` keys on `clientIp(req)` (cf-connecting-ip → x-real-ip → first XFF
// hop → 'anon'). Same value behind Cloudflare, a different bucket everywhere else.
export async function POST(request: Request) {
  // ⚠️ A MISSING Origin IS REFUSED IN PRODUCTION. Browsers always send it on a cross-origin POST, so
  // absent means a non-browser caller. Allowing absent (an earlier draft did) let anything mint rows.
  const origin = request.headers.get('origin')
  if (process.env.NODE_ENV === 'production' && origin !== appOrigin()) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const ip = request.headers.get('cf-connecting-ip') || 'unknown'
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
  // exactly one route. Query string stays free: that is where PKCE and redirect_to live.
  let parsed: URL
  try { parsed = new URL(body.authUrl) } catch { return NextResponse.json({ error: 'bad_url' }, { status: 400 }) }
  let expectedOrigin: string
  try { expectedOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').origin } catch { expectedOrigin = '' }
  const okOrigin = expectedOrigin !== '' && parsed.origin === expectedOrigin
  if (parsed.protocol !== 'https:' || !okOrigin || parsed.pathname !== '/auth/v1/authorize') {
    return NextResponse.json({ error: 'bad_url_host' }, { status: 400 })
  }

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
