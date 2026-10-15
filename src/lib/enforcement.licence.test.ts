import { beforeEach, describe, expect, it, vi } from 'vitest'
import { licenceClearedWhere } from './licence-stamp'

// ── Enforcement restores and the LICENCE CHECK (owner, 2026-10-14 — src/lib/licence-stamp.ts) ───────────────────────
//
// A lift, an expiry or a downgrade below `held` restores the listings a hold pulled. A restore is an enforcement
// decision, not a licence check: an e-Visa / Legal & permits row eno has not approved (licenceBlockedIds) must come out
// of it neither published NOR parked — it stays unpublished and waits under Catalogue › Licence checks, whose approval
// publishes it. Pinned on all three paths: the blocked rows are in no write and never reach the identity gate, the
// rest restore as before (a stamped row is simply not blocked), both writes AND licenceClearedWhere for eno's desk
// (resolved once), every pulled id is still revalidated, and nothing about the licence is read when nothing restores.

type Row = Record<string, any>
const DESK = ['desk-seller']
const GUARD = licenceClearedWhere(DESK)

const h = vi.hoisted(() => ({
  /** Ids the identity gate refuses (parked instead of published). */
  held: [] as string[],
  /** Ids the licence pre-filter blocks — unchecked e-Visa / Legal & permits rows. */
  blocked: [] as string[],
  action: null as Record<string, any> | null,
  due: [] as Record<string, any>[],
  updates: [] as Record<string, any>[],
  /** Successive db.listing.updateManyAndReturn row sets — what a park wrote. */
  returns: [] as Record<string, any>[][],
  profileState: 'good_standing',
  deskCalls: 0,
  blockedCalls: [] as Array<{ ids: string[]; desk?: string[] }>,
  partitioned: [] as string[][],
  purged: [] as string[],
}))

vi.mock('./compliance/seller-publish-gate', () => ({
  partitionByIdentityGate: async (ids: string[]) => {
    h.partitioned.push(ids)
    return { allowed: ids.filter((i) => !h.held.includes(i)), held: ids.filter((i) => h.held.includes(i)) }
  },
  settleHolds: async () => 0,
}))
vi.mock('./edition-scope', () => ({ deskSellerIds: async () => { h.deskCalls++; return DESK } }))
vi.mock('./core/licence-check', () => ({
  licenceBlockedIds: async (ids: string[], desk?: string[]) => {
    h.blockedCalls.push({ ids, desk })
    return new Set(ids.filter((i) => h.blocked.includes(i)))
  },
}))
vi.mock('./db', () => {
  const db: Record<string, any> = {
    enforcementAction: {
      findUnique: async () => h.action,
      findMany: async () => h.due,
      update: async () => ({}),
      updateMany: async () => ({ count: 1 }),
      create: async () => ({ id: 'a2' }),
    },
    listing: {
      updateMany: async (a: Record<string, any>) => { h.updates.push(a); return { count: a.where.id.in.length } },
      updateManyAndReturn: async (a: Record<string, any>) => { h.updates.push({ andReturn: true, ...a }); return h.returns.shift() ?? [] },
      findMany: async () => [],
    },
    profile: {
      updateMany: async () => ({ count: 1 }),
      update: async () => ({}),
      findUnique: async () => ({ locale: 'en', enforcementState: h.profileState }),
    },
    seller: { findMany: async () => [] },
    bannedIdentity: { deleteMany: async () => ({ count: 0 }) },
    notification: { create: async () => ({}) },
  }
  db.$transaction = async (fn: (tx: Record<string, any>) => unknown) => fn(db)
  db.$queryRaw = async () => [{ enforcementState: h.profileState }]
  return { db }
})
vi.mock('./push', () => ({ sendPushToProfile: async () => 0 }))
vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: (p: string) => { h.purged.push(p) } }))

const { liftAction, expireEnforcement, applyEnforcement } = await import('./enforcement')

const action = (pulled: string[]) => ({ id: 'a1', profileId: 'p1', state: 'held', reason: 'admin_manual', status: 'active', pulledListingIds: JSON.stringify(pulled), appealedAt: null, appealOutcome: null })
const publish = (ids: string[]) => ({ where: { id: { in: ids }, status: 'active', verified: false, AND: [GUARD] }, data: { verified: true, identityHold: false, verificationNotes: null } })
const park = (ids: string[]) => ({ andReturn: true, where: { id: { in: ids }, status: 'active', verified: false, identityHold: false, AND: [GUARD] }, data: { identityHold: true }, select: { id: true } })
/** Every id a write touched, whichever write. */
const written = () => h.updates.flatMap((u) => u.where.id.in as string[])

beforeEach(() => {
  h.held = []
  h.blocked = []
  h.action = null
  h.due = []
  h.updates = []
  h.returns = []
  h.profileState = 'good_standing'
  h.deskCalls = 0
  h.blockedCalls = []
  h.partitioned = []
  h.purged = []
})

