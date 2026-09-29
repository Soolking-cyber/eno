import { describe, expect, it } from 'vitest'
import { formatCalendarDay, vnCalendarDay } from './calendar-day'

describe('formatCalendarDay — a readable day with no Intl and no clock', () => {
  it('writes a bare YYYY-MM-DD the way each language does, never shifting it', () => {
    expect(formatCalendarDay('2026-10-08', 'en')).toBe('8 Oct 2026')
    expect(formatCalendarDay('2026-10-08', 'vi')).toBe('8/10/2026')
    expect(formatCalendarDay('2026-10-08', 'en', { year: false })).toBe('8 Oct')
    expect(formatCalendarDay('2026-10-08', 'vi', { year: false })).toBe('8/10')
  })

  it('gives the VIETNAM day of a timestamp, not the UTC one', () => {
    // 20:00 UTC on the 23rd is 03:00 on the 24th in Hanoi — the old UTC slice printed the 23rd.
    expect(formatCalendarDay('2026-09-23T20:00:00Z', 'en')).toBe('24 Sep 2026')
    expect(formatCalendarDay('2026-09-23T20:00:00.000Z', 'vi', { year: false })).toBe('24/9')
    expect(vnCalendarDay('2026-12-31T17:00:00Z')).toEqual({ y: 2027, m: 1, d: 1 })
  })

  it('English is the form for every non-Vietnamese language', () => {
    expect(formatCalendarDay('2026-01-02', 'ko')).toBe('2 Jan 2026')
  })

  it('returns anything that is not a date unchanged', () => {
    expect(formatCalendarDay('Online', 'en')).toBe('Online')
    expect(formatCalendarDay('2026-13-40', 'en')).toBe('2026-13-40')
    expect(formatCalendarDay('', 'vi')).toBe('')
  })
})
