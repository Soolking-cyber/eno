import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: { $queryRaw: vi.fn(async () => []) } }))

import { getPriceBand, listingSegment, pickPriceBand, type PriceStatRow } from './price-stat'
import { FALLBACK_BRAND_KEY } from './price-fallback'
import { db } from '@/lib/db'
import type { Prisma } from '@/generated/prisma/client'

/**
 * ⛔ THE BAND IS PER SHELF. Before 2026-09-15 the key was brand + model + condition, so a phone case
 * named after an iPhone was banded with the iPhone and badged "Good price" at ₫119,000 — the segment
 * must carry category AND subcategory, and a listing with no subcategory has no band at all.
 * The SQL twin is SEGMENT_SQL in price-stat.ts (it lived in /api/cron/price-stats until 2026-10-05). When
 * the key changed (2026-09-15) its output was compared with this function on every active production row
 * with a subcategory — 27,133 rows, 0 mismatches. None of those rows carried a year, so the year band was
 * checked on its own: SQL integer `(y / 2) * 2` gives 2014→2014, 2015→2014, 2019→2018, 2020→2020, the
 * same as Math.floor below. Since 2026-10-05 price-stat.sql.test.ts EXECUTES SEGMENT_SQL in an
 * in-process Postgres and compares it with this function row by row.
 */
describe('listingSegment', () => {
  const base = { categorySlug: 'electronics', subcategorySlug: 'phones-tablets', condition: 'used', year: null }

  it('keys on the shelf and the condition', () => {
    expect(listingSegment(base)).toBe('electronics/phones-tablets|used')
  })

  it('separates a case from the phone it fits', () => {
    expect(listingSegment({ ...base, subcategorySlug: 'phone-cases' })).not.toBe(listingSegment(base))
  })

  it('has no band without a category or a subcategory — never a mixed "unfiled" bucket', () => {
    expect(listingSegment({ ...base, subcategorySlug: null })).toBeNull()
    expect(listingSegment({ ...base, subcategorySlug: '   ' })).toBeNull()
    expect(listingSegment({ ...base, categorySlug: '' })).toBeNull()
  })

  it('reads a null, empty or whitespace condition as "any", like NULLIF(btrim(condition),"") in SQL', () => {
    for (const condition of [null, '', '  ']) {
      expect(listingSegment({ ...base, condition })).toBe('electronics/phones-tablets|any')
    }
    expect(listingSegment({ ...base, condition: ' new ' })).toBe('electronics/phones-tablets|new')
  })

  it('adds the 2-year band when a year is present', () => {
    expect(listingSegment({ ...base, categorySlug: 'vehicles', subcategorySlug: 'motorbikes', year: 2015 })).toBe('vehicles/motorbikes|used:2014')
    expect(listingSegment({ ...base, categorySlug: 'vehicles', subcategorySlug: 'motorbikes', year: 2014 })).toBe('vehicles/motorbikes|used:2014')
  })
})

describe('getPriceBand', () => {
  const sale = { brandSlug: 'apple', model: 'iPhone 17', categorySlug: 'electronics', subcategorySlug: 'phones-tablets', listingType: 'sell', condition: 'new', year: null }

  it('does not query at all for a listing with no subcategory', async () => {
    vi.mocked(db.$queryRaw).mockClear()
    expect(await getPriceBand({ ...sale, subcategorySlug: null })).toBeNull()
    expect(db.$queryRaw).not.toHaveBeenCalled()
  })

  // A band is a sale price: a monthly rent or a wanted-ad budget in the same distribution makes both
  // numbers a fiction, so neither forms a band nor is judged against one.
  it('does not judge a rental or a wanted ad against sale prices', async () => {
    for (const listingType of ['rent', 'wanted', null]) {
      vi.mocked(db.$queryRaw).mockClear()
      expect(await getPriceBand({ ...sale, listingType })).toBeNull()
      expect(db.$queryRaw).not.toHaveBeenCalled()
    }
  })
})

