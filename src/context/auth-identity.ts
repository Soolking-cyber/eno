/**
 * WHO THE VIEWER IS, AS PURE RULES — the identity logic auth-context needs, with none of React.
 *
 * ⛔ THIS FILE EXISTS BECAUSE THESE RULES SHIPPED WRONG ONCE AND MUST STAY TESTED. The provider
 * once kept `sellerId` in its own state and cleared it inside an effect. Effects run AFTER the
 * commit, so a render that already had the NEW `user` still read the PREVIOUS user's storefront
 * id — for the width of that frame an owner-only Edit control could paint on a listing belonging
 * to whoever had just signed out. codex found it on a post-deploy review.
 *
 * ⚠️ AND IT IS A SEPARATE MODULE, NOT EXPORTS ON THE PROVIDER, FOR ONE REASON: auth-context.tsx is
 * `'use client'` and pulls in next/navigation and the Supabase browser client at module scope. A
 * test importing the provider just to reach a pure comparison inherits all of that, and one
 * transitive `window` access would take the suite down for reasons having nothing to do with the
 * rules under test. Raised by external review; the rules now import clean.
 *
 * ⛔ NONE OF THIS IS A SECURITY BOUNDARY. `/listings/[id]/edit` re-proves ownership server-side and
 * must keep doing so. What these rules protect is the UI never CLAIMING an ownership it cannot
 * support — a lie whose only audience is the one person who cannot tell it is wrong.
 */

/**
 * What `/api/me` told us, and WHO it told us about. Never store any of it without the subject:
 * every field here is an answer about a specific person, and an answer without its subject is how
 * one account's identity gets read as another's.
 */
export type FetchedIdentity = {
  userId: string
  accountType: string | null
  sellerId: string | null
}

/** The shape `/api/me` returns — only the fields the auth context consumes. */
export type MeResponse = {
  user?: { id?: string; accountType?: string | null; sellerId?: string | null } | null
}

/**
 * Do we hold an answer that is ABOUT the current user? This is what `identityLoaded` means, and
 * stating it as a comparison rather than a boolean in state is what stops it being confidently
 * true about the wrong person for a frame.
 *
 * ⚠️ It was independent state until 2026-08-15, cleared in the same late effect — so on an account
 * switch the first render carried an `identityLoaded=true` belonging to the previous user. Every
 * consumer is told to gate on this flag, which makes a confidently-wrong one worse than none.
 */
export function identityIsCurrent(identity: FetchedIdentity | null, userId: string | null | undefined): boolean {
  return !!identity && !!userId && identity.userId === userId
}

/** The viewer's own storefront id — or null the moment it cannot be proven to be theirs. */
export function ownStorefrontId(identity: FetchedIdentity | null, userId: string | null | undefined): string | null {
  return identityIsCurrent(identity, userId) ? identity!.sellerId : null
}

/** The viewer's own account type — same rule, so the two can never disagree about whose answer it is. */
export function ownAccountType(identity: FetchedIdentity | null, userId: string | null | undefined): string | null {
  return identityIsCurrent(identity, userId) ? identity!.accountType : null
}

/**
 * Is this `/api/me` body an answer about the user we asked for — and if so, what does it say?
 * Returns null to mean "discard it", which leaves the context exactly as it was.
 *
 * ⛔ THE SUBJECT COMES FROM THE SERVER, NOT FROM US. The client can only stamp a response with the
 * id it BELIEVED it was asking for, and that is a guess: the request carries whatever cookies exist
 * when the server reads them, so a sign-in in another tab mid-fetch answers about the new account
 * while this page still renders the old one. Since the payload carries `sellerId`, believing it
 * would attribute one person's storefront to another.
 *
 * ⚠️ `{ user: null }` IS NOT AN ANSWER ABOUT ANYONE — IT MEANS THE SESSION IS GONE. Checked rather
 * than assumed: `getCurrentProfile()` LAZILY PROVISIONS a Profile row (src/lib/admin.ts — `if
 * (!existing) return ensureProfile(...)`), so an authenticated caller always gets a payload back.
 * A null body therefore only ever means unauthenticated, never "signed in but not onboarded".
 * Accepting it would let a sign-out in another tab stamp this viewer as loaded-with-no-account-type
 * and hand them the /onboard chooser the flag exists to keep away from an onboarded account.
 */
export function acceptedIdentity(body: MeResponse | null | undefined, askedForUserId: string): FetchedIdentity | null {
  const u = body?.user
  if (!u?.id || u.id !== askedForUserId) return null
  /**
   * ⚠️ THE FIELDS MUST BE PRESENT, NOT MERELY NULLISH — VERSION SKEW FAILS CLOSED.
   * `/api/me` always sends both keys (null when empty), so a body carrying an id but no
   * `accountType` is not "this user has no account type", it is a DIFFERENT SHAPE — an older or
   * newer deploy, or a partial response. Coercing that to null would tell an already-onboarded
   * user they have no account type, and the /onboard chooser overwrites a real one on a click.
   * Discarding costs a render; guessing costs someone their account type. Reviewer-caught.
   */
  if (!('accountType' in u) || !('sellerId' in u)) return null
  return {
    userId: u.id,
    accountType: u.accountType ?? null,
    sellerId: u.sellerId ?? null,
  }
}

/**
 * The stamp after the viewer picks an account type at /onboard.
 *
 * ⛔ ALWAYS RETURNS A STAMP FOR THE USER WHO IS SIGNED IN NOW — never a patch of whatever happened
 * to be in state. Two failures were found here, in opposite directions, both by review:
 *
 * · Patching a stamp belonging to a DIFFERENT user keeps that user's `userId`, so the new viewer's
 *   choice derives back out as null — they submit onboarding, nothing takes, and the gate sends
 *   them straight back to /onboard. A loop, from a write that "succeeded".
 * · Refusing to write when there is no stamp at all silently drops the choice whenever the identity
 *   fetch is still in flight or has failed — same loop, different cause.
 *
 * Minting for the current user covers both. `sellerId: null` is honest: onboarding precedes any
 * storefront, and the next /api/me overwrites it regardless.
 */
export function stampAccountType(prev: FetchedIdentity | null, userId: string, accountType: string): FetchedIdentity {
  return prev && prev.userId === userId
    ? { ...prev, accountType }
    : { userId, accountType, sellerId: null }
}
