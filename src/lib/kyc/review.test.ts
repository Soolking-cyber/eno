import { describe, it, expect, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  s: {
    row: null as Record<string, unknown> | null,
    clash: null as { id: string } | null,
    /** The WHERE of the last updateMany — how a test proves what the guard actually pinned. */
    lastWhere: null as Record<string, unknown> | null | undefined,
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
    /** Stand-in for Postgres aborting the transaction (SQLSTATE 40001 / Prisma P2034). */
    writeConflict: false,
    /** What isolation level `$transaction` was asked for — the guard is only real at Serializable. */
    txIsolation: null as string | null,
    /** A NON-conflict failure, to prove an unknown error is not laundered into a tidy refusal. */
    updateThrows: null as (Error & { code?: string }) | null,
    queue: [] as Record<string, unknown>[],
    updates: [] as Record<string, unknown>[],
    recomputed: [] as string[],
    provisioned: [] as string[],
    provisionFails: false,
    notified: [] as Record<string, unknown>[],
    recomputeThrows: false,
    recomputedStatus: 'verified' as string,
    /** Rows appended to the hash-chained compliance log — the durable half of a correction. */
    audits: [] as Record<string, unknown>[],
  },
}))

vi.mock('@/lib/db', () => {
  const identityVerification = {
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
      updateMany: async ({ data, where }: { data: Record<string, unknown>; where?: Record<string, unknown> }) => {
        // ⛔ THE SERIALIZATION ABORT. Postgres raises this when another transaction wrote the same
        // row first; the correction's whole defence against undoing an erasure rests on it, so the
        // suite has to be able to produce one.
        if (h.s.writeConflict) {
          const e = new Error('Transaction failed due to a write conflict or a deadlock.') as Error & { code?: string }
          e.code = 'P2034'
          throw e
        }
        if (h.s.updateThrows) throw h.s.updateThrows
        if (h.s.raced) return { count: 0 }
        h.s.lastWhere = where
        h.s.updates.push(data)
        return { count: 1 }
      },
  }
  /**
   * ⚠️ `$transaction` HANDS THE CALLBACK THE SAME CLIENT — that is what makes the correction path
   * testable, since it reads and writes through `t` rather than `db`. vitest cannot reproduce
   * Postgres's serialization checking, so the ISOLATION LEVEL is recorded and asserted while
   * `writeConflict` above stands in for the abort itself.
   */
  const db = {
    identityVerification,
    $transaction: async (fn: (t: unknown) => unknown, opts?: { isolationLevel?: string }) => {
      h.s.txIsolation = opts?.isolationLevel ?? null
      return fn({ identityVerification })
    },
  }
  return { db }
})
vi.mock('@/lib/compliance/recompute-verification', () => ({
  recomputeVerification: async (id: string) => {
    if (h.s.recomputeThrows) throw new Error('db down')
    h.s.recomputed.push(id); return { status: h.s.recomputedStatus, sourceId: null, changed: true }
  },
}))
// ⚠️ BOTH EXPORTS. identity.ts is in this file's import graph and calls `logWarn`; a mock naming
// only `logError` throws "No logWarn export is defined on the mock" the moment a test exercises an
// unrecognised PAYMENTS_ADDRESS_SOURCES value (the Opus seat, 2026-09-09).
vi.mock('@/lib/log', () => ({ logError: () => {}, logWarn: () => {}, logInfo: () => {} }))
// ⚠️ MOCKED AT THE MODULE, not through the tx client: the real appendAudit takes an advisory lock
// via `$executeRaw` and reads the chain head, neither of which a unit mock should be reimplementing.
// What these tests must prove is WHAT is recorded — and, just as much, what is NOT.
vi.mock('@/lib/compliance/audit', () => ({
  appendAudit: async (_tx: unknown, input: Record<string, unknown>) => { h.s.audits.push(input) },
}))
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

const { reviewKycCase, listKycQueue, resignKycCaptures, correctVerifiedIdentity } = await import('./review')

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

beforeEach(() => { h.s.row = caseRow(); h.s.clash = null; h.s.pendingById = caseRow(); h.s.storage = 'present'; h.s.signFails = false; h.s.raced = false; h.s.writeConflict = false; h.s.txIsolation = null; h.s.updateThrows = null; h.s.queue = []; h.s.updates = []; h.s.lastWhere = null; h.s.recomputed = []; h.s.provisioned = []; h.s.provisionFails = false; h.s.notified = []; h.s.recomputeThrows = false; h.s.recomputedStatus = 'verified'; h.s.audits = [] })

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

/**
 * ⛔ THE MRZ NATIONALITY FIELD IS COVERED BY NO CHECK DIGIT — mrz.ts's composite spans
 * `line2.slice(0,10)` + `slice(13,20)` + `slice(21,43)` and steps over `slice(10,13)`. So a case can
 * reach a reviewer with that column blank or quietly wrong while every checksummed field passed,
 * and the wallet gate then answers `unmappable_nationality` forever because the approve path had no
 * way to write it. Measured in production 2026-09-09: the only verified identity had NULL here.
 */
