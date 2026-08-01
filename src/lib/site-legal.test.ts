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
   * ⚠️ THE BOUNDARY IS MIDNIGHT IN VIETNAM, AND THIS TEST IS WHY IT CHANGED.
   *
   * The first implementation compared UTC date strings, so the switch landed at 07:00 Hanoi. That
   * was legally SAFE (later = more notice) but incoherent: for the first seven hours of the very
   * date the page names as its effective date, the page still said the previous version governed.
   * An external review (agy / Gemini 3.1 Pro) called it, and the fix is to compare instants against
   * Hanoi midnight — which still leaves 5 clear days, so nothing about compliance was traded away.
   *
   * The rule for anyone changing this: the effective instant must be midnight in the jurisdiction
   * the terms apply to, and the clear-day count must be re-checked afterwards. The test below does
   * both, so getting it wrong fails here rather than in front of a regulator.
   */
  it('switches exactly at midnight in Vietnam, not at UTC midnight', () => {
    const oneSecondBefore = inVietnam('2026-08-06T23:59:59')
    expect(tosVersionInForce(oneSecondBefore)).toBe(TOS_PREVIOUS_VERSION)

    const midnightHanoi = inVietnam(`${TOS_EFFECTIVE_FROM}T00:00:00`)
    expect(tosVersionInForce(midnightHanoi)).toBe(TOS_VERSION)

    // The old UTC-string implementation returned the PREVIOUS version here — the seven-hour
    // contradiction, pinned so it cannot come back.
    const halfPastMidnightHanoi = inVietnam(`${TOS_EFFECTIVE_FROM}T00:30:00`)
    expect(tosVersionInForce(halfPastMidnightHanoi)).toBe(TOS_VERSION)
  })

  /**
   * Neither is reachable through the app (every caller passes `new Date()` or nothing), but both
   * crashed or silently misbehaved in the first implementation, and a legal predicate should not
   * have a shape that CAN throw.
   */
  it('survives the inputs that broke the string comparison', () => {
    // `new Date('nonsense').toISOString()` threw a RangeError and took the route down with it.
    expect(tosVersionInForce(new Date('nonsense'))).toBe(TOS_PREVIOUS_VERSION)

    // Years past 9999 serialise as `+010000-01-01`, so slice(0,10) broke the ordering outright.
    expect(tosVersionInForce(new Date('+010000-01-01T00:00:00Z'))).toBe(TOS_VERSION)
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
