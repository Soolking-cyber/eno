import { describe, expect, it } from 'vitest'
import { IN_APP_ONLY, inAppOnly } from './in-app-listing'

/**
 * The home page's in-app narrowing (owner, 2026-10-28). It must be the serializer's own flag — `isPartnerBooking` is
 * `Boolean(affiliateUrl)` — so null and '' both read as "dealt on eno", and it must be its own AND element: it is an OR,
 * and spreading it beside a caller's keys would overwrite the caller's own OR.
 */
describe('in-app-listing', () => {
  it('matches exactly the rows the serializer calls "not a partner booking": null and the empty string', () => {
    expect(IN_APP_ONLY).toEqual({ OR: [{ affiliateUrl: null }, { affiliateUrl: '' }] })
  })

  it('wraps, never spreads — a caller\'s own OR survives', () => {
    const where = { verified: true, OR: [{ district: 'd1' }, { district: 'd7' }] }
    expect(inAppOnly(where)).toEqual({ AND: [where, IN_APP_ONLY] })
  })
})
