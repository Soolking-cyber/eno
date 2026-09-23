import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── The seller identity gate WITH its database half ─────────────────────────────────────────────
//
// seller-publish-decision.test.ts pins the pure rules. This file pins what the rules are FED and what
// the gate WRITES: that the switch really is a switch (off → not one query), that a batch resolves
// one decision per owner rather than per row, that a claim or an admin act parks only what was about
// to become public, and that verifying releases exactly the parked rows — the auto-publish half.
//
// Only the database and the cache/search side effects are faked. recomputeVerification,
// verificationStatusForDecision and the derivation run for real, so a regression in how the gate
// reads identity_verifications fails here and not only in production.

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  enforced: false,
  profiles: new Map<string, Row>(),
  /** identity_verifications rows by profileId. */
  ivs: new Map<string, Row[]>(),
  /** listing rows for findMany (partition / claim / release). */
  listings: [] as Row[],
  sellers: [] as Row[],
  calls: [] as Array<{ m: string; args: any }>,
  updateManyCount: 0,
  /** seller.updateMany count — 1 = the claim-once guard won. */
  claimCount: 1,
  /** listing ids a release (identityHold → false) has touched. */
  released: new Set<string>(),
}))

vi.mock('@/lib/compliance/account-state', async (orig) => ({
  ...(await orig<typeof import('./account-state')>()),
  identityGateEnforced: () => h.enforced,
}))
vi.mock('next/server', () => ({ after: (fn: () => unknown) => { void fn() } }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: (p: string) => { h.calls.push({ m: 'revalidate', args: p }) } }))
vi.mock('@/lib/listing-index', () => ({ reindexListing: async (id: string) => { h.calls.push({ m: 'reindex', args: id }) } }))
vi.mock('@/lib/db', () => {
  const rec = (m: string, args: any) => { h.calls.push({ m, args }) }
  const mock = {
    db: {
      profile: {
        findUnique: async (a: any) => { rec('profile.findUnique', a); return h.profiles.get(a.where.id) ?? null },
        update: async (a: any) => { rec('profile.update', a); return {} },
      },
      identityVerification: {
        findMany: async (a: any) => { rec('identityVerification.findMany', a); return h.ivs.get(a.where.profileId) ?? [] },
      },
      seller: {
        findMany: async (a: any) => { rec('seller.findMany', a); return h.sellers.filter((s) => s.ownerId === a.where.ownerId) },
        findUnique: async (a: any) => { rec('seller.findUnique', a); return h.sellers.find((s) => s.ownerId === a.where.ownerId) ?? null },
        updateMany: async (a: any) => { rec('seller.updateMany', a); return { count: h.claimCount } },
      },
      listing: {
        findMany: async (a: any) => {
          rec('listing.findMany', a)
          // settleHolds' re-read: only the rows still identity-held, as the real WHERE would.
          if (a.where?.identityHold === true && a.select?.seller) return h.listings.filter((l) => !h.released.has(l.id))
          return h.listings
        },
        updateMany: async (a: any) => {
          rec('listing.updateMany', a)
          if (a.data?.identityHold === false) for (const id of a.where.id.in) h.released.add(id)
          return { count: h.updateManyCount }
        },
      },
    },
  }
  // Interactive transactions run against the same fake, tagged so a test can see what ran inside.
  ;(mock.db as any).$transaction = async (fn: (tx: unknown) => unknown) => { rec('$transaction', null); return fn(mock.db) }
  return mock
})

const gate = await import('./seller-publish-gate')
const { recomputeVerification } = await import('./recompute-verification')
const { PublishBlockedError } = await import('@/lib/publish-guard')

const OLD = new Date('2026-05-01T10:00:00+07:00')
const AFTER_ALL_DEADLINES = new Date('2027-02-01T12:00:00+07:00')
const reads = () => h.calls.filter((c) => /findUnique|findMany/.test(c.m))
const writes = () => h.calls.filter((c) => /update/.test(c.m))

