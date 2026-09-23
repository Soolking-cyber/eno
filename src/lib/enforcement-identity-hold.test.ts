import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Enforcement restores under the seller identity gate ─────────────────────────────────────────
//
// Lifting or expiring a hold RESTORES the listings it pulled — a transition back into public state
// that is an enforcement decision, not an identity one. So for an owner the gate refuses, the pulled
// rows are PARKED (identityHold) instead of published, and the admin console is told how many.
// Pinned: gate off → the restore is the single write it always was; gate on → the split, with the
// SAME `status:'active', verified:false` guard on both halves so a row sold or re-approved in the
// meantime is never touched — and, on every path (lift, expiry, a downgrade through
// applyEnforcement), the held count is what the park WROTE, never the size of the decision set, and
// only the ids the park wrote go to the post-write re-check (settleHolds).

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  held: [] as string[],
  action: null as Row | null,
  due: [] as Row[],
  /** Every listing write in order: updateMany args as-is, updateManyAndReturn args tagged `andReturn`. */
  updates: [] as Row[],
  counts: [] as number[],
  /** Successive db.listing.updateManyAndReturn row sets — what the park actually wrote; default []. */
  returns: [] as Row[][],
  /** Ids whose owner the post-write re-check (settleHolds) finds verified NOW; it releases those it is GIVEN. */
  releasable: [] as string[],
  settleCalls: [] as string[][],
  /** Profile.enforcementState applyEnforcement reads first. */
  profileState: 'good_standing',
}))

vi.mock('./compliance/seller-publish-gate', () => ({
  partitionByIdentityGate: async (ids: string[]) => ({ allowed: ids.filter((i) => !h.held.includes(i)), held: ids.filter((i) => h.held.includes(i)) }),
  // Like the real one: it re-reads only the ids it is given and counts among those.
  settleHolds: async (ids: string[]) => { h.settleCalls.push(ids); return ids.filter((i) => h.releasable.includes(i)).length },
}))
vi.mock('./db', () => {
  const db: Row = {
    enforcementAction: {
      findUnique: async () => h.action,
      findMany: async () => h.due,
      update: async () => ({}),
      updateMany: async () => ({ count: 1 }),
      create: async () => ({ id: 'a2' }),
    },
    listing: {
      updateMany: async (a: Row) => { h.updates.push(a); return { count: h.counts.shift() ?? 0 } },
      updateManyAndReturn: async (a: Row) => { h.updates.push({ andReturn: true, ...a }); return h.returns.shift() ?? [] },
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
  // applyEnforcement's interactive transaction runs against the same fake client.
  db.$transaction = async (fn: (tx: Row) => unknown) => fn(db)
  // …whose Profile row lock re-reads the state it decided on (no concurrent writer in this file).
  db.$queryRaw = async () => [{ enforcementState: h.profileState }]
  return { db }
})
vi.mock('./push', () => ({ sendPushToProfile: async () => 0 }))
vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: () => {} }))

const { liftAction, expireEnforcement, applyEnforcement } = await import('./enforcement')

const action = (pulled: string[]) => ({ id: 'a1', profileId: 'p1', state: 'held', reason: 'admin_manual', status: 'active', pulledListingIds: JSON.stringify(pulled), appealedAt: null, appealOutcome: null })

beforeEach(() => {
  h.held = []
  h.action = null
  h.due = []
  h.updates = []
  h.counts = []
  h.returns = []
  h.releasable = []
  h.settleCalls = []
  h.profileState = 'good_standing'
})

const park = (ids: string[]) => ({ andReturn: true, where: { id: { in: ids }, status: 'active', verified: false, identityHold: false }, data: { identityHold: true }, select: { id: true } })
const publish = (ids: string[]) => ({ where: { id: { in: ids }, status: 'active', verified: false }, data: { verified: true, identityHold: false } })
const rows = (ids: string[]) => ids.map((id) => ({ id }))

describe('liftAction', () => {
  it('⛔ gate off (nobody held): ONE restore write, and no held callback', async () => {
    h.action = action(['l1', 'l2'])
    const onHeld = vi.fn()
    expect(await liftAction('a1', { to: 'lifted', by: 'mod@eno.vn', onHeld })).toBe(true)
    // `identityHold: false` rides the publish: a row this restore makes live must not carry a hold.
    expect(h.updates).toEqual([publish(['l1', 'l2'])])
    expect(onHeld).not.toHaveBeenCalled()
    expect(h.settleCalls).toEqual([])
  })

  it('gate on + refused owner: pulled rows are PARKED, not published, and the count reaches the console', async () => {
    h.action = action(['l1', 'l2'])
    h.held = ['l1', 'l2']
    h.returns = [rows(['l1', 'l2'])]
    const onHeld = vi.fn()
    expect(await liftAction('a1', { to: 'lifted', by: 'mod@eno.vn', onHeld })).toBe(true)
    expect(h.updates).toEqual([park(['l1', 'l2'])])
    expect(onHeld).toHaveBeenCalledWith(2)
  })
})

