// PURE predicate for the one-time onboarding redirect in src/context/auth-context.tsx: given the
// current pathname, may we bounce a signed-in user who has not yet picked individual-vs-business
// to /onboard? Extracted so the exemption list is unit-testable without React — same idiom as
// dashboard-nav-resolve.ts. Keep this module free of React and of Next imports.
//
// ⚠️ THE EXEMPTIONS ARE LOAD-BEARING, NOT TIDINESS. Each one is a bug that happened:
//
//  · /onboard  — gating the destination would redirect it to itself.
//  · /auth     — the callback route must finish exchanging its code before anything moves.
//  · /signin   — it owns its own post-auth redirect; gating it double-redirects and captures
//                next=/signin, dropping the user's original intent.
//  · /post     — the listing wizard is DRAFT-FIRST: a guest fills the whole form and is asked
//                to sign in only at Publish, in-dialog, specifically so the page never
//                navigates and the photos survive. Photos are File objects in memory until
//                submit-time uploadPhotos(); the localStorage draft holds 17 text fields but no
//                images, and its restore toast reads "re-add your photos". Bouncing here the
//                instant in-dialog sign-in lands (accountType is null for every brand-new
//                account, by definition) unmounted the wizard and destroyed them. On a
//                marketplace requiring three different-angle photos, with 7 real third-party
//                sellers measured 2026-07-28, that is a first listing lost.
//
// Deferring the gate costs nothing: createListingCore defaults providerType to 'individual'
// while accountType is null (core/listings.ts), the Business chip is derived LIVE from
// Profile.accountType at serialize time rather than stored, and the Services-only providerType
// facet is recomputed by withDerivedAttributes on every later edit. So an account that publishes
// before onboarding is not left mislabelled — it is relabelled the moment onboarding happens,
// which is on the seller's very next navigation.

/** Paths matched EXACTLY. See the /post note above for why this list is not a prefix list. */
const EXACT_EXEMPT = new Set(['/post'])

/** Paths matched by PREFIX, because each owns a subtree of its own routes. */
const PREFIX_EXEMPT = ['/onboard', '/auth', '/signin'] as const

/**
 * True when the onboarding redirect may fire for this pathname.
 *
 * ⚠️ EXACT BEATS PREFIX FOR NEW ENTRIES. An exemption is a hole deliberately punched in an
 * account gate, so it must never widen by accident: `/post` exact means a future `/post/<step>`
 * or `/posts` keeps the gate ON until someone decides otherwise, which is the safe direction to
 * fail. The three prefix entries are grandfathered because each genuinely owns a subtree.
 */
export function mayGateOnboarding(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  if (EXACT_EXEMPT.has(pathname) || resumesInPlace(pathname)) return false
  return !PREFIX_EXEMPT.some((prefix) => pathname.startsWith(prefix))
}

/**
 * ⛔ PAGES THAT KEEP THEIR PLACE ACROSS A SIGN-IN (owner, 2026-10-11: "after login they can resume from where they left
 * and not redirecting to home page … continue creating profile right away without distractions"). A form the visitor is
 * filling in when it asks for sign-in — the teacher sign-up form — comes back exactly where it was, whatever the method:
 *   · the one-time /onboard chooser does not interrupt it: the browser gate (mayGateOnboarding, above) and the server's
 *     finishSignInPath (src/lib/auth-finish.ts — every redirect-style sign-in and the iOS app's native Apple route) both
 *     skip the account-type step for it, and its first Publish records that step on the server — an individual account
 *     and the Terms acceptance, under the line above Publish (api/teachers/me PUT, src/lib/core/first-onboarding.ts);
 *   · the emailed sign-in is the 6-digit CODE, typed in place (sign-in-form.tsx `autoCode`): a magic link opens a new tab
 *     with an empty form;
 *   · the timed "Join eno" prompt never opens over it (src/lib/signup-prompt.ts);
 *   · a failed sign-in lands back on it (src/lib/auth-landing.ts authFailurePath), not on the home page.
 * EXACT paths (a trailing slash dropped), for the same reason as EXACT_EXEMPT above.
 */
const RESUME_IN_PLACE = new Set(['/teachers/join'])

/**
 * ⛔ AND eno CLASSROOM'S INVITE PAGES (2026-10-25): /classroom/join/<code> asks for sign-in in place, then records the account
 * step itself in the join's own transaction — an individual account and the Terms shown beside "Join"
 * (src/lib/classroom/join.ts claimSeat → first-onboarding.ts individualOnboardingWrite). A PREFIX, because the code is in
 * the path; one segment exactly — nothing deeper resumes in place.
 */
const RESUME_IN_PLACE_PREFIX = /^\/classroom\/join\/[^/]+$/

export function resumesInPlace(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return RESUME_IN_PLACE.has(p) || RESUME_IN_PLACE_PREFIX.test(p)
}
