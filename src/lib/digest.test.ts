import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * The weekly digest had defects that all showed up in the email itself, where nobody in the app sees
 * them, so only a test holds them:
 *  1. It sent the same six listings every week — `top` ordered by rankScore across every active
 *     listing with no recency bound, and rankScore barely moves.
 *  2. It rendered a red "−25%" pill for drops the site had already retired, because it checked
 *     `previousPrice > price` with no badge window, and previousPrice is only ever cleared on a
 *     price RAISE.
 *  3. (2026-09-29) It led with whatever scored best that week — six SIM plans — while thousands of
 *     homes for rent went live and the site's one conversion is the rental availability check.
 */

type R = Record<string, unknown>
const h = vi.hoisted(() => ({ rows: [] as R[], calls: [] as R[] }))

const DAY = 24 * 60 * 60 * 1000
const isHome = (r: R) => r.kind === 'home'
const gteOf = (where: R) => (where?.createdAt as { gte?: Date } | undefined)?.gte
const byRank = (a: R, b: R) => (b.rankScore as number) - (a.rankScore as number)
/** What the picks query can see: not a home, not a job, a photo, new enough. categoryId doubles as the slug. */
const pickable = (gte: Date) =>
  h.rows.filter((r) => !isHome(r) && !r.isSale && r.categoryId !== 'jobs' && r.categoryId !== 'rentals' && r.images !== '[]' && (r.createdAt as Date) >= gte)

vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: object) => ({ ...w }) }))
vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      findMany: (args: R) => {
        h.calls.push(args)
        const where = args.where as R
        const gte = gteOf(where)
        // The sales query is the only one with an OR.
        if (where.OR) return Promise.resolve(h.rows.filter((r) => r.isSale))
        // A picks query names its category.
        if (where.categoryId) {
          return Promise.resolve(pickable(gte as Date).filter((r) => r.categoryId === where.categoryId).sort(byRank).slice(0, args.take as number))
        }
        // Otherwise it is the homes query (category.slug === 'rentals').
        const price = where.price as { gte: number; lte: number }
        return Promise.resolve(
          h.rows
            .filter((r) => isHome(r) && (r.createdAt as Date) >= (gte as Date))
            .filter((r) => (r.price as number) >= price.gte && (r.price as number) <= price.lte)
            .sort(byRank)
            .slice(0, args.take as number),
        )
      },
      findFirst: (args: R) => {
        h.calls.push(args)
        const where = args.where as R
        const gte = gteOf(where) as Date
        return Promise.resolve(pickable(gte).filter((r) => r.categoryId === where.categoryId).sort(byRank)[0] ?? null)
      },
      groupBy: (args: R) => {
        const key = (args.by as string[])[0]
        const gte = gteOf(args.where as R) as Date
        const pool = key === 'categoryId' ? pickable(gte) : h.rows.filter((x) => isHome(x) && (x.createdAt as Date) >= gte)
        const tally = new Map<unknown, number>()
        for (const r of pool) tally.set(r[key], (tally.get(r[key]) ?? 0) + 1)
        return Promise.resolve([...tally].map(([k, c]) => ({ [key]: k, _count: { _all: c } })))
      },
    },
    category: {
      findMany: (args: R) => {
        const ids = ((args.where as R).id as { in: string[] }).in
        return Promise.resolve(ids.map((id) => ({ id, slug: id })))
      },
    },
  },
}))

import { getDigestContent, homeHeading, pickHomes } from './digest'

const row = (id: string, o: R = {}) => ({
  id, title: id, price: 1_000_000, currency: '₫', images: '["https://x/i.jpg"]',
  district: 'D1', city: 'HCMC', previousPrice: null, priceDropAt: null, urgentUntil: null,
  seller: { trustScore: 100 }, rankScore: 1, createdAt: new Date(), categoryId: 'electronics', category: { name: 'Electronics' }, ...o,
})
const home = (id: string, o: R = {}) =>
  row(id, { kind: 'home', subcategorySlug: 'apartment-rental', price: 9_000_000, district: `Quận ${id}`, title: `Apartment · 1 bed · 1 bath · 30 m² for rent — ${id}`, ...o })

