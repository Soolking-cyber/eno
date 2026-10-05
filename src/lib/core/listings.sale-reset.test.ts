import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── A LISTING BACK ON SALE CARRIES NO SALE (trade loop, 2026-10-05) ──────────────────────────────────
//
// Every write that moves a listing back to 'active' clears the whole cluster — the seller's claim
// (`sold*`) AND the marketplace's observation (`sale*`: the agreed price, the buyer's answer, the
// question and its per-buyer memory). Before, setStatusCore and confirmCore cleared only `sold*`, so a
// relisted bike kept its old buyer's confirmation, price and open "did you buy this?" — answerable while
// the item was for sale again. And the mark-sold write (POST /sold) puts the trade loop's columns in the
// SAME UPDATE as the status, under the caller's compare-and-swap.

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  read: null as Row | null,
  writes: [] as Row[],
  count: 1,
  afters: [] as Array<() => unknown>,
  withdrawn: [] as Row[],
  failWithdraw: false,
}))

vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      findUnique: async () => (h.read ? { ...h.read } : null),
      updateMany: async (a: Row) => { h.writes.push(a); return { count: h.count } },
      count: async () => 0,
    },
    teacherProfile: { updateMany: async () => ({ count: 0 }) },
    notification: {
      deleteMany: async (a: Row) => {
        if (h.failWithdraw) throw new Error('database unavailable')
        h.withdrawn.push(a.where)
        return { count: 1 }
      },
    },
  },
}))
vi.mock('next/server', () => ({ after: (fn: () => unknown) => { h.afters.push(fn) } }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: () => {} }))
vi.mock('@/lib/compliance/account-state', async (orig) => ({
  ...(await orig<typeof import('@/lib/compliance/account-state')>()),
  identityGateEnforced: () => false,
}))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ sellerPublishDecision: async () => ({ ok: true }), assertSellerMayPublish: async () => {} }))
vi.mock('@/lib/released-charge-gate', () => ({ releasedChargeGate: async () => null, releasedChargeStanding: async () => null, releasedChargeGateFor: async () => null }))
vi.mock('@/lib/listing-index', () => ({ reindexListing: async () => {}, removeFromIndex: async () => {} }))
vi.mock('@/lib/trust', () => ({ recordEngagement: async () => {} }))
vi.mock('@/lib/stale', () => ({ canBump: () => false }))
vi.mock('@/lib/translate', () => ({ warmTranslations: async () => {} }))
vi.mock('@/lib/webhooks', () => ({ dispatchListingEvent: async () => {}, dispatchListingEventsBatch: async () => {} }))
vi.mock('@/lib/ranking', () => ({ browseRankScore: () => 0, recomputeRankScoreForListing: async () => {} }))

const { setStatusCore, confirmCore } = await import('@/lib/core/listings')

const BUYER = '00000000-0000-4000-8000-000000000002'

/** A listing that SOLD through the trade loop: a named buyer, a price, a confirmation and the memory. */
function soldRow(status = 'sold'): Row {
  return {
    id: 'L1', status, sellerId: 's1', listingType: 'sell', soldToProfileId: status === 'active' ? null : BUYER,
    soldAt: new Date('2026-09-20'), updatedAt: new Date('2026-09-20'),
    seller: { ownerId: 'p1', owner: { enforcementState: 'good_standing' } },
    postedAt: new Date('2026-09-01'), sellerTrustScore: 100, featured: false, views: 0, contactCount: 0,
  }
}

const SALE_COLUMNS = ['soldAt', 'soldChannel', 'soldToProfileId', 'soldPlatform', 'salePrice', 'saleConfirmedAt', 'saleDeclinedAt', 'saleBuyerHistory', 'saleConfirmPromptedAt']

beforeEach(() => {
  h.read = null
  h.writes = []
  h.count = 1
  h.afters = []
  h.withdrawn = []
  h.failWithdraw = false
})
/** Run what the core deferred to after the response. */
const flushAfter = async () => { for (const fn of h.afters.splice(0)) await fn() }