describe('liftAction — a verification that raced the park', () => {
  it('rows the post-write re-check released are not reported as held', async () => {
    h.action = action(['l1', 'l2'])
    h.held = ['l1', 'l2']
    h.returns = [rows(['l1', 'l2'])]
    h.releasable = ['l1', 'l2']
    const onHeld = vi.fn()
    expect(await liftAction('a1', { to: 'lifted', by: 'mod@eno.vn', onHeld })).toBe(true)
    expect(onHeld).not.toHaveBeenCalled()
  })

  it('⛔ only the ids the park WROTE are re-checked — a pre-existing hold released there cannot cancel a row parked here', async () => {
    // 'l2' was ALREADY parked (so the park's `identityHold: false` guard skipped it) and the re-check
    // finds its owner verified now; 'l1' was parked by THIS lift and its owner is still refused.
    // Handing settleHolds the whole decision set counted 'l2' as a release and floored `held` to 0.
    h.action = action(['l1', 'l2'])
    h.held = ['l1', 'l2']
    h.returns = [rows(['l1'])]
    h.releasable = ['l2']
    const onHeld = vi.fn()
    expect(await liftAction('a1', { to: 'lifted', by: 'mod@eno.vn', onHeld })).toBe(true)
    expect(h.settleCalls).toEqual([['l1']])
    expect(onHeld).toHaveBeenCalledWith(1)
  })

  it('nothing parked (every held row sold/hidden/re-approved/already parked) → no re-check at all', async () => {
    h.action = action(['l1'])
    h.held = ['l1']
    h.returns = [[]]
    const onHeld = vi.fn()
    expect(await liftAction('a1', { to: 'lifted', by: 'mod@eno.vn', onHeld })).toBe(true)
    expect(h.settleCalls).toEqual([])
    expect(onHeld).not.toHaveBeenCalled()
  })
})

describe('expireEnforcement (cron)', () => {
  it('gate on + refused owner: the timed hold lapses, its rows are parked and the count is logged', async () => {
    h.due = [{ id: 'a1', profileId: 'p1', state: 'held', pulledListingIds: JSON.stringify(['l1', 'l2']) }]
    h.held = ['l2']
    h.counts = [1]
    h.returns = [rows(['l2'])]
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await expireEnforcement()).toBe(1)
    expect(h.updates).toEqual([publish(['l1']), park(['l2'])])
    expect(h.settleCalls).toEqual([['l2']])
    expect(warn).toHaveBeenCalledWith('[enforcement] expiry restore parked by identity gate', { profileId: 'p1', held: 1 })
    warn.mockRestore()
  })
})

describe('applyEnforcement — a downgrade below `held` restores the pulled rows', () => {
  const lift = { state: 'good_standing' as const, reason: 'admin_manual', expiresAt: null }

  it('⛔ gate off: the restore publishes with identityHold cleared, and nothing is re-checked', async () => {
    h.profileState = 'held'
    h.due = [{ id: 'a1', state: 'held', pulledListingIds: JSON.stringify(['l1', 'l2']) }]
    const onHeld = vi.fn()
    expect(await applyEnforcement('p1', lift, { decidedBy: 'mod@eno.vn', onHeld })).toBe(true)
    expect(h.updates).toEqual([publish(['l1', 'l2'])])
    expect(h.settleCalls).toEqual([])
    expect(onHeld).not.toHaveBeenCalled()
  })

  it('⛔ `held` is what the park WROTE: a pulled row since sold is not reported as held', async () => {
    h.profileState = 'held'
    h.due = [{ id: 'a1', state: 'held', pulledListingIds: JSON.stringify(['l1', 'l2']) }]
    h.held = ['l1', 'l2']
    // 'l2' was sold after the pull, so the park's `status: 'active'` guard matched only 'l1'.
    h.returns = [rows(['l1'])]
    const onHeld = vi.fn()
    expect(await applyEnforcement('p1', lift, { decidedBy: 'mod@eno.vn', onHeld })).toBe(true)
    expect(h.updates).toEqual([park(['l1', 'l2'])])
    expect(onHeld).toHaveBeenCalledWith(1)
  })

  it('every pulled row sold, hidden or re-approved since → nothing parked, nothing reported', async () => {
    h.profileState = 'held'
    h.due = [{ id: 'a1', state: 'held', pulledListingIds: JSON.stringify(['l1', 'l2']) }]
    h.held = ['l1', 'l2']
    h.returns = [[], []]
    const onHeld = vi.fn()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await applyEnforcement('p1', lift, { decidedBy: 'system' })).toBe(true)
    expect(await applyEnforcement('p1', lift, { decidedBy: 'mod@eno.vn', onHeld })).toBe(true)
    expect(onHeld).not.toHaveBeenCalled()
    expect(h.settleCalls).toEqual([])
    expect(warn).not.toHaveBeenCalledWith('[enforcement] downgrade restore parked by identity gate', expect.anything())
    warn.mockRestore()
  })

  it('rows the post-commit re-check released are not reported as held', async () => {
    h.profileState = 'held'
    h.due = [{ id: 'a1', state: 'held', pulledListingIds: JSON.stringify(['l1', 'l2']) }]
    h.held = ['l1', 'l2']
    h.returns = [rows(['l1', 'l2'])]
    h.releasable = ['l1', 'l2']
    const onHeld = vi.fn()
    expect(await applyEnforcement('p1', lift, { decidedBy: 'mod@eno.vn', onHeld })).toBe(true)
    expect(onHeld).not.toHaveBeenCalled()
  })

  it('⛔ only the ids the park WROTE are re-checked — a pre-existing hold released there cannot cancel a row parked here', async () => {
    // Same shape as the lift case: 'l2' was already parked, its owner verifies mid-downgrade; 'l1' is
    // parked by this restore and still refused. The whole-set re-check reported 0 held.
    h.profileState = 'held'
    h.due = [{ id: 'a1', state: 'held', pulledListingIds: JSON.stringify(['l1', 'l2']) }]
    h.held = ['l1', 'l2']
    h.returns = [rows(['l1'])]
    h.releasable = ['l2']
    const onHeld = vi.fn()
    expect(await applyEnforcement('p1', lift, { decidedBy: 'mod@eno.vn', onHeld })).toBe(true)
    expect(h.settleCalls).toEqual([['l1']])
    expect(onHeld).toHaveBeenCalledWith(1)
  })
})