describe('liftAction — an unchecked licence-aisle row is not restored', () => {
  it('⛔ a blocked row is neither published nor parked, and never reaches the identity gate — the rest restore as before', async () => {
    h.action = action(['l1', 'visa-1', 'l2'])
    h.blocked = ['visa-1']
    expect(await liftAction('a1', { to: 'lifted', by: 'mod@eno.vn' })).toBe(true)
    expect(h.blockedCalls).toEqual([{ ids: ['l1', 'visa-1', 'l2'], desk: DESK }])
    expect(h.partitioned).toEqual([['l1', 'l2']])
    expect(h.updates).toEqual([publish(['l1', 'l2'])])
    expect(written()).not.toContain('visa-1')
    // Revalidated all the same: one render of a page whose state did not change.
    expect(h.purged).toEqual(expect.arrayContaining(['/listings/visa-1']))
  })

  it('a refused owner: the blocked row is not parked either — only the rest is', async () => {
    h.action = action(['l1', 'visa-1'])
    h.held = ['l1', 'visa-1']
    h.blocked = ['visa-1']
    h.returns = [[{ id: 'l1' }]]
    const onHeld = vi.fn()
    expect(await liftAction('a1', { to: 'lifted', by: 'mod@eno.vn', onHeld })).toBe(true)
    expect(h.updates).toEqual([park(['l1'])])
    expect(onHeld).toHaveBeenCalledWith(1)
  })

  it('a STAMPED aisle row (cleared, so not blocked) restores like any other — the guard is in both writes', async () => {
    h.action = action(['visa-ok', 'l2'])
    h.held = ['l2']
    h.returns = [[{ id: 'l2' }]]
    expect(await liftAction('a1', { to: 'lifted', by: 'mod@eno.vn' })).toBe(true)
    expect(h.updates).toEqual([publish(['visa-ok']), park(['l2'])])
  })

  it('every pulled row blocked → no write at all, and the identity gate is handed nothing to decide', async () => {
    h.action = action(['visa-1', 'visa-2'])
    h.blocked = ['visa-1', 'visa-2']
    expect(await liftAction('a1', { to: 'lifted', by: 'mod@eno.vn' })).toBe(true)
    expect(h.updates).toEqual([])
    expect(h.partitioned).toEqual([[]])
  })
})

describe('expireEnforcement (cron) — the same rule on a timed hold', () => {
  it('⛔ a blocked row stays unpublished when the hold lapses', async () => {
    h.due = [{ id: 'a1', profileId: 'p1', state: 'held', pulledListingIds: JSON.stringify(['l1', 'visa-1']) }]
    h.blocked = ['visa-1']
    expect(await expireEnforcement()).toBe(1)
    expect(h.updates).toEqual([publish(['l1'])])
    expect(h.blockedCalls).toEqual([{ ids: ['l1', 'visa-1'], desk: DESK }])
  })
})

describe('applyEnforcement — a downgrade below `held`', () => {
  const lift = { state: 'good_standing' as const, reason: 'admin_manual', expiresAt: null }

  it('⛔ a blocked row is in neither the publish nor the park; both AND the guard; the desk is resolved once', async () => {
    h.profileState = 'held'
    h.due = [{ id: 'a1', state: 'held', pulledListingIds: JSON.stringify(['l1', 'visa-1', 'l2', 'l3']) }]
    h.held = ['l2', 'visa-1']
    h.blocked = ['visa-1']
    h.returns = [[{ id: 'l2' }]]
    const onHeld = vi.fn()
    expect(await applyEnforcement('p1', lift, { decidedBy: 'mod@eno.vn', onHeld })).toBe(true)
    expect(h.deskCalls).toBe(1)
    expect(h.blockedCalls).toEqual([{ ids: ['l1', 'visa-1', 'l2', 'l3'], desk: DESK }])
    // The identity decision is made over the restorable rows only.
    expect(h.partitioned).toEqual([['l1', 'l2', 'l3']])
    expect(h.updates).toEqual([publish(['l1', 'l3']), park(['l2'])])
    expect(onHeld).toHaveBeenCalledWith(1)
    // `touched` still carries every pulled id — the blocked one's page is revalidated with the rest, and the home page once.
    expect(h.purged).toEqual(expect.arrayContaining(['/listings/visa-1', '/listings/l1', '/']))
  })

  it('a transition that restores nothing reads nothing about the licence (no desk, no pre-filter read)', async () => {
    h.profileState = 'good_standing'
    expect(await applyEnforcement('p1', { state: 'warned', reason: 'admin_manual', expiresAt: null }, { decidedBy: 'mod@eno.vn' })).toBe(true)
    expect(h.deskCalls).toBe(0)
    expect(h.blockedCalls).toEqual([{ ids: [], desk: [] }])
    expect(h.updates).toEqual([])
  })
})
