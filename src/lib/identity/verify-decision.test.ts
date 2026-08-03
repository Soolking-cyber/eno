import { describe, it, expect } from 'vitest'
import { decideTierB, describeAssurance, foldName, namesCorrespond, LIMITATION, TIER_B_LIMITATIONS } from './verify-decision'

/** Explicit fields now — no faked MRZ struct. See the note in verify-decision.ts. */
const base = (over: Record<string, unknown> = {}) => ({
  surname: 'ERIKSSON', givenNames: 'ANNA MARIA',
  documentExpiry: '2030-04-15', mrzValid: true, ...over,
})
const NOW = new Date('2026-08-03T00:00:00Z')
const CLEAN = { documentIsReal: true, legal: true, fakeWarning: false, faceMatches: true, faceIsLive: true }

describe('Tier B decision', () => {
  it('verifies a clean, consistent, unexpired document', () => {
    const d = decideTierB({ ...base(), accountName: 'Anna Maria Eriksson', now: NOW })
    expect(d.status).toBe('verified')
    expect(d.assurance).toBe('document_consistent')
    expect(d.checksPassed).toContain('mrz_checksums')
  })

  it('⚠️ ALWAYS records the limitations, even on a clean pass', () => {
    // These are not failure flags — they are the honest scope of "verified" here, frozen at
    // decision time so the answer to a regulator cannot drift as the product changes.
    const d = decideTierB({ ...base(), accountName: 'Anna Maria Eriksson', now: NOW })
    expect(d.limitations).toContain(LIMITATION.noStolenDocCheck)
    expect(d.limitations).toContain(LIMITATION.noIssuerConfirmation)
    expect(d.limitations).toContain(LIMITATION.noBiometricBinding)
  })

  it('drops the biometric limitation only when the provider actually bound the holder', () => {
    const d = decideTierB({ ...base(), accountName: 'Anna Maria Eriksson', provider: CLEAN, now: NOW })
    expect(d.status).toBe('verified')
    expect(d.assurance).toBe('document_authenticated')
    expect(d.limitations).not.toContain(LIMITATION.noBiometricBinding)
    expect(d.checksPassed).toContain('portrait_matched_holder')
    // The registry limitations can NOT be lifted — no product change makes SLTD available to us.
    expect(d.limitations).toEqual(TIER_B_LIMITATIONS)
  })

  it('⚠️ absent provider signals mean the checks did NOT RUN — weaker record, not a silent pass', () => {
    // Treating "we could not ask" as "it answered yes" is the same fail-open shape as the
    // liveness bug qwen found in vnpt-client.
    const d = decideTierB({ ...base(), accountName: 'Anna Maria Eriksson', now: NOW })
    expect(d.status).toBe('verified')
    expect(d.assurance).toBe('document_consistent')          // NOT document_authenticated
    expect(d.limitations).toContain(LIMITATION.noBiometricBinding)
  })

  it('REJECTS a document the provider says is re-captured, tampered or fake', () => {
    for (const bad of [{ documentIsReal: false }, { legal: false }, { fakeWarning: true }]) {
      const d = decideTierB({ ...base(), accountName: 'Anna Maria Eriksson', provider: { ...CLEAN, ...bad }, now: NOW })
      expect(d.status, JSON.stringify(bad)).toBe('rejected')
      expect(d.rejectReason).toBe('document_not_authentic')
    }
  })

  it('⚠️ sends a FACE mismatch to a human, not to rejection', () => {
    // Comparing a live selfie to a passport photo that may be a decade old is the most
    // error-prone step for a legitimate person: ageing, weight, glasses, beards.
    for (const soft of [{ faceMatches: false }, { faceIsLive: false }]) {
      const d = decideTierB({ ...base(), accountName: 'Anna Maria Eriksson', provider: { ...CLEAN, ...soft }, now: NOW })
      expect(d.status, JSON.stringify(soft)).toBe('pending')
      expect(d.rejectReason).toBeUndefined()
    }
  })

  it('rejects an invalid MRZ and an expired passport, expiry reported first', () => {
    expect(decideTierB({ ...base({ mrzValid: false }), accountName: 'x', now: NOW }).rejectReason).toBe('mrz_invalid')
    const expired = decideTierB({ ...base({ documentExpiry: '2020-01-01' }), accountName: 'nobody', now: NOW })
    // Name also mismatches — but expiry is what the user must fix first.
    expect(expired.rejectReason).toBe('document_expired')
  })

  it('⚠️ sends a name mismatch to a HUMAN, never to rejection', () => {
    // Transliteration is lossy both ways and married names differ; auto-rejecting would fail a
    // large slice of legitimate expats on a string comparison.
    const d = decideTierB({ ...base(), accountName: 'Anna Eriksson-Nguyen', now: NOW })
    expect(d.status).toBe('pending')
    expect(d.rejectReason).toBeUndefined()
  })

  it('folds diacritics and Vietnamese đ so MRZ ASCII matches a real name', () => {
    expect(foldName('NGUYỄN Đức')).toBe(foldName('NGUYEN DUC'))
  })

  it('describeAssurance is derived from the record and names the missing registry', () => {
    const d = decideTierB({ ...base(), accountName: 'Anna Maria Eriksson', now: NOW })
    const s = describeAssurance(d)
    expect(s).toContain('document_consistent')
    expect(s).toContain('INTERPOL SLTD')
    expect(s).toContain('mrz_checksums')
  })
})

