/**
 * THE HOUSING SHELF LEADS WITH ITS OWN CITY (2026-11-06). /housing-vietnam-expats says it covers Ho Chi Minh City, and its
 * rail showed one bathroom photo in Biên Hòa five times. The first fix tested `isHcmc(location)`, which matches a bare
 * city value, while these rows' `location` reads "Quận Bình Thạnh (Phường …)": it matched nothing, every unit test passed
 * (there were none), and the shelf did not change. The rows below are shaped like the live ones that day: the partner
 * import stores city "Hồ Chí Minh" on its Biên Hòa and Đà Nẵng rows too, and those are its rows with no district.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const q = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], reads: [] as { take: number; city: boolean }[], failCity: false }))
vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      // Answers like the database would: each district clause the read carries filters, and a read returns at most `take`.
      findMany: async (args: { where: unknown; take: number }) => {
        const w = JSON.stringify(args.where)
        const city = w.includes('{"district":{"not":null}}')
        const notEmpty = w.includes('{"NOT":{"district":""}}')
        q.reads.push({ take: args.take, city })
        if (city && q.failCity) throw new Error('city read failed')
        return q.rows.filter((r) => (!city || r.district !== null) && (!notEmpty || r.district !== '')).slice(0, args.take)
      },
    },
  },
}))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: unknown) => w }))
vi.mock('@/lib/translate', () => ({ localizeListingTitles: async (x: unknown) => x }))
vi.mock('@/lib/serialize', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/serialize')>()),
  serializeListing: (r: unknown) => r,
}))

const { loadSeoRail } = await import('./seo-listing-rail')
const { HOME_RENTAL_SUBCATS } = await import('@/lib/rental-homes')

let n = 0
function row(seller: string, location: string, district: string | null, photos = 5) {
  n++
  return {
    id: `l${n}`, sellerId: seller, city: 'Hồ Chí Minh', district, location,
    // One distinct photo per row: this test is about the city, not the photo rule.
    images: JSON.stringify(Array.from({ length: photos }, (_, i) => `https://img.example/${n}-${i}.jpg`)),
    subcategorySlug: 'apartment-rental', listingType: null, condition: null, category: { slug: 'rentals' }, brandSlug: null, model: null,
  }
}

const target = { categorySlug: 'rentals', subcategoryIn: HOME_RENTAL_SUBCATS }

beforeEach(() => { n = 0; q.reads = []; q.failCity = false })

describe('loadSeoRail — a homes shelf on a page that names its city', () => {
  it('fills from rows with an HCMC district before the rows the import mislabels', async () => {
    // Newest first, as the query returns them: the out-of-city rows lead, as they did live.
    q.rows = [
      row('goplus', 'Phường Biên Hòa, Biên Hòa', null),
      row('goplus', 'Phường Ngũ Hành Sơn, Ngũ Hành Sơn', null),
      row('goplus', 'Phường Cẩm Lệ, Cẩm Lệ', null),
      row('goplus', 'Phường Tam Phước, Biên Hòa', null),
      ...['Quận Bình Thạnh (Phường Gia Định)', 'Quận 5 (Phường An Đông)', 'Quận 10 (Phường Diên Hồng)', 'TP. Thủ Đức (Phường An Khánh)']
        .map((l) => row('goplus', l, l.split(' (')[0])),
      row('seller-b', 'Tân Hưng', 'Tân Hưng'),
      row('seller-c', 'Tân Mỹ', 'Tân Mỹ'),
      row('seller-d', 'Quận 1 (Phường Cầu Ông Lãnh)', 'Quận 1'),
      row('seller-e', 'Quận Phú Nhuận (Phường Đức Nhuận)', 'Quận Phú Nhuận'),
    ]
    const { listings } = await loadSeoRail({ ...target, railCity: 'hcmc' })
    const shown = listings as unknown as { location: string; district: string | null }[]
    expect(shown).toHaveLength(8)
    expect(shown.every((r) => r.district !== null)).toBe(true)
    expect(shown.map((r) => r.location).join(' | ')).not.toMatch(/Biên Hòa|Ngũ Hành Sơn|Cẩm Lệ/)
  })

  it('keeps another city out even when the city rows are one seller the per-seller rule caps', async () => {
    q.rows = [
      row('b', 'Phường Biên Hòa, Biên Hòa', null), row('c', 'Phường Cẩm Lệ, Cẩm Lệ', null), row('d', 'Phường Liên Chiểu, Liên Chiểu', null),
      ...Array.from({ length: 10 }, (_, i) => row('goplus', `Quận Bình Thạnh (Phường ${i})`, 'Quận Bình Thạnh')),
    ]
    const { listings } = await loadSeoRail({ ...target, railCity: 'hcmc' })
    const shown = listings as unknown as { district: string | null }[]
    expect(shown).toHaveLength(8)
    expect(shown.every((r) => r.district === 'Quận Bình Thạnh')).toBe(true)
  })

  it('still fills a full shelf from the other rows when the city has too few', async () => {
    q.rows = [
      row('a', 'Phường Biên Hòa, Biên Hòa', null), row('b', 'Phường Cẩm Lệ, Cẩm Lệ', null), row('c', 'Phường Liên Chiểu, Liên Chiểu', null),
      row('d', 'Quận 1 (Phường Bến Nghé)', 'Quận 1'),
      row('e', 'Phường Tam Phước, Biên Hòa', null), row('f', 'Phường Ngũ Hành Sơn, Ngũ Hành Sơn', null), row('g', 'Phường Hòa Khánh, Liên Chiểu', null),
      row('h', 'Phường Bửu Long, Biên Hòa', null),
    ]
    const { listings } = await loadSeoRail({ ...target, railCity: 'hcmc' })
    const shown = listings as unknown as { location: string }[]
    expect(shown).toHaveLength(8)
    expect(shown[0].location).toBe('Quận 1 (Phường Bến Nghé)')
  })

  it('finds the city even when the newest 24 rows are all somewhere else', async () => {
    q.rows = [
      ...Array.from({ length: 30 }, (_, i) => row(`dn${i % 4}`, `Phường Ngũ Hành Sơn ${i}, Ngũ Hành Sơn`, null)),
      ...Array.from({ length: 10 }, (_, i) => row(`hcm${i % 4}`, `Quận 7 (Phường ${i})`, 'Quận 7')),
    ]
    const { listings } = await loadSeoRail({ ...target, railCity: 'hcmc' })
    const shown = listings as unknown as { district: string | null }[]
    expect(shown).toHaveLength(8)
    expect(shown.every((r) => r.district === 'Quận 7')).toBe(true)
  })

  it('an empty district is not a district: 24 newer rows with one cannot crowd the city out', async () => {
    q.rows = [
      ...Array.from({ length: 24 }, (_, i) => row(`x${i % 4}`, `Somewhere ${i}`, '')),
      ...Array.from({ length: 8 }, (_, i) => row(`hcm${i % 4}`, `Quận 3 (Phường ${i})`, 'Quận 3')),
    ]
    const { listings } = await loadSeoRail({ ...target, railCity: 'hcmc' })
    const shown = listings as unknown as { district: string | null }[]
    expect(shown).toHaveLength(8)
    expect(shown.every((r) => r.district === 'Quận 3')).toBe(true)
  })

  it('a failed city read keeps the pool it already has', async () => {
    q.rows = Array.from({ length: 8 }, (_, i) => row(`s${i % 4}`, `Quận 4 (Phường ${i})`, 'Quận 4'))
    q.failCity = true
    const { listings, known } = await loadSeoRail({ ...target, railCity: 'hcmc' })
    expect(known).toBe(true)
    expect(listings).toHaveLength(8)
  })

  it('a city page reads the pool and its city; a page without one reads the pool alone', async () => {
    q.rows = []
    await loadSeoRail({ ...target, railCity: 'hcmc' })
    expect(q.reads).toEqual([{ take: 24, city: false }, { take: 24, city: true }])
    q.reads = []
    await loadSeoRail(target)
    expect(q.reads).toEqual([{ take: 24, city: false }])
  })
})
