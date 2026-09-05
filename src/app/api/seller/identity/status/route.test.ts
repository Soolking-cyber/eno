import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  userId: 'p1' as string | null,
  rows: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/admin', () => ({
  getAdmin: async () => null,
  getCurrentProfile: async () => (h.userId ? { id: h.userId, email: 'x@y.z' } : null),
  getCurrentProfileId: async () => h.userId,
}))
vi.mock('@/lib/db', () => ({
  db: { identityVerification: { findMany: async () => h.rows } },
}))
vi.mock('@/lib/kyc/person-gate', () => ({ personBeforeBusinessEnforced: () => false }))

const { GET } = await import('./route')

const call = async () => {
  const res = await GET(new Request('http://x/api/seller/identity/status'))
  return { status: res.status, body: await res.json() }
}
const row = (over: Record<string, unknown>) => ({
  id: 'iv1', tier: 'B', method: 'passport_mrz', status: 'pending', decidedAt: null,
  documentExpiresAt: new Date('2030-01-01T00:00:00Z'), assuranceLevel: null, rejectReason: null, evidence: {}, ...over,
})

beforeEach(() => { h.userId = 'p1'; h.rows = [] })

describe('GET /api/seller/identity/status', () => {
  it('no rows is unverified, with no reason fields at all', async () => {
    const r = await call()
    expect(r.status).toBe(200)
    expect(r.body).toEqual({ status: 'unverified', gate: false })
  })

  it('a refusal carries the reviewer note and the machine reason', async () => {
    h.rows = [row({ status: 'rejected', decidedAt: new Date('2026-09-01T00:00:00Z'), rejectReason: 'manual', evidence: { reviewerNote: 'Photo is blurred' } })]
    const r = await call()
    expect(r.body).toEqual({ status: 'rejected', reason: 'manual', note: 'Photo is blurred', gate: false })
  })

  it('a refusal by the six-month floor names it, and never carries the approve-time note', async () => {
    h.rows = [row({ status: 'rejected', decidedAt: new Date('2026-09-01T00:00:00Z'), rejectReason: 'document_expires_soon', evidence: { reviewerNote: 'looks fine, approving' } })]
    expect((await call()).body).toMatchObject({ status: 'rejected', reason: 'document_expires_soon', note: null })
  })

  it('⛔ a refused case superseded by a pending one leaks nothing about the refusal', async () => {
    h.rows = [
      row({ id: 'old', status: 'rejected', decidedAt: new Date('2026-08-01T00:00:00Z'), rejectReason: 'manual', evidence: { reviewerNote: 'old note' } }),
      row({ id: 'new', status: 'pending' }),
    ]
    const r = await call()
    expect(r.body.status).toBe('pending')
    expect(r.body).not.toHaveProperty('note')
    expect(r.body).not.toHaveProperty('reason')
  })

  it('the note is capped at 500 characters and a non-string note is dropped', async () => {
    h.rows = [row({ status: 'rejected', decidedAt: new Date('2026-09-01T00:00:00Z'), rejectReason: 'manual', evidence: { reviewerNote: 'x'.repeat(900) } })]
    expect((await call()).body.note).toHaveLength(500)
    h.rows = [row({ status: 'rejected', decidedAt: new Date('2026-09-01T00:00:00Z'), rejectReason: 'manual', evidence: { reviewerNote: { html: '<b>' } } })]
    expect((await call()).body.note).toBeNull()
  })

  it('two refusals: the newest decision is the one shown', async () => {
    h.rows = [
      row({ id: 'first', status: 'rejected', decidedAt: new Date('2026-08-01T00:00:00Z'), rejectReason: 'manual', evidence: { reviewerNote: 'Name differs from account' } }),
      row({ id: 'second', status: 'rejected', decidedAt: new Date('2026-09-01T00:00:00Z'), rejectReason: 'manual', evidence: { reviewerNote: 'Photo is blurred' } }),
    ]
    expect((await call()).body.note).toBe('Photo is blurred')
    h.rows.reverse()
    expect((await call()).body.note).toBe('Photo is blurred')
  })

  it('an unknown reason code is not exposed', async () => {
    h.rows = [row({ status: 'rejected', decidedAt: new Date('2026-09-01T00:00:00Z'), rejectReason: 'internal_flag', evidence: {} })]
    expect((await call()).body).toMatchObject({ status: 'rejected', reason: null, note: null })
  })

  it('signed out is 401', async () => {
    h.userId = null
    expect((await call()).status).toBe(401)
  })
})
