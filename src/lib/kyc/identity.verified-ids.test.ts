import { describe, expect, it, vi } from 'vitest'

// verifiedProfileIds — the batch form of hasVerifiedIdentity that /schools counts votes with. It must apply
// the SAME derivation: a revoked row outranks a verification, and a lapsed document stops counting.
const rows = vi.hoisted(() => [] as Record<string, unknown>[])
vi.mock('@/lib/db', () => ({ db: { identityVerification: { findMany: vi.fn(async () => rows) } } }))
const { verifiedProfileIds } = await import('./identity')

const day = 86_400_000
const now = new Date('2026-10-05T03:00:00Z')
const row = (profileId: string, status: string, extra: Record<string, unknown> = {}) => ({
  id: `${profileId}-${status}-${rows.length}`, profileId, tier: 'B', method: 'passport_mrz', status,
  decidedAt: new Date(now.getTime() - 10 * day), documentExpiresAt: new Date(now.getTime() + 365 * day), assuranceLevel: null, ...extra,
})

describe('verifiedProfileIds', () => {
  it('counts a live verification and nothing else', async () => {
    rows.length = 0
    rows.push(
      row('alive', 'verified'),
      row('revoked', 'verified'), row('revoked', 'revoked'), // revocation outranks the verification
      row('lapsed', 'verified', { documentExpiresAt: new Date(now.getTime() - 3 * day) }),
      row('pending', 'pending'),
      row('rejected', 'rejected'),
    )
    expect([...await verifiedProfileIds(['alive', 'revoked', 'lapsed', 'pending', 'rejected', 'nobody'], now)]).toEqual(['alive'])
  })

  it('as of a past moment: a verification decided after it does not count, a revocation always does', async () => {
    rows.length = 0
    const cutoff = new Date(now.getTime() - 5 * day)
    rows.push(
      row('before', 'verified'), // decided 10 days ago, before the cutoff
      row('after', 'verified', { decidedAt: new Date(now.getTime() - 1 * day) }), // verified only after the cutoff
      row('revokedLater', 'verified'), row('revokedLater', 'revoked', { decidedAt: new Date(now.getTime() - 1 * day) }),
    )
    expect([...await verifiedProfileIds(['before', 'after', 'revokedLater'], cutoff, { asOf: cutoff })]).toEqual(['before'])
    // Without asOf, today's view: the later verification counts, the revoked one still does not.
    expect([...await verifiedProfileIds(['before', 'after', 'revokedLater'], now)].sort()).toEqual(['after', 'before'])
  })

  it('asks nothing for an empty list', async () => {
    expect((await verifiedProfileIds([], now)).size).toBe(0)
  })
})
