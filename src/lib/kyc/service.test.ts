import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHash } from 'node:crypto'

const h = vi.hoisted(() => ({
  s: {
    challenge: { ok: true, code: 'ACD349' } as { ok: boolean; reason?: string; code?: string },
    consumed: 0,
    pendingRow: null as { id: string } | null,
    clashRow: null as { id: string; subjectHash: string } | null,
    created: [] as Record<string, unknown>[],
    recomputed: [] as string[],
    pepper: true,
  },
}))

vi.mock('@/lib/identity/challenge', () => ({
  consumeChallenge: async () => { h.s.consumed++; return h.s.challenge },
}))
// ⚠️ THE FAKE MUST BE OPAQUE, LIKE THE REAL ONE. The first version returned `hash(SWE:X1234567)`,
// which embedded the passport number in its own output — so the "never stores the number" test
// failed against the MOCK rather than the code. A stand-in that leaks what the real thing hides
// tests the stand-in.
vi.mock('@/lib/compliance/subject-hash', () => ({
  identityHashingAvailable: () => h.s.pepper,
  hmacSubject: (raw: string, o?: { issuer?: string }) =>
    createHash('sha256').update(`${o?.issuer ?? ''}:${raw}`).digest('hex'),
  subjectHashEquals: (a: string, b: string) => a === b,
}))
vi.mock('@/lib/compliance/recompute-verification', () => ({
  recomputeVerification: async (id: string) => { h.s.recomputed.push(id); return { status: 'pending', sourceId: null, changed: true } },
}))
vi.mock('@/lib/db', () => ({
  db: {
    identityVerification: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        where.status === 'pending' ? h.s.pendingRow : h.s.clashRow,
      create: async ({ data }: { data: Record<string, unknown> }) => { h.s.created.push(data); return { id: 'iv_new' } },
    },
  },
}))

const { submitKycForReview } = await import('./service')

const UUID = '11111111-2222-4333-8444-555555555555'
const NOW = new Date('2026-08-20T10:00:00+07:00')
// ⛔ A REAL MRZ IS NOW MANDATORY, so the fixture carries one whose check digits actually verify.
// Built with the same mod-7-3-1 the parser uses; if it did not verify, every test below would be
// asserting the rejection path while appearing to test the happy one.
import { buildMrz } from './__mrz-fixture'
const MRZ = buildMrz({ surname: 'ERIKSSON', given: 'ANNA MARIA', number: 'X1234567', nat: 'SWE', dob: '900101', exp: '301231' })
// ⚠️ THE PATHS MUST BELONG TO THE PROFILE UNDER TEST. submitKycForReview now proves ownership
// before it writes anything, so a fixture with a generic path would send every test down the
// `path_not_owned` branch while still LOOKING like it exercised the happy one.
const input = (over: Record<string, unknown> = {}, who = 'p1') => ({ tier: 'B' as const, challengeCode: 'ACD349',
  documentPath: `${who}/identity/document-11111111-2222-4333-8444-555555555555.jpg`,
  selfiePath: `${who}/identity/selfie-11111111-2222-4333-8444-555555555555.jpg`,
  mrzLine1: MRZ.line1, mrzLine2: MRZ.line2,
  surname: 'ERIKSSON', givenNames: 'ANNA MARIA', consentVersion: 'v1', ...over,
})

beforeEach(() => {
  h.s.challenge = { ok: true, code: 'ACD349' }; h.s.consumed = 0; h.s.pendingRow = null
  h.s.clashRow = null; h.s.created = []; h.s.recomputed = []; h.s.pepper = true
})

