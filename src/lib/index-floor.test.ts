import { describe, expect, it } from 'vitest'
import { MIN_INDEXABLE_LISTINGS, isIndexableCount } from './index-floor'

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