beforeEach(() => { h.rows = []; h.calls = [] })

describe('the digest leads with the week’s rental homes', () => {
  it('puts a new home in `homes` and a same-week SIM plan only in `picks`', async () => {
    h.rows = [
      row('esim-plan', { rankScore: 99, categoryId: 'services', category: { name: 'Services' } }),
      home('1', { rankScore: 1 }),
    ]
    const c = await getDigestContent()
    expect(c.homes.map((x) => x.id)).toEqual(['1'])
    expect(c.picks.map((x) => x.id)).toEqual(['esim-plan'])
  })

  it('shows at most one home per district, best rankScore first', async () => {
    h.rows = [
      home('a', { rankScore: 9, district: 'Quận Gò Vấp' }),
      home('b', { rankScore: 8, district: 'Gò Vấp' }), // same canonical district, different spelling
      home('c', { rankScore: 7, district: 'Quận Bình Thạnh' }),
    ]
    const c = await getDigestContent()
    expect(c.homes.map((x) => x.id)).toEqual(['a', 'c'])
    expect(c.homes[0].area).toBe('Go Vap District')
  })

  it('keeps portal mistakes off the cards: a ₫1,200 room and a ₫106M "house" are out', async () => {
    h.rows = [
      home('cheap', { price: 1_200, district: 'Quận 4' }),
      home('warehouse', { price: 106_000_000, district: 'Quận 7' }),
      home('fine', { price: 8_000_000, district: 'Quận 3' }),
    ]
    const c = await getDigestContent()
    expect(c.homes.map((x) => x.id)).toEqual(['fine'])
  })

  it('counts every home ADDED this week by type, price band or not', async () => {
    h.rows = [
      home('a1'), home('a2', { price: 1_200 }),
      home('h1', { subcategorySlug: 'house-rental' }),
      home('r1', { subcategorySlug: 'room-rental' }),
      home('old', { createdAt: new Date(Date.now() - 10 * DAY) }),
    ]
    const c = await getDigestContent()
    expect(c.homeCounts).toEqual({ apartments: 2, houses: 1, rooms: 1, total: 4 })
  })

  it('links only districts that have a curated /c/rentals page, busiest first', async () => {
    h.rows = [
      home('g1', { district: 'Quận Gò Vấp' }), home('g2', { district: 'Quận Gò Vấp' }),
      home('b1', { district: 'Quận Bình Thạnh' }),
      home('w1', { district: 'Phường Nowhere' }), home('w2', { district: 'Phường Nowhere' }), home('w3', { district: 'Phường Nowhere' }),
    ]
    const c = await getDigestContent()
    expect(c.districts.map((d) => d.slug)).toEqual(['go-vap', 'binh-thanh'])
  })

  it('shortens the importer title to its facts', () => {
    expect(homeHeading('Apartment · 1 bed · 1 bath · 28 m² for rent — Tân Bình Ward (new), Tân Bình')).toBe('Apartment · 1 bed · 1 bath · 28 m²')
    expect(homeHeading('Cozy studio near the river')).toBe('Cozy studio near the river')
  })

  it('leaves an implausible home off the cards: 3 bedrooms in 16.5 m² is a portal typo', () => {
    const picked = pickHomes([
      { id: 'typo', title: 't', price: 16e6, currency: '₫', images: '["https://x/1.jpg"]', district: 'Quận 3', areaM2: 16.5, attributes: '{"bedrooms":"3"}' },
      { id: 'ok', title: 't', price: 9e6, currency: '₫', images: '["https://x/2.jpg"]', district: 'Quận 4', areaM2: 64, attributes: '{"bedrooms":"3"}' },
    ])
    expect(picked.map((p) => p.id)).toEqual(['ok'])
  })

  it('fills with rooms only after apartments and houses', () => {
    const picked = pickHomes([
      { id: 'room', title: 't', price: 3e6, currency: '₫', images: '["https://x/r.jpg"]', district: 'Quận 1', subcategorySlug: 'room-rental' },
      { id: 'flat', title: 't', price: 9e6, currency: '₫', images: '["https://x/f.jpg"]', district: 'Quận 3', subcategorySlug: 'apartment-rental' },
    ], 1)
    expect(picked.map((p) => p.id)).toEqual(['flat'])
  })

  it('never builds a card without a photo', () => {
    const picked = pickHomes([
      { id: 'no-photo', title: 't', price: 9e6, currency: '₫', images: '[]', district: 'Quận 1' },
      { id: 'photo', title: 't', price: 9e6, currency: '₫', images: '["https://x/1.jpg"]', district: 'Quận 3' },
    ])
    expect(picked.map((p) => p.id)).toEqual(['photo'])
  })
})

