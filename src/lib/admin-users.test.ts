import { beforeEach, describe, expect, it, vi } from 'vitest'

// revokeIdentity: the admin act the transition table reserves. Rows flip to revoked with the reason on
// the audit row, in one transaction; the profile status is RECOMPUTED from the rows, never set by hand.
const h = vi.hoisted(() => ({
  profile: null as null | { id: string; verificationStatus: string },
  updates: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  recomputed: [] as string[],
  recomputeResult: { status: 'revoked', sourceId: 'v1', changed: true } as Record<string, unknown>,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({
  db: {
    profile: { findUnique: async () => h.profile },
    $transaction: async (fn: (tx: unknown) => Promise<void>) => fn({
      identityVerification: { updateMany: async ({ where, data }: { where: unknown; data: unknown }) => { h.updates.push({ where, data }); return { count: 1 } } },
    }),
  },
}))
vi.mock('@/lib/compliance/audit', () => ({ appendAudit: async (_tx: unknown, input: Record<string, unknown>) => { h.audits.push(input) } }))
vi.mock('@/lib/compliance/recompute-verification', () => ({ recomputeVerification: async (id: string) => { h.recomputed.push(id); return h.recomputeResult } }))

const { revokeIdentity } = await import('./admin-users')

beforeEach(() => { h.profile = { id: 'p1', verificationStatus: 'verified' }; h.updates = []; h.audits = []; h.recomputed = []; h.recomputeResult = { status: 'revoked', sourceId: 'v1', changed: true } })

describe('revokeIdentity', () => {
  it('revokes the live rows, writes the audit row with the reason, then recomputes the profile', async () => {
    const r = await revokeIdentity({ profileId: 'p1', admin: 'admin@eno.vn', reason: 'passport reported stolen', now: new Date('2026-09-05T10:00:00Z') })
    expect(r).toEqual({ ok: true, status: 'revoked' })
    expect(h.updates[0]).toMatchObject({ where: { profileId: 'p1', status: { in: ['verified', 'expired'] } }, data: { status: 'revoked', decidedBy: 'admin@eno.vn', rejectReason: 'manual' } })
    // a pending re-submission is retired in the same act, or approving it would restore verified status
    expect(h.updates[1]).toMatchObject({ where: { profileId: 'p1', status: 'pending' }, data: { status: 'rejected', rejectReason: 'manual' } })
    expect(h.audits[0]).toMatchObject({ actorType: 'admin', actorId: 'admin@eno.vn', action: 'identity.revoked', subjectId: 'p1', detail: { reason: 'passport reported stolen', from: 'verified' } })
    expect(h.recomputed).toEqual(['p1'])
  })
  it('an unverified, pending or rejected account has nothing to revoke — and nothing is written', async () => {
    for (const s of ['unverified', 'pending', 'rejected']) {
      h.profile = { id: 'p1', verificationStatus: s }
      expect(await revokeIdentity({ profileId: 'p1', admin: 'a', reason: 'x' })).toEqual({ ok: false, code: 'nothing_to_revoke' })
    }
    expect(h.updates).toEqual([]); expect(h.audits).toEqual([])
  })
  it('unknown profile → not_found; an illegal transition reported by the recompute is surfaced', async () => {
    h.profile = null
    expect(await revokeIdentity({ profileId: 'x', admin: 'a', reason: 'x' })).toEqual({ ok: false, code: 'not_found' })
    h.profile = { id: 'p1', verificationStatus: 'verified' }; h.recomputeResult = { status: 'verified', sourceId: 'v1', changed: false, illegalTransition: { from: 'verified', to: 'weird' } }
    expect(await revokeIdentity({ profileId: 'p1', admin: 'a', reason: 'x' })).toEqual({ ok: false, code: 'illegal_transition' })
  })
})