function verifiedRow(profileId: string, over: Row = {}): Row {
  return { id: `iv-${profileId}`, tier: 'basic', method: 'vnpt', status: 'verified', decidedAt: new Date('2026-06-01T00:00:00+07:00'), documentExpiresAt: null, assuranceLevel: null, ...over }
}

beforeEach(() => {
  h.enforced = false
  h.profiles = new Map([
    ['verified-owner', { createdAt: OLD, verificationStatus: 'verified' }],
    ['plain-owner', { createdAt: OLD, verificationStatus: 'unverified' }],
  ])
  h.ivs = new Map([['verified-owner', [verifiedRow('verified-owner')]]])
  h.listings = []
  h.sellers = []
  h.calls = []
  h.updateManyCount = 0
  h.claimCount = 1
  h.released = new Set()
})

describe('sellerPublishDecision — OFF MEANS OFF', () => {
  it('⛔ gate off: allowed for everyone, including a guest, WITHOUT A SINGLE QUERY', async () => {
    expect(await gate.sellerPublishDecision({ ownerId: null, guestCreate: true, now: AFTER_ALL_DEADLINES })).toEqual({ ok: true })
    expect(await gate.sellerPublishDecision({ ownerId: 'plain-owner', now: AFTER_ALL_DEADLINES })).toEqual({ ok: true })
    expect(h.calls).toEqual([])
  })

  it('gate off: partition allows every id and reads nothing; the re-check reads nothing', async () => {
    expect(await gate.partitionByIdentityGate(['a', 'b'])).toEqual({ allowed: ['a', 'b'], held: [] })
    expect(await gate.settleHolds(['a'])).toBe(0)
    expect(h.calls).toEqual([])
  })

  it('⛔ gate off: a claim is the ONE claim-once updateMany it always was — no read, no transaction', async () => {
    expect(await gate.claimGuestStorefront({ match: { phone: '+84900000000' }, ownerId: 'plain-owner' })).toEqual({ claimed: true, held: 0 })
    expect(h.calls.map((c) => c.m)).toEqual(['seller.updateMany'])
    const a = h.calls[0].args
    expect(a.where).toEqual({ phone: '+84900000000', ownerId: null })
    expect(a.data).toMatchObject({ ownerId: 'plain-owner' })
    expect(a.data.claimedAt).toBeInstanceOf(Date)
  })
})

