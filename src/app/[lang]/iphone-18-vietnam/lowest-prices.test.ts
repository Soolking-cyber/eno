import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The two reads behind the iPhone price tables (lowest-prices.ts): the NEW table's sibling read (2026-11-26) — the three shops'
 * new units, one row per (model, storage tier), ties settled by the shop's name then the id — and the used read's `tracked`
 * widening to an eno-run partner's Buy now. The database is faked; every other module (the taxonomy, the price guard, the
 * new-Apple predicate, partner-buy) is the real one.
 */
const h = vi.hoisted(() => ({
  used: [] as Record<string, unknown>[],
  fresh: [] as Record<string, unknown>[],
  fail: false,
  wheres: [] as Record<string, unknown>[],
}))
vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        h.wheres.push(where)
        if (h.fail) throw new Error('fake db: unreachable')
        return where.condition === 'new' ? h.fresh : h.used
      },
    },
  },
}))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: unknown) => w }))

import { cheapestPerModel, lowestNewPrices, lowestPrices, newPriceWhere } from './lowest-prices'
import { NEW_APPLE_PREFIX, NEW_APPLE_SHOPS } from '@/lib/new-apple'

const [SHOPDUNK, CELLPHONES, HOANGHA] = NEW_APPLE_SHOPS
let n = 0
const fresh = (title: string, price: number, shop = SHOPDUNK, over: Record<string, unknown> = {}) => ({
  id: `n${String(++n).padStart(3, '0')}`, title, titleVi: null, price, currency: '₫',
  model: title.match(/^iPhone (18 Pro Max|18 Pro|Duo)/)?.[0] ?? null,
  images: JSON.stringify([`https://sb.eno.vn/a/${n}.webp`]), sellerId: shop.sellerId, seller: { name: shop.name }, ...over,
})

// CellphoneS's pinned eno-run pair (src/lib/eno-run-partners.ts): its rows earn through the chat's Buy now.
const CPS_PAIR = { sellerId: 'cmt78nvif0000gpq48kvzmxjw', ownerId: 'a7dcc001-3521-4732-a07b-fda02d50b3b6' }
const LINK = 'https://go.isclix.com/deep_link/7053736680188167797/6259155740535091857?url=https%3A%2F%2Fcellphones.com.vn%2Fx'
const used = (id: string, price: number, over: Record<string, unknown> = {}) => ({
  id, title: 'iPhone 18 Pro 256GB cũ đẹp', titleVi: null, price, currency: '₫', model: 'iPhone 18 Pro',
  affiliateUrl: null, images: '[]', status: 'active', verified: true, sellerId: 'some-shop',
  seller: { name: 'Minh Tuấn Mobile', ownerId: null, officialPartner: false }, purchaseLink: null, ...over,
})
const viaBuyNow = { sellerId: CPS_PAIR.sellerId, seller: { name: 'CellphoneS', ownerId: CPS_PAIR.ownerId, officialPartner: true }, purchaseLink: { url: LINK } }

beforeEach(() => {
  h.used = []
  h.fresh = []
  h.fail = false
  h.wheres = []
})

