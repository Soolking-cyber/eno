import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── reconcileIdentities — the nightly identity reconcile (owner, 2026-10-15; plan review R3/R4) ──────────────────────
//
// Pinned: it selects EVERY distinct non-null profileId with ANY identity row (no expiry window, no revoked blind spot);
// recomputes them ONE AT A TIME with the run's clock; counts a throw, effects that did not run and a failed effects step
// as failures and keeps going; reports an illegal cache move without failing; and a dry run READS ONLY — the database
// below throws on anything that is not one of the three reads, and recomputeVerification must never be called.

type Row = Record<string, any>
const h = vi.hoisted(() => ({
  calls: [] as Array<{ m: string; args: any }>,
  /** What the distinct-owner selection returns (duplicates allowed — the code dedupes). */
  owners: [] as Row[],
  /** identity rows for the dry run's derivation. */
  rows: [] as Row[],
  profiles: [] as Row[],
  teachers: [] as Row[],
  /** Per profile: the RecomputeResult to return, or an Error to throw. Missing → in sync, effects clean. */
  results: new Map<string, Row | Error>(),
  inFlight: 0,
  maxInFlight: 0,
}))

vi.mock('@/lib/db', () => {
  const rec = (m: string, args: any) => { h.calls.push({ m, args }) }
  const READS: Record<string, Record<string, (a: Row) => Promise<unknown>>> = {
    identityVerification: {
      findMany: async (a) => {
        rec('identityVerification.findMany', a)
        if (a.distinct) return h.owners
        const ids: string[] = a.where?.profileId?.in ?? []
        return h.rows.filter((r) => ids.includes(r.profileId))
      },
    },
    profile: { findMany: async (a) => { rec('profile.findMany', a); return h.profiles } },
    teacherProfile: {
      findMany: async (a) => { rec('teacherProfile.findMany', a); return h.teachers.filter((t) => (a.where?.profileId?.in ?? []).includes(t.profileId)) },
    },
  }
  // ⛔ ANYTHING ELSE IS A WRITE (or an unplanned read): recorded and refused, so "zero writes" is checked, not assumed.
  const refuse = (what: string) => async (a: unknown) => { rec(`WRITE ${what}`, a); throw new Error(`unexpected db call: ${what}`) }
  const model = (name: string) => new Proxy({}, {
    get: (_t, op) => (typeof op !== 'string' ? undefined : READS[name]?.[op] ?? refuse(`${name}.${op}`)),
  })
  const db = new Proxy({}, {
    get: (_t, key) => (typeof key !== 'string' || key === 'then' ? undefined : key.startsWith('$') ? refuse(key) : model(key)),
  })
  return { db }
})
vi.mock('./recompute-verification', () => ({
  recomputeVerification: async (profileId: string, now: Date) => {
    h.calls.push({ m: 'recomputeVerification', args: [profileId, now] })
    h.inFlight++
    h.maxInFlight = Math.max(h.maxInFlight, h.inFlight)
    try {
      await new Promise((r) => setTimeout(r, 1)) // a real await, so overlapping calls WOULD overlap
      const r = h.results.get(profileId)
      if (r instanceof Error) throw r
      return r ?? { status: 'verified', sourceId: 'iv', changed: false, effects: { trustMoved: false, markChanged: false, purged: false, failed: false } }
    } finally {
      h.inFlight--
    }
  },
}))
vi.mock('@/lib/log', () => ({
  logError: (e: unknown, ctx: unknown) => { h.calls.push({ m: 'logError', args: [e, ctx] }) },
  logWarn: () => {},
  logInfo: () => {},
}))

const { reconcileIdentities } = await import('./identity-reconcile')

