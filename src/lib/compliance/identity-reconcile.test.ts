import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── reconcileIdentities — the nightly identity reconcile (owner, 2026-10-15; plan review R3/R4) ──────────────────────
//
// Pinned: it selects EVERY distinct non-null profileId with ANY identity row (no expiry window, no revoked blind spot);
// recomputes them ONE AT A TIME with the run's clock; counts a throw, effects that did not run and a failed effects step
// as failures and keeps going; reports an illegal cache move without failing; and a dry run READS ONLY — the database
// below throws on anything that is not one of its reads, and recomputeVerification must never be called.
// And the CARD-TICK PASS (C4): after the loop, every teacher whose switch is on or whose card cache carries a value —
// minus those the loop handled cleanly — is synced one at a time (syncIdentityMarkCard, faked here), purged when the
// cache changed or when a revoked teacher's switch is still on, each failure counted into `failed`; its dry run judges
// with identityMarkState (faked) against the stored cache and writes, syncs and purges NOTHING.

type Row = Record<string, any>
const h = vi.hoisted(() => ({
  /** Listing ids clearOrphanIdentityMarks nulls; and whether it throws. */
  orphans: [] as string[],
  orphansThrow: false,
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
  /** The card pass's selection (switch on, or a card cache carrying a value), as the TeacherProfile read returns it. */
  marked: [] as Row[],
  markedThrows: false,
  /** Per profile: what syncIdentityMarkCard answers (null: no listing), or an Error to throw. Missing → in sync. */
  syncs: new Map<string, Row | null | Error>(),
  /** Per profile: what identityMarkState answers in a dry run, or an Error. Missing → not shown, 'off'. */
  states: new Map<string, Row | Error>(),
  syncInFlight: 0,
  syncMaxInFlight: 0,
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
      findMany: async (a) => {
        if (a.where?.OR) {
          rec('teacherProfile.findMany(marks)', a)
          if (h.markedThrows) throw new Error('teacher read down')
          return h.marked
        }
        rec('teacherProfile.findMany', a)
        return h.teachers.filter((t) => (a.where?.profileId?.in ?? []).includes(t.profileId))
      },
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
vi.mock('@/lib/teachers/identity-mark-card', () => ({
  // Orphaned caches (a listing with no TeacherProfile) — the ids the guarded clear nulled.
  countOrphanIdentityMarks: async () => {
    h.calls.push({ m: 'countOrphanIdentityMarks', args: [] })
    return h.orphans.length
  },
  clearOrphanIdentityMarks: async () => {
    h.calls.push({ m: 'clearOrphanIdentityMarks', args: [] })
    if (h.orphansThrow) throw new Error('orphan clear failed')
    return h.orphans
  },
  syncIdentityMarkCard: async (profileId: string, now: Date) => {
    h.calls.push({ m: 'syncIdentityMarkCard', args: [profileId, now] })
    h.syncInFlight++
    h.syncMaxInFlight = Math.max(h.syncMaxInFlight, h.syncInFlight)
    try {
      await new Promise((r) => setTimeout(r, 1))
      const r = h.syncs.has(profileId) ? h.syncs.get(profileId) : { listingId: `L-${profileId}`, districts: ['d7'], changed: false, shown: false, reason: 'off', on: false }
      if (r instanceof Error) throw r
      return r
    } finally {
      h.syncInFlight--
    }
  },
}))
vi.mock('@/lib/teachers/identity-mark', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/teachers/identity-mark')>()),
  identityMarkState: async (m: Row, now: Date) => {
    h.calls.push({ m: 'identityMarkState', args: [m, now] })
    const r = h.states.get(m.profileId as string) ?? { shown: false, reason: 'off' }
    if (r instanceof Error) throw r
    return r
  },
}))
vi.mock('@/lib/teachers/revalidate', () => ({
  revalidateTeacherPages: (listingId: string | null, districts: unknown[]) => { h.calls.push({ m: 'revalidateTeacherPages', args: [listingId, districts] }) },
}))
vi.mock('@/lib/log', () => ({
  logError: (e: unknown, ctx: unknown) => { h.calls.push({ m: 'logError', args: [e, ctx] }) },
  logWarn: () => {},
  logInfo: () => {},
}))

const { reconcileIdentities, reconcileIdentityMarks } = await import('./identity-reconcile')
const { IDENTITY_MARK_NOTICE_VERSION } = await import('@/lib/teachers/constants')

const NOW = new Date('2026-10-16T09:05:00+07:00')
const effects = (over: Row = {}) => ({ trustMoved: false, markChanged: false, purged: false, failed: false, ...over })
const recomputed = () => h.calls.filter((c) => c.m === 'recomputeVerification').map((c) => c.args[0])
const writes = () => h.calls.filter((c) => c.m.startsWith('WRITE'))
const synced = () => h.calls.filter((c) => c.m === 'syncIdentityMarkCard').map((c) => c.args[0])
const purgedPages = () => h.calls.filter((c) => c.m === 'revalidateTeacherPages').map((c) => c.args)
const NO_MARKS = { checked: 0, changed: 0, purged: 0, failed: 0 }
/** A selected teacher, as the card pass's TeacherProfile read returns it. */
const marked = (profileId: string, over: Row = {}): Row => ({
  profileId, fullName: 'Anna Eriksson', identityMarkOn: true, identityMarkNoticeVersion: IDENTITY_MARK_NOTICE_VERSION,
  identityMarkWithdrawnAt: null, listing: { identityMarkNotice: null, status: 'active' }, ...over,
})
const sync = (over: Row = {}) => ({ listingId: 'L1', districts: ['d7'], changed: false, shown: false, reason: 'off', on: true, ...over })
const ivRow = (profileId: string, over: Row = {}) => ({
  id: `iv-${profileId}-${h.rows.length}`, profileId, tier: 'B', method: 'passport_mrz', status: 'verified',
  decidedAt: new Date('2026-06-01T00:00:00+07:00'), documentExpiresAt: new Date('2030-01-01T00:00:00+07:00'), assuranceLevel: null, ...over,
})

beforeEach(() => {
  h.orphans = []
  h.orphansThrow = false
  h.calls = []
  h.owners = []
  h.rows = []
  h.profiles = []
  h.teachers = []
  h.results = new Map()
  h.inFlight = 0
  h.maxInFlight = 0
  h.marked = []
  h.markedThrows = false
  h.syncs = new Map()
  h.states = new Map()
  h.syncInFlight = 0
  h.syncMaxInFlight = 0
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

  it('no identity row anywhere: nothing recomputed — and the card pass still reads its own selection (and nothing else)', async () => {
    expect(await reconcileIdentities({ now: NOW })).toEqual({ checked: 0, recomputed: 0, changed: 0, failed: 0, illegal: 0, trustMoved: 0, purged: 0, marks: NO_MARKS })
    expect(h.calls.map((c) => c.m)).toEqual(['identityVerification.findMany', 'teacherProfile.findMany(marks)', 'clearOrphanIdentityMarks'])
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
    expect(r).toEqual({ checked: 3, recomputed: 3, changed: 1, failed: 0, illegal: 1, trustMoved: 2, purged: 1, marks: NO_MARKS })
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

  it('the real run reads nothing beyond its two selections (recomputeVerification and the card sync do their own reading)', async () => {
    h.owners = [{ profileId: 'a' }]
    await reconcileIdentities({ now: NOW })
    expect(h.calls.map((c) => c.m)).toEqual(['identityVerification.findMany', 'recomputeVerification', 'teacherProfile.findMany(marks)', 'clearOrphanIdentityMarks'])
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
    expect(synced()).toEqual([])
    expect(purgedPages()).toEqual([])
    expect(h.calls.map((c) => c.m).sort()).toEqual(['countOrphanIdentityMarks', 'identityVerification.findMany', 'identityVerification.findMany', 'profile.findMany', 'teacherProfile.findMany', 'teacherProfile.findMany(marks)'])
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

  it('the counts lead the result, in the order the route\'s first 200 bytes need — the card pass\'s right after', async () => {
    for (const dryRun of [true, false]) {
      const r = await reconcileIdentities({ now: NOW, dryRun })
      expect(Object.keys(r).slice(0, 8), String(dryRun)).toEqual(['checked', 'recomputed', 'changed', 'failed', 'illegal', 'trustMoved', 'purged', 'marks'])
    }
  })

  it('a dry run with no identity rows answers zeros and reads nothing more', async () => {
    h.owners = []
    expect(await reconcileIdentities({ now: NOW, dryRun: true })).toEqual({
      checked: 0, recomputed: 0, changed: 0, failed: 0, illegal: 0, trustMoved: 0, purged: 0, marks: { ...NO_MARKS, shown: 0 },
      dryRun: true, mismatched: 0, teachers: 0, profiles: [],
    })
    expect(h.calls.map((c) => c.m)).toEqual(['identityVerification.findMany', 'teacherProfile.findMany(marks)', 'countOrphanIdentityMarks'])
  })
})

describe('reconcileIdentities — the card-tick pass (C4)', () => {
  it('selects every teacher whose switch is ON or whose card cache carries a value — reading the switch, the name and the cache', async () => {
    await reconcileIdentities({ now: NOW })
    const sel = h.calls.find((c) => c.m === 'teacherProfile.findMany(marks)')!.args
    expect(sel.where).toEqual({ OR: [
      { identityMarkOn: true },
      { listing: { is: { identityMarkNotice: { not: null } } } },
      { identityMarkWithdrawnAt: { gte: new Date(NOW.getTime() - 7 * 86_400_000) } },
    ] })
    expect(sel.select).toEqual({ profileId: true, fullName: true, identityMarkOn: true, identityMarkNoticeVersion: true, identityMarkWithdrawnAt: true, listing: { select: { identityMarkNotice: true, status: true } } })
  })

  it('⛔ skips the profiles the loop handled CLEANLY; a recompute that threw, or whose effects failed or never ran, gets its own sync', async () => {
    h.owners = ['clean', 'threw', 'failed', 'noeffects'].map((profileId) => ({ profileId }))
    h.results.set('threw', new Error('db hiccup'))
    h.results.set('failed', { status: 'verified', sourceId: 'x', changed: false, effects: effects({ failed: true }) })
    h.results.set('noeffects', { status: 'verified', sourceId: 'y', changed: false })
    h.marked = ['clean', 'threw', 'failed', 'noeffects', 'no-identity'].map((id) => marked(id))
    const r = await reconcileIdentities({ now: NOW })
    expect(synced()).toEqual(['threw', 'failed', 'noeffects', 'no-identity'])
    expect(h.calls.filter((c) => c.m === 'syncIdentityMarkCard').every((c) => c.args[1] === NOW)).toBe(true)
    expect(r.marks).toEqual({ checked: 4, changed: 0, purged: 0, failed: 0 })
    expect(r.failed).toBe(3) // the loop's three — the pass itself failed nothing
  })

  it('changed → purged with the sync\'s own listing and districts; unchanged with the switch OFF → no purge', async () => {
    h.marked = [marked('a'), marked('b')]
    h.syncs.set('a', sync({ listingId: 'L-a', districts: ['d7', null], changed: true, shown: false, reason: 'off', on: false }))
    h.syncs.set('b', sync({ listingId: 'L-b', changed: false, shown: false, reason: 'off', on: false }))
    const r = await reconcileIdentities({ now: NOW })
    expect(purgedPages()).toEqual([['L-a', ['d7', null]]])
    expect(r.marks).toEqual({ checked: 2, changed: 1, purged: 1, failed: 0 })
    expect(r.failed).toBe(0)
  })

  // Commit gate, 2026-10-16: a purge that threw after its sync committed was never retried — the next night found the
  // cache right and purged nothing, so a 30-day ISR page kept a claim the cache had dropped.
  it('⚖️ the switch ON → purged every night, even in sync — a purge that failed the night before is retried', async () => {
    h.marked = [marked('on')]
    h.syncs.set('on', sync({ listingId: 'L-on', changed: false, shown: true, reason: null, on: true }))
    const r = await reconcileIdentities({ now: NOW })
    expect(purgedPages()).toEqual([['L-on', ['d7']]])
    expect(r.marks).toEqual({ checked: 1, changed: 0, purged: 1, failed: 0 })
  })

  it('⛔ revoked while the switch is still ON → purged even with the cache unchanged; revoked with it OFF → not', async () => {
    h.marked = [marked('on'), marked('off')]
    h.syncs.set('on', sync({ listingId: 'L-on', changed: false, reason: 'revoked', on: true }))
    h.syncs.set('off', sync({ listingId: 'L-off', changed: false, reason: 'revoked', on: false }))
    const r = await reconcileIdentities({ now: NOW })
    expect(purgedPages()).toEqual([['L-on', ['d7']]])
    expect(r.marks).toMatchObject({ checked: 2, changed: 0, purged: 1 })
  })

  it('a sync that finds no listing (or no profile any more) is checked, and nothing more', async () => {
    h.marked = [marked('a')]
    h.syncs.set('a', null)
    const r = await reconcileIdentities({ now: NOW })
    expect(r.marks).toEqual({ checked: 1, changed: 0, purged: 0, failed: 0 })
    expect(purgedPages()).toEqual([])
  })

  it('a sync that THROWS is counted — in marks AND in the run\'s `failed` (a 500) — logged, and the pass goes on', async () => {
    h.marked = [marked('a'), marked('b')]
    h.syncs.set('a', new Error('lock timeout'))
    h.syncs.set('b', sync({ listingId: 'L-b', changed: true }))
    const r = await reconcileIdentities({ now: NOW })
    expect(synced()).toEqual(['a', 'b'])
    expect(r.marks).toEqual({ checked: 2, changed: 1, purged: 1, failed: 1 })
    expect(r.failed).toBe(1)
    expect(h.calls.find((c) => c.m === 'logError')!.args[1]).toEqual({ op: 'identity.reconcile.mark', profileId: 'a' })
  })

  it('a selection that cannot be read is one failure — the loop\'s counts still come back, never a throw', async () => {
    h.owners = [{ profileId: 'a' }]
    h.markedThrows = true
    const r = await reconcileIdentities({ now: NOW })
    expect(r).toMatchObject({ checked: 1, recomputed: 1, failed: 1, marks: { checked: 0, failed: 1 } })
    expect(h.calls.find((c) => c.m === 'logError')!.args[1]).toEqual({ op: 'identity.reconcile.mark' })
  })

  it('syncs ONE AT A TIME', async () => {
    h.marked = ['a', 'b', 'c'].map((id) => marked(id))
    await reconcileIdentities({ now: NOW })
    expect(synced()).toEqual(['a', 'b', 'c'])
    expect(h.syncMaxInFlight).toBe(1)
  })

  describe('⛔ its dry run judges and compares — ZERO syncs, ZERO purges, ZERO writes', () => {
    it('every selected teacher judged with the stored switch and name; changed / purged / shown counted against the stored cache', async () => {
      h.owners = [{ profileId: 'clean' }] // a dry run skips nobody: no loop ran
      h.marked = [
        marked('clean', { listing: { identityMarkNotice: null } }), // would show, cache empty → would change
        marked('stale', { listing: { identityMarkNotice: '2026-01-01' } }), // a notice bump left the old version → would clear
        marked('insync', { listing: { identityMarkNotice: IDENTITY_MARK_NOTICE_VERSION } }), // in sync — but the switch is on → purged nightly
        marked('revoked', { listing: { identityMarkNotice: null } }), // revoked, switch on → would purge though in sync
        marked('nolisting', { listing: null }), // no card at all
      ]
      h.states.set('clean', { shown: true, reason: null })
      h.states.set('insync', { shown: true, reason: null })
      h.states.set('revoked', { shown: false, reason: 'revoked' })
      h.states.set('nolisting', { shown: true, reason: null })
      const r = await reconcileIdentities({ now: NOW, dryRun: true })
      expect(r.marks).toEqual({ checked: 5, changed: 2, purged: 4, failed: 0, shown: 2 })
      const judged = h.calls.filter((c) => c.m === 'identityMarkState').map((c) => c.args)
      expect(judged.map(([m]) => m.profileId)).toEqual(['clean', 'stale', 'insync', 'revoked', 'nolisting'])
      expect(judged[0]).toEqual([{ profileId: 'clean', fullName: 'Anna Eriksson', identityMarkOn: true, identityMarkNoticeVersion: IDENTITY_MARK_NOTICE_VERSION }, NOW])
      expect([synced(), purgedPages(), writes(), recomputed()]).toEqual([[], [], [], []])
    })
    it('a judgement that cannot be read is a failure (in `failed` too) — and still nothing is written', async () => {
      h.marked = [marked('a'), marked('b')]
      h.states.set('a', new Error('identity read down'))
      const r = await reconcileIdentities({ now: NOW, dryRun: true })
      expect(r.marks).toMatchObject({ checked: 2, failed: 1 })
      expect(r.failed).toBe(1)
      expect([synced(), purgedPages(), writes()]).toEqual([[], [], []])
    })
  })
})

// ── reconcileIdentityMarks — THE SAME PASS ALONE, AT 00:05 ICT (review, 2026-10-16) ──────────────────────────────────────
// A document lapses at 00:00 ICT and the mark with it, but the reconcile runs at 09:05: this run (/api/cron/identity-marks)
// re-derives every selected teacher's card cache five minutes after midnight. Pinned: the same selection; EVERY selected
// teacher synced (no loop ran, nobody skipped), one at a time, with the run's clock; purged when the cache changed or a
// revoked teacher's switch is on; and NOTHING ELSE — no identity-owner read, no recompute (trust and enforcement, which can
// notify, stay at 09:05). Its dry run judges and writes nothing.
describe('reconcileIdentityMarks — the card-tick pass ALONE, at 00:05 ICT', () => {
  const MIDNIGHT = new Date('2026-10-17T00:05:00+07:00')

  it('⛔ syncs EVERY selected teacher, one at a time, with its clock — and does nothing else: no owner read, no recompute', async () => {
    h.owners = [{ profileId: 'a' }] // the full reconcile would recompute 'a' — this run never does
    h.marked = ['a', 'b', 'c'].map((id) => marked(id))
    const r = await reconcileIdentityMarks({ now: MIDNIGHT })
    expect(h.calls.map((c) => c.m)).toEqual(['teacherProfile.findMany(marks)', 'syncIdentityMarkCard', 'syncIdentityMarkCard', 'syncIdentityMarkCard', 'clearOrphanIdentityMarks'])
    expect(h.calls.filter((c) => c.m === 'syncIdentityMarkCard').map((c) => c.args)).toEqual([['a', MIDNIGHT], ['b', MIDNIGHT], ['c', MIDNIGHT]])
    expect(h.syncMaxInFlight).toBe(1)
    expect(recomputed()).toEqual([])
    expect(r).toEqual({ checked: 3, changed: 0, purged: 0, failed: 0 })
  })

  it('the same selection as the reconcile\'s pass: the switch on, or a card cache carrying a value', async () => {
    await reconcileIdentityMarks({ now: MIDNIGHT })
    const sel = h.calls.find((c) => c.m === 'teacherProfile.findMany(marks)')!.args
    expect(sel.where).toEqual({ OR: [
      { identityMarkOn: true },
      { listing: { is: { identityMarkNotice: { not: null } } } },
      { identityMarkWithdrawnAt: { gte: new Date(MIDNIGHT.getTime() - 7 * 86_400_000) } },
    ] })
  })

  // Commit gate, 2026-10-16: a withdrawal's own purge that failed left its teacher outside every later selection (the
  // switch off, the cache clear) — recent withdrawals now stay selected for 7 nights and are purged each.
  it('⚖️ a withdrawal in the last 7 days is purged again each night — a failed purge of the save is retried', async () => {
    h.marked = [marked('w', { identityMarkOn: false, identityMarkWithdrawnAt: new Date(MIDNIGHT.getTime() - 86_400_000) })]
    h.syncs.set('w', sync({ listingId: 'L-w', changed: false, shown: false, reason: 'off', on: false }))
    const r = await reconcileIdentityMarks({ now: MIDNIGHT })
    expect(purgedPages()).toEqual([['L-w', ['d7']]])
    expect(r).toMatchObject({ checked: 1, changed: 0, purged: 1, failed: 0 })
  })

  // Commit gate, 2026-10-16: a teacher listing hidden by deleteListingCore (an open report) keeps no TeacherProfile, so
  // no pass from TeacherProfile reached its cache — the orphan clear nulls it and purges its pages.
  it('⚖️ orphaned caches (no TeacherProfile behind the listing) are cleared and their pages purged; a failure is counted', async () => {
    h.orphans = ['L-orphan']
    const r = await reconcileIdentityMarks({ now: MIDNIGHT })
    expect(purgedPages()).toEqual([['L-orphan', []]])
    expect(r).toMatchObject({ changed: 1, purged: 1, failed: 0 })
    h.calls = []
    h.orphansThrow = true
    expect(await reconcileIdentityMarks({ now: MIDNIGHT })).toMatchObject({ failed: 1 })
  })

  it('⛔ a lapse at midnight: the cache it clears is purged at once; unchanged and off → no purge; revoked with the switch on → purged, off → not', async () => {
    h.marked = ['lapsed', 'insync', 'revoked-on', 'revoked-off'].map((id) => marked(id))
    h.syncs.set('lapsed', sync({ listingId: 'L-lapsed', districts: ['d7', null], changed: true, shown: false, reason: 'expired' }))
    h.syncs.set('insync', sync({ listingId: 'L-insync', changed: false, shown: false, reason: 'off', on: false }))
    h.syncs.set('revoked-on', sync({ listingId: 'L-ron', changed: false, reason: 'revoked', on: true }))
    h.syncs.set('revoked-off', sync({ listingId: 'L-roff', changed: false, reason: 'revoked', on: false }))
    const r = await reconcileIdentityMarks({ now: MIDNIGHT })
    expect(purgedPages()).toEqual([['L-lapsed', ['d7', null]], ['L-ron', ['d7']]])
    expect(r).toEqual({ checked: 4, changed: 1, purged: 2, failed: 0 })
  })

  it('a sync that throws is counted in `failed` (a 500), logged, and the pass goes on; an unreadable selection is one failure', async () => {
    h.marked = [marked('a'), marked('b')]
    h.syncs.set('a', new Error('lock timeout'))
    h.syncs.set('b', sync({ listingId: 'L-b', changed: true }))
    expect(await reconcileIdentityMarks({ now: MIDNIGHT })).toEqual({ checked: 2, changed: 1, purged: 1, failed: 1 })
    expect(h.calls.find((c) => c.m === 'logError')!.args[1]).toEqual({ op: 'identity.reconcile.mark', profileId: 'a' })
    h.calls = []
    h.markedThrows = true
    expect(await reconcileIdentityMarks({ now: MIDNIGHT })).toEqual({ checked: 0, changed: 0, purged: 0, failed: 1 })
  })

  it('⛔ its dry run judges every selected teacher against the stored cache — ZERO syncs, ZERO purges, ZERO writes', async () => {
    h.marked = [
      marked('lapsed', { listing: { identityMarkNotice: IDENTITY_MARK_NOTICE_VERSION } }), // cached, no longer shown → would clear
      marked('insync', { listing: { identityMarkNotice: IDENTITY_MARK_NOTICE_VERSION } }),
    ]
    h.states.set('lapsed', { shown: false, reason: 'expired' })
    h.states.set('insync', { shown: true, reason: null })
    const r = await reconcileIdentityMarks({ now: MIDNIGHT, dryRun: true })
    expect(r).toEqual({ checked: 2, changed: 1, purged: 2, failed: 0, shown: 1, dryRun: true }) // in sync, switch on → purged too
    expect(h.calls.filter((c) => c.m === 'identityMarkState').map((c) => c.args[1])).toEqual([MIDNIGHT, MIDNIGHT])
    expect([synced(), purgedPages(), writes(), recomputed()]).toEqual([[], [], [], []])
  })
})