describe('lowestNewPrices — the new table', () => {
  it('zero rows → known, empty: "none listed", which the tables print as nothing', async () => {
    expect(await lowestNewPrices()).toEqual({ rows: [], known: true })
  })

  it('a failed read → NOT known: never reported as none listed', async () => {
    h.fail = true
    expect(await lowestNewPrices()).toEqual({ rows: [], known: false })
  })

  it('reads ONLY the three shops’ new: rows — exact condition, the namespace, the pinned ids, the phones shelf, no ownerless arm', async () => {
    await lowestNewPrices()
    const where = h.wheres[0]
    expect(where).toMatchObject({
      status: 'active', verified: true, listingType: 'sell', condition: 'new', brandSlug: 'apple', currency: '₫',
      subcategorySlug: 'phones-tablets',
      externalId: { startsWith: NEW_APPLE_PREFIX },
      sellerId: { in: NEW_APPLE_SHOPS.map((s) => s.sellerId) },
      model: { in: ['iPhone 18 Pro Max', 'iPhone 18 Pro', 'iPhone Duo'] },
    })
    expect(where).not.toHaveProperty('seller')
    expect(JSON.stringify(where)).not.toMatch(/like_new|contains/)
  })

  it('keeps only the iPhone lines in the model filter (a Mac or an iPhone 17 is never this table’s)', () => {
    expect(newPriceWhere(['iPhone 18 Pro', 'iPhone 17 Pro', 'MacBook Neo']).model).toEqual({ in: ['iPhone 18 Pro'] })
  })

  it('one row per (model, storage tier): the cheapest live unit, `offers` = the tier’s size, `ceiling` = its dearest', async () => {
    h.fresh = [
      fresh('iPhone 18 Pro 512GB', 44_490_000, CELLPHONES),
      fresh('iPhone 18 Pro 256GB', 38_999_000, CELLPHONES),
      fresh('iPhone 18 Pro 256GB', 37_990_000, SHOPDUNK),
      fresh('iPhone 18 Pro 256GB', 38_490_000, HOANGHA),
      fresh('iPhone 18 Pro Max 256GB', 41_999_000, HOANGHA),
      fresh('iPhone Duo 1TB', 84_499_000, SHOPDUNK),
    ]
    const { rows, known } = await lowestNewPrices()
    expect(known).toBe(true)
    expect(rows.map((r) => [r.model, r.storage, r.price, r.seller, r.offers, r.ceiling])).toEqual([
      ['iPhone 18 Pro', '256GB', 37_990_000, 'ShopDunk', 3, 38_999_000],
      ['iPhone 18 Pro', '512GB', 44_490_000, 'CellphoneS', 1, 44_490_000],
      ['iPhone 18 Pro Max', '256GB', 41_999_000, 'Hoàng Hà Mobile', 1, 41_999_000],
      ['iPhone Duo', '1TB', 84_499_000, 'ShopDunk', 1, 84_499_000],
    ])
    for (const r of rows) {
      expect(r.condition).toBe('new')
      // ⛔ Every new row earns through the shop's Buy now: the disclosure shows whenever one is quoted.
      expect(r.tracked).toBe(true)
      expect(r.currency).toBe('₫')
    }
  })

  it('a tie at one price goes to the shop’s NAME (CellphoneS, Hoàng Hà, ShopDunk) — never to what it pays — whatever order the database returns', async () => {
    const rowsAt = [fresh('iPhone 18 Pro 256GB', 38_999_000, HOANGHA), fresh('iPhone 18 Pro 256GB', 38_999_000, CELLPHONES), fresh('iPhone 18 Pro 256GB', 38_999_000, SHOPDUNK)]
    for (const order of [rowsAt, [...rowsAt].reverse(), [rowsAt[1], rowsAt[2], rowsAt[0]]]) {
      h.fresh = order
      const [row] = (await lowestNewPrices()).rows
      expect(row).toMatchObject({ seller: 'CellphoneS', listingId: rowsAt[1].id, offers: 3 })
    }
    h.fresh = [rowsAt[0], rowsAt[2]]
    expect((await lowestNewPrices()).rows[0].seller).toBe('Hoàng Hà Mobile')
  })

  it('a tie inside one shop goes to the lower listing id — the same row on every render', async () => {
    const a = fresh('iPhone 18 Pro 256GB', 38_999_000, SHOPDUNK, { id: 'b-second' })
    const b = fresh('iPhone 18 Pro 256GB', 38_999_000, SHOPDUNK, { id: 'a-first' })
    for (const order of [[a, b], [b, a]]) {
      h.fresh = order
      expect((await lowestNewPrices()).rows[0].listingId).toBe('a-first')
    }
  })

  it('the rank never outranks a cheaper price', async () => {
    h.fresh = [fresh('iPhone 18 Pro 256GB', 38_999_000, SHOPDUNK), fresh('iPhone 18 Pro 256GB', 38_490_000, HOANGHA)]
    expect((await lowestNewPrices()).rows[0]).toMatchObject({ seller: 'Hoàng Hà Mobile', price: 38_490_000 })
  })

  it('the price guard drops a typo either way, and an accessory or a title with no tier never makes a row', async () => {
    h.fresh = [
      fresh('iPhone 18 Pro 256GB', 3_899_000, SHOPDUNK), // a dropped digit — below 0.3 × Apple's price
      fresh('iPhone 18 Pro 256GB', 389_990_000, CELLPHONES), // an extra one
      fresh('iPhone 18 Pro 256GB', 38_999_000, HOANGHA),
      fresh('Ốp lưng iPhone 18 Pro 256GB', 590_000, SHOPDUNK, { model: 'iPhone 18 Pro' }),
      fresh('iPhone 18 Pro', 38_000_000, SHOPDUNK),
    ]
    const { rows } = await lowestNewPrices()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ storage: '256GB', price: 38_999_000, seller: 'Hoàng Hà Mobile', offers: 1 })
  })

  it('a separate market from the used table: its yardstick is its own rows, so Apple’s price is never an outlier', async () => {
    h.fresh = [fresh('iPhone 18 Pro 256GB', 38_999_000), fresh('iPhone 18 Pro 256GB', 38_999_000, CELLPHONES), fresh('iPhone 18 Pro 1TB', 57_999_000)]
    h.used = [used('u1', 30_000_000), used('u2', 30_500_000), used('u3', 31_000_000)]
    const [newRows, usedRows] = await Promise.all([lowestNewPrices(), lowestPrices(['iPhone 18 Pro'])])
    expect(newRows.rows.map((r) => r.price)).toEqual([38_999_000, 57_999_000])
    expect(usedRows.rows.map((r) => [r.price, r.condition])).toEqual([[30_000_000, 'used']])
  })
})

