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
