import { describe, expect, it } from 'vitest'
import { LEGAL_AMENDMENT } from './compliance/legal-amendment'
import {
  AFFILIATION,
  COMPANY,
  OPERATOR_REGISTERED,
  TOS_EFFECTIVE_AT,
  TOS_PREVIOUS_VERSION,
  TOS_VERSION,
  tosAcceptanceStamp,
  tosInNoticeWindow,
  tosVersionInForce,
} from './site-legal'

/**
 * The legal identity, the affiliation statement, and — since the October 2026 amendment — the
 * Terms-version notice window.
 *
 * The window is a LEGAL mechanism, not a UI nicety, so it is tested like one. Every failure mode is
 * SILENT: a wrong comparison, an off-by-one date or a timezone slip does not throw, fail a build or
 * look wrong on screen — it quietly records an acceptance of text that was not yet in force, or
 * binds people before the notice the texts promise has run.
 */

describe('the operator identity', () => {
  it('never asserts a company that does not exist yet', () => {
    // ⚠️ THE FLAG IS THE GATE, NOT THE PLACEHOLDER TEXT. Copy that reads "operated by X, ERC no. Y"
    // is a false statement until the certificate is in hand, and "đang cập nhật" in a field labelled
    // "registration no." does not read as a disclaimer to anyone.
    expect(OPERATOR_REGISTERED).toBe(COMPANY.registered)
    if (!OPERATOR_REGISTERED) {
      expect(COMPANY.erc).not.toMatch(/\d{6,}/)
      expect(COMPANY.name).toMatch(/đang đăng ký|registration in progress/i)
    }
  })

  it('carries no invented registration number anywhere', () => {
    // A real-looking ERC or licence number in any field is a legal defect no lint can see.
    for (const value of [COMPANY.erc, COMPANY.ercIssued, COMPANY.phone, COMPANY.address]) {
      expect(value, `${value} looks like a real registration number`).not.toMatch(/^\s*\d{9,}\s*$/)
    }
  })
})

describe('the affiliation statement', () => {
  it('discloses the relationship rather than denying it', () => {
    // ⚠️ The one thing it may never say is that the sites are unrelated: one codebase, one brand,
    // one pending operator, and they cross-link. A false disclosure is worse than none.
    for (const text of [AFFILIATION.en, AFFILIATION.shortEn]) {
      expect(text).toMatch(/related/i)
      expect(text).not.toMatch(/unrelated|independent of|no connection/i)
    }
  })

  it('names no service — it ships in the marketplace bundle too', () => {
    for (const text of Object.values(AFFILIATION)) {
      expect(text, 'AFFILIATION reaches eno.vn\'s artifact; naming a service here leaks it').not.toMatch(
        /visa|thị thực|hộ chiếu|passport|PayPal|itinerary/i,
      )
    }
  })

  it('has an authored Vietnamese pass, not a machine translation of the English', () => {
    expect(AFFILIATION.vi).not.toBe(AFFILIATION.en)
    expect(AFFILIATION.vi).toMatch(/[ạảấầệếịọồộớởủữỳỹăâđêôơư]/i)
  })
})

