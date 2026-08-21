import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  s: {
    row: null as Record<string, unknown> | null,
    clash: null as { id: string } | null,
    raced: false,
    queue: [] as Record<string, unknown>[],
    updates: [] as Record<string, unknown>[],
    recomputed: [] as string[],
  },
}))

vi.mock('@/lib/db', () => ({
  db: {
    identityVerification: {
      findUnique: async () => h.s.row,
      findFirst: async () => h.s.clash,
      findMany: async () => h.s.queue,
      update: async ({ data }: { data: Record<string, unknown> }) => { h.s.updates.push(data); return { id: 'iv1' } },
      // ⚠️ CONDITIONAL WRITE. `h.s.raced` stands in for another admin having decided the case
      // between our read and our write — Postgres then matches zero rows.
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        if (h.s.raced) return { count: 0 }
        h.s.updates.push(data)
        return { count: 1 }
      },
    },
  },
}))
vi.mock('@/lib/compliance/recompute-verification', () => ({
  recomputeVerification: async (id: string) => { h.s.recomputed.push(id); return { status: 'verified', sourceId: null, changed: true } },
}))
vi.mock('@/lib/business-verification-store', () => ({ signVerificationDoc: async (p: string) => `signed:${p}` }))

const { reviewKycCase, listKycQueue } = await import('./review')

const NOW = new Date('2026-08-20T10:00:00+07:00')
const caseRow = (over: Record<string, unknown> = {}) => ({
  id: 'iv1', profileId: 'p1', status: 'pending', tier: 'B',
  fullName: 'ANNA MARIA ERIKSSON', nationality: 'SWE',
  documentExpiresAt: new Date('2030-01-01T00:00:00Z'),
  method: 'passport_mrz',
  evidence: { documentPath: 'p1/identity/document-11111111-2222-4333-8444-555555555555.jpg', selfiePath: 'p1/identity/selfie-11111111-2222-4333-8444-555555555555.jpg', checksPassed: ['mrz_checksums'] },
  subjectHash: 'sh_abc',
  profile: { displayName: 'Anna Maria Eriksson' }, ...over,
})

beforeEach(() => { h.s.row = caseRow(); h.s.clash = null; h.s.raced = false; h.s.queue = []; h.s.updates = []; h.s.recomputed = [] })

describe('reviewKycCase', () => {
  it('approving a good case verifies it and records WHO decided', async () => {
    const r = await reviewKycCase({ verificationId: 'iv1', admin: 'desk@eno.vn', decision: 'approve', now: NOW })
    expect(r).toEqual({ ok: true, status: 'verified' })
    expect(h.s.updates[0]).toMatchObject({ status: 'verified', decidedBy: 'desk@eno.vn' })
    // The assurance must say a HUMAN carried it, not that the document was self-consistent.
    expect(h.s.updates[0].assuranceLevel).toBe('manual_review')
  })

  it('⛔ A PASSPORT THAT LAPSED WHILE IT QUEUED IS REJECTED, NOT APPROVED', async () => {
    // verify-decision.ts:338 requires the decision to be RE-RUN at adjudication, because the
    // six-month floor moves. Committing the stored verdict would make the manual queue the way to
    // get a non-compliant document approved.
    h.s.row = caseRow({ documentExpiresAt: new Date('2026-09-15T00:00:00Z') }) // inside 6 months of NOW
    const r = await reviewKycCase({ verificationId: 'iv1', admin: 'desk@eno.vn', decision: 'approve', now: NOW })
    expect(r).toEqual({ ok: false, code: 'expired_at_review' })
    // …and it is RECORDED as a rejection, so the seller can retry with a renewed passport rather
    // than sitting in a queue nobody can lawfully clear.
    expect(h.s.updates[0]).toMatchObject({ status: 'rejected' })
    expect(h.s.recomputed).toEqual(['p1'])
  })

  it('an admin cannot approve a case twice', async () => {
    h.s.row = caseRow({ status: 'verified' })
    const r = await reviewKycCase({ verificationId: 'iv1', admin: 'a@eno.vn', decision: 'approve', now: NOW })
    expect(r).toEqual({ ok: false, code: 'not_pending' })
    expect(h.s.updates).toHaveLength(0)
  })

  it('rejecting records the reviewer note without destroying the evidence', async () => {
    const r = await reviewKycCase({ verificationId: 'iv1', admin: 'desk@eno.vn', decision: 'reject', note: 'Selfie does not match the document', now: NOW })
    expect(r).toEqual({ ok: true, status: 'rejected' })
    const ev = h.s.updates[0].evidence as Record<string, unknown>
    expect(ev.reviewerNote).toBe('Selfie does not match the document')
    expect(ev.documentPath).toBe('p1/identity/document-11111111-2222-4333-8444-555555555555.jpg') // the original evidence survives
  })

  it('a missing case is not_found, and writes nothing', async () => {
    h.s.row = null
    const r = await reviewKycCase({ verificationId: 'nope', admin: 'a@eno.vn', decision: 'approve', now: NOW })
    expect(r).toEqual({ ok: false, code: 'not_found' })
    expect(h.s.updates).toHaveLength(0)
  })

  it('the profile cache is recomputed after every decision, never before', async () => {
    await reviewKycCase({ verificationId: 'iv1', admin: 'a@eno.vn', decision: 'approve', now: NOW })
    expect(h.s.recomputed).toEqual(['p1'])
  })

  it('a long reviewer note is truncated rather than rejected', async () => {
    await reviewKycCase({ verificationId: 'iv1', admin: 'a@eno.vn', decision: 'reject', note: 'x'.repeat(900), now: NOW })
    expect(String((h.s.updates[0].evidence as Record<string, unknown>).reviewerNote)).toHaveLength(500)
  })
})