describe('submitKycForReview', () => {
  it('creates a PENDING record and never a verified one', async () => {
    const r = await submitKycForReview('p1', 'Anna Maria Eriksson', input(), NOW)
    expect(r).toEqual({ ok: true, verificationId: 'iv_new', status: 'pending' })
    expect(h.s.created[0].status).toBe('pending')
  })

  it('⛔ CONSUMES THE CHALLENGE BEFORE ANY OTHER CHECK', async () => {
    // Otherwise probing the other branches is free: an attacker learns whether an identity is
    // already registered without ever spending a code.
    h.s.pepper = false
    const r = await submitKycForReview('p1', 'Anna Maria Eriksson', input(), NOW)
    expect(r).toEqual({ ok: false, code: 'identity_hashing_unavailable' })
    expect(h.s.consumed).toBe(1) // spent anyway
  })

  it('⛔ FAILS CLOSED WITH NO PEPPER — an unkeyed passport digest is brute-forceable', async () => {
    h.s.pepper = false
    const r = await submitKycForReview('p1', 'Anna Maria Eriksson', input(), NOW)
    expect(r).toEqual({ ok: false, code: 'identity_hashing_unavailable' })
    expect(h.s.created).toHaveLength(0)
  })

  it('refuses a bad challenge and distinguishes why', async () => {
    for (const [reason, code] of [['no_challenge', 'challenge_missing'], ['expired', 'challenge_expired'], ['mismatch', 'challenge_mismatch']] as const) {
      h.s.challenge = { ok: false, reason }
      const r = await submitKycForReview('p1', 'Anna Maria Eriksson', input(), NOW)
      expect(r).toEqual({ ok: false, code })
    }
  })

  it('⛔ CATCHES THE SAME HUMAN ON A SECOND ACCOUNT', async () => {
    h.s.clashRow = { id: 'iv_other', subjectHash: createHash('sha256').update('SWE:X1234567').digest('hex') }
    const r = await submitKycForReview('p2', 'Anna Maria Eriksson', input({}, 'p2'), NOW)
    expect(r).toEqual({ ok: false, code: 'duplicate_identity' })
  })

  it('a DIFFERENT passport under the same nationality is not a clash', async () => {
    h.s.clashRow = { id: 'iv_other', subjectHash: createHash('sha256').update('SWE:SOMEONEELSE').digest('hex') }
    const r = await submitKycForReview('p2', 'Anna Maria Eriksson', input({}, 'p2'), NOW)
    expect(r.ok).toBe(true)
  })

  it('refuses a second case while one is already in flight', async () => {
    h.s.pendingRow = { id: 'iv_open' }
    const r = await submitKycForReview('p1', 'Anna Maria Eriksson', input(), NOW)
    expect(r).toEqual({ ok: false, code: 'already_pending' })
  })

  it('the method is always passport_mrz, because nothing else can get in', async () => {
    await submitKycForReview('p1', 'Anna Maria Eriksson', input(), NOW)
    expect(h.s.created[0].method).toBe('passport_mrz')
  })

  it('⛔ REFUSES A HAND-TYPED PASSPORT — no MRZ, no submission', async () => {
    // Not a support-friendliness decision: verify-decision.ts:275 rejects a Tier B record with
    // neither MRZ nor provider, so accepting hand entry here would only ever manufacture a
    // rejection later. "Retake the data page" is the honest answer.
    const r = await submitKycForReview('p1', 'Anna Maria Eriksson',
      input({ mrzLine1: undefined, mrzLine2: undefined }), NOW)
    expect(r).toEqual({ ok: false, code: 'document_unreadable' })
    expect(h.s.created).toHaveLength(0)
  })

  it('refuses an MRZ whose check digits do not verify', async () => {
    const r = await submitKycForReview('p1', 'Anna Maria Eriksson',
      input({ mrzLine2: MRZ.line2.replace(/^(.)/, (c) => (c === 'A' ? 'B' : 'A')) }), NOW)
    expect(r).toEqual({ ok: false, code: 'document_unreadable' })
  })

  it('an expired passport is rejected on the six-month floor', async () => {
    const stale = buildMrz({ surname: 'ERIKSSON', given: 'ANNA MARIA', number: 'X1234567', nat: 'SWE', dob: '900101', exp: '260901' })
    const r = await submitKycForReview('p1', 'Anna Maria Eriksson',
      input({ mrzLine1: stale.line1, mrzLine2: stale.line2 }), NOW)
    expect(r).toEqual({ ok: false, code: 'rejected' })
  })

  it('⛔ STORES POINTERS AND VERDICTS, NEVER THE PASSPORT NUMBER', async () => {
    // A database dump must not be a passport dump. The number survives only inside the keyed hash.
    await submitKycForReview('p1', 'Anna Maria Eriksson', input(), NOW)
    const dump = JSON.stringify(h.s.created[0])
    expect(dump).not.toContain('X1234567')  // the number survives only inside the keyed hash
    expect(dump).toContain('p1/identity/document-11111111-2222-4333-8444-555555555555.jpg')
  })

  it('recomputes the cache after writing the record, never before', async () => {
    await submitKycForReview('p1', 'Anna Maria Eriksson', input(), NOW)
    expect(h.s.recomputed).toEqual(['p1'])
  })

  // ── the paths are client input ────────────────────────────────────────────────────────────────
  //
  // ⛔ THIS IS THE IDOR TEST. `documentPath`/`selfiePath` arrive in the request body, and
  // listKycQueue later mints a SIGNED URL for whatever the evidence column holds. Before the guard
  // was wired, naming another profile's object here put THEIR private document on an admin's
  // screen, attributed to the attacker's case.
  it("⛔ REFUSES ANOTHER PROFILE'S OBJECT PATH", async () => {
    const r = await submitKycForReview('p1', 'Anna Maria Eriksson', input({}, 'p2'), NOW)
    expect(r).toEqual({ ok: false, code: 'path_not_owned' })
    expect(h.s.created).toHaveLength(0)
  })

  it('refuses a path outside the identity segment, even under the right profile', async () => {
    // `<profileId>/licence.pdf` IS this seller's own object — their business-verification upload —
    // but it is not a KYC capture, and the reviewer is being told it is one.
    const r = await submitKycForReview('p1', 'Anna Maria Eriksson',
      input({ documentPath: 'p1/licence.pdf' }), NOW)
    expect(r).toEqual({ ok: false, code: 'path_not_owned' })
  })

  it('⚠️ REFUSES A PREFIX-COLLISION NEIGHBOUR', async () => {
    // `p1` must not match `p10/identity/…`. A bare startsWith on the id without the trailing
    // separator would let every profile whose id begins with another's read the longer one.
    const r = await submitKycForReview('p1', 'Anna Maria Eriksson', input({}, 'p10'), NOW)
    expect(r).toEqual({ ok: false, code: 'path_not_owned' })
  })

  // ⛔ THE FINDING THAT REFUTED THE FIRST VERSION. `!path.includes('..')` passed this string, and
  // nothing in the Supabase client encodes an object path — `_getFinalPath` only strips leading
  // slashes — so `%2e%2e` would have reached the storage server verbatim. The allow-list makes the
  // question moot: a legitimate filename cannot contain a percent sign at all.
  it('⛔ REFUSES AN ENCODED TRAVERSAL THE BLACKLIST LET THROUGH', async () => {
    const evil = `p1/identity/%2e%2e/%2e%2e/p2/identity/document-${UUID}.jpg`
    const r = await submitKycForReview('p1', 'Anna Maria Eriksson', input({ documentPath: evil }), NOW)
    expect(r).toEqual({ ok: false, code: 'path_not_owned' })
    expect(h.s.created).toHaveLength(0)
  })

  it('refuses a filename this module could not have written', async () => {
    // Right profile, right segment, wrong shape — not a kind, not a UUID, not a .jpg.
    for (const bad of ['note.txt', 'document-not-a-uuid.jpg', 'passport-' + UUID + '.jpg', 'document-' + UUID + '.jpg.exe']) {
      const r = await submitKycForReview('p1', 'Anna Maria Eriksson', input({ documentPath: `p1/identity/${bad}` }), NOW)
      expect(r).toEqual({ ok: false, code: 'path_not_owned' })
    }
  })

  // ⛔ THE FINDING THAT QUIETLY UNDID THE FRESHNESS FIX. Accepting either kind in either field let
  // a client send its PASSPORT photo as both paths: no selfie was ever taken, so no handwritten
  // code was ever in frame, and the reviewer compares the stored code against a photo that cannot
  // contain it. The code check becomes theatre one round after it was made real.
  it('⛔ REFUSES A DOCUMENT PHOTO SUBMITTED AS THE SELFIE', async () => {
    const doc = `p1/identity/document-11111111-2222-4333-8444-555555555555.jpg`
    const r = await submitKycForReview('p1', 'Anna Maria Eriksson', input({ selfiePath: doc }), NOW)
    expect(r).toEqual({ ok: false, code: 'path_not_owned' })
    expect(h.s.created).toHaveLength(0)
  })

  it('refuses a selfie submitted as the document', async () => {
    const self = `p1/identity/selfie-11111111-2222-4333-8444-555555555555.jpg`
    const r = await submitKycForReview('p1', 'Anna Maria Eriksson', input({ documentPath: self }), NOW)
    expect(r).toEqual({ ok: false, code: 'path_not_owned' })
  })

  it('checks BOTH paths, not just the first', async () => {
    const r = await submitKycForReview('p1', 'Anna Maria Eriksson',
      input({ selfiePath: 'p2/identity/selfie-11111111-2222-4333-8444-555555555555.jpg' }), NOW)
    expect(r).toEqual({ ok: false, code: 'path_not_owned' })
  })

  // ⛔ THE CODE IS EVIDENCE NOW, NOT JUST A BOOLEAN. `challengeSatisfied: true` alone gave the
  // reviewer nothing to compare against, so any handwriting in any photo passed.
  it('⛔ RECORDS THE CODE THE REVIEWER MUST FIND IN THE PHOTO', async () => {
    await submitKycForReview('p1', 'Anna Maria Eriksson', input(), NOW)
    expect((h.s.created[0].evidence as Record<string, unknown>).challengeCode).toBe('ACD349')
  })

  it('⚠️ STILL BURNS THE CHALLENGE WHEN THE PATH IS REFUSED', async () => {
    // The burn-first rule is the whole reason the challenge is consumed at step 1: a branch worth
    // probing must not be probeable for free.
    await submitKycForReview('p1', 'Anna Maria Eriksson', input({}, 'p2'), NOW)
    expect(h.s.consumed).toBe(1)
  })
})