describe('name correspondence — the ordering trap', () => {
  it('matches surname-first MRZ against given-name-first account name', () => {
    // ⚠️ The regression this pins: MRZ is ERIKSSON + ANNA MARIA, the account says "Anna Maria
    // Eriksson". A concatenated comparison fails, and every Western expat lands in manual review.
    expect(namesCorrespond('ERIKSSON', 'ANNA MARIA', 'Anna Maria Eriksson')).toBe(true)
  })

  it('tolerates an omitted middle name in either direction', () => {
    expect(namesCorrespond('ERIKSSON', 'ANNA MARIA', 'Anna Eriksson')).toBe(true)
    expect(namesCorrespond('ERIKSSON', 'ANNA', 'Anna Maria Eriksson')).toBe(true)
  })

  it('handles Vietnamese diacritics and MRZ filler characters', () => {
    expect(namesCorrespond('NGUYEN', 'DUC<ANH', 'Nguyễn Đức Anh')).toBe(true)
  })

  it('still requires the surname on both sides', () => {
    expect(namesCorrespond('ERIKSSON', 'ANNA', 'Anna Schmidt')).toBe(false)
    expect(namesCorrespond('', 'ANNA', 'Anna')).toBe(false)
  })

  it('rejects a wholly different person', () => {
    expect(namesCorrespond('ERIKSSON', 'ANNA MARIA', 'Tran Van Minh')).toBe(false)
  })
})

describe('compound surnames — the regression agy caught', () => {
  it('accepts a multi-word MRZ surname', () => {
    // MRZ surnames are '<'-separated: NGUYEN<DUC. Folding the whole field to "NGUYENDUC" produced a
    // token no account name contains, so EVERY compound surname auto-routed to manual review —
    // Vietnamese, Spanish and Portuguese double surnames alike.
    expect(namesCorrespond('NGUYEN<DUC', 'ANH', 'Nguyen Duc Anh')).toBe(true)
    expect(namesCorrespond('GARCIA<MARQUEZ', 'GABRIEL', 'Gabriel Garcia Marquez')).toBe(true)
  })

  it('still requires EVERY surname token, not just one', () => {
    // Leniency stops here: matching on a single shared token would accept a different person who
    // happens to share one common name.
    expect(namesCorrespond('GARCIA<MARQUEZ', 'GABRIEL', 'Gabriel Garcia')).toBe(false)
  })
})

describe('tier-aware decision', () => {
  it('⚠️ a CCCD has no MRZ and no expiry — Tier A must not be judged as a passport', () => {
    // Both tiers hit the same VNPT endpoints, but the DECISION is not the same. Requiring MRZ
    // check digits or a passport expiry would reject every legitimate Vietnamese ID holder.
    const d = decideTierB({
      tier: 'A', surname: 'NGUYEN', givenNames: 'QUANG HUY',
      mrzValid: false, accountName: 'Nguyen Quang Huy', provider: CLEAN,
      now: NOW,
    })
    expect(d.status).toBe('verified')
  })

  it('⚠️ a provider-verified passport passes without MRZ check digits', () => {
    // VNPT's OCR returns fields, not MRZ lines, so mrzValid is honestly false on that path.
    // Requiring it unconditionally rejected EVERY provider-verified passport — a bug that only
    // became visible once the faked MRZ struct was removed.
    const d = decideTierB({ ...base({ mrzValid: false }), accountName: 'Anna Maria Eriksson', provider: CLEAN, now: NOW })
    expect(d.status).toBe('verified')
  })

  it('but a passport with NEITHER check digits NOR a provider is refused', () => {
    const d = decideTierB({ ...base({ mrzValid: false }), accountName: 'Anna Maria Eriksson', now: NOW })
    expect(d.status).toBe('rejected')
    expect(d.rejectReason).toBe('mrz_invalid')
  })

  it('a passport still requires an expiry date', () => {
    const d = decideTierB({ ...base({ documentExpiry: undefined }), accountName: 'Anna Maria Eriksson', provider: CLEAN, now: NOW })
    expect(d.status).toBe('rejected')
    expect(d.rejectReason).toBe('document_expired')
  })
})
