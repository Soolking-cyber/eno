import { describe, expect, it } from 'vitest'
import {
  MIN_CATEGORY_LISTINGS,
  MIN_INDEXABLE_LISTINGS,
  STALE_NOINDEX_DAYS,
  STALE_NOINDEX_MS,
  belowFloorThroughWindow,
  isIndexableCount,
  staleWindowStart,
} from './index-floor'

describe('the district-page indexing floor', () => {
  it('is 10 listings (owner decision I-a)', () => {
    expect(MIN_INDEXABLE_LISTINGS).toBe(10)
  })

  it('passes at the floor and above, fails one below it', () => {
    expect(isIndexableCount(MIN_INDEXABLE_LISTINGS - 1)).toBe(false)
    expect(isIndexableCount(MIN_INDEXABLE_LISTINGS)).toBe(true)
    expect(isIndexableCount(3741)).toBe(true)
  })

  it('fails on nothing, and on a value that is not a count', () => {
    for (const n of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) expect(isIndexableCount(n), String(n)).toBe(false)
  })
})

/**
 * ⛔ THE STALE-NOINDEX WINDOW (SEO wave B, I1b; owner decision I-g, 2026-09-28): a page says `noindex`
 * only after 14 days under its floor. The query side is src/lib/stale-noindex.test.ts.
 */
describe('the stale-noindex window', () => {
  const NOW = Date.UTC(2026, 8, 29, 8, 0, 0)

  it('is 14 days (decision I-g), and a category page\'s floor is one live listing (decision I-a)', () => {
    expect(STALE_NOINDEX_DAYS).toBe(14)
    expect(STALE_NOINDEX_MS).toBe(14 * 86_400_000)
    expect(MIN_CATEGORY_LISTINGS).toBe(1)
  })

  it('starts exactly 14 days before now', () => {
    expect(staleWindowStart(NOW).toISOString()).toBe('2026-09-15T08:00:00.000Z')
  })

  it('an empty category: noindex only when nothing left inside the window', () => {
    expect(belowFloorThroughWindow(0, 0, MIN_CATEGORY_LISTINGS)).toBe(true)
    expect(belowFloorThroughWindow(0, 1, MIN_CATEGORY_LISTINGS)).toBe(false)
    expect(belowFloorThroughWindow(1, 0, MIN_CATEGORY_LISTINGS)).toBe(false)
  })

  it('a district page: noindex only when what it holds plus what left stays under 10', () => {
    const F = MIN_INDEXABLE_LISTINGS
    expect(belowFloorThroughWindow(F - 1, 0, F)).toBe(true) // 9, nothing left: under 10 all along
    expect(belowFloorThroughWindow(F - 1, 1, F)).toBe(false) // 9 + 1 that left: it may have held 10
    expect(belowFloorThroughWindow(5, 4, F)).toBe(true)
    expect(belowFloorThroughWindow(5, 5, F)).toBe(false)
    expect(belowFloorThroughWindow(1, 0, F)).toBe(true) // /c/rentals/can-gio, one place
    expect(belowFloorThroughWindow(F, 0, F)).toBe(false) // at the floor is never below it
  })

  it('fails toward indexable on a count that is not a number', () => {
    expect(belowFloorThroughWindow(Number.NaN, 0, MIN_INDEXABLE_LISTINGS)).toBe(false)
    expect(belowFloorThroughWindow(0, Number.NaN, MIN_CATEGORY_LISTINGS)).toBe(false)
  })
})