describe('listKycQueue', () => {
  const queued = (over: Record<string, unknown> = {}) => ({
    ...caseRow(), submittedAt: new Date('2026-08-19T08:00:00Z'), ...over,
  })

  it('mints a short-lived link for each capture', async () => {
    h.s.queue = [queued()]
    const [item] = await listKycQueue()
    expect(item.documentUrl).toBe('signed:p1/identity/document-11111111-2222-4333-8444-555555555555.jpg')
    expect(item.selfieUrl).toBe('signed:p1/identity/selfie-11111111-2222-4333-8444-555555555555.jpg')
  })

  // ⛔ THE REFUTED-FIRST-VERSION TEST. Signing whatever the row happens to hold means one bad or
  // legacy write puts another person's passport on an admin's screen. This is the ONLY place a
  // stored string becomes a readable link, so it proves ownership itself rather than trusting it.
  it("⛔ REFUSES TO SIGN A PATH THAT IS NOT THE CASE OWNER'S", async () => {
    h.s.queue = [queued({
      evidence: { documentPath: 'p2/identity/document-11111111-2222-4333-8444-555555555555.jpg', selfiePath: 'p1/identity/selfie-11111111-2222-4333-8444-555555555555.jpg' },
    })]
    const [item] = await listKycQueue()
    expect(item.documentUrl).toBeNull()   // someone else's object
    expect(item.selfieUrl).not.toBeNull() // the seller's own still resolves
  })

  it('⚠️ SIGNS NOTHING FOR A DELETED PROFILE', async () => {
    // profileId is SetNull on account deletion; a deleted person's passport photo must not resolve.
    h.s.queue = [queued({ profileId: null })]
    const [item] = await listKycQueue()
    expect(item.documentUrl).toBeNull()
    expect(item.selfieUrl).toBeNull()
  })

  it('refuses a path that survived from an older, looser writer', async () => {
    h.s.queue = [queued({ evidence: { documentPath: 'p1/identity/../../p2/licence.pdf', selfiePath: 'p1/identity/selfie-11111111-2222-4333-8444-555555555555.jpg' } })]
    const [item] = await listKycQueue()
    expect(item.documentUrl).toBeNull()
  })
})