describe('sellerPublishDecision — gate on', () => {
  beforeEach(() => { h.enforced = true })

  it('⛔ a guest create is refused with the sign-in code, and no identity table is read', async () => {
    expect(await gate.sellerPublishDecision({ ownerId: null, guestCreate: true })).toEqual({ ok: false, code: 'identity_sign_in_required' })
    expect(reads()).toEqual([])
  })

  it('an ownerless storefront on an admin/cron/script path is allowed — nobody to verify', async () => {
    expect(await gate.sellerPublishDecision({ ownerId: null, now: AFTER_ALL_DEADLINES })).toEqual({ ok: true })
    expect(reads()).toEqual([])
  })

  it('inside the grace window an unverified owner is allowed — but the identity table IS read, so a REVOKED one is not', async () => {
    expect(await gate.sellerPublishDecision({ ownerId: 'plain-owner', now: new Date('2026-10-15T00:00:00+07:00') })).toEqual({ ok: true })
    expect(reads().map((c) => c.m)).toEqual(['profile.findUnique', 'identityVerification.findMany'])
  })

  it('past the deadline: unverified → identity_unverified, verified → allowed', async () => {
    expect(await gate.sellerPublishDecision({ ownerId: 'plain-owner', now: AFTER_ALL_DEADLINES })).toEqual({ ok: false, code: 'identity_unverified' })
    expect(await gate.sellerPublishDecision({ ownerId: 'verified-owner', now: AFTER_ALL_DEADLINES })).toEqual({ ok: true })
  })

  it.each([
    ['pending', { status: 'pending', decidedAt: null }, 'identity_pending'],
    ['revoked', { status: 'revoked' }, 'identity_suspended'],
    ['rejected', { status: 'rejected' }, 'identity_unverified'],
    ['expired document', { documentExpiresAt: new Date('2027-01-10T00:00:00+07:00') }, 'identity_expired'],
  ])('past the deadline: %s → %s', async (_label, over, code) => {
    h.profiles.set('p', { createdAt: OLD })
    h.ivs.set('p', [verifiedRow('p', over)])
    expect(await gate.sellerPublishDecision({ ownerId: 'p', now: AFTER_ALL_DEADLINES })).toEqual({ ok: false, code })
  })

  it('⛔ decides on identity_verifications, NEVER the Profile cache', async () => {
    // The cache says verified; the only row is a lapsed passport. The row wins.
    h.profiles.set('p', { createdAt: OLD, verificationStatus: 'verified' })
    h.ivs.set('p', [verifiedRow('p', { documentExpiresAt: new Date('2027-01-10T00:00:00+07:00') })])
    expect(await gate.sellerPublishDecision({ ownerId: 'p', now: AFTER_ALL_DEADLINES })).toEqual({ ok: false, code: 'identity_expired' })
  })

  it('an account created after 2026-09-28 has no grace', async () => {
    h.profiles.set('new', { createdAt: new Date('2026-10-01T00:00:00+07:00') })
    expect(await gate.sellerPublishDecision({ ownerId: 'new', now: new Date('2026-10-02T00:00:00+07:00') })).toEqual({ ok: false, code: 'identity_unverified' })
  })

  it('assertSellerMayPublish throws PublishBlockedError carrying the code', async () => {
    await expect(gate.assertSellerMayPublish({ ownerId: null, guestCreate: true })).rejects.toBeInstanceOf(PublishBlockedError)
    await expect(gate.assertSellerMayPublish({ ownerId: null, guestCreate: true })).rejects.toMatchObject({ code: 'identity_sign_in_required' })
    await expect(gate.assertSellerMayPublish({ ownerId: 'verified-owner', now: AFTER_ALL_DEADLINES })).resolves.toBeUndefined()
  })
})

describe('partitionByIdentityGate — the HOLD split for admin / enforcement batches', () => {
  beforeEach(() => { h.enforced = true })

  it('one decision per OWNER, not per row; ownerless rows are allowed; refused owners are held', async () => {
    h.listings = [
      { id: 'l1', seller: { ownerId: 'plain-owner' } },
      { id: 'l2', seller: { ownerId: 'plain-owner' } },
      { id: 'l3', seller: { ownerId: 'verified-owner' } },
      { id: 'l4', seller: { ownerId: null } },
    ]
    const r = await gate.partitionByIdentityGate(['l1', 'l2', 'l3', 'l4'], AFTER_ALL_DEADLINES)
    expect(r).toEqual({ allowed: ['l3', 'l4'], held: ['l1', 'l2'] })
    // Two owners → two Profile reads, not four.
    expect(h.calls.filter((c) => c.m === 'profile.findUnique')).toHaveLength(2)
  })
})