describe('tier A (CCCD) — a Vietnamese national ID has no MRZ', () => {
  // ⛔ EVERY TIER-A SUBMISSION WAS REFUSED, ALWAYS. `readDocument` returned null without two MRZ
  // lines, and the client correctly sends none for a CCCD — so a Vietnamese seller met
  // `document_unreadable` ("photograph the card again") no matter how good their photo was, and
  // retried into the same certain refusal, spending a single-use challenge each time. Measured on
  // 2026-09-04: `identity_verifications` held ZERO rows in production.
  const tierA = (over: Record<string, unknown> = {}) => ({
    tier: 'A' as const,
    challengeCode: 'ACD349',
    documentPath: `p1/identity/document-${UUID}.jpg`,
    selfiePath: `p1/identity/selfie-${UUID}.jpg`,
    surname: 'NGUYEN', givenNames: 'VAN A',
    passportNumber: '079123456789',
    documentExpiry: '2035-01-01',
    consentVersion: 'v1',
    ...over,
  })

  it('writes a pending row', async () => {
    const r = await submitKycForReview('p1', 'Nguyen Van A', tierA(), NOW)
    expect(r.ok).toBe(true)
    expect(h.s.created).toHaveLength(1)
    expect(h.s.created[0]!.tier).toBe('A')
  })

  it('records the method as a manual CCCD read, never as an MRZ one', async () => {
    // ⚠️ A false statement about our OWN procedure in a compliance record is the thing to avoid.
    await submitKycForReview('p1', 'Nguyen Van A', tierA(), NOW)
    expect(h.s.created[0]!.method).toBe('cccd_manual')
  })

  it('still needs a number and a name — a blank form is not a submission', async () => {
    // ⚠️ TWO DIFFERENT CODES, and the difference is the point: a missing NUMBER is a number problem
    // (fix the field), a missing NAME with a good number is a document problem (the read gave us
    // nothing). Collapsing both into "photograph the card again" is what made this form unusable.
    const a = await submitKycForReview('p1', 'Nguyen Van A', tierA({ passportNumber: undefined }), NOW)
    expect(a).toMatchObject({ ok: false, code: 'document_number_invalid' })
    const b = await submitKycForReview('p1', 'Nguyen Van A', tierA({ surname: undefined, givenNames: undefined }), NOW)
    expect(b).toMatchObject({ ok: false, code: 'document_unreadable' })
    expect(h.s.created).toHaveLength(0)
  })

  it('records the nationality as VNM whatever the client claims', async () => {
    // A CCCD is issued only to Vietnamese citizens; 'USA' on a cccd_manual row is a false statement.
    await submitKycForReview('p1', 'Nguyen Van A', tierA({ nationality: 'USA' }), NOW)
    expect(h.s.created[0]!.nationality).toBe('VNM')
  })

  it('accepts a CCCD with no expiry — holders over 60 have none', async () => {
    // ⛔ "Không thời hạn". A CCCD issued to someone over 60 carries no expiry date at all; requiring
    // one would refuse that entire cohort. The row stores null and the reviewer decides.
    const r = await submitKycForReview('p1', 'Nguyen Van A', tierA({ documentExpiry: undefined }), NOW)
    expect(r.ok).toBe(true)
    expect(h.s.created[0]!.documentExpiresAt).toBeNull()
  })

  it('refuses a number that is not 12 digits, with its OWN code', async () => {
    // ⚠️ Without a checksum, FORMAT is the only machine check available — and accepting any non-empty
    // string files a mistyped phone number as a national ID for a human to catch days later.
    // ⛔ NOT `document_unreadable`: that code's copy says "photograph the card again", which is
    // useless advice about a number the seller TYPED.
    for (const bad of ['0912345678', 'ABC123456789', '12345', '079123456789012', '123456789']) {
      const r = await submitKycForReview('p1', 'Nguyen Van A', tierA({ passportNumber: bad }), NOW)
      expect(r, bad).toMatchObject({ ok: false, code: 'document_number_invalid' })
    }
    expect(h.s.created).toHaveLength(0)
  })

  it('does NOT spend the challenge on a mistyped number', async () => {
    // ⛔ THE WHOLE POINT OF CHECKING THE SHAPE FIRST. Every other refusal deliberately sits behind
    // challenge consumption so a probe costs the attacker a code — but a dropped digit is not a
    // probe. This reads only the caller's own input, so it leaks nothing.
    // ⚠️ THE DAILY ATTEMPT IS STILL SPENT: the five-a-day limiter is a route wrapper that counts the
    // request before this function is reached. Only a client-side check prevents that, which is why
    // both clients also validate the shape.
    await submitKycForReview('p1', 'Nguyen Van A', tierA({ passportNumber: '12345' }), NOW)
    expect(h.s.consumed).toBe(0)
  })

  it('still spends it on a well-formed submission', async () => {
    await submitKycForReview('p1', 'Nguyen Van A', tierA(), NOW)
    expect(h.s.consumed).toBe(1)
  })

  it('normalises the spacing before storing, so one card is one identity', async () => {
    // ⛔ ASSERT THE STORED VALUE, NOT JUST `ok`. `subjectHash` is what detects "same human, second
    // account", and it is computed from the number this function returns — so if `079123456789` and
    // `079-123-456-789` reached it differently, one card would verify several seller accounts on a
    // site that publishes trust scores.
    // ⚠️ ASSERT THE HASH, NOT THE NAME. A first version of this test compared `fullName`, which is
    // identical for all three inputs whatever the number does — it would have passed with the bug
    // fully present. The subjectHash is the value that actually decides "same human".
    const hashes = new Set<string>()
    for (const good of ['079123456789', '079 123 456 789', '079-123-456-789']) {
      h.s.created = []
      const r = await submitKycForReview('p1', 'Nguyen Van A', tierA({ passportNumber: good }), NOW)
      expect(r.ok, good).toBe(true)
      hashes.add(h.s.created[0]!.subjectHash as string)
    }
    expect(hashes.size, 'one card must produce exactly one identity').toBe(1)
  })

  it('a DIFFERENT card produces a different identity', async () => {
    // The control for the test above: if the hash were constant, that test would pass vacuously too.
    const one = await submitKycForReview('p1', 'Nguyen Van A', tierA(), NOW)
    expect(one.ok).toBe(true)
    const first = h.s.created[0]!.subjectHash
    h.s.created = []
    await submitKycForReview('p1', 'Nguyen Van A', tierA({ passportNumber: '079999999999' }), NOW)
    expect(h.s.created[0]!.subjectHash).not.toBe(first)
  })

  it('still refuses a tier A claim that carries MRZ lines', async () => {
    // ⛔ THE SELF-CONTRADICTING SUBMISSION stays closed: MRZ lines exist only on a passport, so a
    // CCCD claim carrying them is a mismatch, not a document. (The remaining hole — a passport filed
    // as tier A with the MRZ simply omitted — is closed by the human reviewer, who is shown both the
    // document and the claimed tier. The service's own comment says so.)
    const r = await submitKycForReview('p1', 'Nguyen Van A', tierA({ mrzLine1: MRZ.line1, mrzLine2: MRZ.line2 }), NOW)
    expect(r).toMatchObject({ ok: false, code: 'tier_mismatch' })
    expect(h.s.created).toHaveLength(0)
  })

  it('leaves tier B requiring its MRZ', async () => {
    // The rule that made tier A impossible is correct FOR PASSPORTS and must not be relaxed.
    const r = await submitKycForReview('p1', 'Anna Maria Eriksson', input({ mrzLine1: undefined, mrzLine2: undefined }), NOW)
    expect(r).toMatchObject({ ok: false, code: 'document_unreadable' })
    expect(h.s.created).toHaveLength(0)
  })
})
