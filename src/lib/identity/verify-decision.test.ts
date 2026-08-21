import { describe, it, expect } from 'vitest'
import { decideTierB, describeAssurance, foldName, minimumValidityDate, namesCorrespond, LIMITATION, TIER_B_LIMITATIONS } from './verify-decision'

/** Explicit fields now — no faked MRZ struct. See the note in verify-decision.ts. */
const base = (over: Record<string, unknown> = {}) => ({
  surname: 'ERIKSSON', givenNames: 'ANNA MARIA',
  documentExpiry: '2030-04-15', mrzValid: true, ...over,
})
const NOW = new Date('2026-08-03T00:00:00Z')
const CLEAN = { documentIsReal: true, legal: true, fakeWarning: false, faceMatches: true, faceIsLive: true }

describe('Tier B decision', () => {
  // ⚠️ THIS TEST ASSERTED `verified` UNTIL 2026-08-20 AND THE CHANGE IS DELIBERATE. Dropping VNPT
  // (owner: "we skip the ekyc by vnpt and create own checking flow") removes the provider, which
  // this module's own note calls "the trust anchor". A clean MRZ is a mod-10 sum over digits the
  // forger chose, so with nobody attesting the document, `pending` is the honest answer and a
  // human is what lifts it. The checks still RAN and are still recorded — that has not changed.
  it('a clean, consistent, unexpired document is PENDING until a human looks at it', () => {
    const d = decideTierB({ ...base(), accountName: 'Anna Maria Eriksson', now: NOW })
    expect(d.status).toBe('pending')
    expect(d.assurance).toBeNull()
    expect(d.checksPassed).toContain('mrz_checksums')
  })

  it('a reviewer approving it produces manual_review, not document_consistent', () => {
    const d = decideTierB({ ...base(), accountName: 'Anna Maria Eriksson', humanReview: 'approved', now: NOW })
    expect(d.status).toBe('verified')
    // What carried this record over the line was a PERSON, and the compliance sentence must say so.
    expect(d.assurance).toBe('manual_review')
    expect(d.checksPassed).toContain('human_review_approved')
  })

  it('a reviewer refusing it rejects with a reason the seller can act on', () => {
    const d = decideTierB({ ...base(), accountName: 'Anna Maria Eriksson', humanReview: 'rejected', now: NOW })
    expect(d.status).toBe('rejected')
    expect(d.rejectReason).toBe('manual_review_rejected')
  })

  it('⛔ humanReview NEVER rescues a document that failed an objective check', () => {
    // The human substitutes for the PROVIDER, not for expiry — otherwise "approve" becomes a
    // button that verifies anything. Both objective checks run BEFORE the humanReview branch and
    // return early, so approval cannot reach them.
    const expired = decideTierB({ ...base(), accountName: 'Anna Maria Eriksson', documentExpiry: '2020-01-01', humanReview: 'approved', now: NOW })
    expect(expired.status).toBe('rejected')
    expect(expired.rejectReason).toBe('document_expired')
  })

  // ── the name-mismatch queue, and who can clear it ────────────────────────────────────────────
  //
  // ⛔ THIS TEST USED TO ASSERT `pending` AND CALLED IT "lenient by design". That was me writing
  // down a bug as if it were a decision: three external reviewers independently found that the
  // consequence is an UNAPPROVABLE case. reviewKycCase calls in with humanReview:'approved', gets
  // `pending` back, and its own non-verified branch stamps `rejected` + `rejectReason:'expired'` on
  // a passport valid for years. So the one cohort manual review exists for — transliterations,
  // married names, reordered given names — was the one cohort a human could not clear.
  //
  // A test that pins current behaviour is only worth writing when the behaviour is RIGHT. This pair
  // now pins the rule instead: unreviewed goes to a human; a human's verdict governs.
  it('a name mismatch with NO human verdict waits for one', () => {
    const wrongName = decideTierB({ ...base(), accountName: 'Someone Else Entirely', now: NOW })
    expect(wrongName.status).toBe('pending')
    expect(wrongName.checksPassed).not.toContain('name_matches_account')
  })

  it('⛔ A HUMAN CAN CLEAR A NAME MISMATCH — it is the whole point of the queue', () => {
    const approved = decideTierB({ ...base(), accountName: 'Someone Else Entirely', humanReview: 'approved', now: NOW })
    expect(approved.status).toBe('verified')
    expect(approved.assurance).toBe('manual_review')
    // Recorded as ACCEPTED, never as MATCHED — the audit trail must not claim the strings agreed.
    expect(approved.checksPassed).toContain('name_mismatch_accepted_by_reviewer')
    expect(approved.checksPassed).not.toContain('name_matches_account')
  })

  it('a human can also REJECT a name mismatch, with its own reason', () => {
    const rejected = decideTierB({ ...base(), accountName: 'Someone Else Entirely', humanReview: 'rejected', now: NOW })
    expect(rejected.status).toBe('rejected')
    expect(rejected.rejectReason).toBe('manual_review_rejected')
  })

  it('⚠️ APPROVAL STILL CANNOT OUTRANK EXPIRY, mismatch or not', () => {
    // The carve-out is for the two AMBIGUOUS checks (name, likeness). An expired passport is an
    // objective fact, and "approve" must never become a button that verifies anything.
    const both = decideTierB({
      ...base(), accountName: 'Someone Else Entirely',
      documentExpiry: '2020-01-01', humanReview: 'approved', now: NOW,
    })
    expect(both.status).toBe('rejected')
    expect(both.rejectReason).toBe('document_expired')
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
    // The test NAME was already right and the assertion had drifted from it: `verified` with no
    // provider IS the silent pass this warns about. Now it stops at pending.
    expect(d.status).toBe('pending')
    expect(d.assurance).not.toBe('document_authenticated')
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

  // ── NĐ 248/2026 Điều 18 kh.1 đ.b — the six-month validity floor ────────────────────────────
  describe('six-month validity floor (foreign documents)', () => {
    it('rejects a passport that is valid but expires inside six months', () => {
      // NOW is 2026-08-03, so the floor is 2027-02-03. This passport is unexpired — the OLD gate
      // passed it — and still fails the decree.
      const d = decideTierB({ ...base({ documentExpiry: '2026-12-01' }), accountName: 'Anna Maria Eriksson', now: NOW })
      expect(d.status).toBe('rejected')
      expect(d.rejectReason).toBe('document_expires_soon')
      // ⚠️ NOT `document_expired`. The passport is valid; saying otherwise is false and leaves the
      // seller with nothing to act on.
      expect(d.checksPassed).toContain('document_unexpired')
      expect(d.checksPassed).not.toContain('document_valid_6_months')
    })

    it('accepts a passport expiring exactly on the floor — "ít nhất 06 tháng" includes the boundary', () => {
      const d = decideTierB({ ...base({ documentExpiry: '2027-02-03' }), accountName: 'Anna Maria Eriksson', now: NOW })
      // The BOUNDARY is what this pins, not the status: the six-month check passing is the claim.
      // Status is pending now because no provider and no human have attested the document.
      expect(d.status).toBe('pending')
      expect(d.checksPassed).toContain('document_valid_6_months')
    })

    it('rejects one day inside the boundary', () => {
      const d = decideTierB({ ...base({ documentExpiry: '2027-02-02' }), accountName: 'Anna Maria Eriksson', now: NOW })
      expect(d.rejectReason).toBe('document_expires_soon')
    })

    it('⚠️ does NOT apply the floor to a Tier A CCCD — điểm a imposes no validity requirement', () => {
      // A domestic individual is verified on họ tên + ngày sinh + số định danh cá nhân alone.
      // Borrowing the foreign rule here would invent a requirement and reject lawful sellers.
      const d = decideTierB({
        ...base({ documentExpiry: '2026-10-01', mrzValid: false }),
        tier: 'A', accountName: 'Anna Maria Eriksson', provider: CLEAN, now: NOW,
      })
      expect(d.rejectReason).toBeUndefined()
      expect(d.checksPassed).not.toContain('document_valid_6_months')
    })

    it('reports an already-expired passport as expired, not as expiring soon', () => {
      const d = decideTierB({ ...base({ documentExpiry: '2020-01-01' }), accountName: 'Anna Maria Eriksson', now: NOW })
      expect(d.rejectReason).toBe('document_expired')
    })
  })

  describe('⚠️ a malformed expiry must FAIL CLOSED', () => {
    // Measured, not theorised: `new Date('…T10:00:00+07:00T00:00:00Z')` is Invalid Date, and every
    // comparison against Invalid Date is false — so the value passed the expiry guard AND the
    // six-month floor and reached `verified`.
    for (const bad of ['2027-02-03T10:00:00+07:00', '03/02/2027', '2027-2-3', 'soon', '2027-02-31']) {
      it(`rejects ${bad}`, () => {
        const d = decideTierB({ ...base({ documentExpiry: bad }), accountName: 'Anna Maria Eriksson', now: NOW })
        expect(d.status).toBe('rejected')
        // ⚠️ NOT `document_expired` — the document may be perfectly in date; we could not READ it.
        expect(d.rejectReason).toBe('document_expiry_unreadable')
      })
    }

    it('rejects a malformed expiry on Tier A too, where the field is otherwise optional', () => {
      // Absent is fine for a CCCD; PRESENT-BUT-UNREADABLE is not the same thing, and treating it as
      // absent would let a garbage value read as "no expiry, nothing to check".
      const d = decideTierB({
        ...base({ documentExpiry: 'nonsense', mrzValid: false }),
        tier: 'A', accountName: 'Anna Maria Eriksson', provider: CLEAN, now: NOW,
      })
      expect(d.status).toBe('rejected')
    })
  })

  describe('⚠️ expiry is an ICT calendar day, not an instant', () => {
    it('accepts a Tier A document on its own expiry date, all day', () => {
      // The old `expiry <= now` flipped to rejected at 07:00 Hanoi (00:00 UTC) on the expiry date
      // itself, so a seller submitting at 09:00 local on their document's last valid day was told
      // it had expired. A document is valid THROUGH its expiry date.
      const morningInHanoi = new Date('2026-08-04T02:00:00Z') // 09:00 ICT
      const d = decideTierB({
        ...base({ documentExpiry: '2026-08-04', mrzValid: false }),
        tier: 'A', accountName: 'Anna Maria Eriksson', provider: CLEAN, now: morningInHanoi,
      })
      expect(d.rejectReason).toBeUndefined()
    })

    it('rejects it the following ICT day', () => {
      const d = decideTierB({
        ...base({ documentExpiry: '2026-08-04', mrzValid: false }),
        tier: 'A', accountName: 'Anna Maria Eriksson', provider: CLEAN,
        now: new Date('2026-08-05T02:00:00Z'),
      })
      expect(d.rejectReason).toBe('document_expired')
    })

    it('⚠️ 23:30 UTC is already tomorrow in Hanoi', () => {
      // 2026-08-04T23:30Z is 2026-08-05 06:30 ICT, so a document expiring on the 4th is spent.
      const d = decideTierB({
        ...base({ documentExpiry: '2026-08-04', mrzValid: false }),
        tier: 'A', accountName: 'Anna Maria Eriksson', provider: CLEAN,
        now: new Date('2026-08-04T23:30:00Z'),
      })
      expect(d.rejectReason).toBe('document_expired')
    })
  })

  describe('⚠️ checksPassed must name only checks that actually ran', () => {
    it('does NOT claim mrz_checksums when the provider did the reading', () => {
      // verify-flow.ts passes mrzValid:false on the only live path, so this WAS every Tier B
      // record in the compliance log asserting a check digit verification that never happened.
      const d = decideTierB({ ...base({ mrzValid: false }), accountName: 'Anna Maria Eriksson', provider: CLEAN, now: NOW })
      expect(d.status).toBe('verified')
      expect(d.checksPassed).not.toContain('mrz_checksums')
      expect(d.checksPassed).toContain('provider_attested_read')
    })

    it('claims mrz_checksums only when real check digits passed', () => {
      const d = decideTierB({ ...base(), accountName: 'Anna Maria Eriksson', now: NOW })
      expect(d.checksPassed).toContain('mrz_checksums')
      expect(d.checksPassed).not.toContain('provider_attested_read')
    })
  })

  describe('minimumValidityDate', () => {
    it('adds six calendar months, not 180 days', () => {
      expect(minimumValidityDate(new Date('2026-08-03T00:00:00Z')).toISOString().slice(0, 10)).toBe('2027-02-03')
    })

    it('⚠️ clamps to the last day of a short target month instead of rolling into the next', () => {
      // 31 August + 6 months has no 31 February. Naive arithmetic yields 3 March, which is a
      // STRICTER threshold than the decree sets.
      expect(minimumValidityDate(new Date('2026-08-31T00:00:00Z')).toISOString().slice(0, 10)).toBe('2027-02-28')
      // …and the leap year it would otherwise get wrong in the other direction.
      expect(minimumValidityDate(new Date('2027-08-31T00:00:00Z')).toISOString().slice(0, 10)).toBe('2028-02-29')
    })

    it('⚠️ reckons the review date in ICT, so a 01:00 Hanoi submission is not dated yesterday', () => {
      // 2026-08-04T01:00+07:00 is 2026-08-03T18:00Z. Reckoned in UTC the review day would be the
      // 3rd, handing the seller an extra day against a legal gate.
      expect(minimumValidityDate(new Date('2026-08-03T18:00:00Z')).toISOString().slice(0, 10)).toBe('2027-02-04')
    })

    it('rolls the year over', () => {
      expect(minimumValidityDate(new Date('2026-11-15T00:00:00Z')).toISOString().slice(0, 10)).toBe('2027-05-15')
    })
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
    // Take the record through a human, since that is now the only route to an assurance level.
    const d = decideTierB({ ...base(), accountName: 'Anna Maria Eriksson', humanReview: 'approved', now: NOW })
    const s = describeAssurance(d)
    expect(s).toContain('manual_review')
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
    // ⚠️ Reported as UNREADABLE, not expired: no expiry was extracted, which is almost always a bad
    // scan of a perfectly valid passport. "Expired" would send that seller to check a fine date.
    expect(d.rejectReason).toBe('document_expiry_unreadable')
  })
})
