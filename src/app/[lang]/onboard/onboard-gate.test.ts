import { describe, expect, it } from 'vitest'

/**
 * THE ONBOARDING GATE — "should this user be shown the account-type chooser?"
 *
 * ⚠️ WRITTEN FROM A LIVE DEFECT (owner, 2026-07-27): signed in, `accountType: 'business'`, a real
 * storefront — and the "How will you use eno.vn?" chooser on screen. The cause is that
 * `accountType === null` carries TWO meanings that need opposite handling:
 *
 *   · "this user has not onboarded"   → show the chooser
 *   · "we have not asked /api/me yet" → show nothing, we do not know
 *
 * `loading` cannot separate them: it is the SESSION's flag and flips false the moment Supabase
 * resolves, while the identity fetch is still in flight. So every term in the old condition
 * (`loading || !user || accountType`) was false for an onboarded user mid-fetch, and the card
 * rendered. Choosing in that window POSTs a fresh account type over an existing one — a business
 * silently downgraded to an individual.
 *
 * The rule is therefore: show the chooser ONLY when identity is KNOWN and says the user has none.
 * Fail closed on every uncertain state. This mirrors the auth context's own gate, which already
 * waited on `identityLoaded` — the two now agree.
 */

/** Exactly the predicate both the effect and the render branch encode. */
export function shouldShowAccountTypeChooser(s: {
  loading: boolean
  identityLoaded: boolean
  user: unknown | null
  accountType: string | null
}): boolean {
  if (s.loading || !s.identityLoaded) return false
  if (!s.user) return false
  return !s.accountType
}

const USER = { id: 'u1' }

describe('the chooser appears only when identity is known AND absent', () => {
  it('THE REGRESSION: an onboarded business mid-identity-fetch sees NOTHING', () => {
    // The owner's exact state on 2026-07-27: session resolved, /api/me still in flight.
    expect(shouldShowAccountTypeChooser({
      loading: false, identityLoaded: false, user: USER, accountType: null,
    })).toBe(false)
  })

  it('and still sees nothing once identity arrives saying "business"', () => {
    expect(shouldShowAccountTypeChooser({
      loading: false, identityLoaded: true, user: USER, accountType: 'business',
    })).toBe(false)
  })

  it('a genuinely new user — identity KNOWN and empty — does see it', () => {
    expect(shouldShowAccountTypeChooser({
      loading: false, identityLoaded: true, user: USER, accountType: null,
    })).toBe(true)
  })

  it('a guest never sees it, however identity resolved', () => {
    for (const identityLoaded of [false, true]) {
      expect(shouldShowAccountTypeChooser({
        loading: false, identityLoaded, user: null, accountType: null,
      })).toBe(false)
    }
  })

  it('nothing renders while the session itself is still loading', () => {
    expect(shouldShowAccountTypeChooser({
      loading: true, identityLoaded: true, user: USER, accountType: null,
    })).toBe(false)
  })

  it('fails CLOSED when /api/me never answers — the fail-open path in auth-context', () => {
    // On a transient /api/me error the context deliberately leaves identityLoaded false forever.
    // That must mean "never show the chooser", not "assume they need onboarding": guessing wrong
    // here overwrites a real account type.
    expect(shouldShowAccountTypeChooser({
      loading: false, identityLoaded: false, user: USER, accountType: 'individual',
    })).toBe(false)
    expect(shouldShowAccountTypeChooser({
      loading: false, identityLoaded: false, user: USER, accountType: null,
    })).toBe(false)
  })

  it('`loading` alone is NOT sufficient — the exact hole that shipped', () => {
    // The old predicate, restated: it ignored identityLoaded entirely.
    const old = (s: { loading: boolean; user: unknown | null; accountType: string | null }) =>
      !(s.loading || !s.user || s.accountType)
    const ownerMidFetch = { loading: false, user: USER, accountType: null }
    expect(old(ownerMidFetch)).toBe(true) // ← what the owner saw
    expect(shouldShowAccountTypeChooser({ ...ownerMidFetch, identityLoaded: false })).toBe(false)
  })
})

/**
 * ⚠️ THE SECOND HALF, FOUND BY EXTERNAL REVIEW (agy) AFTER THE FIRST FIX SHIPPED.
 *
 * Gating on `identityLoaded` is only sound if that flag is reset whenever the identity being
 * loaded CHANGES. The effect that loads it re-runs on every `user` change — an account switch, a
 * token or metadata refresh — and none of those pass through a falsy `user`, so the original code
 * (which reset only on sign-out) left `identityLoaded` TRUE across the gap while `accountType`
 * still held the PREVIOUS user's answer. A consumer then reads a confidently stale value, which is
 * strictly worse than reading an obviously unloaded one: if the stale answer was null and the
 * incoming user is onboarded, the chooser renders and a click overwrites a real account type.
 *
 * The fix is `setIdentityLoaded(false)` at the START of each load. These pin the property that
 * makes it correct: identity is "known" only for the user it was actually fetched for.
 */
describe('identity is known only for the user it was fetched for', () => {
  /** What the provider holds while a NEW user's /api/me is still in flight. */
  const midSwitch = (previousAnswer: string | null) => ({
    loading: false,
    identityLoaded: false, // ← reset at the start of the load; without it this stayed true
    user: { id: 'the-new-user' },
    accountType: previousAnswer, // still the OLD user's answer until the fetch resolves
  })

  it('shows nothing mid-switch even when the previous answer was null', () => {
    expect(shouldShowAccountTypeChooser(midSwitch(null))).toBe(false)
  })

  it('shows nothing mid-switch when the previous answer was a real type', () => {
    expect(shouldShowAccountTypeChooser(midSwitch('business'))).toBe(false)
  })

  it('would have rendered the chooser had the flag NOT been reset — the defect, pinned', () => {
    const notReset = { ...midSwitch(null), identityLoaded: true }
    expect(shouldShowAccountTypeChooser(notReset)).toBe(true)
  })
})

/**
 * ⛔ THE GUEST HALF — AND IT MUST NOT WAIT FOR IDENTITY (found on prod 2026-09-29: a guest on /onboard
 * sat on the loader for 8s+ and never left). `identityLoaded` can only ever be true for a USER
 * (identityIsCurrent needs a userId), so an effect that returned early on `!identityLoaded` before
 * testing `!user` had no path out for a guest. The rule the effect now encodes, in this order: the
 * session's own `loading` is the only thing a guest waits for.
 */
export function guestShouldLeave(s: { loading: boolean; user: unknown | null }): boolean {
  return !s.loading && !s.user
}

describe('a guest on /onboard is sent on, without waiting for an identity that never comes', () => {
  it('THE REGRESSION: loading false, identity never loaded, no user → leaves', () => {
    expect(guestShouldLeave({ loading: false, user: null })).toBe(true)
    // …while the chooser stays hidden for the same state, so the loader shows during the redirect.
    expect(shouldShowAccountTypeChooser({ loading: false, identityLoaded: false, user: null, accountType: null })).toBe(false)
  })

  it('does not leave while the session is still resolving — a signed-in user may be about to appear', () => {
    expect(guestShouldLeave({ loading: true, user: null })).toBe(false)
  })

  it('never sends a signed-in user away, whatever identity says', () => {
    expect(guestShouldLeave({ loading: false, user: USER })).toBe(false)
  })
})