describe('reviewKycCase — nationality correction', () => {
  it('⛔ WRITES THE REVIEWER\'S NATIONALITY ONTO A CASE THAT HAS NONE — the bug that shut the wallet', async () => {
    h.s.row = caseRow({ nationality: null }); h.s.pendingById = caseRow({ nationality: null })
    const r = await reviewKycCase({ verificationId: 'iv1', admin: 'desk@eno.vn', decision: 'approve', nationality: 'SWE', now: NOW })
    expect(r).toEqual({ ok: true, status: 'verified' })
    expect(h.s.updates[0]).toMatchObject({ status: 'verified', nationality: 'SWE' })
  })

  it('⛔ OVERWRITES A NATIONALITY THAT LOOKS FINE, because no checksum ever proved it', async () => {
    // The document says SWE; OCR read NOR. Both map, so nothing downstream could tell them apart.
    h.s.row = caseRow({ nationality: 'NOR' }); h.s.pendingById = caseRow({ nationality: 'NOR' })
    await reviewKycCase({ verificationId: 'iv1', admin: 'desk@eno.vn', decision: 'approve', nationality: 'SWE', now: NOW })
    expect(h.s.updates[0]).toMatchObject({ nationality: 'SWE' })
  })

  it('keeps BOTH values — a compliance record must still say what the document read', async () => {
    h.s.row = caseRow({ nationality: 'NOR' }); h.s.pendingById = caseRow({ nationality: 'NOR' })
    await reviewKycCase({ verificationId: 'iv1', admin: 'desk@eno.vn', decision: 'approve', nationality: 'SWE', now: NOW })
    expect(h.s.updates[0].evidence).toMatchObject({
      nationalitySource: 'reviewer',
      nationalityBefore: 'NOR',
      // ⛔ AND WHAT IT WAS CHANGED TO. `nationality` is a mutable column; evidence keeping only the
      // OLD value cannot answer what this reviewer vouched for once anything else writes the column.
      nationalityAfter: 'SWE',
      nationalitySetBy: 'desk@eno.vn',
    })
  })

  it('accepts the ICAO alias — a German passport reads `D`, which is not ISO alpha-3', async () => {
    h.s.row = caseRow({ nationality: null }); h.s.pendingById = caseRow({ nationality: null })
    await reviewKycCase({ verificationId: 'iv1', admin: 'a@eno.vn', decision: 'approve', nationality: 'D', now: NOW })
    expect(h.s.updates[0]).toMatchObject({ nationality: 'DEU' })
  })

  it('refuses a code that is not a country, rather than storing it', async () => {
    const r = await reviewKycCase({ verificationId: 'iv1', admin: 'a@eno.vn', decision: 'approve', nationality: 'ZZZ', now: NOW })
    expect(r).toEqual({ ok: false, code: 'nationality_invalid' })
    expect(h.s.updates).toHaveLength(0)
  })

  /**
   * ⛔ THE CASE THAT MUST NOT BE STRANDED. `XXA`/`XXB`/`XXC`/`XXX` (stateless, refugee, unspecified)
   * are unmapped ON PURPOSE, so a rule of "approve requires an assessable nationality" would make
   * those holders permanently unapprovable — codex named this when it refuted the first plan.
   * Identity verification and wallet eligibility are different questions: verify the person, and let
   * the wallet stay shut with an honest reason.
   */
  it('⛔ STILL APPROVES WITH NO NATIONALITY AT ALL — identity is not wallet eligibility', async () => {
    h.s.row = caseRow({ nationality: null }); h.s.pendingById = caseRow({ nationality: null })
    const r = await reviewKycCase({ verificationId: 'iv1', admin: 'a@eno.vn', decision: 'approve', now: NOW })
    expect(r).toEqual({ ok: true, status: 'verified' })
    expect(h.s.updates[0]).not.toHaveProperty('nationality')
  })

  /**
   * ⛔ THE CORRECTION RIDES THE GUARDED UPDATE. An admin who LOSES the race is told `not_pending`
   * and must not have rewritten the nationality on a case somebody else already decided — which a
   * separate `update()` before `decideOnce` would have done.
   */
  it('⛔ WRITES NOTHING WHEN ANOTHER ADMIN DECIDED FIRST', async () => {
    h.s.raced = true
    const r = await reviewKycCase({ verificationId: 'iv1', admin: 'a@eno.vn', decision: 'approve', nationality: 'SWE', now: NOW })
    expect(r).toEqual({ ok: false, code: 'not_pending' })
    expect(h.s.updates).toHaveLength(0)
  })

  /**
   * ⛔ THE UNFIXABLE-WRONG-VALUE CASE. A stateless holder whose OCR produced a real-looking country:
   * the reviewer cannot type `XXA` (unmapped on purpose) and, if empty folded into "no opinion",
   * could not clear it either — so the case approves carrying a country the passport never claimed
   * and the wallet OPENS on it. A NULL closes the wallet honestly; a wrong value opens it.
   */
  it('⛔ CLEARS A WRONG NATIONALITY WHEN THE REVIEWER EMPTIES THE BOX', async () => {
    h.s.row = caseRow({ nationality: 'NOR' }); h.s.pendingById = caseRow({ nationality: 'NOR' })
    const r = await reviewKycCase({ verificationId: 'iv1', admin: 'a@eno.vn', decision: 'approve', nationality: '', now: NOW })
    expect(r).toEqual({ ok: true, status: 'verified' })
    expect(h.s.updates[0]).toMatchObject({ nationality: null })
    expect(h.s.updates[0].evidence).toMatchObject({ nationalityBefore: 'NOR', nationalityAfter: null })
  })

  it('an empty box on a case that already had none writes nothing', async () => {
    h.s.row = caseRow({ nationality: null }); h.s.pendingById = caseRow({ nationality: null })
    await reviewKycCase({ verificationId: 'iv1', admin: 'a@eno.vn', decision: 'approve', nationality: '', now: NOW })
    expect(h.s.updates[0]).not.toHaveProperty('nationality')
  })

  /**
   * ⛔ CONFIRMING AN UNCHANGED CODE IS RECORDED — AND THIS TEST USED TO ASSERT THE OPPOSITE. The
   * panel only sends this field when the reviewer touched it, so a code equal to the stored one
   * means a human read the passport and vouched for what was already there. Recording nothing left
   * that record byte-identical to one nobody had checked, on a column that feeds a settlement gate
   * (two reviewer seats, 2026-09-09). The COLUMN is still not written — there is nothing to change.
   */
  it('⛔ RECORDS A CONFIRMATION OF AN UNCHANGED CODE, without writing the column', async () => {
    await reviewKycCase({ verificationId: 'iv1', admin: 'a@eno.vn', decision: 'approve', nationality: 'SWE', now: NOW })
    expect(h.s.updates[0]).not.toHaveProperty('nationality')
    expect(h.s.updates[0].evidence).toMatchObject({
      nationalitySource: 'reviewer',
      nationalitySetBy: 'a@eno.vn',
      nationalityBefore: 'SWE',
      nationalityAfter: 'SWE',
      nationalityConfirmedOnly: true,
    })
  })

  it('a CHANGE is not marked as a confirmation', async () => {
    await reviewKycCase({ verificationId: 'iv1', admin: 'a@eno.vn', decision: 'approve', nationality: 'NOR', now: NOW })
    expect(h.s.updates[0]).toMatchObject({ nationality: 'NOR' })
    expect(h.s.updates[0].evidence).toMatchObject({ nationalityConfirmedOnly: false, nationalityAfter: 'NOR' })
  })

  it('⚠️ AN UNTOUCHED BOX RECORDS NOTHING — no opinion is not a confirmation', async () => {
    await reviewKycCase({ verificationId: 'iv1', admin: 'a@eno.vn', decision: 'approve', now: NOW })
    expect(h.s.updates[0].evidence).not.toHaveProperty('nationalitySetBy')
  })

  it('ignores a nationality sent with a rejection — a refusal records nobody\'s nationality', async () => {
    await reviewKycCase({ verificationId: 'iv1', admin: 'a@eno.vn', decision: 'reject', note: 'blurred', nationality: 'SWE', now: NOW })
    expect(h.s.updates[0]).not.toHaveProperty('nationality')
  })
})

