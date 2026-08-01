import { describe, expect, it } from 'vitest'
import {
  TOS_EFFECTIVE_FROM,
  TOS_NOTICE,
  TOS_PREVIOUS_VERSION,
  TOS_VERSION,
  tosInNoticeWindow,
  tosVersionInForce,
} from './site-legal'

/**
 * The notice window is a LEGAL mechanism, not a UI nicety, so it gets tested like one.
 *
 * Decree 52/2013 Đ.38.3 requires a material change to the Terms/Operating Regulations to be
 * announced on-platform at least 5 days BEFORE it takes effect, and `/regulations` promises exactly
 * that in Vietnamese on the page MoIT reads. Before `TOS_EFFECTIVE_FROM` existed there was nothing
 * behind that sentence: a bumped `TOS_VERSION` bound users the moment it deployed, so publishing
 * the promise would have broken it.
 *
 * What makes this worth a test file rather than a careful read: every failure mode here is SILENT.
 * A wrong comparison, an off-by-one date or a timezone slip does not throw, does not fail a build,
 * and does not look wrong on screen — it just quietly binds people to text they were promised five
 * days to read.
 */

/** Vietnam is UTC+7 and has no DST, so a wall-clock time there is a fixed offset from UTC. */
const inVietnam = (isoLocal: string) => new Date(`${isoLocal}+07:00`)

describe('the version in force', () => {
  it('is the PREVIOUS version throughout the notice window', () => {
    expect(tosVersionInForce(inVietnam('2026-08-01T12:00:00'))).toBe(TOS_PREVIOUS_VERSION)
    expect(tosVersionInForce(inVietnam('2026-08-05T23:59:59'))).toBe(TOS_PREVIOUS_VERSION)
  })

  it('is the NEW version once the effective date has passed', () => {
    expect(tosVersionInForce(inVietnam('2026-08-20T09:00:00'))).toBe(TOS_VERSION)
    expect(tosVersionInForce(inVietnam('2027-01-01T00:00:00'))).toBe(TOS_VERSION)
  })

  /**
   * ⚠️ THE TIMEZONE QUESTION, PINNED — and the reason it is pinned rather than reasoned about.
   *
   * The comparison is done on `toISOString()`, which is UTC, while every user and the regulator are
   * UTC+7. So the switch does NOT happen at midnight in Vietnam; it happens at 07:00 Vietnam time,
   * when UTC finally reaches the date.
   *
   * That is the SAFE direction and the test says so explicitly: the new terms start binding LATER
   * than the promised date, never earlier. A user in Hanoi at 00:30 on the effective date is still
   * on the old version — they got more notice than promised, not less. Had the skew gone the other
   * way (binding at 17:00 the day BEFORE), the site would silently deliver four days and seventeen
   * hours of a five-day statutory notice, and nothing would have flagged it.
   *
   * If this is ever "fixed" to compare in Asia/Ho_Chi_Minh, the direction must stay: round toward
   * MORE notice.
   */
  it('switches LATER in Vietnam than the stated date, never earlier', () => {
    const midnightHanoi = inVietnam(`${TOS_EFFECTIVE_FROM}T00:00:00`)
    expect(tosVersionInForce(midnightHanoi)).toBe(TOS_PREVIOUS_VERSION)

    const sevenAmHanoi = inVietnam(`${TOS_EFFECTIVE_FROM}T07:00:00`)
    expect(tosVersionInForce(sevenAmHanoi)).toBe(TOS_VERSION)

    // The day BEFORE must never bind, at any hour — this is the direction that would be unlawful.
    const lateEveningBefore = inVietnam('2026-08-06T23:59:59')
    expect(tosVersionInForce(lateEveningBefore)).toBe(TOS_PREVIOUS_VERSION)
  })
})

describe('the notice window', () => {
  it('is open before the effective date and closed after', () => {
    expect(tosInNoticeWindow(inVietnam('2026-08-02T10:00:00'))).toBe(true)
    expect(tosInNoticeWindow(inVietnam('2026-08-20T10:00:00'))).toBe(false)
  })

  it('gives at least 5 clear days between publication and effect', () => {
    // Publication is the deploy that carried the announcement: 2026-08-01.
    const published = Date.parse('2026-08-01T00:00:00Z')
    const effective = Date.parse(`${TOS_EFFECTIVE_FROM}T00:00:00Z`)
    const clearDays = (effective - published) / 86_400_000 - 1
    expect(clearDays).toBeGreaterThanOrEqual(5)
  })
})

describe('the notice copy', () => {
  it('is authored in both languages and names all three facts a reader needs', () => {
    for (const text of [TOS_NOTICE.en, TOS_NOTICE.vi]) {
      expect(text).toContain(TOS_VERSION)
      expect(text).toContain(TOS_PREVIOUS_VERSION)
      expect(text).toContain(TOS_EFFECTIVE_FROM)
    }
    // Authored Vietnamese, not a machine translation of the English — which version binds a user is
    // not a sentence to hand to MT. Cheap proxy: real Vietnamese diacritics are present.
    expect(TOS_NOTICE.vi).toMatch(/[ạảấầệhiếịọồộớởủữỳỹăâđêôơư]/i)
    expect(TOS_NOTICE.vi).not.toBe(TOS_NOTICE.en)
  })

  it('stays in step with the constants when they change', () => {
    // The getters interpolate rather than hardcode, so a version bump cannot leave the sentence
    // describing the previous change — the failure that makes a notice worse than none.
    expect(TOS_NOTICE.en).toContain(`Version ${TOS_VERSION}`)
    expect(TOS_VERSION).not.toBe(TOS_PREVIOUS_VERSION)
  })
})
