import { describe, expect, it } from 'vitest'
import { formatArticleDate } from './dates'

describe('formatArticleDate', () => {
  it('prints the English short form', () => {
    expect(formatArticleDate('2026-09-23', 'en')).toBe('23 Sep 2026')
    expect(formatArticleDate('2026-01-05', 'en')).toBe('5 Jan 2026')
  })

  it('prints the Vietnamese numeric form without leading zeros', () => {
    expect(formatArticleDate('2026-09-23', 'vi')).toBe('23/9/2026')
    expect(formatArticleDate('2026-01-05', 'vi')).toBe('5/1/2026')
  })

  it('takes the UTC calendar date of a timestamp, never the local one', () => {
    // 23:30 UTC on the 21st is already the 22nd in Vietnam. The ISO string's own date wins, so a
    // server in one zone and a browser in another print the same thing.
    expect(formatArticleDate('2026-07-21T23:30:00.000Z', 'en')).toBe('21 Jul 2026')
  })

  it('returns anything that is not an ISO date unchanged', () => {
    expect(formatArticleDate('soon', 'en')).toBe('soon')
    expect(formatArticleDate('2026-13-01', 'en')).toBe('2026-13-01')
  })
})
