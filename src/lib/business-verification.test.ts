import { describe, expect, it } from 'vitest'
import {
  isBusinessVerified,
  sellerIdentityHash,
  verificationView,
  nameMatchesLegal,
  VERIFICATION_VALIDITY_MS,
  type VerificationFacts,
} from './business-verification'

// The badge's entire honesty rests on the identity-hash derivation (external review made
// it the design): a badge is live ONLY while the approved hash still equals the seller's
// CURRENT identity hash, the window hasn't lapsed, and Channel 1 (tax) is verified live.
// These tests pin exactly that, because a passing click-through can't see a stale badge.

const future = new Date(Date.now() + 30 * 86_400_000)
const past = new Date(Date.now() - 1)
const freshCheck = new Date() // taxCheckedAt within the 180-day TTL

/** A seller whose Channel 1 is 'verified' and whose identity hash is stamped as approved. */
function verifiedSeller(over: Partial<VerificationFacts> = {}): VerificationFacts {
  const base = {
    name: 'ACME Store', legalName: 'CONG TY ACME', legalAddress: '1 Le Loi, HCMC',
    idNumber: '0300588569', taxCode: '0300588569',
    taxCheckedAt: freshCheck, taxRegisteredName: 'CONG TY ACME', taxActive: true,
    verifiedUntil: future,
  }
  const identity = { name: base.name, legalName: base.legalName, legalAddress: base.legalAddress, idNumber: base.idNumber, taxCode: base.taxCode }
  return { ...base, verifiedIdentityHash: sellerIdentityHash(identity), ...over }
}

describe('sellerIdentityHash', () => {
  it('is stable under cosmetic re-accenting/casing but changes on a material edit', () => {
    const a = sellerIdentityHash({ name: 'ACME', legalName: 'Công Ty', legalAddress: 'X', idNumber: '1', taxCode: '2' })
    const b = sellerIdentityHash({ name: 'acme', legalName: 'CONG TY', legalAddress: 'x', idNumber: '1', taxCode: '2' })
    expect(a).toBe(b) // fold() folds diacritics + case
    const c = sellerIdentityHash({ name: 'ACME', legalName: 'Công Ty Khac', legalAddress: 'X', idNumber: '1', taxCode: '2' })
    expect(c).not.toBe(a)
  })

  it('a display-NAME change alone changes the hash (brand-impersonation guard)', () => {
    const base = { name: 'ACME', legalName: 'L', legalAddress: 'A', idNumber: '1', taxCode: '2' }
    expect(sellerIdentityHash({ ...base, name: 'APPLE OFFICIAL' })).not.toBe(sellerIdentityHash(base))
  })
})

describe('isBusinessVerified', () => {
  it('true for a fresh approval matching the live identity + verified tax', () => {
    expect(isBusinessVerified(verifiedSeller())).toBe(true)
  })

  it('DROPS the moment any identity field is edited after approval — no reset write needed', () => {
    for (const edit of [{ legalName: 'CONG TY MOI' }, { name: 'DIFFERENT SHOP' }, { taxCode: '0101248141' }, { idNumber: '999' }, { legalAddress: '2 Nguyen Hue' }]) {
      expect(isBusinessVerified(verifiedSeller(edit)), JSON.stringify(edit)).toBe(false)
    }
  })

  it('DROPS when the validity window has lapsed (no indefinite latch)', () => {
    expect(isBusinessVerified(verifiedSeller({ verifiedUntil: past }))).toBe(false)
  })

  it('DROPS when Channel 1 is no longer verified live (stale/renamed tax facts)', () => {
    expect(isBusinessVerified(verifiedSeller({ taxActive: false }))).toBe(false)
    expect(isBusinessVerified(verifiedSeller({ taxCheckedAt: new Date(Date.now() - 200 * 86_400_000) }))).toBe(false)
    expect(isBusinessVerified(verifiedSeller({ taxRegisteredName: 'SOMEONE ELSE' }))).toBe(false)
  })

  it('false when never approved', () => {
    expect(isBusinessVerified(verifiedSeller({ verifiedIdentityHash: null }))).toBe(false)
    expect(isBusinessVerified(verifiedSeller({ verifiedUntil: null }))).toBe(false)
  })
})

describe('verificationView (what the applicant sees)', () => {
  it('verified when the badge is live', () => {
    expect(verificationView(verifiedSeller(), 'approved')).toBe('verified')
  })
  it('pending while a case awaits review', () => {
    const s = verifiedSeller({ verifiedIdentityHash: null, verifiedUntil: null })
    expect(verificationView(s, 'pending')).toBe('pending')
  })
  it('expired when an approval no longer matches (edited or lapsed)', () => {
    expect(verificationView(verifiedSeller({ legalName: 'MOVED' }), 'approved')).toBe('expired')
    expect(verificationView(verifiedSeller({ verifiedUntil: past }), 'approved')).toBe('expired')
  })
  it('rejected when the last case was rejected and never verified', () => {
    const s = verifiedSeller({ verifiedIdentityHash: null, verifiedUntil: null })
    expect(verificationView(s, 'rejected')).toBe('rejected')
  })
  it('changes_needed when a tax code is set but Channel 1 is not verified', () => {
    const s = verifiedSeller({ verifiedIdentityHash: null, verifiedUntil: null, taxRegisteredName: 'MISMATCH CO' })
    expect(verificationView(s, null)).toBe('changes_needed')
  })
  it('unverified for a plain business with nothing done', () => {
    const s = verifiedSeller({ verifiedIdentityHash: null, verifiedUntil: null, taxCode: null, taxCheckedAt: null })
    expect(verificationView(s, null)).toBe('unverified')
  })
})

describe('nameMatchesLegal (the reviewer hint)', () => {
  it('folds diacritics and accepts containment when the shorter side is >=8 chars', () => {
    expect(nameMatchesLegal('Công Ty ACME Việt Nam', 'CONG TY ACME', 'x')).toBe(true)
    expect(nameMatchesLegal('CONG TY ACME', 'CONG TY ACME', 'x')).toBe(true)
  })
  it('rejects a short generic containment and empties', () => {
    expect(nameMatchesLegal('AN', 'AN NHIEN CO', 'x')).toBe(false) // shorter side < 8
    expect(nameMatchesLegal('', 'CONG TY ACME', 'x')).toBe(false)
  })
  it('falls back to the display name when there is no legal name', () => {
    expect(nameMatchesLegal('ACME STORE', null, 'ACME STORE')).toBe(true)
  })
})

describe('constants', () => {
  it('the validity window is 365 days', () => {
    expect(VERIFICATION_VALIDITY_MS).toBe(365 * 24 * 60 * 60 * 1000)
  })
})
