import 'server-only'
import { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { ensureProfile } from '@/lib/profile'
import { pendingOnboardingStep } from '@/lib/auth-policy'

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
      // ⚠️ ONE PREDICATE, SHARED WITH /onboard's SERVER GUARD AND ITS CLIENT — see lib/auth-policy.ts.
      // It covers the account-type step and, once SIGNUP_REQUIRES_PHONE is on, the phone step. Do
      // not re-test `!profile.accountType` inline here: a gate enforced in one place and not another
      // is a step a user skips by typing a URL.
      // ⚠️ `profile.phone` IS ALREADY PROOF, not a claim — ensureProfile mirrors it only when
      // `user.phone_confirmed_at` is set, so it can never be self-typed.
      if (pendingOnboardingStep(profile)) {
        return authRedirect(`${origin}/onboard?next=${encodeURIComponent(next)}`)
      }
    } catch (e) {
      console.error('[auth] ensureProfile', e)
    }
  }
  return authRedirect(`${origin}${next}`)
}