const NOW = new Date('2026-10-16T09:05:00+07:00')
const effects = (over: Row = {}) => ({ trustMoved: false, markChanged: false, purged: false, failed: false, ...over })
const recomputed = () => h.calls.filter((c) => c.m === 'recomputeVerification').map((c) => c.args[0])
const writes = () => h.calls.filter((c) => c.m.startsWith('WRITE'))
const ivRow = (profileId: string, over: Row = {}) => ({
  id: `iv-${profileId}-${h.rows.length}`, profileId, tier: 'B', method: 'passport_mrz', status: 'verified',
  decidedAt: new Date('2026-06-01T00:00:00+07:00'), documentExpiresAt: new Date('2030-01-01T00:00:00+07:00'), assuranceLevel: null, ...over,
})

beforeEach(() => {
  h.calls = []
  h.owners = []
  h.rows = []
  h.profiles = []
  h.teachers = []
  h.results = new Map()
  h.inFlight = 0
  h.maxInFlight = 0
})

describe('reconcileIdentities — the selection', () => {
  it('⛔ EVERY distinct non-null owner of ANY identity row — no status filter, no expiry window', async () => {
    h.owners = [{ profileId: 'a' }, { profileId: 'b' }, { profileId: 'a' }, { profileId: null }]
    const r = await reconcileIdentities({ now: NOW })
    const sel = h.calls.find((c) => c.m === 'identityVerification.findMany')!.args
    expect(sel.where).toEqual({ profileId: { not: null } })
    expect(sel.select).toEqual({ profileId: true })
    expect(sel.distinct).toEqual(['profileId'])
    expect(recomputed()).toEqual(['a', 'b']) // deduped, and the erased (null) row's owner is nobody
    expect(r.checked).toBe(2)
  })

  it('no identity row anywhere: nothing recomputed, nothing else read', async () => {
    expect(await reconcileIdentities({ now: NOW })).toEqual({ checked: 0, recomputed: 0, changed: 0, failed: 0, illegal: 0, trustMoved: 0, purged: 0 })
    expect(h.calls.map((c) => c.m)).toEqual(['identityVerification.findMany'])
  })
})

describe('reconcileIdentities — the real run', () => {
  it('recomputes each profile ONE AT A TIME, with the run\'s clock', async () => {
    h.owners = ['a', 'b', 'c'].map((profileId) => ({ profileId }))
    await reconcileIdentities({ now: NOW })
    expect(h.calls.filter((c) => c.m === 'recomputeVerification').map((c) => c.args)).toEqual([['a', NOW], ['b', NOW], ['c', NOW]])
    expect(h.maxInFlight).toBe(1)
  })

  it('tallies cache writes, trust moves and purges; an ILLEGAL move is reported, never failed', async () => {
    h.owners = ['a', 'b', 'c'].map((profileId) => ({ profileId }))
    h.results.set('a', { status: 'expired', sourceId: 'x', changed: true, effects: effects({ trustMoved: true, purged: true }) })
    h.results.set('b', { status: 'revoked', sourceId: 'y', changed: false, illegalTransition: { from: 'revoked', to: 'verified' }, effects: effects({ trustMoved: true }) })
    const r = await reconcileIdentities({ now: NOW })
    expect(r).toEqual({ checked: 3, recomputed: 3, changed: 1, failed: 0, illegal: 1, trustMoved: 2, purged: 1 })
  })

  it('a THROW is counted and logged, and the next profile still runs', async () => {
    h.owners = ['a', 'b'].map((profileId) => ({ profileId }))
    h.results.set('a', new Error('db hiccup'))
    const r = await reconcileIdentities({ now: NOW })
    expect(recomputed()).toEqual(['a', 'b'])
    expect(r).toMatchObject({ checked: 2, recomputed: 1, failed: 1 })
    const log = h.calls.find((c) => c.m === 'logError')!
    expect(log.args[1]).toEqual({ op: 'identity.reconcile', profileId: 'a' })
  })

  it('effects that did not run at all, or whose step failed, count as failures — the cache write still counts', async () => {
    h.owners = ['a', 'b', 'c'].map((profileId) => ({ profileId }))
    h.results.set('a', { status: 'verified', sourceId: 'x', changed: true }) // no `effects`: the lazy import failed
    h.results.set('b', { status: 'verified', sourceId: 'y', changed: false, effects: effects({ failed: true, purged: false }) })
    const r = await reconcileIdentities({ now: NOW })
    expect(r).toMatchObject({ recomputed: 3, changed: 1, failed: 2 })
  })

  it('the real run reads nothing beyond the selection itself (recomputeVerification does its own reading)', async () => {
    h.owners = [{ profileId: 'a' }]
    await reconcileIdentities({ now: NOW })
    expect(h.calls.map((c) => c.m)).toEqual(['identityVerification.findMany', 'recomputeVerification'])
  })
})