describe('claimGuestStorefront — a guest storefront claimed by an account that cannot publish', () => {
  beforeEach(() => { h.enforced = true })

  it('claims AND parks ONLY the live rows (verified AND active) in ONE transaction, and reports the count', async () => {
    h.sellers = [{ id: 's1', ownerId: 'plain-owner' }]
    h.listings = [{ id: 'l1', seller: { ownerId: 'plain-owner' } }, { id: 'l2', seller: { ownerId: 'plain-owner' } }]
    h.updateManyCount = 2
    const r = await gate.claimGuestStorefront({ match: { id: 's1' }, ownerId: 'plain-owner', data: { name: 'Shop' }, now: AFTER_ALL_DEADLINES })
    expect(r).toEqual({ claimed: true, held: 2 })
    const order = h.calls.map((c) => c.m).filter((m) => m === '$transaction' || m.startsWith('seller.update') || m === 'listing.updateMany')
    // The claim and the park happen inside the transaction, claim first.
    expect(order.slice(0, 3)).toEqual(['$transaction', 'seller.updateMany', 'listing.updateMany'])
    expect(h.calls.find((c) => c.m === 'seller.updateMany')!.args.data).toMatchObject({ ownerId: 'plain-owner', name: 'Shop' })
    const find = h.calls.find((c) => c.m === 'listing.findMany')!.args
    expect(find.where).toEqual({ sellerId: 's1', status: 'active', verified: true })
    const upd = h.calls.find((c) => c.m === 'listing.updateMany')!.args
    // ⚠️ `verified: true` in the WHERE: a row a moderator pulled in between must not gain a hold.
    expect(upd).toEqual({ where: { id: { in: ['l1', 'l2'] }, verified: true }, data: { verified: false, identityHold: true } })
  })

  it('a LOST claim (the ownerId:null guard matched nothing) parks nothing', async () => {
    h.claimCount = 0
    h.listings = [{ id: 'l1' }]
    expect(await gate.claimGuestStorefront({ match: { id: 's1' }, ownerId: 'plain-owner', now: AFTER_ALL_DEADLINES })).toEqual({ claimed: false, held: 0 })
    expect(h.calls.filter((c) => c.m.startsWith('listing.'))).toEqual([])
  })

  it('a claim by an account that MAY publish is the plain claim and touches no listing', async () => {
    h.listings = [{ id: 'l1' }]
    expect(await gate.claimGuestStorefront({ match: { id: 's1' }, ownerId: 'verified-owner', now: AFTER_ALL_DEADLINES })).toEqual({ claimed: true, held: 0 })
    expect(h.calls.filter((c) => c.m.startsWith('listing.') || c.m === '$transaction')).toEqual([])
  })
})

