import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { rateLimit } from '@/lib/ratelimit'
import { FORUM_URL } from '@/lib/forum-nav'

// ── Native-app SSO handoff: eno.vn session → eno.forum session ──
//
// Middle leg of a three-hop, all-top-level-navigation flow (no fetch, no CORS,
// no third-party-cookie dependence):
//   app on eno.vn → eno.forum/auth/bridge?next=…   (forum sets a nonce cookie)
//                 → HERE ?nonce=…&next=…           (mint for the signed-in user)
//                 → eno.forum/auth/handoff?token_hash=…&nonce=…&next=…
//                                                   (verify nonce cookie ⇒ verifyOtp)
//
// SECURITY POSTURE (this endpoint mints sign-in URLs — treat it as auth surface):
//  • Login-CSRF is closed by the NONCE, not by this endpoint: the forum only
//    accepts a token when the accompanying nonce matches the cookie set by
//    /auth/bridge in the SAME browser. A GET here from anywhere else can, at
//    worst, sign the caller's own cookies into the caller's own forum account —
//    which is the feature itself, not an attack.
//  • Single-use token: only `properties.hashed_token` from admin.generateLink is
//    embedded in the redirect — NEVER the action_link, and neither is logged.
//    FORUM_URL must be the CANONICAL forum host (www) so the token-bearing URL
//    takes no apex→www redirect hop through extra edge logs.
//  • UA gate: the flow is native-only; without the app UA token we just land the
//    user on the forum as-is instead of minting.
//  • Every failure degrades to a plain redirect to the forum (logged-out beats a
//    dead tap); nothing renders, so the token never appears in a document URL.
//  • Independent forum session by design: verifyOtp mints the forum's own cookie
//    session rather than sharing eno.vn's refresh chain — two short handoffs are
//    simpler and strictly safer than one entangled session.
//  • Strict (fail-CLOSED) per-user rate limit: a Redis outage must pause minting,
//    not silently un-limit an auth-token faucet.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Local forum path only: '/', no protocol-relative '//', no backslash escapes
// (browsers normalize '\' to '/'), no traversal.
function safeNextPath(next: unknown): string {
  if (typeof next !== 'string' || !next.startsWith('/')) return '/'
  if (next.startsWith('//') || next.includes('\\') || next.includes('..')) return '/'
  return next
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const next = safeNextPath(url.searchParams.get('next'))
  const nonce = url.searchParams.get('nonce') || ''
  const plain = () => NextResponse.redirect(`${FORUM_URL}${next}`, { headers: NO_STORE })

  // Native-only flow + a nonce is required for the forum to accept the login at
  // all — without either, minting would only burn a token.
  const ua = req.headers.get('user-agent') || ''
  if (!ua.includes('EnoNativeApp') || !/^[a-zA-Z0-9-]{16,64}$/.test(nonce)) return plain()

  const supabase = await createSupabaseServer()
  const { data } = await supabase.auth.getUser()
  // Signed out, or a phone-only account (magiclink minting is email-keyed):
  // land on the forum as a guest.
  const email = data.user?.email
  if (!data.user || !email) return plain()

  const gate = await rateLimit('forum-handoff', data.user.id, 5, '1 m', { strict: true })
  if (!gate.success) return plain()

  const admin = getSupabaseAdmin()
  const { data: link, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const tokenHash = link?.properties?.hashed_token
  if (error || !tokenHash) {
    console.error('[forum-handoff] generateLink failed', data.user.id, error?.message)
    return plain()
  }

  return NextResponse.redirect(
    `${FORUM_URL}/auth/handoff?token_hash=${tokenHash}&nonce=${nonce}&next=${encodeURIComponent(next)}`,
    { headers: NO_STORE },
  )
}