/**
 * ⛔ THE RECORD THAT COULD NOT BE FIXED. `decideOnce` guards on `status: 'pending'` so a settled case
 * cannot be re-decided — correct, and unchanged. But production's only verified identity carried a
 * NULL nationality (the MRZ field no check digit covers), which meant a right DECISION holding a
 * missing FACT, uncorrectable forever, and a wallet permanently shut behind "contact support" that
 * support could not act on either. This path fixes fields without touching the decision.
 */
describe('correctVerifiedIdentity', () => {
  const verified = (over: Record<string, unknown> = {}) => caseRow({ status: 'verified', ...over })

  it('⛔ SETS A MISSING NATIONALITY ON A VERIFIED RECORD — the case the pending guard locked out', async () => {
    h.s.row = verified({ nationality: null })
    const r = await correctVerifiedIdentity({ verificationId: 'iv1', admin: 'a@eno.vn', nationality: 'SWE', note: 'read off the passport', now: NOW })
    expect(r).toEqual({ ok: true, changed: true })
    expect(h.s.updates[0]).toMatchObject({ nationality: 'SWE' })
  })

  it('⛔ NEVER WRITES status — this is a correction, not a second approve path', async () => {
    h.s.row = verified({ nationality: null })
    await correctVerifiedIdentity({ verificationId: 'iv1', admin: 'a@eno.vn', nationality: 'SWE', note: 'x', now: NOW })
    expect(h.s.updates[0]).not.toHaveProperty('status')
    expect(h.s.updates[0]).not.toHaveProperty('decidedBy')
  })

  it('refuses a PENDING row — those must go through review', async () => {
    h.s.row = caseRow({ status: 'pending' })
    const r = await correctVerifiedIdentity({ verificationId: 'iv1', admin: 'a@eno.vn', nationality: 'SWE', note: 'x', now: NOW })
    expect(r).toEqual({ ok: false, code: 'not_verified' })
    expect(h.s.updates).toHaveLength(0)
  })

  it('requires a reason — a correction to a compliance record without one is not one', async () => {
    h.s.row = verified({ nationality: null })
    const r = await correctVerifiedIdentity({ verificationId: 'iv1', admin: 'a@eno.vn', nationality: 'SWE', note: '  ', now: NOW })
    expect(r).toEqual({ ok: false, code: 'note_required' })
    expect(h.s.updates).toHaveLength(0)
  })

  /**
   * ⛔ THE COUNTRY IS WORTHLESS WITHOUT ITS PROVENANCE. identity.ts decides whether a residence
   * counts by reading `residenceSource`; writing the country alone leaves a value that looks
   * authoritative and is ignored by the only code that consults it.
   */
  it('⛔ WRITES residenceSource ALONGSIDE THE COUNTRY, never the country alone', async () => {
    h.s.row = verified({ residenceCountry: null, residenceSource: null })
    await correctVerifiedIdentity({ verificationId: 'iv1', admin: 'a@eno.vn', residenceCountry: 'SWE', note: 'utility bill', now: NOW })
    expect(h.s.updates[0]).toMatchObject({ residenceCountry: 'SWE', residenceSource: 'admin_document_review' })
  })

  it('clears the source when the country is cleared', async () => {
    h.s.row = verified({ residenceCountry: 'SWE', residenceSource: 'admin_document_review' })
    await correctVerifiedIdentity({ verificationId: 'iv1', admin: 'a@eno.vn', residenceCountry: '', note: 'was wrong', now: NOW })
    expect(h.s.updates[0]).toMatchObject({ residenceCountry: null, residenceSource: null })
  })

  it('⛔ REFUSES THE MRZ ALIAS AS A RESIDENCE — `D` is a passport-field code, not a country', async () => {
    h.s.row = verified()
    const r = await correctVerifiedIdentity({ verificationId: 'iv1', admin: 'a@eno.vn', residenceCountry: 'D', note: 'x', now: NOW })
    expect(r).toEqual({ ok: false, code: 'residence_invalid' })
  })

  it('records who corrected it, when, and why', async () => {
    h.s.row = verified({ nationality: null })
    await correctVerifiedIdentity({ verificationId: 'iv1', admin: 'desk@eno.vn', nationality: 'SWE', note: 'passport page 2', now: NOW })
    const ev = h.s.updates[0].evidence as { corrections: Record<string, unknown>[] }
    expect(ev.corrections).toEqual([
      { nationalityBefore: null, nationalityAfter: 'SWE', by: 'desk@eno.vn', at: NOW.toISOString(), note: 'passport page 2' },
    ])
  })

  /**
   * ⛔ AN AUDIT TRAIL THAT KEEPS ONLY THE LATEST ENTRY IS NOT ONE. Flat keys meant a second
   * correction erased the first AND collided with the `nationality*` keys the approve path writes,
   * destroying what the reviewer originally read off the document (codex + Opus, on the diff).
   */
  it('⛔ APPENDS TO THE CORRECTION LOG AND LEAVES THE APPROVAL RECORD ALONE', async () => {
    h.s.row = verified({
      nationality: 'NOR',
      evidence: {
        nationalitySource: 'reviewer', nationalitySetBy: 'first@eno.vn',
        corrections: [{ nationalityAfter: 'NOR', by: 'first@eno.vn', at: '2026-09-01T00:00:00.000Z', note: 'first pass' }],
      },
    })
    await correctVerifiedIdentity({ verificationId: 'iv1', admin: 'second@eno.vn', nationality: 'SWE', note: 'rechecked', now: NOW })
    const ev = h.s.updates[0].evidence as { corrections: Record<string, unknown>[]; nationalitySetBy: string }
    expect(ev.corrections).toHaveLength(2)
    expect(ev.corrections[0]).toMatchObject({ by: 'first@eno.vn' })
    expect(ev.corrections[1]).toMatchObject({ nationalityBefore: 'NOR', nationalityAfter: 'SWE', by: 'second@eno.vn' })
    // The approve path's own record survives untouched.
    expect(ev.nationalitySetBy).toBe('first@eno.vn')
  })

  it('treats a non-array `corrections` on an old record as absent rather than throwing', async () => {
    h.s.row = verified({ nationality: null, evidence: { corrections: 'nonsense' } })
    const r = await correctVerifiedIdentity({ verificationId: 'iv1', admin: 'a@eno.vn', nationality: 'SWE', note: 'x', now: NOW })
    expect(r).toEqual({ ok: true, changed: true })
    expect((h.s.updates[0].evidence as { corrections: unknown[] }).corrections).toHaveLength(1)
  })

  /**
   * ⛔ THE ONE ALL THREE REVIEWER SEATS FOUND. The panel used to submit BOTH boxes, so an admin
   * fixing only the nationality re-sent the unchanged residence — and the first cut then restamped
   * its source, demoting `provider_kyc` (the only source the payments gate honours by default) to
   * an inert one. An operation that changed nothing closed the rail the record already had.
   */
  it('⛔ NEVER DOWNGRADES A provider_kyc RESIDENCE WHEN THE COUNTRY IS UNCHANGED', async () => {
    h.s.row = verified({ residenceCountry: 'SWE', residenceSource: 'provider_kyc' })
    const r = await correctVerifiedIdentity({ verificationId: 'iv1', admin: 'a@eno.vn', residenceCountry: 'SWE', note: 'x', now: NOW })
    expect(r).toEqual({ ok: true, changed: false })
    expect(h.s.updates).toHaveLength(0)
  })

  it('a CHANGED country does restamp the source — a new fact needs its own provenance', async () => {
    h.s.row = verified({ residenceCountry: 'SWE', residenceSource: 'provider_kyc' })
    await correctVerifiedIdentity({ verificationId: 'iv1', admin: 'a@eno.vn', residenceCountry: 'NOR', note: 'moved', now: NOW })
    expect(h.s.updates[0]).toMatchObject({ residenceCountry: 'NOR', residenceSource: 'admin_document_review' })
  })

  it('stamps a source onto a country that has none — an inconsistent row, not a downgrade', async () => {
    h.s.row = verified({ residenceCountry: 'SWE', residenceSource: null })
    await correctVerifiedIdentity({ verificationId: 'iv1', admin: 'a@eno.vn', residenceCountry: 'SWE', note: 'x', now: NOW })
    expect(h.s.updates[0]).toMatchObject({ residenceCountry: 'SWE', residenceSource: 'admin_document_review' })
  })

  /**
   * ⛔ THE WHOLE POINT WAS TO OPEN A WALLET. Writing the nationality and stopping leaves the user
   * exactly where they were until they happen to visit /api/wallet themselves.
   */
  /**
   * ⛔ THE DURABLE RECORD, AND WHAT IT MUST NOT CONTAIN. complianceAudit is append-only and
   * hash-chained — it cannot be edited or deleted — so a nationality or a free-text note written
   * here would outlive a deletion request. Fields and ids only; the values live on the row, where
   * account-erasure.ts strips them.
   */
  it('⛔ APPENDS A COMPLIANCE-AUDIT ROW NAMING THE FIELDS, NEVER THE VALUES', async () => {
    h.s.row = verified({ nationality: null })
    await correctVerifiedIdentity({ verificationId: 'iv1', admin: 'desk@eno.vn', nationality: 'SWE', note: 'passport page 2', now: NOW })
    expect(h.s.audits).toHaveLength(1)
    expect(h.s.audits[0]).toMatchObject({
      actorType: 'admin', actorId: 'desk@eno.vn', action: 'identity.corrected',
      subjectType: 'profile', subjectId: 'p1',
      detail: { verificationId: 'iv1', fields: ['nationality'] },
    })
    expect(JSON.stringify(h.s.audits[0])).not.toContain('SWE')
    expect(JSON.stringify(h.s.audits[0])).not.toContain('passport page 2')
  })

  it('appends no audit row when nothing was written', async () => {
    h.s.row = verified({ nationality: 'SWE' })
    await correctVerifiedIdentity({ verificationId: 'iv1', admin: 'a@eno.vn', nationality: 'SWE', note: 'x', now: NOW })
    expect(h.s.audits).toEqual([])
  })

  it('⛔ RE-DRIVES PROVISIONING AFTER A SUCCESSFUL CORRECTION', async () => {
    h.s.row = verified({ nationality: null })
    await correctVerifiedIdentity({ verificationId: 'iv1', admin: 'a@eno.vn', nationality: 'SWE', note: 'x', now: NOW })
    expect(h.s.provisioned).toEqual(['p1'])
  })

  it('a provisioning failure does not turn a committed correction into a reported failure', async () => {
    h.s.row = verified({ nationality: null })
    h.s.provisionFails = true
    const r = await correctVerifiedIdentity({ verificationId: 'iv1', admin: 'a@eno.vn', nationality: 'SWE', note: 'x', now: NOW })
    expect(r).toEqual({ ok: true, changed: true })
  })

  it('does not provision when nothing was written', async () => {
    h.s.row = verified({ nationality: 'SWE' })
    await correctVerifiedIdentity({ verificationId: 'iv1', admin: 'a@eno.vn', nationality: 'SWE', note: 'x', now: NOW })
    expect(h.s.provisioned).toEqual([])
  })

  /**
   * ⛔ THE PRIVACY RACE. account-erasure.ts nulls the identity columns and rewrites `evidence`
   * WITHOUT changing `status`, so a guard on status alone would match an erased row — and this
   * function spreads the evidence it read BEFORE that erasure, putting deleted identity data back.
   */
  it('⛔ WRITES NOTHING WHEN THE ROW CHANGED UNDER IT — an erasure must not be undone', async () => {
    h.s.row = verified({ nationality: null })
    h.s.raced = true // updateMany matches zero rows
    const r = await correctVerifiedIdentity({ verificationId: 'iv1', admin: 'a@eno.vn', nationality: 'SWE', note: 'x', now: NOW })
    // ⚠️ `conflict`, not `not_verified`: the status was checked inside this same snapshot, so a zero
    // here can only mean the row stopped being the one that was read.
    expect(r).toEqual({ ok: false, code: 'conflict' })
  })

  /**
   * ⛔ THE EXACT SHAPE OF THE PRODUCTION RECORD. Nationality and residence are ALREADY null, so an
   * erasure changes none of them — it rewrites `evidence` and nulls `fullName`. Pinning only the
   * identity columns still matched and wrote the stale evidence back; `fullName` is the pin that
   * catches it.
   */
  it('⛔ PINS fullName SO AN ERASED ROW CANNOT MATCH, even when every other field was already null', async () => {
    h.s.row = verified({ nationality: null, residenceCountry: null, residenceSource: null })
    await correctVerifiedIdentity({ verificationId: 'iv1', admin: 'a@eno.vn', nationality: 'SWE', note: 'x', now: NOW })
    expect(h.s.lastWhere).toMatchObject({ status: 'verified', fullName: 'ANNA MARIA ERIKSSON' })
  })

  it('clears a stranded source even when the country is already null', async () => {
    h.s.row = verified({ residenceCountry: null, residenceSource: 'admin_document_review' })
    await correctVerifiedIdentity({ verificationId: 'iv1', admin: 'a@eno.vn', residenceCountry: '', note: 'x', now: NOW })
    expect(h.s.updates[0]).toMatchObject({ residenceCountry: null, residenceSource: null })
  })

  /**
   * ⛔ THE ONE THAT PINNING COULD NOT REACH, AND THE REASON THE TRANSACTION EXISTS. Every pinned
   * column is nullable: a verified row whose `fullName`, nationality AND residence are all already
   * null matches its own pins before and after an erasure, because erasure changes nothing but
   * `evidence`. codex refuted three successive WHERE-widenings on exactly this shape (2026-09-09).
   * The answer is not another pin — it is that the read and the write share one SERIALIZABLE
   * transaction, so Postgres aborts one of the two instead of letting this one clobber the other.
   */
  it('⛔ READS AND WRITES IN ONE SERIALIZABLE TRANSACTION — the all-NULL row no pin can protect', async () => {
    h.s.row = verified({ fullName: null, nationality: null, residenceCountry: null, residenceSource: null })
    const r = await correctVerifiedIdentity({ verificationId: 'iv1', admin: 'a@eno.vn', nationality: 'SWE', note: 'x', now: NOW })
    expect(r).toEqual({ ok: true, changed: true })
    expect(h.s.txIsolation).toBe('Serializable')
  })

  it('⛔ REPORTS A SERIALIZATION ABORT AS `conflict`, never as success — the erasure won the race', async () => {
    h.s.row = verified({ fullName: null, nationality: null, residenceCountry: null, residenceSource: null })
    h.s.writeConflict = true
    const r = await correctVerifiedIdentity({ verificationId: 'iv1', admin: 'a@eno.vn', nationality: 'SWE', note: 'x', now: NOW })
    expect(r).toEqual({ ok: false, code: 'conflict' })
    expect(h.s.updates).toHaveLength(0)
  })

  /**
   * ⚠️ THE WRAPPED SHAPE. Under the pg driver adapter a serialization abort commonly arrives as a
   * PrismaClientUnknownRequestError with the real 40001 under `.cause`, where a top-level `.code`
   * read sees nothing — which would have surfaced the guard firing as a 500 (antigravity, on the
   * diff, 2026-09-09).
   */
  it('⛔ RECOGNISES A WRAPPED 40001 — a nested cause is the shape the pg adapter actually throws', async () => {
    h.s.row = verified({ nationality: null })
    const inner = new Error('could not serialize access due to concurrent update') as Error & { code?: string }
    inner.code = '40001'
    const wrapped = new Error('Invalid `prisma.identityVerification.updateMany()` invocation') as Error & { cause?: unknown }
    wrapped.cause = inner
    h.s.updateThrows = wrapped as Error & { code?: string }
    const r = await correctVerifiedIdentity({ verificationId: 'iv1', admin: 'a@eno.vn', nationality: 'SWE', note: 'x', now: NOW })
    expect(r).toEqual({ ok: false, code: 'conflict' })
  })

  it('rethrows anything that is NOT a write conflict — an unknown failure is not a tidy refusal', async () => {
    h.s.row = verified({ nationality: null })
    const boom = new Error('connection terminated') as Error & { code?: string }
    boom.code = 'P1001'
    h.s.updateThrows = boom
    await expect(correctVerifiedIdentity({ verificationId: 'iv1', admin: 'a@eno.vn', nationality: 'SWE', note: 'x', now: NOW })).rejects.toThrow('connection terminated')
  })

  it('a no-op residence save writes nothing, appends no audit and does not re-provision', async () => {
    h.s.row = verified({ residenceCountry: 'SWE', residenceSource: 'admin_document_review' })
    const r = await correctVerifiedIdentity({ verificationId: 'iv1', admin: 'a@eno.vn', residenceCountry: 'SWE', note: 'x', now: NOW })
    expect(r).toEqual({ ok: true, changed: false })
    expect(h.s.updates).toHaveLength(0)
    expect(h.s.audits).toEqual([])
    expect(h.s.provisioned).toEqual([])
  })

  /**
   * ⛔ CLEARING WAS THE BACK DOOR THROUGH THE NO-DOWNGRADE RULE. Empty the box, retype the same
   * code, and a `provider_kyc` provenance became an inert `admin_document_review` one — the exact
   * destruction the branch above spends fifty lines preventing (the Opus seat, 2026-09-09).
   */
  it('⛔ REFUSES TO CLEAR A RESIDENCE THE PAYMENT PROVIDER ESTABLISHED', async () => {
    h.s.row = verified({ residenceCountry: 'SWE', residenceSource: 'provider_kyc' })
    const r = await correctVerifiedIdentity({ verificationId: 'iv1', admin: 'a@eno.vn', residenceCountry: '', note: 'x', now: NOW })
    expect(r).toEqual({ ok: false, code: 'residence_provider_owned' })
    expect(h.s.updates).toHaveLength(0)
  })

  it('still clears a residence WE wrote — admin_document_review is ours to withdraw', async () => {
    h.s.row = verified({ residenceCountry: 'SWE', residenceSource: 'admin_document_review' })
    await correctVerifiedIdentity({ verificationId: 'iv1', admin: 'a@eno.vn', residenceCountry: '', note: 'was wrong', now: NOW })
    expect(h.s.updates[0]).toMatchObject({ residenceCountry: null, residenceSource: null })
  })

  it('replaces a source the gate does NOT honour, even with the country unchanged', async () => {
    h.s.row = verified({ residenceCountry: 'SWE', residenceSource: 'self_declared' })
    await correctVerifiedIdentity({ verificationId: 'iv1', admin: 'a@eno.vn', residenceCountry: 'SWE', note: 'saw the lease', now: NOW })
    expect(h.s.updates[0]).toMatchObject({ residenceCountry: 'SWE', residenceSource: 'admin_document_review' })
  })

  it('⛔ REFUSES A RECORD WHOSE PROFILE IS GONE — an erasure already emptied it', async () => {
    h.s.row = verified({ profileId: null, fullName: null, nationality: null })
    const r = await correctVerifiedIdentity({ verificationId: 'iv1', admin: 'a@eno.vn', nationality: 'SWE', note: 'x', now: NOW })
    expect(r).toEqual({ ok: false, code: 'not_found' })
    expect(h.s.updates).toHaveLength(0)
  })

  it('writes nothing when the values already match', async () => {
    h.s.row = verified({ nationality: 'SWE' })
    const r = await correctVerifiedIdentity({ verificationId: 'iv1', admin: 'a@eno.vn', nationality: 'SWE', note: 'x', now: NOW })
    expect(r).toEqual({ ok: true, changed: false })
    expect(h.s.updates).toHaveLength(0)
  })
})

