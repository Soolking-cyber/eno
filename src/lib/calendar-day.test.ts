import { describe, expect, it } from 'vitest'
import { formatCalendarDay, vnCalendarDay, longCalendarDate } from './calendar-day'

describe('formatCalendarDay — a readable day with no clock (and no Intl for en / vi, the two the server renders)', () => {
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

  it('the nine machine-translated languages get their own month names — zone-free, the Vietnam day', () => {
    // CLDR-shaped: assert the number and the localized month, not ICU's spacing or abbreviation dot.
    expect(formatCalendarDay('2026-01-02', 'ko')).toMatch(/^2026년\s*1월\s*2일$/)
    expect(formatCalendarDay('2026-10-08', 'fr')).toMatch(/^8\s+oct\.?\s+2026$/)
    expect(formatCalendarDay('2026-10-08', 'ru', { year: false })).toMatch(/^8\s+окт\.?$/)
    // 20:00 UTC on the 23rd is the 24th in Hanoi in every language, not only en / vi.
    expect(formatCalendarDay('2026-09-23T20:00:00Z', 'ja', { year: false })).toMatch(/^9月\s*24日$/)
  })
  it('a day that does not exist is never rolled into the next month for the nine', () => {
    expect(formatCalendarDay('2026-02-31', 'fr')).toBe('2026-02-31') // unchanged, like any non-date
    expect(longCalendarDate('2026-02-31', 'ru')).toBe('2026-02-31')
    expect(longCalendarDate('2026-02-28', 'ru')).toMatch(/^28\s+февраля\s+2026/)
  })

  it('returns anything that is not a date unchanged', () => {
    expect(formatCalendarDay('Online', 'en')).toBe('Online')
    expect(formatCalendarDay('2026-13-40', 'en')).toBe('2026-13-40')
    expect(formatCalendarDay('', 'vi')).toBe('')
  })
})
