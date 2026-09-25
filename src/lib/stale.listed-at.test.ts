import { describe, expect, it } from 'vitest'
import { listedAt } from './stale'

describe('listedAt — when a listing appeared on eno', () => {
  it('is postedAt for a listing a person posted and bumped', () => {
    const createdAt = new Date('2026-08-01T00:00:00Z')
    const postedAt = new Date('2026-09-10T00:00:00Z') // a "still available" bump moved it forward
    expect(listedAt({ postedAt, createdAt })).toBe(postedAt)
  })

  it('is createdAt for an import whose postedAt carries the merchant publish date', () => {
    // SuperSports: postedAt backdated for ranking, but the row arrived today — "Posted a year ago"
    // on new stock, and a priceValidUntil already in the past, are the two bugs this prevents.
    const postedAt = new Date('2025-06-01T00:00:00Z')
    const createdAt = new Date('2026-09-17T00:00:00Z')
    expect(listedAt({ postedAt, createdAt })).toBe(createdAt)
  })

  it('falls back to postedAt when createdAt is not selected', () => {
    const postedAt = new Date('2026-09-01T00:00:00Z')
    expect(listedAt({ postedAt })).toBe(postedAt)
    expect(listedAt({ postedAt, createdAt: null })).toBe(postedAt)
  })
  it('a JOB shows its posting date, not the day it was imported', () => {
    const postedAt = new Date('2026-09-20T00:00:00Z')
    const createdAt = new Date('2026-09-25T00:00:00Z')
    expect(listedAt({ postedAt, createdAt, listingType: 'job' })).toBe(postedAt)
    expect(listedAt({ postedAt, createdAt, listingType: 'sell' })).toBe(createdAt)
  })
})
