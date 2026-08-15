import { describe, expect, it } from 'vitest'

import { acceptedIdentity, identityIsCurrent, ownAccountType, ownStorefrontId, stampAccountType } from './auth-identity'

/**
 * THE ONE-FRAME OWNERSHIP LEAK — pinned because it shipped, and because nothing else would catch it.
 *
 * The version in production on 2026-08-15 kept `sellerId` in its own state and cleared it inside the
 * identity effect. Effects run AFTER the commit, so a render that already had the NEW `user` still
 * read the PREVIOUS user's storefront id: for the width of that frame, the Edit pencil could paint
 * on a listing belonging to whoever had just signed out. `signOut()` was safe (it clears both in one
 * batched handler); a session change arriving through `onAuthStateChange` — a sign-out in another
 * tab, a session swap — was not. Found by codex on a post-deploy review.
 *
 * ⚠️ THE FIX IS THIS FUNCTION EXISTING AT ALL. The answer is stamped with the user it was fetched
 * for and compared during render, so a mismatch reads null in the SAME render rather than one
 * commit later. These cases fail against the old bare-state version and pass against this one,
 * which is the only reason they are worth running.
 *
 * ⛔ Still not a security boundary: /listings/[id]/edit re-proves ownership server-side. This keeps
 * the UI from making a claim it cannot support.
 */
const ME = 'user_me'
const THEM = 'user_them'
const MY_SHOP = 'seller_mine'

describe('ownStorefrontId — an answer is only valid for the user it was fetched for', () => {
  it('returns the storefront when the answer belongs to the current user', () => {
    expect(ownStorefrontId({ userId: ME, accountType: 'business', sellerId: MY_SHOP }, ME)).toBe(MY_SHOP)
  })

  it('⛔ returns null when the account changed but the answer has not caught up', () => {
    // The exact production frame: state still holds the previous user's answer, `user` is already
    // the new one. Reading MY_SHOP here is what put a pencil on a stranger's listing.
    expect(ownStorefrontId({ userId: ME, accountType: 'business', sellerId: MY_SHOP }, THEM)).toBeNull()
  })

  it('returns null once the user is gone, even if the answer lingers', () => {
    expect(ownStorefrontId({ userId: ME, accountType: 'business', sellerId: MY_SHOP }, null)).toBeNull()
    expect(ownStorefrontId({ userId: ME, accountType: 'business', sellerId: MY_SHOP }, undefined)).toBeNull()
  })

  it('returns null before /api/me has answered', () => {
    expect(ownStorefrontId(null, ME)).toBeNull()
  })

  it('returns null for a signed-in user who owns no storefront', () => {
    // ⚠️ Must stay null, not undefined: the consumer compares it against a listing's sellerId, and
    // two undefineds would read as "equal, therefore mine".
    expect(ownStorefrontId({ userId: ME, accountType: 'business', sellerId: null }, ME)).toBeNull()
  })
})

/**
 * `identityLoaded`, which every consumer is told to gate on. The failure it must not have is being
 * confidently TRUE about the wrong person: all three reviewers pointed out that leaving it as
 * independent state re-created, for `accountType`, exactly the frame the stamp had just closed for
 * `sellerId`. Deriving it means "we have an answer" and "it is about this user" are one statement.
 */
describe('identityIsCurrent — the flag every consumer gates on', () => {
  it('is true only when the held answer is about the signed-in user', () => {
    expect(identityIsCurrent({ userId: ME, accountType: 'business', sellerId: MY_SHOP }, ME)).toBe(true)
  })

  it('⛔ is false on the account-switch frame, rather than stale-true', () => {
    // The onboarding gate acts on this flag. Stale-true here is how /onboard once rendered its
    // chooser to an already-onboarded account and let a click overwrite a real account type.
    expect(identityIsCurrent({ userId: ME, accountType: 'business', sellerId: MY_SHOP }, THEM)).toBe(false)
  })

  it('is false before any answer, and false once the user is gone', () => {
    expect(identityIsCurrent(null, ME)).toBe(false)
    expect(identityIsCurrent({ userId: ME, accountType: 'business', sellerId: MY_SHOP }, null)).toBe(false)
  })

  it('is true for a signed-in user who simply has no storefront', () => {
    // "Answered, and the answer is no" — distinct from "not asked yet", which is the whole reason
    // this flag exists separately from `sellerId === null`.
    expect(identityIsCurrent({ userId: ME, accountType: 'business', sellerId: null }, ME)).toBe(true)
    expect(ownStorefrontId({ userId: ME, accountType: 'business', sellerId: null }, ME)).toBeNull()
  })
})

/**
 * THE ACCEPT RULE — which /api/me bodies are allowed to become this viewer's identity.
 *
 * ⚠️ THIS IS THE WIRING, AND THE WIRING IS WHERE THE BUG LIVED. The first fix covered the two
 * comparison helpers and left the response handling narrated in a comment; a reviewer called that
 * out, correctly. Every case below is a body this app can actually receive.
 */
