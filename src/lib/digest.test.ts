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
/** The "also new" query is the one that EXCLUDES rentals: `category: { slug: { not: 'rentals' } }`. */
const isOthersCall = (c: R) => typeof ((c.where as R).category as { slug?: unknown } | undefined)?.slug === 'object'

vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: object) => ({ ...w }) }))
vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      findMany: (args: R) => {
        h.calls.push(args)
        const where = args.where as R
        const gte = gteOf(where)
        const byRank = (a: R, b: R) => (b.rankScore as number) - (a.rankScore as number)
        // The sales query is the only one with an OR.
        if (where.OR) return Promise.resolve(h.rows.filter((r) => r.isSale))
        const cat = (where.category as { slug?: unknown } | undefined)?.slug
        if (cat === 'rentals') {
          const price = where.price as { gte: number; lte: number }
          return Promise.resolve(
            h.rows
              .filter((r) => isHome(r) && (r.createdAt as Date) >= (gte as Date))
              .filter((r) => (r.price as number) >= price.gte && (r.price as number) <= price.lte)
              .sort(byRank)
              .slice(0, args.take as number),
          )
        }
        return Promise.resolve(
          h.rows
            .filter((r) => !r.isSale && !isHome(r) && (r.createdAt as Date) >= (gte as Date))
            .sort(byRank)
            .slice(0, args.take as number),
        )
      },
      groupBy: (args: R) => {
        const key = (args.by as string[])[0]
        const gte = gteOf(args.where as R) as Date
        const tally = new Map<unknown, number>()
        for (const r of h.rows.filter((x) => isHome(x) && (x.createdAt as Date) >= gte)) {
          tally.set(r[key], (tally.get(r[key]) ?? 0) + 1)
        }
        return Promise.resolve([...tally].map(([k, c]) => ({ [key]: k, _count: { _all: c } })))
      },
    },
  },
}))

import { getDigestContent, homeHeading, pickHomes } from './digest'

const row = (id: string, o: R = {}) => ({
  id, title: id, price: 1_000_000, currency: '₫', images: '["https://x/i.jpg"]',
  district: 'D1', city: 'HCMC', previousPrice: null, priceDropAt: null, urgentUntil: null,
  seller: { trustScore: 100 }, rankScore: 1, createdAt: new Date(), ...o,
})
const home = (id: string, o: R = {}) =>
  row(id, { kind: 'home', subcategorySlug: 'apartment-rental', price: 9_000_000, district: `Quận ${id}`, title: `Apartment · 1 bed · 1 bath · 30 m² for rent — ${id}`, ...o })

beforeEach(() => { h.rows = []; h.calls = [] })

describe('the digest leads with the week’s rental homes', () => {
  it('puts a new home in `homes` and a same-week SIM plan only in `others`', async () => {
    h.rows = [
      row('esim-plan', { rankScore: 99 }),
      home('1', { rankScore: 1 }),
    ]
    const c = await getDigestContent()
    expect(c.homes.map((x) => x.id)).toEqual(['1'])
    expect(c.others.map((x) => x.id)).toEqual(['esim-plan'])
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

describe('"also new" sends the LATEST listings, not the same winners forever', () => {
  it('prefers a NEW listing over an older one with a much higher rankScore', async () => {
    h.rows = [
      row('ancient-champion', { rankScore: 9999, createdAt: new Date(Date.now() - 200 * DAY) }),
      row('posted-yesterday', { rankScore: 1, createdAt: new Date(Date.now() - 1 * DAY) }),
    ]
    const { others } = await getDigestContent()
    // The old query returned ancient-champion first, every single week.
    expect(others.map((t) => t.id)).toEqual(['posted-yesterday'])
  })

  it('widens the window rather than falling back to all-time when a week is quiet', async () => {
    h.rows = [row('from-three-weeks-ago', { createdAt: new Date(Date.now() - 21 * DAY) })]
    const { others } = await getDigestContent()
    expect(others.map((t) => t.id)).toEqual(['from-three-weeks-ago'])
    // It must have TRIED the tighter windows first — otherwise "latest" means nothing.
    const windows = h.calls.filter(isOthersCall).map((c) => gteOf(c.where as R)) as Date[]
    expect(windows.length).toBeGreaterThan(1)
    expect(windows[0].getTime()).toBeGreaterThan(windows[1].getTime()) // 7d before 14d
  })

  it('stops widening as soon as a window is full', async () => {
    h.rows = Array.from({ length: 3 }, (_, i) => row(`fresh-${i}`, { rankScore: 10 - i }))
    const { others } = await getDigestContent()
    expect(others).toHaveLength(3)
    const windowed = h.calls.filter(isOthersCall)
    expect(windowed).toHaveLength(1) // the 7-day window satisfied it; no widening
  })
})

describe('the digest never advertises a discount the site has retired', () => {
  it('drops the pill once the 3-day badge window has lapsed', async () => {
    h.rows = [row('lapsed', {
      previousPrice: 2_000_000, price: 1_500_000,
      priceDropAt: new Date(Date.now() - 5 * DAY), // badge expired 2 days ago
    })]
    const { others } = await getDigestContent()
    expect(others[0].drop).toBeNull()
  })

  it('still shows a pill for a drop inside the window', async () => {
    h.rows = [row('live', {
      previousPrice: 2_000_000, price: 1_500_000,
      priceDropAt: new Date(Date.now() - 1 * DAY),
    })]
    const { others } = await getDigestContent()
    expect(others[0].drop).toBeTruthy()
  })

  it('shows no pill when previousPrice lingers with no priceDropAt at all', async () => {
    // previousPrice is cleared only on a RAISE, so a legacy row can carry it with a null timestamp.
    h.rows = [row('no-timestamp', { previousPrice: 2_000_000, price: 1_500_000, priceDropAt: null })]
    const { others } = await getDigestContent()
    expect(others[0].drop).toBeNull()
  })
})