describe('reviewKycCase — what external review found', () => {
  // ⛔ THE HEADLINE DEFECT. A transliteration or a married name is EXACTLY why a human is in this
  // loop. Before the fix, approving one recorded `status:'rejected'`, `rejectReason:'expired'`
  // against a passport valid to 2030 — unapprovable, and mislabelled twice.
  it("⛔ APPROVES A CASE WHOSE ACCOUNT NAME DOES NOT MATCH THE PASSPORT", async () => {
    h.s.row = caseRow({ profile: { displayName: 'Annie Eriksson-Nguyen' } })
    const r = await reviewKycCase({ verificationId: 'iv1', admin: 'desk@eno.vn', decision: 'approve', now: NOW })
    expect(r).toEqual({ ok: true, status: 'verified' })
    expect(h.s.updates[0]).toMatchObject({ status: 'verified' })
  })

  // ⚠️ "VAN DER BILT" came back as surname "BILT" when review re-split `fullName` on spaces.
  it('⚠️ KEEPS A COMPOUND SURNAME INTACT', async () => {
    h.s.row = caseRow({
      fullName: 'JOHN VAN DER BILT',
      profile: { displayName: 'John van der Bilt' },
      evidence: {
        documentPath: `p1/identity/document-11111111-2222-4333-8444-555555555555.jpg`,
        selfiePath: `p1/identity/selfie-11111111-2222-4333-8444-555555555555.jpg`,
        decisionInput: { surname: 'VAN DER BILT', givenNames: 'JOHN', documentExpiry: '2030-01-01', mrzValid: true, accountName: 'John van der Bilt' },
      },
    })
    const r = await reviewKycCase({ verificationId: 'iv1', admin: 'desk@eno.vn', decision: 'approve', now: NOW })
    expect(r).toEqual({ ok: true, status: 'verified' })
  })

  // ⚠️ `new Date('2026-09-01T00:00:00+07:00').toISOString()` is 2026-08-31T17:00Z — the day BEFORE.
  // On the six-month floor that is the difference between approved and rejected.
  it('⚠️ DOES NOT LOSE A DAY TO THE ICT→UTC BOUNDARY', async () => {
    // ⚠️ THE DATE IS EXACT, AND MY FIRST ATTEMPT AT THIS TEST WAS NOT. I used 2027-02-22, which
    // clears the floor whether or not the day is lost — a test that passes against the bug it
    // names. Measured floor for this NOW is 2027-02-20, so that is the ONLY date where a UTC slice
    // (reading 2027-02-19) rejects and an ICT read approves.
    const expiry = new Date('2027-02-20T00:00:00+07:00')
    h.s.row = caseRow({ documentExpiresAt: expiry, evidence: { decisionInput: undefined } })
    const r = await reviewKycCase({ verificationId: 'iv1', admin: 'desk@eno.vn', decision: 'approve', now: NOW })
    expect(r).toEqual({ ok: true, status: 'verified' })
  })

  // ⛔ Two accounts can both be PENDING on one passport, because the submit-side clash check only
  // looks for an already-VERIFIED row. Without this, an admin verifies both.
  it('⛔ REFUSES TO VERIFY A PASSPORT ALREADY VERIFIED ON ANOTHER ACCOUNT', async () => {
    h.s.clash = { id: 'iv_other' }
    const r = await reviewKycCase({ verificationId: 'iv1', admin: 'desk@eno.vn', decision: 'approve', now: NOW })
    expect(r).toEqual({ ok: false, code: 'duplicate_identity' })
    expect(h.s.updates).toHaveLength(0)   // nothing written either way
  })

  it('a REJECTION never consults the clash check — it is not a reason to keep a case open', async () => {
    h.s.clash = { id: 'iv_other' }
    const r = await reviewKycCase({ verificationId: 'iv1', admin: 'desk@eno.vn', decision: 'reject', now: NOW })
    expect(r).toEqual({ ok: true, status: 'rejected' })
  })
})

describe('reviewKycCase — two admins, one case', () => {
  // ⛔ THE READ AT THE TOP IS A CHECK-THEN-ACT. Both admins read `pending`, both pass the guard.
  // Only the conditional write settles it — and with the duplicate-passport check this matters
  // beyond a double-decide: two cases holding the SAME passport both clear the clash query while
  // neither is verified yet, so an unconditional write verifies both.
  it('⛔ THE SECOND WRITER LOSES, AND IS TOLD SO', async () => {
    h.s.raced = true
    const r = await reviewKycCase({ verificationId: 'iv1', admin: 'second@eno.vn', decision: 'approve', now: NOW })
    expect(r).toEqual({ ok: false, code: 'not_pending' })
    expect(h.s.updates).toHaveLength(0)
    expect(h.s.recomputed).toHaveLength(0)   // and the cache is NOT recomputed off a write that lost
  })

  it('a losing REJECT is reported the same way', async () => {
    h.s.raced = true
    const r = await reviewKycCase({ verificationId: 'iv1', admin: 'second@eno.vn', decision: 'reject', now: NOW })
    expect(r).toEqual({ ok: false, code: 'not_pending' })
  })
})

describe('listKycQueue — the freshness code', () => {
  // ⛔ WITHOUT THIS THE CHALLENGE IS DECORATIVE. The reviewer has to compare six characters against
  // the paper in the photo; being told to look for "a handwritten code" accepts any handwriting,
  // including a selfie taken last year.
  it('⛔ SHOWS THE REVIEWER THE ACTUAL CODE TO COMPARE', async () => {
    h.s.queue = [{ ...caseRow(), submittedAt: new Date('2026-08-19T08:00:00Z'),
      evidence: { ...(caseRow().evidence as object), challengeCode: 'ACD349' } }]
    const [item] = await listKycQueue()
    expect(item.expectedNote).toBe('ACD349')
  })

  it('says so loudly when no code was recorded', async () => {
    h.s.queue = [{ ...caseRow(), submittedAt: new Date('2026-08-19T08:00:00Z'), evidence: {} }]
    const [item] = await listKycQueue()
    expect(item.expectedNote).toMatch(/none recorded/)
  })
})