describe('the erasure guard on the decide path', () => {
  /**
   * ⛔ THE APPROVE PATH'S TWIN OF THE CORRECTION RACE. account-erasure.ts rewrites `evidence` and
   * nulls the identity columns WITHOUT touching `status`, so a pending case erased between the
   * read and the write still matched `status: 'pending'` — and the decision wrote the pre-erasure
   * document paths, decision inputs and a reviewer-asserted nationality back onto a record a
   * deletion request had just emptied. Erasure also nulls `profileId` in the same transaction.
   */
  it('⛔ REFUSES TO DECIDE A CASE WHOSE PROFILE IS GONE, and pins profileId to prove it', async () => {
    await reviewKycCase({ verificationId: 'iv1', admin: 'desk@eno.vn', decision: 'approve', now: NOW })
    expect(h.s.lastWhere).toMatchObject({ status: 'pending', profileId: { not: null } })
  })
})

describe('listKycQueue', () => {
  const queued = (over: Record<string, unknown> = {}) => ({
    ...caseRow(), submittedAt: new Date('2026-08-19T08:00:00Z'), ...over,
  })

  /**
   * ⛔ THE SUGGESTION EXISTS SO NOBODY RETYPES ANYTHING. Every tier B case reaches a human anyway —
   * with no provider configured verify-decision.ts always answers `pending` — so a blank nationality
   * never cost "a human looks at it", it cost "a human transcribes three characters they can already
   * see". The issuing state off MRZ line 1 prefills the box, and stays a SUGGESTION: the column is
   * still null, because issuing state and nationality differ on exactly the documents that matter.
   */
  it('surfaces the issuing state as a suggestion while nationality stays NULL', async () => {
    h.s.queue = [queued({
      nationality: null,
      evidence: {
        documentPath: 'p1/identity/document-11111111-2222-4333-8444-555555555555.jpg',
        selfiePath: 'p1/identity/selfie-11111111-2222-4333-8444-555555555555.jpg',
        nationalitySuggested: 'SWE',
        nationalitySuggestedFrom: 'mrz_issuing_state',
      },
    })]
    const [item] = await listKycQueue()
    expect(item.nationality).toBeNull()
    expect(item.nationalitySuggested).toBe('SWE')
  })

  it('offers no suggestion when the MRZ nationality field was read fine', async () => {
    h.s.queue = [queued()]
    const [item] = await listKycQueue()
    expect(item.nationality).toBe('SWE')
    expect(item.nationalitySuggested).toBeNull()
  })

  /**
   * ⛔ A SELF-DECLARED NATIONALITY MUST NOT REACH THE PANEL LABELLED AS A MACHINE READING.
   * service.ts falls back to the applicant's typed value when the MRZ nationality field is
   * unreadable, and the panel announced it as "MRZ nationality field: X" while suppressing the
   * issuing-state cross-check, because a value was present (the Opus seat, on the diff, 2026-09-09).
   */
  it('⛔ MARKS A NATIONALITY THE APPLICANT DECLARED AS NOT MACHINE-READ', async () => {
    h.s.queue = [queued({
      nationality: 'DEU',
      evidence: {
        documentPath: 'p1/identity/document-11111111-2222-4333-8444-555555555555.jpg',
        selfiePath: 'p1/identity/selfie-11111111-2222-4333-8444-555555555555.jpg',
        nationalityFromMrz: false,
        nationalitySuggested: 'DEU',
        nationalitySuggestedFrom: 'mrz_issuing_state',
      },
    })]
    const [item] = await listKycQueue()
    expect(item.nationality).toBe('DEU')
    expect(item.nationalityFromMrz).toBe(false)
    // The cross-check stays available precisely here — it is no longer suppressed by a value the
    // machine never produced.
    expect(item.nationalitySuggested).toBe('DEU')
  })

  /**
   * ⛔ A CASE SUBMITTED BEFORE THE PROVENANCE FIELD EXISTED IS UNKNOWN, NOT SELF-DECLARED. Coercing
   * the missing key to `false` labelled every row already in the queue "declared by the applicant —
   * the MRZ field was unreadable" about nationalities the strip had read cleanly. All three
   * answering seats found it (2026-09-09).
   */
  it('⛔ REPORTS A LEGACY ROW AS UNKNOWN PROVENANCE, NEVER AS A SELF-DECLARATION', async () => {
    h.s.queue = [queued({ evidence: {
      documentPath: 'p1/identity/document-11111111-2222-4333-8444-555555555555.jpg',
      selfiePath: 'p1/identity/selfie-11111111-2222-4333-8444-555555555555.jpg',
    } })]
    const [item] = await listKycQueue()
    expect(item.nationality).toBe('SWE')
    expect(item.nationalityFromMrz).toBeNull()
  })

  it('reports a machine-read nationality as machine-read', async () => {
    h.s.queue = [queued({ evidence: {
      documentPath: 'p1/identity/document-11111111-2222-4333-8444-555555555555.jpg',
      selfiePath: 'p1/identity/selfie-11111111-2222-4333-8444-555555555555.jpg',
      nationalityFromMrz: true,
    } })]
    const [item] = await listKycQueue()
    expect(item.nationalityFromMrz).toBe(true)
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