describe('the picks show VARIETY: one listing per category, never one category', () => {
  const cat = (slug: string, name: string) => ({ categoryId: slug, category: { name } })

  it('takes one listing from each category, however many one category has', async () => {
    h.rows = [
      ...Array.from({ length: 10 }, (_, i) => row(`phone-${i}`, { rankScore: 100 - i, ...cat('electronics', 'Electronics') })),
      row('sofa', { rankScore: 1, ...cat('furniture-appliances', 'Home') }),
      row('dress', { rankScore: 2, ...cat('fashion-beauty', 'Fashion') }),
    ]
    const { picks } = await getDigestContent()
    expect(picks.map((p) => p.id).sort()).toEqual(['dress', 'phone-0', 'sofa'])
    expect(new Set(picks.map((p) => p.category)).size).toBe(picks.length)
  })

  it('orders categories for a renter moving in: Home before Electronics, whatever their ranks', async () => {
    h.rows = [
      row('phone', { rankScore: 999, ...cat('electronics', 'Electronics') }),
      row('bike', { rankScore: 500, ...cat('vehicles', 'Vehicles') }),
      row('sofa', { rankScore: 1, ...cat('furniture-appliances', 'Home') }),
    ]
    const { picks } = await getDigestContent()
    expect(picks.map((p) => p.id)).toEqual(['sofa', 'phone', 'bike'])
  })

  it('stops at six categories', async () => {
    const slugs = ['furniture-appliances', 'electronics', 'vehicles', 'fashion-beauty', 'baby-kids', 'sports', 'services', 'books-stationery']
    h.rows = slugs.map((s) => row(`x-${s}`, cat(s, s)))
    const { picks } = await getDigestContent()
    expect(picks).toHaveLength(6)
    expect(picks.map((p) => p.id)).toEqual(slugs.slice(0, 6).map((s) => `x-${s}`))
  })

  it('reaches back for a quiet category rather than dropping it: 60 days old still counts', async () => {
    h.rows = [
      row('phone', cat('electronics', 'Electronics')),
      row('old-book', { createdAt: new Date(Date.now() - 60 * DAY), ...cat('books-stationery', 'Books') }),
    ]
    const { picks } = await getDigestContent()
    expect(picks.map((p) => p.id)).toEqual(['phone', 'old-book'])
  })

  it('keeps Home first even when its newest listing is older than six busier categories’ (the 2026-09-29 miss)', async () => {
    const fresh = ['electronics', 'vehicles', 'fashion-beauty', 'baby-kids', 'sports', 'services']
    h.rows = [
      ...fresh.map((s) => row(`new-${s}`, { rankScore: 50, ...cat(s, s) })),
      row('sofa-16-days', { rankScore: 1, createdAt: new Date(Date.now() - 16 * DAY), ...cat('furniture-appliances', 'Home') }),
    ]
    const { picks } = await getDigestContent()
    expect(picks[0].id).toBe('sofa-16-days')
    expect(picks).toHaveLength(6)
  })

  it('a top row with an unusable photo does not cost its category — the next one with a photo speaks for it', async () => {
    h.rows = [
      row('broken-photo', { rankScore: 99, images: '[""]', ...cat('fashion-beauty', 'Fashion') }),
      row('good-photo', { rankScore: 1, ...cat('fashion-beauty', 'Fashion') }),
    ]
    const { picks } = await getDigestContent()
    expect(picks.map((p) => p.id)).toEqual(['good-photo'])
  })

  it('prefers the NEW over an old champion inside a category (champion inside the 90-day window)', async () => {
    h.rows = [
      row('champion-40-days', { rankScore: 9999, createdAt: new Date(Date.now() - 40 * DAY) }),
      row('posted-yesterday', { rankScore: 1, createdAt: new Date(Date.now() - 1 * DAY) }),
    ]
    const { picks } = await getDigestContent()
    expect(picks.map((p) => p.id)).toEqual(['posted-yesterday'])
  })

  it('shows a 14-day category its BEST listing — no rotation', async () => {
    h.rows = ['a', 'b', 'c'].map((id, i) => row(`fresh-${id}`, { rankScore: 10 - i, createdAt: new Date(Date.now() - 10 * DAY) }))
    expect((await getDigestContent()).picks[0].id).toBe('fresh-a')
  })

  it('rotates a quiet category week to week instead of repeating its best old listing', async () => {
    h.rows = ['a', 'b', 'c'].map((id, i) => row(`old-${id}`, { rankScore: 10 - i, createdAt: new Date(Date.now() - 50 * DAY) }))
    const seen = new Set<string>()
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      for (let w = 0; w < 3; w++) {
        vi.setSystemTime(new Date(Date.UTC(2026, 9, 1) + w * 7 * DAY))
        h.rows = ['a', 'b', 'c'].map((id, i) => row(`old-${id}`, { rankScore: 10 - i, createdAt: new Date(Date.now() - 50 * DAY) }))
        seen.add((await getDigestContent()).picks[0].id)
      }
    } finally {
      vi.useRealTimers()
    }
    expect(seen.size).toBe(3)
  })

  it('never picks a job, and never a listing without a photo', async () => {
    h.rows = [
      row('job', cat('jobs', 'Jobs')),
      row('no-photo', { images: '[]', ...cat('pets', 'Pets') }),
      row('ok', cat('sports', 'Sports')),
    ]
    const { picks } = await getDigestContent()
    expect(picks.map((p) => p.id)).toEqual(['ok'])
  })
})

describe('the digest never advertises a discount the site has retired', () => {
  it('drops the pill once the 3-day badge window has lapsed', async () => {
    h.rows = [row('lapsed', {
      previousPrice: 2_000_000, price: 1_500_000,
      priceDropAt: new Date(Date.now() - 5 * DAY), // badge expired 2 days ago
    })]
    const { picks } = await getDigestContent()
    expect(picks[0].drop).toBeNull()
  })

  it('still shows a pill for a drop inside the window', async () => {
    h.rows = [row('live', {
      previousPrice: 2_000_000, price: 1_500_000,
      priceDropAt: new Date(Date.now() - 1 * DAY),
    })]
    const { picks } = await getDigestContent()
    expect(picks[0].drop).toBeTruthy()
  })

  it('shows no pill when previousPrice lingers with no priceDropAt at all', async () => {
    // previousPrice is cleared only on a RAISE, so a legacy row can carry it with a null timestamp.
    h.rows = [row('no-timestamp', { previousPrice: 2_000_000, price: 1_500_000, priceDropAt: null })]
    const { picks } = await getDigestContent()
    expect(picks[0].drop).toBeNull()
  })
})