/**
 * WHICH BAND A LISTING GETS. The brand+model band first; the similar-items fallback (price-fallback.ts)
 * ONLY when that band has no data; the same n ≥ 5 floor and 3x spread guard on both; nothing when the
 * model band exists but is too wide — the coarser comparison is never a second try.
 */
describe('pickPriceBand — brand+model first, the fallback only when it has no data', () => {
  const keys = { brandSlug: 'ikea', model: 'Ektorp', fallbackKey: 'material=fabric' }
  const modelRow = (over: Partial<PriceStatRow> = {}): PriceStatRow => ({ brandSlug: 'ikea', model: 'Ektorp', n: 7, p25: 2_000_000, median: 2_500_000, p75: 3_000_000, ...over })
  const fallbackRow = (over: Partial<PriceStatRow> = {}): PriceStatRow => ({ brandSlug: FALLBACK_BRAND_KEY, model: 'material=fabric', n: 12, p25: 1_000_000, median: 1_400_000, p75: 2_000_000, ...over })

  it('takes the brand+model band when it has data, even with a fallback row beside it', () => {
    expect(pickPriceBand([fallbackRow(), modelRow()], keys)).toEqual({ n: 7, p25: 2_000_000, median: 2_500_000, p75: 3_000_000, basis: 'model' })
  })

  it('falls back to the similar-items band when there is no brand+model row', () => {
    expect(pickPriceBand([fallbackRow()], keys)).toEqual({ n: 12, p25: 1_000_000, median: 1_400_000, p75: 2_000_000, basis: 'similar' })
  })

  it('serves an unbranded listing (no brand, no model) from the fallback', () => {
    expect(pickPriceBand([fallbackRow()], { brandSlug: null, model: null, fallbackKey: 'material=fabric' })?.basis).toBe('similar')
  })

  it('⛔ a brand+model band that HAS data but is too wide answers nothing — no fallback', () => {
    expect(pickPriceBand([modelRow({ p25: 1_000_000, p75: 3_000_001 }), fallbackRow()], keys)).toBeNull()
  })

  it('a brand+model row under the sample floor counts as no data (the cron never writes one; defensive)', () => {
    expect(pickPriceBand([modelRow({ n: 4 }), fallbackRow()], keys)?.basis).toBe('similar')
  })

  it('n ≥ 5 on the fallback too: 5 shows, 4 does not', () => {
    expect(pickPriceBand([fallbackRow({ n: 5 })], keys)?.n).toBe(5)
    expect(pickPriceBand([fallbackRow({ n: 4 })], keys)).toBeNull()
  })

  it('the P25–P75 spread guard on the fallback: exactly 3x shows, a đồng more does not', () => {
    expect(pickPriceBand([fallbackRow({ p25: 1_000_000, p75: 3_000_000 })], keys)).toMatchObject({ p25: 1_000_000, p75: 3_000_000 })
    expect(pickPriceBand([fallbackRow({ p25: 1_000_000, p75: 3_000_001 })], keys)).toBeNull()
  })

  it('reads only the row for ITS keys — another brand\'s row or another facet value is not its band', () => {
    expect(pickPriceBand([modelRow({ brandSlug: 'hay' })], keys)).toBeNull()
    expect(pickPriceBand([fallbackRow({ model: 'material=wood' })], keys)).toBeNull()
    expect(pickPriceBand([fallbackRow()], { ...keys, fallbackKey: null })).toBeNull()
  })

  it('coerces driver strings/bigints and refuses a non-number', () => {
    expect(pickPriceBand([fallbackRow({ n: '9', p25: BigInt(10), median: '12', p75: 20 })], keys)).toEqual({ n: 9, p25: 10, median: 12, p75: 20, basis: 'similar' })
    expect(pickPriceBand([fallbackRow({ p25: 'x' })], keys)).toBeNull()
  })
})

