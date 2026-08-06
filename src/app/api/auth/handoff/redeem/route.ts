import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { HANDOFF_COOKIE, isNonce, redeemPair } from '@/lib/auth/handoff'
import { rateLimit } from '@/lib/ratelimit'
import { nonceHash } from '@/lib/auth/handoff'

// The ONLY endpoint that returns an authorization code, and it requires BOTH halves:
//   · the httpOnly cookie — proves this is the jar that started the flow (and holds the verifier)
//   · the pairing code    — proves the human is looking at the browser that authenticated
//
// The second half is what defeats the account takeover: an attacker who lures a victim through the
// escape link holds the cookie but never sees the pair, which appears only on the victim's screen.
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate', Pragma: 'no-cache' }

// ⚠️ WS6 — NOT MIGRATED: after the origin guard, EVERY failure here is a 200 with an `{"ok":false,
// "reason":…}` body. Enumerated:
//   · `{"error":"bad_origin"}` 403 — first, ahead of anything the wrapper does.
//   · `{"ok":false,"reason":"gone"}` 200 — no/malformed handoff cookie. Not a 401: the cookie nonce
//     is the credential and "gone" is the ordinary end-of-flow answer the app polls for.
//   · `{"ok":false,"reason":"wrong"}` 200 — unparseable body, or a `pair` that is not a string of
//     ≤32 chars. A `body:` schema would turn both into a 400 with an `{error}` envelope.
//   · `{"ok":false,"reason":"exhausted"}` 200 — THROTTLED. Not `{"error":"rate_limited"}` 429.
//   · `{"ok":true,"code":…}` / `{"ok":false,"reason":r.reason}` 200 from `redeemPair`.
// Two further blockers on top of the envelope:
//   · THE LIMITER IS KEYED ON `nonceHash(nonce)` FROM THE COOKIE and runs after the body parse —
//     explicitly NOT per-IP ("per-IP strict limiting 429s whole carriers behind CGNAT"). `rateLimit:`
//     keys on the caller or `clientIp(req)`, which is the exact bucketing this route rejects.
//   · EVERY response carries `Cache-Control: no-store, no-cache, must-revalidate` + `Pragma:
//     no-cache`. This endpoint returns the authorization code; the no-store is load-bearing.
export async function POST(request: Request) {
  const appOrigin = new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn').origin
  if (process.env.NODE_ENV === 'production' && request.headers.get('origin') !== appOrigin) {
    return NextResponse.json({ error: 'bad_origin' }, { status: 403 })
  }

  const nonce = (await cookies()).get(HANDOFF_COOKIE)?.value
  if (!isNonce(nonce)) return NextResponse.json({ ok: false, reason: 'gone' }, { headers: NO_STORE })

  let body: { pair?: unknown }
  try { body = await request.json() } catch { return NextResponse.json({ ok: false, reason: 'wrong' }, { headers: NO_STORE }) }
  if (typeof body.pair !== 'string' || body.pair.length > 32) {
    return NextResponse.json({ ok: false, reason: 'wrong' }, { headers: NO_STORE })
  }

  // ⚠️ KEYED ON THE HANDOFF, NOT THE IP, AND NOT STRICT. Per-IP strict limiting 429s whole carriers
  // behind CGNAT — which in Vietnam is most mobile traffic — and would lock honest visitors out of
  // their own sign-in. The real brute-force bound is the 5-attempt counter on the row itself.
  const rl = await rateLimit('handoff-redeem', nonceHash(nonce), 15, '10 m').catch(() => ({ success: true, remaining: 0 }))
  if (!rl.success) return NextResponse.json({ ok: false, reason: 'exhausted' }, { headers: NO_STORE })

  const r = await redeemPair(nonce, body.pair)
  // ⚠️ THE BODY IS BUILT FROM THE DISCRIMINATED UNION, so a `code` field cannot ride along on a
  // failure. Spreading the result wholesale is how a "wrong pair" response leaks the code.
  return NextResponse.json(
    r.ok ? { ok: true, code: r.code } : { ok: false, reason: r.reason },
    { headers: NO_STORE },
  )
}
