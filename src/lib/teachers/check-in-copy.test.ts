import { describe, expect, it } from 'vitest'
import { CHECK_IN_TITLE, checkInBody, checkInQuestion } from './check-in-copy'
import { inAvailabilityReview } from '@/lib/stale'

/**
 * The teachers' weekly check-in asks in the teacher's own terms (owner, 2026-10-27: "are you still looking for a job or
 * still available for cover etc, no sold there"), and a teacher's profile is never in the goods review again.
 */
describe('checkInQuestion — what the profile offers decides the question', () => {
  const q = (jobTypes: string[], coverOpen = false) => checkInQuestion({ jobTypes, coverOpen }).en
  it('a job (full-time or part-time), with cover named whenever cover is on — "yes" confirms the cover periods too', () => {
    expect(q(['fulltime'])).toBe('Still looking for a teaching job?')
    expect(q(['parttime', 'private'])).toBe('Still looking for a teaching job?')
    expect(q(['fulltime'], true)).toBe('Still looking for a teaching job — and free for cover lessons?')
  })
  it('private students only, cover only, and the fallback', () => {
    expect(q(['private'])).toBe('Still taking private students?')
    expect(q(['private'], true)).toBe('Still taking private students — and free for cover lessons?')
    expect(q([], true)).toBe('Still free for cover lessons?')
    expect(q([])).toBe('Still available to teach?')
  })
  it('every question has its Vietnamese, and none says "sold"', () => {
    for (const jobTypes of [['fulltime'], ['private'], []]) for (const coverOpen of [true, false]) {
      const x = checkInQuestion({ jobTypes, coverOpen })
      expect(x.vi.length).toBeGreaterThan(0)
      expect(`${x.en} ${x.vi} ${checkInBody({ jobTypes, coverOpen })} ${CHECK_IN_TITLE}`).not.toMatch(/sold|đã bán/i)
    }
  })
  it('the bell body is eno\'s bilingual composite: Vietnamese, then English, and says the profile stays up', () => {
    const b = checkInBody({ jobTypes: ['fulltime'], coverOpen: false })
    expect(b.indexOf('Bạn vẫn đang tìm việc dạy?')).toBe(0)
    expect(b).toContain(' · Still looking for a teaching job? Tap to answer — your profile stays up.')
  })
})

describe('inAvailabilityReview — the goods review never lists a teacher', () => {
  it('a teacher profile is out; goods, rentals, jobs and services stay in', () => {
    expect(inAvailabilityReview({ listingType: 'teacher' })).toBe(false)
    for (const listingType of ['sell', 'rent', 'job', 'service', null, undefined]) expect(inAvailabilityReview({ listingType })).toBe(true)
  })
})
