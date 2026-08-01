import { describe, expect, it } from 'vitest'
import { AFFILIATION, COMPANY, OPERATOR_REGISTERED, TOS_VERSION } from './site-legal'

/**
 * ⚠️ THIS FILE USED TO TEST A 5-DAY TERMS-CHANGE NOTICE WINDOW, WHICH WAS PREMATURE AND IS GONE.
 * The site is pre-launch with no real users, so there is one Terms version, nobody accepted an
 * earlier one, and there is no change to announce. What remains worth pinning is narrower and
 * survives that: the legal identity must not start asserting a company that does not exist, and the
 * affiliation statement must not claim the two sites are unrelated.
 *
 * When the first real amendment happens, the notice machinery comes back (see the comment on
 * TOS_VERSION for what it needs and which commits to recover it from) — and so do its tests.
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

describe('the terms version', () => {
  it('is a single current version with no transition state', () => {
    expect(TOS_VERSION).toBe('1')
  })
})
