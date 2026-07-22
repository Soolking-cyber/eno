import 'server-only'
import { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { ensureProfile } from '@/lib/profile'

// The shared tail of every sign-in. Two routes complete a session — /auth/callback
// (OAuth's ?code=) and /auth/confirm (the emailed magic link's token_hash) — and they
// must agree on what happens next, or a user who signs in by email skips the onboarding
// an OAuth user gets, and lands without an accountType.

/**
 * Never let a proxy/CDN cache an auth redirect: it carries Set-Cookie, so a cached
 * response would hand one user's session to the next visitor.
 */
export function authRedirect(to: string): NextResponse {
  const res = NextResponse.redirect(to)
  res.headers.set('Cache-Control', 'private, no-store, max-age=0')
  return res
}

/**
 * Provision the app Profile on sign-in (idempotent; best-effort so a transient DB hiccup
 * never blocks login). New accounts that haven't picked individual vs business are sent
 * through the one-time onboarding first.
 */
export async function finishSignIn(user: User | null | undefined, origin: string, next: string): Promise<NextResponse> {
  if (user) {
    try {
      const profile = await ensureProfile(user)
      if (!profile.accountType) {
        return authRedirect(`${origin}/onboard?next=${encodeURIComponent(next)}`)
      }
    } catch (e) {
      console.error('[auth] ensureProfile', e)
    }
  }
  return authRedirect(`${origin}${next}`)
}