/** Vietnam is UTC+7 with no DST, so a wall-clock time there is a fixed offset from UTC. */
const inVietnam = (isoLocal: string) => new Date(`${isoLocal}+07:00`)
const { published, inForce } = LEGAL_AMENDMENT
const dayBefore = new Date(Date.parse(`${inForce}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)

describe('the terms version', () => {
  it('has a newer published version and the one it replaces', () => {
    expect(TOS_VERSION).toBe('2')
    expect(TOS_PREVIOUS_VERSION).toBe('1')
  })

  it('takes effect at midnight in Vietnam on the in-force date, read from LEGAL_AMENDMENT', () => {
    expect(TOS_EFFECTIVE_AT).toBe(Date.parse(`${inForce}T00:00:00+07:00`))
    // 17:00 UTC the day before — the instant a UTC date-string comparison would have missed by 7 hours.
    expect(new Date(TOS_EFFECTIVE_AT).toISOString()).toBe(`${dayBefore}T17:00:00.000Z`)
  })
})

describe('the version in force', () => {
  it('is the PREVIOUS version from publication until the instant', () => {
    expect(tosVersionInForce(inVietnam(`${published}T00:00:00`))).toBe(TOS_PREVIOUS_VERSION)
    expect(tosVersionInForce(inVietnam(`${published}T12:00:00`))).toBe(TOS_PREVIOUS_VERSION)
    expect(tosVersionInForce(inVietnam(`${dayBefore}T23:59:59`))).toBe(TOS_PREVIOUS_VERSION)
  })

  it('switches exactly at midnight in Vietnam, not at UTC midnight', () => {
    expect(tosVersionInForce(new Date(TOS_EFFECTIVE_AT - 1))).toBe(TOS_PREVIOUS_VERSION)
    expect(tosVersionInForce(new Date(TOS_EFFECTIVE_AT))).toBe(TOS_VERSION)
    // Half past midnight in Hanoi is still the previous UTC day: the old UTC-string implementation
    // returned the PREVIOUS version here, for seven hours of the date the pages name as in force.
    expect(tosVersionInForce(inVietnam(`${inForce}T00:30:00`))).toBe(TOS_VERSION)
    expect(tosVersionInForce(new Date(`${inForce}T00:00:00Z`))).toBe(TOS_VERSION)
  })

  it('stays the new version afterwards', () => {
    expect(tosVersionInForce(inVietnam(`${inForce}T09:00:00`))).toBe(TOS_VERSION)
    expect(tosVersionInForce(inVietnam('2027-06-01T00:00:00'))).toBe(TOS_VERSION)
  })

  it('survives the inputs that broke the string comparison, failing toward more notice', () => {
    expect(tosVersionInForce(new Date('nonsense'))).toBe(TOS_PREVIOUS_VERSION)
    expect(tosVersionInForce(new Date('+010000-01-01T00:00:00Z'))).toBe(TOS_VERSION)
  })
})

describe('the notice window', () => {
  it('is open before the instant and closed from it', () => {
    expect(tosInNoticeWindow(inVietnam(`${published}T08:00:00`))).toBe(true)
    expect(tosInNoticeWindow(new Date(TOS_EFFECTIVE_AT - 1))).toBe(true)
    expect(tosInNoticeWindow(new Date(TOS_EFFECTIVE_AT))).toBe(false)
  })

  it('leaves at least 5 clear days between publication and the instant', () => {
    // Publication day not counted (Civil Code 2015 Art 147–148): published 01/10 → 02/10–06/10 → 07/10.
    const fromEndOfPublicationDay = TOS_EFFECTIVE_AT - Date.parse(`${published}T00:00:00+07:00`) - 86_400_000
    expect(fromEndOfPublicationDay / 86_400_000).toBeGreaterThanOrEqual(5)
  })
})

describe('the acceptance stamp', () => {
  it('records the version IN FORCE, never the newest, during the window', () => {
    const now = inVietnam(`${published}T15:00:00`)
    expect(tosAcceptanceStamp(null, now)).toEqual({ tosAcceptedAt: now, tosVersion: TOS_PREVIOUS_VERSION })
    // Already holding the version in force: nothing is re-stamped.
    expect(tosAcceptanceStamp(TOS_PREVIOUS_VERSION, now)).toEqual({})
  })

  it('records the new version from the instant, and re-stamps an older acceptance', () => {
    const now = new Date(TOS_EFFECTIVE_AT)
    expect(tosAcceptanceStamp(null, now)).toEqual({ tosAcceptedAt: now, tosVersion: TOS_VERSION })
    expect(tosAcceptanceStamp(TOS_PREVIOUS_VERSION, now)).toEqual({ tosAcceptedAt: now, tosVersion: TOS_VERSION })
    expect(tosAcceptanceStamp(TOS_VERSION, now)).toEqual({})
  })

  it('stamps the time and the version from ONE clock read', () => {
    // One millisecond before the instant: the version and the timestamp must describe the same moment.
    const now = new Date(TOS_EFFECTIVE_AT - 1)
    const stamp = tosAcceptanceStamp(undefined, now)
    expect(stamp.tosAcceptedAt).toBe(now)
    expect(stamp.tosVersion).toBe(tosVersionInForce(now))
  })
})