describe('getPriceBand — one query, both keys', () => {
  const sofa = { brandSlug: null, model: null, categorySlug: 'furniture-appliances', subcategorySlug: 'sofa-seating', listingType: 'sell', condition: 'used', year: null }
  const sqlOf = () => vi.mocked(db.$queryRaw).mock.calls[0]![0] as unknown as Prisma.Sql

  it('serves an unbranded sofa from its material fallback, in ONE query', async () => {
    vi.mocked(db.$queryRaw).mockClear()
    vi.mocked(db.$queryRaw).mockResolvedValueOnce([{ brandSlug: FALLBACK_BRAND_KEY, model: 'material=fabric', n: 6, p25: 900_000, median: 1_200_000, p75: 1_800_000 }] as never)
    const band = await getPriceBand({ ...sofa, attributes: '{"condition":"used","material":"fabric"}' })
    expect(band).toEqual({ n: 6, p25: 900_000, median: 1_200_000, p75: 1_800_000, basis: 'similar' })
    expect(db.$queryRaw).toHaveBeenCalledTimes(1)
    expect(sqlOf().values).toEqual(['furniture-appliances/sofa-seating|used', FALLBACK_BRAND_KEY, 'material=fabric'])
  })

  it('asks for the brand+model row AND the fallback row in the same statement', async () => {
    vi.mocked(db.$queryRaw).mockClear()
    await getPriceBand({ ...sofa, brandSlug: 'ikea', model: 'Ektorp', attributes: '{"material":"fabric"}' })
    expect(db.$queryRaw).toHaveBeenCalledTimes(1)
    expect(sqlOf().values).toEqual(['furniture-appliances/sofa-seating|used', 'ikea', 'Ektorp', FALLBACK_BRAND_KEY, 'material=fabric'])
  })

  it('does not query for an unbranded listing whose shelf has no fallback — or whose facet is missing', async () => {
    for (const input of [
      { ...sofa, subcategorySlug: 'white-goods' },
      { ...sofa, categorySlug: 'electronics', subcategorySlug: 'phones-tablets' },
      { ...sofa, attributes: '{"condition":"used"}' }, // facet shelf, no material → no band, never the shelf
      { ...sofa, attributes: '{"material":"leather"}' }, // not a taxonomy value
    ]) {
      vi.mocked(db.$queryRaw).mockClear()
      expect(await getPriceBand(input)).toBeNull()
      expect(db.$queryRaw).not.toHaveBeenCalled()
    }
  })

  it('⛔ never a fallback for rentals, jobs, services, teachers, property or tickets', async () => {
    const shelves: Array<[string, string]> = [
      ['rentals', 'apartment-rental'], ['jobs', 'teaching'], ['services', 'cleaning'],
      ['teachers', 'english'], ['property', 'apartment'], ['tickets-travel', 'event-tickets'],
    ]
    for (const [categorySlug, subcategorySlug] of shelves) {
      vi.mocked(db.$queryRaw).mockClear()
      expect(await getPriceBand({ ...sofa, categorySlug, subcategorySlug })).toBeNull()
      expect(db.$queryRaw).not.toHaveBeenCalled()
    }
  })

  it('treats the sentinel as no brand — a caller cannot read a fallback row as a brand+model band', async () => {
    vi.mocked(db.$queryRaw).mockClear()
    vi.mocked(db.$queryRaw).mockResolvedValueOnce([{ brandSlug: FALLBACK_BRAND_KEY, model: '*', n: 8, p25: 100_000, median: 150_000, p75: 200_000 }] as never)
    const band = await getPriceBand({ ...sofa, categorySlug: 'fashion-beauty', subcategorySlug: 'womens', brandSlug: FALLBACK_BRAND_KEY, model: '*' })
    expect(band?.basis).toBe('similar')
    expect(sqlOf().values).toEqual(['fashion-beauty/womens|used', FALLBACK_BRAND_KEY, '*'])
  })

  it('a database error hides the band rather than breaking the page', async () => {
    vi.mocked(db.$queryRaw).mockClear()
    vi.mocked(db.$queryRaw).mockRejectedValueOnce(new Error('boom'))
    expect(await getPriceBand({ ...sofa, categorySlug: 'fashion-beauty', subcategorySlug: 'womens' })).toBeNull()
  })
})
