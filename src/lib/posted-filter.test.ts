import { describe, expect, it } from 'vitest'
import { POSTED_FACET_KEY, POSTED_WINDOWS, postedCutoff, postedNow } from './posted-filter'
import { attrMatcher, attrWhere } from './attr-match'
import { askableFacetsFor, facetsFor } from './taxonomy'
import { releasedParams } from './facet-counts'

// 2026-10-02 14:37:21.500 ICT = 07:37:21.500 UTC
const NOW = new Date('2026-10-02T07:37:21.500Z')

describe('postedCutoff — 5-minute steps, rounded up', () => {
  it('rounds "now" up to its 5-minute step', () => {
    expect(postedNow(NOW).toISOString()).toBe('2026-10-02T07:40:00.000Z')
    expect(postedNow(new Date('2026-10-02T07:40:00.000Z')).toISOString()).toBe('2026-10-02T07:40:00.000Z')
  })

  it('subtracts 24 / 72 / 168 hours from that step', () => {
    expect(postedCutoff('1d', NOW)?.toISOString()).toBe('2026-10-01T07:40:00.000Z')
    expect(postedCutoff('3d', NOW)?.toISOString()).toBe('2026-09-29T07:40:00.000Z')
    expect(postedCutoff('7d', NOW)?.toISOString()).toBe('2026-09-25T07:40:00.000Z')
  })

  it('never returns a post older than its label, and misses at most the last 5 minutes of the window', () => {
    for (const t of ['2026-10-02T07:35:00.001Z', '2026-10-02T07:37:21.500Z', '2026-10-02T07:40:00.000Z']) {
      const now = new Date(t)
      for (const [v, h] of [['1d', 24], ['3d', 72], ['7d', 168]] as const) {
        const ageMs = now.getTime() - postedCutoff(v, now)!.getTime()
        expect(ageMs).toBeLessThanOrEqual(h * 3_600_000)
        expect(ageMs).toBeGreaterThan(h * 3_600_000 - 5 * 60_000)
      }
    }
  })

  it('is stable for every request inside one step (one memo key per 5 minutes)', () => {
    const a = postedCutoff('7d', new Date('2026-10-02T07:35:00.001Z'))
    const b = postedCutoff('7d', new Date('2026-10-02T07:40:00.000Z'))
    expect(a?.getTime()).toBe(b?.getTime())
  })

  it('returns null for anything that is not one of the three windows', () => {
    for (const v of ['', '2d', '7', '7D', 'all', 'toString', '__proto__', "7d' OR 1=1"]) expect(postedCutoff(v, NOW)).toBeNull()
  })

  it('offers exactly the windows the taxonomy offers', () => {
    const facet = facetsFor('rentals', null).find((f) => f.key === POSTED_FACET_KEY)
    expect(facet?.options.map((o) => o.value)).toEqual(Object.keys(POSTED_WINDOWS))
  })
})

describe('attr_posted in the feed filter', () => {
  it('becomes a postedAt clause, never an attributes match', () => {
    const w = attrWhere('posted', '7d') as { postedAt: { gte: Date } }
    expect(Object.keys(w)).toEqual(['postedAt'])
    expect(w.postedAt.gte).toBeInstanceOf(Date)
  })

  it('is no filter at all for an unknown window — never an error, never "match nothing"', () => {
    expect(attrWhere('posted', 'yesterday')).toEqual({})
    expect(attrWhere('posted', '')).toEqual({})
  })

  it('passes every grouped row in memory (the counts keep it in the database where)', () => {
    expect(attrMatcher('posted', '1d')({ attributes: null, facetTokens: null })).toBe(true)
  })
})

describe('where the Posted filter is offered', () => {
  const has = (sub: string | null) => facetsFor('rentals', sub).some((f) => f.key === POSTED_FACET_KEY)

  it('on the whole rentals view and every property subcategory', () => {
    expect(has(null)).toBe(true)
    for (const s of ['apartment-rental', 'house-rental', 'room-rental', 'hotel-short-stay', 'homestay-serviced', 'office-rental']) expect(has(s)).toBe(true)
  })

  it('not on vehicle hire', () => {
    for (const s of ['car-rental', 'motorbike-rental', 'bicycle-rental', 'ebike-rental']) expect(has(s)).toBe(false)
  })

  it('not outside rentals', () => {
    expect(facetsFor('electronics', null).some((f) => f.key === POSTED_FACET_KEY)).toBe(false)
  })

  it('is never asked by the post wizard', () => {
    expect(askableFacetsFor('rentals', 'apartment-rental').some((f) => f.key === POSTED_FACET_KEY)).toBe(false)
  })
})

describe('Posted in the count bases', () => {
  const p = new URLSearchParams('category=rentals&subcategory=apartment-rental&attr_posted=7d&attr_bedrooms=2')

  it('stays in the attribute rails\' base, so every other chip counts inside the window', () => {
    const r = releasedParams(p, 'attr')
    expect(r.get('attr_posted')).toBe('7d')
    expect(r.has('attr_bedrooms')).toBe(false)
  })

  it('is released from its own rail\'s base and nothing else is', () => {
    const r = releasedParams(p, 'posted')
    expect(r.has('attr_posted')).toBe(false)
    expect(r.get('attr_bedrooms')).toBe('2')
  })
})

describe('a stored posted attribute', () => {
  it('is dropped on save — the filter reads postedAt, so a stored copy would be dead state', async () => {
    const { sanitizeAttributes } = await import('./core/listings')
    expect(sanitizeAttributes({ posted: '7d', bedrooms: '2' })).toBe('{"bedrooms":"2"}')
    expect(sanitizeAttributes({ posted: '7d' })).toBeNull()
  })
})
