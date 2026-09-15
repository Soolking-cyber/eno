import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: { $queryRaw: vi.fn(async () => []) } }))

import { getPriceBand, listingSegment } from './price-stat'
import { db } from '@/lib/db'

/**
 * ⛔ THE BAND IS PER SHELF. Before 2026-09-15 the key was brand + model + condition, so a phone case
 * named after an iPhone was banded with the iPhone and badged "Good price" at ₫119,000 — the segment
 * must carry category AND subcategory, and a listing with no subcategory has no band at all.
 * The SQL twin lives in /api/cron/price-stats (SEGMENT_SQL). When the key changed (2026-09-15) its output
 * was compared with this function on every active production row with a subcategory — 27,133 rows, 0
 * mismatches. None of those rows carried a year, so the year band was checked on its own: SQL integer
 * `(y / 2) * 2` gives 2014→2014, 2015→2014, 2019→2018, 2020→2020, the same as Math.floor below.
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
