import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { browserCookieName, consentAndMintPair, isNonce, voidHandoff } from '@/lib/auth/handoff'
import { rateLimit } from '@/lib/ratelimit'

// Called by the REAL BROWSER after Google, when the visitor answers "was that you?".
//
// ⚠️⚠️ IT TAKES THE NONCE FROM THE BODY *AND* A BROWSER SECRET FROM AN httpOnly COOKIE, AND BOTH
// ARE REQUIRED. The nonce alone used to be enough, and that was an account takeover: the nonce is
// not a secret — it rides in the escape URL and in /handoff/url?h= — so an attacker who opened the
// handoff in their own app could wait for the victim to authenticate, call this endpoint with the
// nonce they chose, receive the pairing code themselves, and redeem it with their own cookie. Two
// external reviewers found this independently on 2026-08-05.
//
// The cookie is set at /auth/callback, in the same request that parks the code, so ONLY the browser
// that actually completed Google can hold it. That is what binds consent to the right context.
// ⚠️ Do not "simplify" this back to a body-only nonce, and do not accept the secret from the body:
// a value the caller can supply proves nothing about which jar they are in.
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate', Pragma: 'no-cache' }

// ⚠️ WS6 — NOT MIGRATED: different envelope, guard-before-everything, and a limiter that must run
// LAST. Enumerated, every exit:
//   · `{"error":"bad_origin"}` 403 — decided FIRST, ahead of any wrapper step.
//   · `{"ok":false}` 400 on a JSON parse failure, and again on a non-nonce `nonce`.
//   · `{"ok":false,"reason":"gone"}` 403 when the per-nonce browser cookie is absent or malformed.
//   · `{"ok":false}` 429 when throttled.
//   · `{"ok":true,"voided":true}` / `{"ok":false,"reason":"gone"}` / `{"ok":true,"pair":"…"}` at 200.
// Three independent blockers follow from that list:
//   · THE ERROR ENVELOPE IS `{"ok":false,…}`, never the wrapper's bare `{error}`. `invalidBodyCode`
//     cannot produce `{"ok":false}`, and the throttled 429 is the same shape.
//   · THE LIMITER RUNS AFTER THE BODY AND AFTER THE COOKIE CHECK, deliberately: an attacker with the
//     nonce but no browser cookie is rejected 403 without ever touching the limiter, so hoisting it
//     into `rateLimit:` would let that caller consume the honest visitor's per-IP budget. Its key is
//     also `cf-connecting-ip || 'unknown'`, not `clientIp()`, so off-Cloudflare traffic buckets
//     differently from what the wrapper would compute.
//   · EVERY RESPONSE CARRIES `Cache-Control: no-store, no-cache, must-revalidate` + `Pragma:
//     no-cache` — and this is the one endpoint that returns the pairing code, so losing no-store is
//     not a cosmetic regression.
export async function POST(request: Request) {
  const appOrigin = new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn').origin
  if (process.env.NODE_ENV === 'production' && request.headers.get('origin') !== appOrigin) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  let body: { nonce?: unknown; agreed?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ ok: false }, { status: 400, headers: NO_STORE }) }
  if (!isNonce(body.nonce)) return NextResponse.json({ ok: false }, { status: 400, headers: NO_STORE })

  // ⚠️ FROM THE COOKIE, NEVER THE BODY — see the header. The cookie NAME is derived from the nonce
  // (browserCookieName), so concurrent handoffs in one browser cannot clobber each other's binding.
  const browserSecret = (await cookies()).get(browserCookieName(body.nonce))?.value
  if (!isNonce(browserSecret)) {
    return NextResponse.json({ ok: false, reason: 'gone' }, { status: 403, headers: NO_STORE })
  }

  const ip = request.headers.get('cf-connecting-ip') || 'unknown'
  const rl = await rateLimit('handoff-consent', ip, 30, '10 m').catch(() => ({ success: true, remaining: 0 }))
  if (!rl.success) return NextResponse.json({ ok: false }, { status: 429, headers: NO_STORE })

  // "That wasn't me" — kill it rather than leave a live authorization code parked.
  if (body.agreed !== true) {
    await voidHandoff(body.nonce, browserSecret)
    return NextResponse.json({ ok: true, voided: true }, { headers: NO_STORE })
  }

  const pair = await consentAndMintPair(body.nonce, browserSecret)
  // ⚠️ Returned exactly once, to this browser, and never written anywhere else. If this value ever
  // reaches a URL, a log line, or a response readable from the app's jar, the takeover is back.
  if (!pair) return NextResponse.json({ ok: false, reason: 'gone' }, { headers: NO_STORE })
  return NextResponse.json({ ok: true, pair }, { headers: NO_STORE })
}
