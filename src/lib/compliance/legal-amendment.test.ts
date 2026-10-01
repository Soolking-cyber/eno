import { describe, expect, it } from 'vitest'
import { AMENDED, LEGAL_AMENDMENT, MIN_NOTICE_DAYS, dateEn, dateVi } from './legal-amendment'

describe('legal-amendment', () => {
  // Civil Code 2015 Art 147–148: the publication day is not counted, so "at least 5 days" needs the
  // in-force date to be at least publication + 6 calendar days.
  it('leaves at least the promised notice, with the publication day not counted', () => {
    const days = (Date.parse(LEGAL_AMENDMENT.inForce) - Date.parse(LEGAL_AMENDMENT.published)) / 86_400_000
    expect(days).toBeGreaterThanOrEqual(MIN_NOTICE_DAYS + 1)
  })

  it('formats both languages from the one ISO date', () => {
    expect(dateVi('2026-10-07')).toBe('07/10/2026')
    expect(dateEn('2026-10-07')).toBe('7 October 2026')
    expect(AMENDED.inForceVi).toBe(dateVi(LEGAL_AMENDMENT.inForce))
    expect(() => dateVi('07/10/2026')).toThrow()
  })
})