describe('reconcileIdentities — ⛔ the dry run READS ONLY', () => {
  beforeEach(() => {
    h.owners = ['lapsed', 'insync', 'stuck', 'teacher'].map((profileId) => ({ profileId }))
    h.rows = [
      ivRow('lapsed', { documentExpiresAt: new Date('2026-10-14T00:00:00+07:00') }), // lapsed before today (ICT)
      ivRow('insync'),
      ivRow('stuck'),
      ivRow('teacher', { status: 'pending', decidedAt: null }),
    ]
    h.profiles = [
      { id: 'lapsed', verificationStatus: 'verified' }, // the cache missed the lapse
      { id: 'insync', verificationStatus: 'verified' },
      { id: 'stuck', verificationStatus: 'revoked' }, // revoked → verified: a move a real run refuses
      // 'teacher' has no Profile row read back: read as unverified, as recomputeVerification would.
    ]
    h.teachers = [{ profileId: 'teacher' }]
  })

  it('derives, compares and reports — and makes ZERO recomputes and ZERO writes', async () => {
    const r = await reconcileIdentities({ now: NOW, dryRun: true })
    expect(recomputed()).toEqual([])
    expect(writes()).toEqual([])
    expect(h.calls.map((c) => c.m).sort()).toEqual(['identityVerification.findMany', 'identityVerification.findMany', 'profile.findMany', 'teacherProfile.findMany'])
    expect(r).toMatchObject({ checked: 4, recomputed: 0, changed: 0, failed: 0, illegal: 1, trustMoved: 0, purged: 0, dryRun: true, mismatched: 3, teachers: 1 })
    expect(r.profiles).toEqual([
      { profileId: 'lapsed', derived: 'expired', cached: 'verified', mismatch: true, illegal: false, teacher: false },
      { profileId: 'insync', derived: 'verified', cached: 'verified', mismatch: false, illegal: false, teacher: false },
      { profileId: 'stuck', derived: 'verified', cached: 'revoked', mismatch: true, illegal: true, teacher: false },
      { profileId: 'teacher', derived: 'pending', cached: 'unverified', mismatch: true, illegal: false, teacher: true },
    ])
  })

  it('(the tripwire is not vacuous: this fake database refuses and records a write)', async () => {
    const { db } = (await import('@/lib/db')) as unknown as { db: Row }
    await expect(db.profile.update({ where: { id: 'x' }, data: {} })).rejects.toThrow(/unexpected db call/)
    await expect(db.$executeRaw``).rejects.toThrow(/unexpected db call/)
    expect(writes().map((c) => c.m)).toEqual(['WRITE profile.update', 'WRITE $executeRaw'])
  })

  it('the counts lead the result, in the order the route\'s first 200 bytes need', async () => {
    const r = await reconcileIdentities({ now: NOW, dryRun: true })
    expect(Object.keys(r).slice(0, 7)).toEqual(['checked', 'recomputed', 'changed', 'failed', 'illegal', 'trustMoved', 'purged'])
  })

  it('a dry run with no identity rows answers zeros and reads nothing more', async () => {
    h.owners = []
    expect(await reconcileIdentities({ now: NOW, dryRun: true })).toEqual({
      checked: 0, recomputed: 0, changed: 0, failed: 0, illegal: 0, trustMoved: 0, purged: 0, dryRun: true, mismatched: 0, teachers: 0, profiles: [],
    })
    expect(h.calls.map((c) => c.m)).toEqual(['identityVerification.findMany'])
  })
})
