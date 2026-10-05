import { describe, expect, it } from 'vitest'
import {
  REACTIVATION_SALE_RESET,
  isGoodsSale,
  markSoldAsks,
  validateMarkSold,
  type MarkSoldContext,
  type SaleFacts,
} from './trade-loop'

/**
 * The three pieces trade-loop.ts gained when the buyer's half was wired (2026-10-05): the "was the buyer
 * just asked?" signal the mark-sold route notifies on, the one goods-sale rule the sheet and the question
 * share, and the column set every reactivation clears. The machine itself is pinned in trade-loop.test.ts.
 */

const SELLER = '00000000-0000-4000-8000-000000000001'
const BUYER = '00000000-0000-4000-8000-000000000002'
const at = (ms: number) => new Date(Date.UTC(2026, 9, 1) + ms)
const HOUR = 3_600_000

const facts = (over: Partial<SaleFacts> = {}): SaleFacts => ({
  status: 'active', complianceStatus: 'clear', soldChannel: null, soldToProfileId: null, soldAt: null,
  salePrice: null, saleConfirmedAt: null, saleDeclinedAt: null, saleBuyerHistory: null, saleConfirmPromptedAt: null,
  ...over,
})
const ctx = (f: SaleFacts, now: Date): MarkSoldContext => ({
  actorProfileId: SELLER, sellerProfileId: SELLER, askingPrice: 12_000_000,
  conversationBuyerProfileIds: [BUYER], facts: f, now,
})

describe('markSoldAsks — did THIS mark-sold send the buyer a question?', () => {
  it('the first naming asks', () => {
    const now = at(0)
    const f = facts()
    const r = validateMarkSold({ channel: 'eno', buyerProfileId: BUYER, salePrice: 11_000_000 }, ctx(f, now))
    expect(r.ok && markSoldAsks(r.patch, f)).toBe(true)
  })

  it('⛔ a re-tap of the SAME answer asks nobody — the double tap that must not notify twice', () => {
    const t0 = at(0)
    const first = validateMarkSold({ channel: 'eno', buyerProfileId: BUYER, salePrice: 11_000_000 }, ctx(facts(), t0))
    if (!first.ok) throw new Error('first mark refused')
    const t1 = at(HOUR)
    const before = facts({ ...first.patch, status: 'sold' })
    const again = validateMarkSold({ channel: 'eno', buyerProfileId: BUYER, salePrice: 11_000_000 }, ctx(before, t1))
    expect(again.ok && markSoldAsks(again.patch, before)).toBe(false)
  })

  it('⛔ …EVEN IN THE SAME MILLISECOND — the stamp carried through then equals `now`, and must not read as an ask', () => {
    const t0 = at(0)
    const first = validateMarkSold({ channel: 'eno', buyerProfileId: BUYER, salePrice: 11_000_000 }, ctx(facts(), t0))
    if (!first.ok) throw new Error('first mark refused')
    const before = facts({ ...first.patch, status: 'sold' })
    const again = validateMarkSold({ channel: 'eno', buyerProfileId: BUYER, salePrice: 11_000_000 }, ctx(before, t0))
    if (!again.ok) throw new Error('re-tap refused')
    expect(again.patch.saleConfirmPromptedAt?.getTime()).toBe(t0.getTime()) // the trap: same instant
    expect(markSoldAsks(again.patch, before)).toBe(false)
  })

  it('a corrected PRICE re-asks (the buyer must never confirm a number they were not shown)', () => {
    const t0 = at(0)
    const first = validateMarkSold({ channel: 'eno', buyerProfileId: BUYER, salePrice: 11_000_000 }, ctx(facts(), t0))
    if (!first.ok) throw new Error('first mark refused')
    const t1 = at(HOUR)
    const before = facts({ ...first.patch, status: 'sold' })
    const fixed = validateMarkSold({ channel: 'eno', buyerProfileId: BUYER, salePrice: 10_500_000 }, ctx(before, t1))
    expect(fixed.ok && markSoldAsks(fixed.patch, before)).toBe(true)
  })

  it('an off-eno or unattributed sale asks nobody', () => {
    const now = at(0)
    for (const input of [{ channel: 'external' as const }, { channel: null }]) {
      const f = facts()
      const r = validateMarkSold({ ...input, salePrice: 11_000_000 }, ctx(f, now))
      expect(r.ok && markSoldAsks(r.patch, f)).toBe(false)
    }
  })
})

describe('isGoodsSale — the ONE rule for "Who bought it?" and for asking a buyer', () => {
  it('sell, wholesale, free (a giveaway), and the column default', () => {
    for (const listingType of ['sell', 'wholesale', 'free', null, undefined]) expect(isGoodsSale({ listingType })).toBe(true)
  })
  it('⛔ never a tenancy, a hire, a teacher, a service, an event, a "wanted" post, a rentals row or a free community post', () => {
    for (const listingType of ['rent', 'job', 'teacher', 'service', 'event', 'wanted']) expect(isGoodsSale({ listingType })).toBe(false)
    expect(isGoodsSale({ listingType: 'sell', categorySlug: 'rentals' })).toBe(false)
    expect(isGoodsSale({ listingType: 'free', categorySlug: 'community-events' })).toBe(false)
  })
})

describe('REACTIVATION_SALE_RESET — a relist clears the WHOLE sale', () => {
  it('every sold*/sale* column SaleFacts reads (plus soldPlatform, which it does not), each one to null — the seller\'s claim AND the observation', () => {
    const saleColumns = (Object.keys(facts()) as (keyof SaleFacts)[]).filter((k) => k !== 'status' && k !== 'complianceStatus')
    expect(Object.keys(REACTIVATION_SALE_RESET).sort()).toEqual([...saleColumns, 'soldPlatform'].sort())
    expect(Object.values(REACTIVATION_SALE_RESET).every((v) => v === null)).toBe(true)
  })

  it('⛔ including saleBuyerHistory: carried over, the old buyer\'s entry would make the NEXT sale to them a dead end', () => {
    // The previous sale: buyer asked a month ago, and they confirmed.
    const t0 = at(0)
    const first = validateMarkSold({ channel: 'eno', buyerProfileId: BUYER, salePrice: 11_000_000 }, ctx(facts(), t0))
    if (!first.ok) throw new Error('first mark refused')
    const later = at(40 * 24 * HOUR)
    const relistedKeepingHistory = facts({ saleBuyerHistory: first.patch.saleBuyerHistory })
    // With the memory kept, a new sale to the same person at a new price is refused (their window closed
    // weeks ago) — the shape this constant prevents.
    const kept = validateMarkSold({ channel: 'eno', buyerProfileId: BUYER, salePrice: 9_000_000 }, ctx(relistedKeepingHistory, later))
    expect(kept).toEqual({ ok: false, reason: 'ask_budget_exhausted' })
    // Cleared, it is simply a new sale, and they are asked about it.
    const fresh = facts({ ...REACTIVATION_SALE_RESET })
    const cleared = validateMarkSold({ channel: 'eno', buyerProfileId: BUYER, salePrice: 9_000_000 }, ctx(fresh, later))
    expect(cleared.ok && markSoldAsks(cleared.patch, fresh)).toBe(true)
  })
})
