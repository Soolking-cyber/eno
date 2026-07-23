import { describe, expect, it } from 'vitest'
import { taxVerdict, type TaxFacts } from './tax-lookup'

// The DERIVED verdict is the honesty-critical half: facts are stored once, but the
// badge must re-verdict against the CURRENT legal name on every read, suppress when
// unknown, and never upgrade weak name matches (dual plan review 2026-07-23).

const base: TaxFacts = {
  taxCode: '0100109106',
  taxCheckedAt: new Date('2026-07-23'),
  taxRegisteredName: 'TẬP ĐOÀN CÔNG NGHIỆP - VIỄN THÔNG QUÂN ĐỘI',
  taxActive: true,
  legalName: 'Tập đoàn Công nghiệp - Viễn thông Quân đội',
  name: 'Viettel Store',
}

describe('taxVerdict', () => {
  it('verifies a diacritic-folded exact match against legalName', () => {
    expect(taxVerdict(base)).toBe('verified')
  })

  it('falls back to the storefront name when legalName is empty', () => {
    expect(taxVerdict({ ...base, legalName: null, name: 'Tập đoàn Công nghiệp - Viễn thông Quân đội' })).toBe('verified')
  })

  it('accepts containment only when the shorter side is >=8 chars', () => {
    // Long substring — a branch storefront under the registered group name.
    expect(taxVerdict({ ...base, legalName: 'Viễn thông Quân đội' })).toBe('verified')
    // Short generic fragment must NOT verify (the review's false-positive catch).
    expect(taxVerdict({ ...base, legalName: 'Quân' })).toBe('mismatch')
  })

  it('mismatch when the names genuinely differ', () => {
    expect(taxVerdict({ ...base, legalName: 'Công ty TNHH ABC' })).toBe('mismatch')
  })

  it('unchecked when never looked up or the code is empty — nothing may surface', () => {
    expect(taxVerdict({ ...base, taxCheckedAt: null })).toBe('unchecked')
    expect(taxVerdict({ ...base, taxCode: null })).toBe('unchecked')
  })

  it('not_found when the registry positively did not know the code', () => {
    expect(taxVerdict({ ...base, taxActive: false, taxRegisteredName: null })).toBe('not_found')
  })

  it('inactive when the taxpayer is registered but not active', () => {
    expect(taxVerdict({ ...base, taxActive: false })).toBe('inactive')
  })

  it('mismatch (never verified) when a registered name exists but the seller has no names', () => {
    expect(taxVerdict({ ...base, legalName: null, name: '' })).toBe('mismatch')
  })
})

describe('taxVerdict freshness (diff review)', () => {
  it('reads facts past the TTL as unchecked — an old snapshot cannot keep a badge alive', () => {
    const stale = { ...base, taxCheckedAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000) }
    expect(taxVerdict(stale)).toBe('unchecked')
  })
})
