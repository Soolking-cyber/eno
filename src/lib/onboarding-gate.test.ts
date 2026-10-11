import { describe, expect, it } from 'vitest'
import { mayGateOnboarding, resumesInPlace } from './onboarding-gate'

/**
 * The onboarding redirect's exemption list. Every case here is a defect that reached production
 * or a regression the exemption exists to prevent — this file is the reason none of them can be
 * removed as "an unnecessary special case".
 */

describe('the gate fires on ordinary routes', () => {
  it.each(['/', '/listings/abc', '/saved', '/messages', '/dashboard', '/dashboard/listings', '/help'])(
    'gates %s', (path) => expect(mayGateOnboarding(path)).toBe(true),
  )

  it('does not fire without a pathname — never bounce on a not-yet-resolved route', () => {
    expect(mayGateOnboarding(null)).toBe(false)
    expect(mayGateOnboarding(undefined)).toBe(false)
    expect(mayGateOnboarding('')).toBe(false)
  })
})

describe('⚠️ /post is exempt, and this is the test that keeps it that way', () => {
  it('never gates the listing wizard', () => {
    // The wizard is draft-first: the seller fills everything as a guest and signs in IN-DIALOG at
    // Publish, so the page does not navigate and the in-memory photos survive. A bounce here
    // unmounts it and the photos are gone — the localStorage draft holds text only, which is why
    // its restore toast says "re-add your photos". Deleting this line deletes first listings.
    expect(mayGateOnboarding('/post')).toBe(false)
  })

  it('does NOT widen to look-alike routes — the exemption is exact, not a prefix', () => {
    // A reviewer flagged the original `startsWith('/post')` as over-broad. An exemption is a hole
    // in an account gate; it must fail toward gating, never away from it.
    for (const path of ['/posts', '/poster', '/post-success', '/post/manage', '/postings'])
      expect(mayGateOnboarding(path)).toBe(true)
  })
})

describe('the three grandfathered prefix exemptions', () => {
  it('skips the destination itself, or it would redirect to itself', () => {
    expect(mayGateOnboarding('/onboard')).toBe(false)
    expect(mayGateOnboarding('/onboard?next=%2Fsaved')).toBe(false)
  })

  it('skips the auth callback so it can finish exchanging its code', () => {
    expect(mayGateOnboarding('/auth/callback')).toBe(false)
  })

  it('skips /signin, which owns its own post-auth redirect', () => {
    // Gating it double-redirects and captures next=/signin, dropping the user's original intent.
    expect(mayGateOnboarding('/signin')).toBe(false)
    expect(mayGateOnboarding('/signin/verify')).toBe(false)
  })
})

// ── Pages that keep their place across a sign-in (owner, 2026-10-11: the teacher form) ──────────────────────────────────
describe('resumesInPlace — the teacher sign-up form keeps its place', () => {
  it('is exactly /teachers/join (a trailing slash dropped) — never a look-alike, never the edit form', () => {
    expect(resumesInPlace('/teachers/join')).toBe(true)
    expect(resumesInPlace('/teachers/join/')).toBe(true)
    expect(resumesInPlace('/teachers/joinx')).toBe(false)
    expect(resumesInPlace('/teachers/join/extra')).toBe(false)
    expect(resumesInPlace('/teachers/edit')).toBe(false)
    expect(resumesInPlace('/')).toBe(false)
    expect(resumesInPlace(null)).toBe(false)
  })
  it('so the browser onboarding gate never bounces it to /onboard', () => {
    expect(mayGateOnboarding('/teachers/join')).toBe(false)
    expect(mayGateOnboarding('/teachers/edit')).toBe(true)
  })
})