describe('acceptedIdentity — a response is only mine if the server says so', () => {
  it('accepts a body whose subject is the user we asked for', () => {
    expect(acceptedIdentity({ user: { id: ME, accountType: 'business', sellerId: MY_SHOP } }, ME))
      .toEqual({ userId: ME, accountType: 'business', sellerId: MY_SHOP })
  })

  it('⛔ discards a body describing a DIFFERENT user — the cross-tab mid-fetch swap', () => {
    // Tab 2 signs in as THEM while tab 1's /api/me is in flight; the request carries whatever
    // cookies exist when the server reads them, so the answer is about THEM. Believing it would
    // hand one person's storefront to another.
    expect(acceptedIdentity({ user: { id: THEM, accountType: 'business', sellerId: 'seller_theirs' } }, ME)).toBeNull()
  })

  it('⛔ discards `{ user: null }` — that means signed out, never "not onboarded"', () => {
    // getCurrentProfile() lazily provisions a Profile, so an authenticated caller always gets a
    // payload. Accepting this body let a sign-out in another tab stamp identityLoaded=true with a
    // null accountType, which is exactly the state that shows /onboard to an onboarded account.
    expect(acceptedIdentity({ user: null }, ME)).toBeNull()
  })

  it('discards a body with no user key at all, and an empty or missing body', () => {
    expect(acceptedIdentity({}, ME)).toBeNull()
    expect(acceptedIdentity(null, ME)).toBeNull()
    expect(acceptedIdentity(undefined, ME)).toBeNull()
  })

  it('accepts an onboarding-pending account: mine, with no account type and no storefront', () => {
    // ⚠️ MUST stay accepted — this is the state the onboarding gate exists to act on, and it is
    // distinguishable from "signed out" precisely because the server named a subject.
    expect(acceptedIdentity({ user: { id: ME, accountType: null, sellerId: null } }, ME))
      .toEqual({ userId: ME, accountType: null, sellerId: null })
  })
})

/**
 * `accountType` — the last value that was still bare state outside the stamp, folded in on
 * 2026-08-15 after all three reviewers named it independently. It matters more than it looks: the
 * onboarding gate fires on `identityLoaded && !accountType`, so a value belonging to the previous
 * account, read under a true flag, is how /onboard shows its chooser to an already-onboarded user
 * and a click POSTs a fresh account type over a real one.
 */
describe('ownAccountType — the same subject rule as the storefront id', () => {
  it('returns the type when the answer is about the current user', () => {
    expect(ownAccountType({ userId: ME, accountType: 'business', sellerId: MY_SHOP }, ME)).toBe('business')
  })

  it('⛔ returns null on the account-switch frame instead of the previous account’s type', () => {
    expect(ownAccountType({ userId: ME, accountType: 'business', sellerId: MY_SHOP }, THEM)).toBeNull()
  })

  it('never disagrees with the flag or the storefront about whose answer it holds', () => {
    // The whole reason all three derive from one stamp: three values, one subject, one rule.
    const stamp = { userId: ME, accountType: 'business', sellerId: MY_SHOP }
    for (const viewer of [ME, THEM, null]) {
      const loaded = identityIsCurrent(stamp, viewer)
      expect(ownAccountType(stamp, viewer) !== null).toBe(loaded)
      expect(ownStorefrontId(stamp, viewer) !== null).toBe(loaded)
    }
  })
})

/**
 * What /onboard writes. Both failure directions below were reviewer-caught, and both produce the
 * SAME user-visible symptom — a submitted choice that does not take, so the gate sends the user
 * back to /onboard forever. A write that "succeeded" and changed nothing is the hardest kind to
 * see, which is why this rule gets a test.
 */
describe('stampAccountType — the choice always lands on the CURRENT user', () => {
  it('patches the held stamp when it is already about this user, keeping their storefront', () => {
    expect(stampAccountType({ userId: ME, accountType: null, sellerId: MY_SHOP }, ME, 'business'))
      .toEqual({ userId: ME, accountType: 'business', sellerId: MY_SHOP })
  })

  it('⛔ mints for the current user rather than patching someone else’s stamp', () => {
    // Patching would keep THEM's userId, so the value derives back out as null for ME — the
    // submitted choice silently evaporates and /onboard asks again.
    const out = stampAccountType({ userId: THEM, accountType: 'individual', sellerId: 'seller_theirs' }, ME, 'business')
    expect(out).toEqual({ userId: ME, accountType: 'business', sellerId: null })
    expect(ownAccountType(out, ME)).toBe('business')
  })

  it('⛔ mints when no answer has arrived yet, instead of dropping the choice', () => {
    // The identity fetch may still be in flight or have failed; the user's decision must survive it.
    expect(stampAccountType(null, ME, 'individual')).toEqual({ userId: ME, accountType: 'individual', sellerId: null })
  })

  it('produces a stamp the derivations immediately agree is current', () => {
    const out = stampAccountType(null, ME, 'business')
    expect(identityIsCurrent(out, ME)).toBe(true)
    expect(ownAccountType(out, ME)).toBe('business')
    expect(ownStorefrontId(out, ME)).toBeNull()
  })
})

/**
 * ⚠️ VERSION SKEW — a 200 whose SHAPE is wrong rather than whose subject is. Reviewer-caught: the
 * accept rule originally coerced a missing `accountType` to null, which reads as "this user has not
 * onboarded" and hands an already-onboarded account the /onboard chooser, where one click overwrites
 * their real answer. A body from another deploy must fail closed.
 */
describe('acceptedIdentity — a body of the wrong shape is not an answer', () => {
  it('⛔ discards a body carrying the right id but no accountType key', () => {
    expect(acceptedIdentity({ user: { id: ME, sellerId: MY_SHOP } }, ME)).toBeNull()
  })

  it('⛔ discards a body carrying the right id but no sellerId key', () => {
    expect(acceptedIdentity({ user: { id: ME, accountType: 'business' } }, ME)).toBeNull()
  })

  it('accepts explicit nulls, which are a real answer and not a missing one', () => {
    expect(acceptedIdentity({ user: { id: ME, accountType: null, sellerId: null } }, ME))
      .toEqual({ userId: ME, accountType: null, sellerId: null })
  })
})
