import { describe, it, expect } from 'vitest'
import { deriveVerification } from './recompute-verification'

// ── What the CACHE should say, given the identity_verifications history ─────────────────────────
//
// The Profile columns are a denormalised cache of these rows (prisma/schema.prisma:112-118). Every
// case here is one way that cache could drift into telling a comfortable lie — a revoked seller
// reading as pending, or a lapsed passport keeping its badge.

const NOW = new Date('2026-08-20T10:00:00+07:00')
const row = (over: Partial<Parameters<typeof deriveVerification>[0][number]> = {}) => ({
  id: 'iv_1', tier: 'B', method: 'passport_manual', status: 'verified',
  decidedAt: new Date('2026-08-01T00:00:00Z'),
  documentExpiresAt: new Date('2030-01-01T00:00:00Z'),
  assuranceLevel: 'manual_review', ...over,
})

describe('deriveVerification', () => {
  it('a profile with no history is unverified, and names no source', () => {
    const d = deriveVerification([], NOW)
    expect(d.status).toBe('unverified')
    expect(d.source).toBeNull()
  })

  it('⛔ REVOKED OUTRANKS A NEWER PENDING ROW', () => {
    // Otherwise a revoked seller resubmits, the newest row is `pending`, and the cache reports
    // pending — which canPublish() treats far more kindly than revoked. The transition table
    // already refuses to LEAVE revoked; this keeps the derivation from re-entering it sideways.
    const d = deriveVerification([
      row({ id: 'new', status: 'pending', decidedAt: null }),
      row({ id: 'old', status: 'revoked' }),
    ], NOW)
    expect(d.status).toBe('revoked')
    expect(d.source?.id).toBe('old')
  })

  it('a verified row with a future expiry stays verified', () => {
    expect(deriveVerification([row()], NOW).status).toBe('verified')
  })

  it('⛔ A LAPSED PASSPORT LOSES THE BADGE WITH NO USER ACTION', () => {
    // Decree 248/2026 Art 18.1(b) requires the document to be valid. A row that said `verified` in
    // March says nothing about today, and nothing else in the system notices a document lapsing.
    const d = deriveVerification([row({ documentExpiresAt: new Date('2026-08-01T00:00:00Z') })], NOW)
    expect(d.status).toBe('expired')
  })

  it('a document expiring TODAY is still valid today — calendar-day, not instant', () => {
    // Matches verify-decision.ts, which compares ICT calendar days rather than timestamps: a
    // passport is good through the whole of its expiry date.
    const d = deriveVerification([row({ documentExpiresAt: new Date('2026-08-20T00:00:00Z') })], NOW)
    expect(d.status).toBe('verified')
  })

  it('a verified row with NO expiry never expires', () => {
    // Tier A (CCCD) has no expiry in the passport sense — absent must not read as lapsed.
    const d = deriveVerification([row({ tier: 'A', documentExpiresAt: null })], NOW)
    expect(d.status).toBe('verified')
  })

  it('rejected, then resubmitted, is PENDING — the seller has acted since', () => {
    const d = deriveVerification([
      row({ id: 'retry', status: 'pending', decidedAt: null }),
      row({ id: 'first', status: 'rejected' }),
    ], NOW)
    expect(d.status).toBe('pending')
    expect(d.source?.id).toBe('retry')
  })

  it('rejected with nothing since stays rejected', () => {
    expect(deriveVerification([row({ status: 'rejected' })], NOW).status).toBe('rejected')
  })

  it('the NEWEST DECIDED row is the verdict, not the newest row', () => {
    // A pending resubmission does not undo a standing verification: the seller keeps selling while
    // the new document is reviewed.
    const d = deriveVerification([
      row({ id: 'inflight', status: 'pending', decidedAt: null }),
      row({ id: 'standing', status: 'verified', decidedAt: new Date('2026-08-10T00:00:00Z') }),
    ], NOW)
    expect(d.status).toBe('verified')
    expect(d.source?.id).toBe('standing')
  })

  it('picks the LATEST decision when two rows are both decided', () => {
    const d = deriveVerification([
      row({ id: 'older', status: 'rejected', decidedAt: new Date('2026-07-01T00:00:00Z') }),
      row({ id: 'newer', status: 'verified', decidedAt: new Date('2026-08-05T00:00:00Z') }),
    ], NOW)
    expect(d.status).toBe('verified')
    expect(d.source?.id).toBe('newer')
  })

  it('an unrecognised status in the database does not become a permissive one', () => {
    // A future migration adding a status this build does not know must not read as `verified`.
    const d = deriveVerification([row({ status: 'quarantined', decidedAt: new Date('2026-08-01T00:00:00Z') })], NOW)
    expect(d.status).toBe('unverified')
  })
})

describe('a standing verification survives a later rejection', () => {
  // ⛔ A seller verified in March resubmits in August and is rejected. That attempt was ADDITIVE —
  // it must not take the March verification with it and stop them selling. If a reviewer thinks the
  // earlier record was fraudulent, `revoked` is the instrument, and it outranks everything.
  const march = new Date('2026-03-01T00:00:00Z')
  const august = new Date('2026-08-01T00:00:00Z')
  const now = new Date('2026-08-20T10:00:00+07:00')

  it('⛔ KEEPS THE EARLIER VERIFIED ROW', () => {
    const out = deriveVerification([
      { id: 'a', status: 'verified', decidedAt: march, documentExpiresAt: new Date('2030-01-01T00:00:00Z'), submittedAt: march },
      { id: 'b', status: 'rejected', decidedAt: august, documentExpiresAt: null, submittedAt: august },
    ] as never, now)
    expect(out.status).toBe('verified')
    expect(out.source?.id).toBe('a')
  })

  it('⚠️ BUT NOT IF THAT ROW’S OWN DOCUMENT HAS EXPIRED', () => {
    const out = deriveVerification([
      { id: 'a', status: 'verified', decidedAt: march, documentExpiresAt: new Date('2026-04-01T00:00:00Z'), submittedAt: march },
      { id: 'b', status: 'rejected', decidedAt: august, documentExpiresAt: null, submittedAt: august },
    ] as never, now)
    expect(out.status).not.toBe('verified')
  })

  it('⛔ AND revoked STILL OUTRANKS IT — that is the escape hatch', () => {
    const out = deriveVerification([
      { id: 'a', status: 'verified', decidedAt: march, documentExpiresAt: new Date('2030-01-01T00:00:00Z'), submittedAt: march },
      { id: 'b', status: 'revoked', decidedAt: august, documentExpiresAt: null, submittedAt: august },
    ] as never, now)
    expect(out.status).toBe('revoked')
  })
})
