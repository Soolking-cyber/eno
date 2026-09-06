import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  s: {
    row: null as Record<string, unknown> | null,
    clash: null as { id: string } | null,
    /** What a `findFirst` BY ID answers — the pending row `resignKycCaptures` looks for. */
    pendingById: null as Record<string, unknown> | null,
    /**
     * What a HEAD on a signed capture URL answers. `reviewKycCase` proves the OBJECT exists before
     * an approval, because signing only signs a path — so every approve test now runs through this.
     * 'present' | 'gone' (404) | 'unreachable' (throws, i.e. the object store is down).
     */
    storage: 'present' as 'present' | 'gone' | 'unreachable',
    signFails: false,
    raced: false,
    queue: [] as Record<string, unknown>[],
    updates: [] as Record<string, unknown>[],
    recomputed: [] as string[],
    provisioned: [] as string[],
    provisionFails: false,
    notified: [] as Record<string, unknown>[],
    recomputeThrows: false,
    recomputedStatus: 'verified' as string,
  },
}))

vi.mock('@/lib/db', () => ({
  db: {
    identityVerification: {
      findUnique: async () => h.s.row,
      /**
       * ⚠️ TWO DIFFERENT `findFirst` QUERIES SHARE THIS MOCK, so it routes on the shape of `where`
       * rather than answering both with the clash row. `reviewKycCase` asks
       * `{ subjectHash, status: 'verified', NOT }`; `resignKycCaptures` asks `{ id, status:
       * 'pending' }`. Returning the clash to the second made every re-sign look like a hit.
       */
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        where?.id !== undefined ? h.s.pendingById : h.s.clash,
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
  recomputeVerification: async (id: string) => {
    if (h.s.recomputeThrows) throw new Error('db down')
    h.s.recomputed.push(id); return { status: h.s.recomputedStatus, sourceId: null, changed: true }
  },
}))
vi.mock('@/lib/log', () => ({ logError: () => {} }))
vi.mock('@/lib/business-verification-store', () => ({
  // ⚠️ SIGNING CAN REFUSE WITHOUT THE EVIDENCE BEING GONE — the real one logs and returns null on
  // any storage error, which is why approval must call that `failed` and not `evidence_unavailable`.
  signVerificationDoc: async (p: string) => (h.s.signFails ? null : `signed:${p}`),
  // ⛔ THE OBJECT-EXISTENCE PROBE. `reviewKycCase` proves the FILE is there before an approval,
  // because signing only signs a path. Default 'present' so the existing tests keep testing what
  // they name. The real mapping is measured in business-verification-store.ts — read that comment
  // before trusting any assumption about what `exists()` returns for a missing object.
  verificationDocExists: async () => (h.s.storage === 'unreachable' ? 'unknown' : h.s.storage === 'gone' ? 'absent' : 'present'),
}))
vi.mock('./notify-outcome', () => ({
  notifyIdentityOutcome: async (id: string, outcome: string, detail: Record<string, unknown>) => { h.s.notified.push({ id, outcome, ...detail }) },
}))
vi.mock('./on-verified', () => ({
  provisionWithinBudget: async (id: string) => {
    h.s.provisioned.push(id)
    // ⚠️ THE REAL ONE NEVER THROWS; this asserts review.ts does not depend on that being true.
    if (h.s.provisionFails) throw new Error('provider exploded')
    return { wallet: 'pending_provider' }
  },
}))

const { reviewKycCase, listKycQueue, resignKycCaptures } = await import('./review')

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

beforeEach(() => { h.s.row = caseRow(); h.s.clash = null; h.s.pendingById = caseRow(); h.s.storage = 'present'; h.s.signFails = false; h.s.raced = false; h.s.queue = []; h.s.updates = []; h.s.recomputed = []; h.s.provisioned = []; h.s.provisionFails = false; h.s.notified = []; h.s.recomputeThrows = false; h.s.recomputedStatus = 'verified' })

describe('reviewKycCase', () => {
  it('approving a good case verifies it and records WHO decided', async () => {
    const r = await reviewKycCase({ verificationId: 'iv1', admin: 'desk@eno.vn', decision: 'approve', now: NOW })
    expect(r).toEqual({ ok: true, status: 'verified' })
    expect(h.s.updates[0]).toMatchObject({ status: 'verified', decidedBy: 'desk@eno.vn' })
    // The assurance must say a HUMAN carried it, not that the document was self-consistent.
    expect(h.s.updates[0].assuranceLevel).toBe('manual_review')
  })

  it('⛔ approving PROVISIONS what the verification unlocks', async () => {
    // ⛔ THE UNTESTED WIRE. A reviewer pointed out that deleting the `provisionWithinBudget` call
    // from review.ts left the whole suite green: the hook was covered, the call was not. Owner,
    // 2026-08-30 — a fresh KYC should auto-create the user's wallet without them asking.
    await reviewKycCase({ verificationId: 'iv1', admin: 'desk@eno.vn', decision: 'approve', now: NOW })
    expect(h.s.provisioned).toEqual(['p1'])
  })

  it('⛔ TELLS THE SELLER: approve → approved, after the recompute', async () => {
    await reviewKycCase({ verificationId: 'iv1', admin: 'desk@eno.vn', decision: 'approve', now: NOW })
    expect(h.s.notified).toEqual([{ id: 'p1', outcome: 'approved', reason: null, note: null, tier: 'B' }])
    expect(h.s.recomputed).toEqual(['p1'])
  })

  it('⛔ TELLS THE SELLER: reject → rejected WITH the reviewer note', async () => {
    await reviewKycCase({ verificationId: 'iv1', admin: 'desk@eno.vn', decision: 'reject', note: 'Photo is blurred', now: NOW })
    expect(h.s.notified).toEqual([{ id: 'p1', outcome: 'rejected', reason: 'manual', note: 'Photo is blurred', tier: 'B' }])
  })

  it('⛔ TELLS THE SELLER: approve refused by the six-month floor → the machine reason, no note', async () => {
    h.s.row = caseRow({ documentExpiresAt: new Date('2026-10-01T00:00:00Z'), evidence: { ...caseRow().evidence, decisionInput: { surname: 'ERIKSSON', givenNames: 'ANNA MARIA', documentExpiry: '2026-10-01', mrzValid: true, accountName: 'Anna Maria Eriksson' } } })
    const r = await reviewKycCase({ verificationId: 'iv1', admin: 'desk@eno.vn', decision: 'approve', now: NOW })
    expect(r).toEqual({ ok: false, code: 'expired_at_review' })
    expect(h.s.notified).toEqual([{ id: 'p1', outcome: 'rejected', reason: 'document_expires_soon', note: null, tier: 'B' }])
  })

  it('⛔ a recompute that throws does not cost the seller the REFUSAL notice', async () => {
    h.s.recomputeThrows = true
    const r = await reviewKycCase({ verificationId: 'iv1', admin: 'desk@eno.vn', decision: 'reject', note: 'x', now: NOW })
    expect(r).toEqual({ ok: true, status: 'rejected' })
    expect(h.s.notified).toHaveLength(1)
  })

  it('⛔ an APPROVAL notice — and the wallet — only when the profile now reads verified', async () => {
    h.s.recomputedStatus = 'revoked'
    const r = await reviewKycCase({ verificationId: 'iv1', admin: 'desk@eno.vn', decision: 'approve', now: NOW })
    expect(r).toEqual({ ok: true, status: 'verified' })
    expect(h.s.notified, 'a revoked profile outranks the approved row: no "you are verified"').toEqual([])
    expect(h.s.provisioned, '…and no custody wallet for a revoked profile').toEqual([])
  })

  it('approve: a recompute that throws propagates to the admin, as it always did, and nothing is sent', async () => {
    h.s.recomputeThrows = true
    await expect(reviewKycCase({ verificationId: 'iv1', admin: 'desk@eno.vn', decision: 'approve', now: NOW })).rejects.toThrow('db down')
    expect(h.s.notified).toEqual([])
    expect(h.s.provisioned).toEqual([])
  })

  it('a lost race notifies nobody', async () => {
    h.s.raced = true
    await reviewKycCase({ verificationId: 'iv1', admin: 'desk@eno.vn', decision: 'reject', note: 'x', now: NOW })
    expect(h.s.notified).toEqual([])
  })

  it('⛔ REJECTING provisions nothing', async () => {
    await reviewKycCase({ verificationId: 'iv1', admin: 'desk@eno.vn', decision: 'reject', note: 'unreadable', now: NOW })
    expect(h.s.provisioned).toEqual([])
  })

  it('⛔ provisioning happens AFTER the decision is durable, and cannot undo it', async () => {
    // The approval is the fact that matters; a wallet provider is a side effect. If provisioning
    // could fail the review, an admin would see an error on a case that IS verified — and the retry
    // returns `not_pending`, so it looks broken and cannot be re-driven.
    h.s.provisionFails = true
    const r = await reviewKycCase({ verificationId: 'iv1', admin: 'desk@eno.vn', decision: 'approve', now: NOW })
    expect(r).toEqual({ ok: true, status: 'verified' })
    expect(h.s.updates[0]).toMatchObject({ status: 'verified' })
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
    // ⚠️ SPREAD THE DEFAULT EVIDENCE — this used to be a bare `{ decisionInput: undefined }`, which
    // silently dropped documentPath and selfiePath too. That was invisible until approval started
    // requiring signable captures, and then this test failed for a reason it does not name.
    h.s.row = caseRow({ documentExpiresAt: expiry, evidence: { ...(caseRow().evidence as object), decisionInput: undefined } })
    const r = await reviewKycCase({ verificationId: 'iv1', admin: 'desk@eno.vn', decision: 'approve', now: NOW })
    expect(r).toEqual({ ok: true, status: 'verified' })
  })

  /**
   * ⛔ THE DISABLED BUTTON IS NOT THE CONTROL. The panel greys out Approve when a capture cannot be
   * shown, but a server action is a public endpoint and there is a second caller in
   * `api/admin/identity/route.ts` with no UI at all. Signing is the honest test: a null means the
   * object is gone or the path is not the profile's, and either way a human is being asked to
   * vouch for a document nobody can produce.
   */
  it('⛔ REFUSES TO APPROVE A CASE WHOSE CAPTURES CANNOT BE SIGNED', async () => {
    h.s.row = caseRow({ evidence: { ...(caseRow().evidence as object), documentPath: undefined } })
    const r = await reviewKycCase({ verificationId: 'iv1', admin: 'desk@eno.vn', decision: 'approve', now: NOW })
    expect(r).toEqual({ ok: false, code: 'evidence_unavailable' })
    expect(h.s.updates).toHaveLength(0)   // the case stays pending
  })

  /**
   * ⛔ SIGNING IS NOT PROOF THE FILE IS THERE. `createSignedUrl` signs a path and never fetches, so
   * a purged passport signs perfectly. Two reviewers found that the path-only gate therefore let an
   * API caller — which has no browser and no decode step — verify a case whose evidence is gone.
   */
  it('⛔ REFUSES TO APPROVE WHEN THE OBJECT IS GONE, THOUGH THE PATH STILL SIGNS', async () => {
    h.s.storage = 'gone'
    const r = await reviewKycCase({ verificationId: 'iv1', admin: 'desk@eno.vn', decision: 'approve', now: NOW })
    expect(r).toEqual({ ok: false, code: 'evidence_unavailable' })
    expect(h.s.updates).toHaveLength(0)
  })

  /**
   * ⛔ AND AN OUTAGE IS NOT A MISSING FILE. `evidence_unavailable` tells the reviewer to reload and
   * then reject with a reason; answering that way because the object store blinked would turn a
   * transient failure into a refusal on somebody's identity. `failed` reads "nothing was changed",
   * which invites the retry this actually deserves. Still fail-closed: the case stays pending.
   */
  it('⛔ A STORAGE OUTAGE IS `failed`, NOT `evidence_unavailable` — never reject someone over a blip', async () => {
    h.s.storage = 'unreachable'
    const r = await reviewKycCase({ verificationId: 'iv1', admin: 'desk@eno.vn', decision: 'approve', now: NOW })
    expect(r).toEqual({ ok: false, code: 'failed' })
    expect(h.s.updates).toHaveLength(0)
  })

  it('a REJECTION never probes storage — an unproducible document is exactly what to refuse', async () => {
    h.s.storage = 'unreachable'
    const r = await reviewKycCase({ verificationId: 'iv1', admin: 'desk@eno.vn', decision: 'reject', note: 'Document cannot be retrieved', now: NOW })
    expect(r).toEqual({ ok: true, status: 'rejected' })
  })

  /**
   * ⛔ A SIGNING OUTAGE IS NOT MISSING EVIDENCE. `signVerificationDoc` returns null on any storage
   * error, so an approval that read every null as "the document is gone" would tell the reviewer to
   * reject a valid applicant because the object store hiccuped. The structural question — is there
   * a recorded, owned path at all — is answered from data we already hold, before signing.
   */
  it('⛔ A SIGNING FAILURE ON GOOD PATHS IS `failed`, NOT `evidence_unavailable`', async () => {
    h.s.signFails = true
    const r = await reviewKycCase({ verificationId: 'iv1', admin: 'desk@eno.vn', decision: 'approve', now: NOW })
    expect(r).toEqual({ ok: false, code: 'failed' })
    expect(h.s.updates).toHaveLength(0)
  })

  // ⚠️ BOTH captures, not just the first. The gate signs a pair, so a missing selfie must refuse
  // exactly as a missing document does — otherwise half the promise is untested.
  it('⛔ REFUSES TO APPROVE WHEN THE SELFIE CANNOT BE SIGNED', async () => {
    h.s.row = caseRow({ evidence: { ...(caseRow().evidence as object), selfiePath: undefined } })
    const r = await reviewKycCase({ verificationId: 'iv1', admin: 'desk@eno.vn', decision: 'approve', now: NOW })
    expect(r).toEqual({ ok: false, code: 'evidence_unavailable' })
    expect(h.s.updates).toHaveLength(0)
  })

  it('a REJECTION is never gated on the captures — an unproducible document is exactly what to refuse', async () => {
    h.s.row = caseRow({ evidence: { ...(caseRow().evidence as object), documentPath: undefined } })
    const r = await reviewKycCase({ verificationId: 'iv1', admin: 'desk@eno.vn', decision: 'reject', note: 'Document cannot be retrieved', now: NOW })
    expect(r).toEqual({ ok: true, status: 'rejected' })
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


/**
 * `resignKycCaptures` — THE ONLY THING THAT TURNS A CASE ID INTO A READABLE PASSPORT LINK on the
 * admin's demand, so its two guards are the whole of its argument and both are asserted here.
 */
describe('resignKycCaptures', () => {
  it('signs both captures for a pending, owned case', async () => {
    h.s.pendingById = caseRow()
    const r = await resignKycCaptures('iv1')
    expect(r.documentUrl).toContain('signed:p1/identity/document-')
    expect(r.selfieUrl).toContain('signed:p1/identity/selfie-')
  })

  // ⛔ The query filters `status: 'pending'`, mirroring listKycQueue. A non-pending id therefore
  // finds nothing — this must never mint a link for an approved, rejected or retention-expired case.
  it('⛔ REFUSES A CASE THAT IS NOT PENDING', async () => {
    h.s.pendingById = null
    expect(await resignKycCaptures('iv1')).toEqual({ documentUrl: null, selfieUrl: null })
  })

  // ⛔ Ownership is re-proven per path, not trusted from the row: a path under another profile is
  // not this case's evidence, whoever wrote the row.
  it('⛔ REFUSES A PATH THAT IS NOT THE PROFILE\'S', async () => {
    h.s.pendingById = caseRow({ evidence: { ...(caseRow().evidence as object), documentPath: 'p2/identity/document-11111111-2222-4333-8444-555555555555.jpg' } })
    const r = await resignKycCaptures('iv1')
    expect(r.documentUrl).toBeNull()
    expect(r.selfieUrl).not.toBeNull()   // the sibling is untouched
  })

  // A deleted account (profileId SetNull) is the case that must never resolve to a link.
  it('⛔ REFUSES WHEN THE ACCOUNT IS GONE', async () => {
    h.s.pendingById = caseRow({ profileId: null })
    expect(await resignKycCaptures('iv1')).toEqual({ documentUrl: null, selfieUrl: null })
  })
})
