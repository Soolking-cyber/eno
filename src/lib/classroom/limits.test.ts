import { describe, expect, it } from 'vitest'
import { ageBand, ageRange, childBirthYearOk, effectiveMinutes, frequencyRefusal, ictDayStart, ictWeekStart, needsAssent, nextPracticeAt, under13 } from './limits'

const at = (iso: string) => new Date(iso)

describe('the practice day and week are Vietnam’s (ICT, UTC+7)', () => {
  it('a day starts at 00:00 ICT = 17:00 UTC the day before', () => {
    expect(ictDayStart(at('2026-10-25T16:59:59Z')).toISOString()).toBe('2026-10-24T17:00:00.000Z')
    expect(ictDayStart(at('2026-10-25T17:00:00Z')).toISOString()).toBe('2026-10-25T17:00:00.000Z')
  })
  it('a week starts on Monday 00:00 ICT', () => {
    // Sunday 25 Oct 2026, 23:30 ICT → the week that began Monday 19 Oct
    expect(ictWeekStart(at('2026-10-25T16:30:00Z')).toISOString()).toBe('2026-10-18T17:00:00.000Z')
    // Monday 26 Oct 2026, 00:10 ICT → a new week
    expect(ictWeekStart(at('2026-10-25T17:10:00Z')).toISOString()).toBe('2026-10-25T17:00:00.000Z')
  })
})

describe('age rules (birth year only) — ⛔ always the end of the range that protects the child', () => {
  const now = at('2026-06-01T00:00:00Z')
  it('a birth year is a range: 2013 → 12 or 13 in 2026', () => {
    expect(ageRange(2013, now)).toEqual({ min: 12, max: 13 })
  })
  it('bands by the YOUNGEST possible age; an account holder is an adult', () => {
    expect(ageBand('self', null, now)).toBe('adult')
    expect(ageBand('child', 2017, now)).toBe('child-young') // 8 or 9
    expect(ageBand('child', 2016, now)).toBe('child-young') // 9 or 10 → the younger band
    expect(ageBand('child', 2015, now)).toBe('child') // 10 or 11
    expect(ageBand('child', 2013, now)).toBe('child') // 12 or 13 → child, never teen
    expect(ageBand('child', 2012, now)).toBe('teen')
  })
  it('⛔ a child born in 2013 is treated as under 13 all through 2026 (voice-only, 10-minute cap)', () => {
    expect(under13('child', 2013, now)).toBe(true)
    expect(under13('child', 2012, now)).toBe(false)
    expect(effectiveMinutes(20, 'child', 2013, now)).toBe(10)
    expect(effectiveMinutes(20, 'child', 2012, now)).toBe(20)
    expect(effectiveMinutes(20, 'self', null, now)).toBe(20)
  })
  it('assent is asked whenever the child MIGHT be 7 (born 2019 → 6 or 7)', () => {
    expect(needsAssent('child', 2019, now)).toBe(true)
    expect(needsAssent('child', 2020, now)).toBe(false)
    expect(needsAssent('self', null, now)).toBe(false)
  })
  it('a child is certainly 3 or older, and may still be 17', () => {
    expect(childBirthYearOk(2023, now)).toBe(false) // 2 or 3 — may still be 2
    expect(childBirthYearOk(2022, now)).toBe(true) // 3 or 4
    expect(childBirthYearOk(2008, now)).toBe(true) // 17 or 18
    expect(childBirthYearOk(2007, now)).toBe(false) // 18 or 19
    expect(childBirthYearOk(2015.5, now)).toBe(false)
  })
})

describe('frequency', () => {
  it('one a day, N a week — ⛔ the week first, so the date it names is the real one', () => {
    expect(frequencyRefusal(0, 0, 3)).toBeNull()
    expect(frequencyRefusal(2, 1, 3)).toBe('day_limit')
    expect(frequencyRefusal(3, 0, 3)).toBe('week_limit')
    expect(frequencyRefusal(3, 1, 3)).toBe('week_limit') // the third of three was today: next Monday, not tomorrow
  })
  it('a start the learner never spoke in may be retried — up to the day’s start cap', () => {
    expect(frequencyRefusal(0, 0, 3, 2)).toBeNull()
    expect(frequencyRefusal(0, 0, 3, 3)).toBe('day_limit')
  })
  it('names when practice opens again', () => {
    const now = at('2026-10-22T03:00:00Z') // Thursday 10:00 ICT
    expect(nextPracticeAt('day_limit', now).toISOString()).toBe('2026-10-22T17:00:00.000Z')
    expect(nextPracticeAt('week_limit', now).toISOString()).toBe('2026-10-25T17:00:00.000Z')
  })
})