describe('lowestPrices — the used table, `tracked` widened to the chat’s Buy now', () => {
  it('reads second-hand rows only: never condition "new", so no row is in both tables', async () => {
    await lowestPrices(['iPhone 18 Pro'])
    const where = h.wheres[0]
    expect(where.condition).toBeUndefined()
    expect(JSON.stringify(where.AND)).toContain('"NOT"')
  })

  it('an eno-run partner’s row with an AccessTrade purchase link is tracked — its public affiliateUrl is null', async () => {
    h.used = [used('cps', 30_000_000, viaBuyNow)]
    expect((await lowestPrices(['iPhone 18 Pro'])).rows[0]).toMatchObject({ listingId: 'cps', tracked: true, seller: 'CellphoneS' })
  })

  it('…but not without the link, nor with a link that is not a commission link, nor for a shop eno does not run', async () => {
    for (const over of [
      { ...viaBuyNow, purchaseLink: null },
      { ...viaBuyNow, purchaseLink: { url: 'https://cellphones.com.vn/x' } },
      { ...viaBuyNow, seller: { ...viaBuyNow.seller, ownerId: null } },
      { ...viaBuyNow, seller: { ...viaBuyNow.seller, officialPartner: false } },
    ]) {
      h.used = [used('x', 30_000_000, over)]
      expect((await lowestPrices(['iPhone 18 Pro'])).rows[0].tracked).toBe(false)
    }
  })

  it('a public tracked affiliateUrl still counts, as before', async () => {
    h.used = [used('aff', 30_000_000, { affiliateUrl: 'https://go.isclix.com/deep_link/1/2?url=x' })]
    expect((await lowestPrices(['iPhone 18 Pro'])).rows[0].tracked).toBe(true)
  })

  it('price first; at one price the row that earns is shown (the AffiliateNote’s own sentence)', async () => {
    h.used = [used('plain', 30_000_000), used('cps', 30_000_000, viaBuyNow), used('cheaper', 29_900_000)]
    expect((await lowestPrices(['iPhone 18 Pro'])).rows[0].listingId).toBe('cheaper')
    h.used = [used('plain', 30_000_000), used('cps', 30_000_000, viaBuyNow)]
    expect((await lowestPrices(['iPhone 18 Pro'])).rows[0]).toMatchObject({ listingId: 'cps', offers: 2, ceiling: 30_000_000 })
  })

  it('zero rows and a failed read stay apart', async () => {
    expect(await lowestPrices(['iPhone 18 Pro'])).toEqual({ rows: [], known: true })
    h.fail = true
    expect(await lowestPrices(['iPhone 18 Pro'])).toEqual({ rows: [], known: false })
  })
})

describe('cheapestPerModel — the buying guides’ block', () => {
  it('the cheapest tier of each model, in the lines’ order; a model with none is absent', async () => {
    h.fresh = [
      fresh('iPhone Duo 512GB', 71_490_000), fresh('iPhone 18 Pro 512GB', 44_490_000), fresh('iPhone 18 Pro 256GB', 38_999_000, HOANGHA),
    ]
    const picked = cheapestPerModel((await lowestNewPrices()).rows)
    expect(picked.map((r) => [r.model, r.storage, r.seller])).toEqual([
      ['iPhone 18 Pro', '256GB', 'Hoàng Hà Mobile'],
      ['iPhone Duo', '512GB', 'ShopDunk'],
    ])
    expect(cheapestPerModel([])).toEqual([])
  })
})
