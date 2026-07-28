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
  if (EXACT_EXEMPT.has(pathname)) return false
  return !PREFIX_EXEMPT.some((prefix) => pathname.startsWith(prefix))
}
