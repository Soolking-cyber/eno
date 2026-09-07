import { describe, it, expect } from 'vitest'
import { listingIsViewable } from './get-listing'

/**
 * ⛔ THIS IS THE RULE THAT WAS WRONG. The first cut of the soft-404 fix had `layout.tsx` 404 only
 * when the listing did not EXIST, which let a hidden / unverified / held row through to the page —
 * where the policy guard runs below the loading boundary and produces exactly the soft-404 (200 +
 * not-found UI) the fix was written to remove. Measured on production 2026-09-07: a hidden listing
 * answered 200. Three reviewers found it independently, from the diff alone.
 *
 * ⚠️ IT MUST STAY IN STEP WITH `page.tsx`'s GUARD, which is the authority. If that guard changes,
 * this fails, and that is the intended coupling — the two disagreeing is what the bug WAS.
 */
describe('listingIsViewable', () => {
  it('⛔ REJECTS hidden, held AND unverified — the states that used to soft-404', () => {
    expect(listingIsViewable({ verified: true, status: 'hidden' })).toBe(false)
    expect(listingIsViewable({ verified: true, status: 'held' })).toBe(false)
    expect(listingIsViewable({ verified: false, status: 'active' })).toBe(false)
    expect(listingIsViewable({ verified: false, status: 'sold' })).toBe(false)
  })

  // ⚠️ `sold` IS VIEWABLE, deliberately — it renders its own on-brand "this item has been sold"
  // page rather than a 404, so the layout must not reject it or that page becomes unreachable.
  it('⚠️ ACCEPTS sold — it has its own page and must not 404', () => {
    expect(listingIsViewable({ verified: true, status: 'sold' })).toBe(true)
  })

  it('accepts a live listing and rejects a missing row', () => {
    expect(listingIsViewable({ verified: true, status: 'active' })).toBe(true)
    expect(listingIsViewable(null)).toBe(false)
  })

  it('rejects any unrecognised status rather than defaulting open', () => {
    for (const status of ['', 'draft', 'expired', 'removed', 'pending']) {
      expect(listingIsViewable({ verified: true, status }), status).toBe(false)
    }
  })
})
