import { describe, expect, it } from 'vitest'
import { inboxTime } from './types'

/** The inbox row's time (break-ui, 2026-10-05): relative for a week, then a date; a far-future time is a date. */
describe('inboxTime', () => {
  const now = Date.UTC(2026, 9, 5, 5, 0, 0) // 2026-10-05 12:00 in Vietnam
  const at = (ms: number) => new Date(now - ms).toISOString()
  const DAY = 24 * 60 * 60 * 1000
  it('stays relative inside the first week', () => {
    expect(inboxTime(at(2 * 60 * 60 * 1000), 'vi', now)).toBe('2 giờ trước')
    expect(inboxTime(at(6 * DAY), 'en', now)).toBe('6d ago')
  })
  it('becomes a date after a week — with the year once it is not this year', () => {
    expect(inboxTime(at(40 * DAY), 'vi', now)).toMatch(/thg/)
    expect(inboxTime(at(40 * DAY), 'vi', now)).not.toMatch(/trước/)
    expect(inboxTime(at(3 * 365 * DAY), 'vi', now)).toMatch(/20(23|24)/)
  })
  it('a few seconds of clock skew still reads "just now"', () => {
    expect(inboxTime(new Date(now + 5_000).toISOString(), 'vi', now)).toBe('vừa xong')
  })
  it('a far-future time (bad data) is a date, not "just now" forever', () => {
    expect(inboxTime(new Date(now + 30 * DAY).toISOString(), 'vi', now)).not.toBe('vừa xong')
  })
  it('an unparseable time renders nothing', () => {
    expect(inboxTime('not a date', 'vi', now)).toBe('')
  })
})
