import { redirect } from 'next/navigation'
import { SITE_NAME } from '@/lib/edition'
import { Suspense } from 'react'
import { Loader2 } from 'lucide-react'
import type { Metadata } from 'next'
import { getCurrentProfile } from '@/lib/admin'
import { safeNextPath } from '@/lib/url'
import { pendingOnboardingStep } from '@/lib/auth-policy'
import { OnboardClient } from './onboard-client'

// Noindex — this is a private, post-sign-in interstitial, not a content page.
export const metadata: Metadata = {
  title: `Welcome to ${SITE_NAME}`,
  robots: { index: false, follow: false },
}

// ⚠️ DYNAMIC BECAUSE OF THE SERVER GATE BELOW — it reads the session, so this page must never be
// prerendered or cached. A cached copy would be one visitor's answer served to the next.
export const dynamic = 'force-dynamic'

/**
 * ⚠️ THE SERVER HALF OF THE ONBOARDING GATE (added 2026-08-02). The CLIENT half already existed and
 * is correct — which is precisely why this was needed.
 *
 * Reported: signed in, full sidebar, trust badge 81, and "How will you use eno.vn?" on screen.
 * onboard-client.tsx guards properly (`loading || !identityLoaded || !user || accountType` → render
 * a spinner, never the chooser) and onboard-gate.test.ts records the same defect being closed on
 * 2026-07-27. So the chooser can only appear once `/api/me` has ANSWERED and reported no
 * accountType — and the database says this profile has one.
 *
 * That leaves a class of ways to arrive here that no client guard can defend against: a stale
 * `?next=/onboard`, a bookmark, the back button, or an `/api/me` answering for a different session
 * than the page was rendered for. The page had NO server guard at all, so it rendered for anyone who
 * asked. Now an onboarded profile never receives the HTML.
 *
 * ⚠️ THE TWO HALVES FAIL IN OPPOSITE DIRECTIONS, DELIBERATELY. The client fails CLOSED on
 * uncertainty (unknown identity → spinner, never the chooser: choosing in that window POSTs a fresh
 * account type over an existing one and silently downgrades a business to an individual). This half
 * only ever redirects AWAY on certainty — if the session or profile cannot be read it falls through
 * to the client, so a transient DB hiccup can never lock a genuinely new user out of onboarding.
 */
export default async function OnboardPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  let target: string | null = null
  try {
    const profile = await getCurrentProfile()
    // ⚠️ THE SHARED PREDICATE, NOT `profile.accountType` INLINE — lib/auth-policy.ts is explicit
    // that its three callers must agree, and this one testing accountType directly was exactly the
    // drift it warns about: the moment SIGNUP_REQUIRES_PHONE is turned on, a user WITH an account
    // type but WITHOUT a phone would be redirected here by auth-finish.ts and then immediately
    // bounced back out by this guard — an infinite loop between the two, or a phone step that can
    // be skipped by opening /onboard and letting it redirect. Reading the same function keeps the
    // entry condition and the exit condition inverses of each other by construction.
    if (profile && !pendingOnboardingStep(profile)) {
      // Same same-origin guard /auth/callback uses: `next` is caller-supplied and must never become
      // an off-site redirect. The origin here is a sentinel — only the PATH is used, and any
      // absolute URL pointing elsewhere fails the origin check and collapses to '/'. safeNextPath
      // also rejects /signin, /auth/* and /onboard as destinations, which is what stops this
      // redirect bouncing straight back into itself.
      const path = safeNextPath(next, 'http://onboard.local')
      target = path === '/' ? '/dashboard' : path
    }
  } catch {
    // No session, or the DB is unreachable → fall through and let the client decide. It fails
    // closed, so the worst case is a spinner rather than a wrongly-shown chooser.
  }
  // ⚠️ OUTSIDE THE try/catch ON PURPOSE. `redirect()` signals by THROWING in the App Router, so
  // calling it above would have the catch swallow it and render the chooser anyway — reintroducing
  // the exact bug this function exists to fix.
  if (target) redirect(target)

  // OnboardClient reads ?next via useSearchParams, which requires a Suspense
  // boundary in the App Router. The fallback mirrors OnboardClient's own loader
  // byte-for-byte (same centering, same spinner) so the page never flashes blank
  // between the server render and hydration — one continuous quiet loading state.
  return (
    <Suspense
      fallback={
        <main id="main" tabIndex={-1} className="flex min-h-screen items-center justify-center bg-background">
          <Loader2 className="h-6 w-6 animate-spin text-accent-foreground" />
        </main>
      }
    >
      <OnboardClient />
    </Suspense>
  )
}