/** Every "did you buy this?" row for the listing — whoever was asked (core/sale-withdraw.ts). */
const ALL_FOR_L1 = { type: 'sale_confirm', listingId: 'L1' }

describe('relist (setStatusCore → active) clears the WHOLE sale', () => {
  it('sold → active: every sold*/sale* column to null, in the same write as the status', async () => {
    h.read = soldRow('sold')
    expect(await setStatusCore('L1', 'active')).toEqual({ ok: true, status: 'active' })
    const data = h.writes[0].data
    expect(data.status).toBe('active')
    for (const col of SALE_COLUMNS) expect(data[col], col).toBeNull()
  })

  it('…and EVERY question that sale put to a buyer is withdrawn — by listing, not just the buyer the read saw', async () => {
    // A mark-sold re-attributing the sale between the read and the write would leave THAT buyer's row if
    // the withdrawal were filtered by the buyer this read saw (commit gate, 2026-10-05).
    h.read = soldRow('sold')
    await setStatusCore('L1', 'active')
    await flushAfter()
    expect(h.withdrawn).toEqual([ALL_FOR_L1])
  })

  it('⛔ the relist is CONDITIONAL on the status it read — a mark-sold landing in between makes it miss (404), the sale stands', async () => {
    h.read = soldRow('hidden')
    h.count = 0 // the row is no longer 'hidden': a sale committed after the read
    expect(await setStatusCore('L1', 'active')).toEqual({ ok: false, code: 404, error: 'not_found' })
    expect(h.writes[0].where).toEqual({ id: 'L1', status: { not: 'removed', equals: 'hidden' } })
    await flushAfter()
    expect(h.withdrawn).toEqual([])
  })

  it('an active → active re-send (the partner sync re-sends every row) is guarded the same way and withdraws nothing', async () => {
    h.read = soldRow('active')
    expect(await setStatusCore('L1', 'active')).toEqual({ ok: true, status: 'active' })
    expect(h.writes[0].where).toEqual({ id: 'L1', status: { not: 'removed', equals: 'active' } })
    await flushAfter()
    expect(h.withdrawn).toEqual([])
  })

  it('a withdrawal that fails never fails the relist (best-effort, after the response)', async () => {
    h.read = soldRow('sold')
    h.failWithdraw = true
    expect(await setStatusCore('L1', 'active')).toEqual({ ok: true, status: 'active' })
    // The deferred delete throwing is swallowed (and logged) — never an unhandled rejection.
    await expect(flushAfter()).resolves.toBeUndefined()
    expect(h.withdrawn).toEqual([])
  })

  it('sold → hidden → active: the same (hiding keeps the sale; only a return to active ends it)', async () => {
    h.read = soldRow('hidden')
    await setStatusCore('L1', 'active')
    for (const col of SALE_COLUMNS) expect(h.writes[0].data[col], col).toBeNull()
    await flushAfter()
    expect(h.withdrawn).toEqual([ALL_FOR_L1])
  })

  it('a HIDE does not touch the trade loop\'s columns (the sale stands while the listing is off the feed)', async () => {
    h.read = soldRow('sold')
    await setStatusCore('L1', 'hidden')
    for (const col of SALE_COLUMNS.filter((c) => c !== 'soldAt')) expect(h.writes[0].data).not.toHaveProperty(col)
    expect(h.writes[0].where).toEqual({ id: 'L1', status: { not: 'removed' } })
    await flushAfter()
    expect(h.withdrawn).toEqual([])
  })
})

