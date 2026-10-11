import 'server-only'
import { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { ensureProfile } from '@/lib/profile'
import { pendingOnboardingStep } from '@/lib/auth-policy'
import { resumesInPlace } from '@/lib/onboarding-gate'
import { nextPathname, withoutAuthError } from '@/lib/auth-landing'

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
 * never blocks login) and say where the person goes next: `next`, or — for a new account that
 * hasn't picked individual vs business — the one-time onboarding first, carrying `next`.
 *
 * A PATH, not a response, so a route that answers JSON can use it too: the native Sign in with
 * Apple route (/api/auth/apple/native) returns `{ to }` and the app navigates there itself.
 * `next` must already be sanitized (safeNextPath) by the caller.
 */
export async function finishSignInPath(user: User | null | undefined, next: string): Promise<string> {
  if (user) {
    try {
      const profile = await ensureProfile(user)
      // ⚠️ ONE PREDICATE, SHARED WITH /onboard's SERVER GUARD AND ITS CLIENT — see lib/auth-policy.ts.
      // It covers the account-type step and, once SIGNUP_REQUIRES_PHONE is on, the phone step. Do
      // not re-test `!profile.accountType` inline here: a gate enforced in one place and not another
      // is a step a user skips by typing a URL.
      // ⚠️ `profile.phone` IS ALREADY PROOF, not a claim — ensureProfile mirrors it only when
      // `user.phone_confirmed_at` is set, so it can never be self-typed.
      // ⛔ A PAGE THAT KEEPS ITS PLACE (onboarding-gate.ts resumesInPlace) skips ONLY the account-type chooser — it
      // records that step itself, at Publish. Any other pending step (the phone, once required) still comes first.
      const step = pendingOnboardingStep(profile)
      // The account type is the ONLY step it may skip: answered (as the page's Publish answers it), nothing else may be
      // pending — the phone, once required, is masked by the type step in `step` (commit gate, opus 2026-10-11).
      const keepsPlace = step === 'account-type' && resumesInPlace(nextPathname(next))
        && pendingOnboardingStep({ ...profile, accountType: 'individual' }) === null
      if (step && !keepsPlace) return `/onboard?next=${encodeURIComponent(withoutAuthError(next))}`
    } catch (e) {
      console.error('[auth] ensureProfile', e)
    }
  }
  return withoutAuthError(next)
}

/** finishSignInPath as the redirect every redirect-style sign-in route answers with. */
export async function finishSignIn(user: User | null | undefined, origin: string, next: string): Promise<NextResponse> {
  return authRedirect(`${origin}${await finishSignInPath(user, next)}`)
}