describe('settleHolds — the re-check that closes the decide-then-park race', () => {
  beforeEach(() => { h.enforced = true })

  it('an owner verified since the decision: their holds are released and counted', async () => {
    h.ivs.set('plain-owner', [verifiedRow('plain-owner')])
    h.sellers = [{ id: 's1', ownerId: 'plain-owner' }]
    h.listings = [{ id: 'l1', seller: { ownerId: 'plain-owner' } }]
    h.updateManyCount = 1
    expect(await gate.settleHolds(['l1'], AFTER_ALL_DEADLINES)).toBe(1)
    expect(h.calls.find((c) => c.m === 'listing.updateMany')!.args).toEqual({ where: { id: { in: ['l1'] }, identityHold: true }, data: { verified: true, identityHold: false } })
  })

  it('an owner still refused: nothing is released or written', async () => {
    h.listings = [{ id: 'l1', seller: { ownerId: 'plain-owner' } }]
    // plain-owner has no identity rows and is past every deadline.
    expect(await gate.settleHolds(['l1'], AFTER_ALL_DEADLINES)).toBe(0)
    expect(writes()).toEqual([])
  })

  it('⚠️ fail-quiet: a read failure reports 0 released instead of failing the hold path', async () => {
    const { db } = await import('@/lib/db')
    const spy = vi.spyOn(db.listing, 'findMany').mockRejectedValueOnce(new Error('boom'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await gate.settleHolds(['l1'])).toBe(0)
    spy.mockRestore(); err.mockRestore()
  })
})

describe('AUTO-PUBLISH ON VERIFY — recomputeVerification releases the holds', () => {
  beforeEach(() => { h.enforced = true })

  it('⚠️ the release is NOT gated: a verified recompute releases holds even with the gate off (other edition, or switched off since)', async () => {
    h.enforced = false
    h.profiles.set('p', { createdAt: OLD, verificationStatus: 'pending' })
    h.ivs.set('p', [verifiedRow('p')])
    h.sellers = [{ id: 's1', ownerId: 'p' }]
    h.listings = [{ id: 'l1' }]
    const r = await recomputeVerification('p')
    expect(r.status).toBe('verified')
    expect(h.calls.some((c) => c.m === 'seller.findMany')).toBe(true)
    expect(h.calls.some((c) => c.m === 'listing.updateMany')).toBe(true)
  })

  it('⛔ an ILLEGAL transition (cache says revoked, derivation says verified) releases NOTHING', async () => {
    h.profiles.set('p', { createdAt: OLD, verificationStatus: 'revoked' })
    h.ivs.set('p', [verifiedRow('p')])
    h.sellers = [{ id: 's1', ownerId: 'p' }]
    h.listings = [{ id: 'l1' }]
    const r = await recomputeVerification('p')
    expect(r.status).toBe('revoked')
    expect(h.calls.some((c) => c.m === 'listing.updateMany')).toBe(false)
  })

  it('a profile that derives to `verified` publishes every held listing of every storefront it owns', async () => {
    h.profiles.set('p', { createdAt: OLD, verificationStatus: 'pending' })
    h.ivs.set('p', [verifiedRow('p')])
    h.sellers = [{ id: 's1', ownerId: 'p' }]
    h.listings = [{ id: 'l1' }, { id: 'l2' }]
    h.updateManyCount = 2
    const r = await recomputeVerification('p', new Date('2026-10-01T00:00:00+07:00'))
    expect(r.status).toBe('verified')
    const upd = h.calls.find((c) => c.m === 'listing.updateMany')!.args
    // identityHold IS the only selector — a takedown (identityHold false) can never be released here.
    expect(upd).toEqual({ where: { id: { in: ['l1', 'l2'] }, identityHold: true }, data: { verified: true, identityHold: false } })
    expect(h.calls.find((c) => c.m === 'listing.findMany')!.args.where).toEqual({ sellerId: { in: ['s1'] }, identityHold: true })
    expect(h.calls.filter((c) => c.m === 'reindex').map((c) => c.args)).toEqual(['l1', 'l2'])
  })

  it('releases even when the cache ALREADY said verified (a lapse the sweep never recorded, then a renewal)', async () => {
    h.profiles.set('p', { createdAt: OLD, verificationStatus: 'verified' })
    h.ivs.set('p', [verifiedRow('p')])
    h.sellers = [{ id: 's1', ownerId: 'p' }]
    h.listings = [{ id: 'l1' }]
    h.updateManyCount = 1
    const r = await recomputeVerification('p')
    expect(r.changed).toBe(false)
    expect(h.calls.some((c) => c.m === 'listing.updateMany')).toBe(true)
  })

  it('a profile that is NOT verified releases nothing and never reads its listings', async () => {
    h.profiles.set('p', { createdAt: OLD, verificationStatus: 'unverified' })
    h.ivs.set('p', [verifiedRow('p', { status: 'pending', decidedAt: null })])
    await recomputeVerification('p')
    expect(h.calls.filter((c) => c.m.startsWith('listing.') || c.m === 'seller.findMany')).toEqual([])
  })

  it('⚠️ FAIL-QUIET: a release failure never fails the verification itself', async () => {
    h.profiles.set('p', { createdAt: OLD, verificationStatus: 'pending' })
    h.ivs.set('p', [verifiedRow('p')])
    h.sellers = [{ id: 's1', ownerId: 'p' }]
    h.listings = [{ id: 'l1' }]
    const { db } = await import('@/lib/db')
    const spy = vi.spyOn(db.listing, 'updateMany').mockRejectedValueOnce(new Error('boom'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(recomputeVerification('p')).resolves.toMatchObject({ status: 'verified', changed: true })
    spy.mockRestore(); err.mockRestore()
  })
})