describe('revive (confirmCore on a sold listing) clears the WHOLE sale', () => {
  it('sold → active through "still available": every sold*/sale* column to null, and every question withdrawn', async () => {
    h.read = soldRow('sold')
    expect(await confirmCore('L1', 'p1')).toEqual({ ok: true, bumped: false })
    const data = h.writes[0].data
    expect(data.status).toBe('active')
    for (const col of SALE_COLUMNS) expect(data[col], col).toBeNull()
    expect(data.marketPosition).toBeNull()
    expect(h.writes[0].where).toEqual({ id: 'L1', status: { not: 'removed', equals: 'sold' } })
    await flushAfter()
    expect(h.withdrawn).toEqual([ALL_FOR_L1])
  })

  it('an ordinary confirm on a live listing touches no sale and withdraws nothing', async () => {
    h.read = soldRow('active')
    await confirmCore('L1', 'p1')
    for (const col of SALE_COLUMNS) expect(h.writes[0].data).not.toHaveProperty(col)
    expect(h.writes[0].data).not.toHaveProperty('marketPosition')
    await flushAfter()
    expect(h.withdrawn).toEqual([])
  })

  it('⛔ …and it is CONDITIONAL on the status it read: a mark-sold landing in between makes it miss (404) — never an active listing holding a sale', async () => {
    // confirmCore decides `wasInactive` from its read. Unguarded, a POST /sold committing in between turned
    // the ordinary confirm into a silent revive that kept the buyer, the price and the open question.
    h.read = soldRow('active')
    h.count = 0
    expect(await confirmCore('L1', 'p1')).toEqual({ ok: false, code: 404, error: 'not_found' })
    expect(h.writes[0].where).toEqual({ id: 'L1', status: { not: 'removed', equals: 'active' } })
    await flushAfter()
    expect(h.withdrawn).toEqual([])
  })
})

describe('mark sold WITH the trade loop (POST /sold → setStatusCore soldMeta.sale / soldMeta.expect)', () => {
  const sale = {
    salePrice: 11_000_000,
    saleConfirmedAt: null,
    saleDeclinedAt: null,
    saleBuyerHistory: JSON.stringify([{ i: BUYER, a: 1, p: 11_000_000, n: 1 }]),
    saleConfirmPromptedAt: new Date('2026-10-05T01:00:00Z'),
  }

  it('the sale columns ride in the SAME UPDATE as the status and the attribution', async () => {
    h.read = soldRow('active')
    await setStatusCore('L1', 'sold', { channel: 'eno', buyerProfileId: BUYER, platform: null, sale })
    expect(h.writes).toHaveLength(1)
    expect(h.writes[0].data).toMatchObject({ status: 'sold', soldChannel: 'eno', soldToProfileId: BUYER, ...sale })
  })

  it('⚠️ the soldAt rule is setStatusCore\'s, unchanged: a re-mark of a sold row keeps the original sale time', async () => {
    h.read = soldRow('sold')
    await setStatusCore('L1', 'sold', { channel: 'eno', buyerProfileId: BUYER, platform: null, sale })
    expect(h.writes[0].data.soldAt).toEqual(new Date('2026-09-20'))
  })

  it('the caller\'s compare-and-swap is ANDed beside the tombstone guard — it can never replace it', async () => {
    h.read = soldRow('active')
    const expect_ = { status: 'active', saleBuyerHistory: null }
    await setStatusCore('L1', 'sold', { channel: 'eno', buyerProfileId: BUYER, platform: null, sale, expect: expect_ })
    expect(h.writes[0].where).toEqual({ AND: [{ id: 'L1', status: { not: 'removed' } }, expect_] })
  })

  it('a missed swap is not_found — the caller re-reads to tell a race from a tombstone', async () => {
    h.read = soldRow('active')
    h.count = 0
    expect(await setStatusCore('L1', 'sold', { channel: 'eno', buyerProfileId: BUYER, platform: null, sale, expect: { status: 'active' } }))
      .toEqual({ ok: false, code: 404, error: 'not_found' })
  })

  it('without the loop (the plain /status path) nothing changes: no sale columns, the old WHERE', async () => {
    h.read = soldRow('active')
    await setStatusCore('L1', 'sold')
    expect(h.writes[0].where).toEqual({ id: 'L1', status: { not: 'removed' } })
    for (const col of ['salePrice', 'saleConfirmedAt', 'saleDeclinedAt', 'saleBuyerHistory', 'saleConfirmPromptedAt']) {
      expect(h.writes[0].data).not.toHaveProperty(col)
    }
  })
})
