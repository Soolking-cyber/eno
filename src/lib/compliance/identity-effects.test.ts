import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── applyIdentityEffects — what an identity recompute moves beside the cache (owner, 2026-10-15) ────────────────────
//
// Pinned: the ORDER (trust → enforcement on that breakdown and the PERSISTED score, re-synced even when the score did
// not move → the teacher read → the card's "Identity verified" sync (C4) → the purge, LAST); that the trust recompute
// takes NO flag (R1: the identity's step is never capped and nothing else is uncapped — an "approved" option would land a
// whole backlog); that every step is fail-quiet on its own (a throw is logged, marks `failed`, and the next step still
// runs); that `markChanged` is the sync's own `changed`; and that the purge is unconditional for a teacher account —
// whatever the derived status or the sync's outcome — and absent, with the sync, for everyone else. Trust, enforcement,
// the db, the card sync and the purge are faked; districtPagesOf is the real one.

type Row = Record<string, any>
const h = vi.hoisted(() => ({
  calls: [] as Array<{ m: string; args: any[] }>,
  trust: null as Row | null,
  trustThrows: false,
  syncThrows: false,
  teacher: null as Row | null,
  teacherThrows: false,
  purgeThrows: false,
  logThrows: false,
  /** What syncIdentityMarkCard answers (null: no profile or no listing — nothing to write). */
  mark: null as Row | null,
  markThrows: false,
}))
const rec = (m: string, ...args: any[]) => { h.calls.push({ m, args }) }

vi.mock('@/lib/trust', () => ({
  recomputeTrust: async (...a: any[]) => { rec('recomputeTrust', ...a); if (h.trustThrows) throw new Error('trust down'); return h.trust },
}))
vi.mock('@/lib/enforcement', () => ({
  syncEnforcement: async (...a: any[]) => { rec('syncEnforcement', ...a); if (h.syncThrows) throw new Error('sync down') },
}))
vi.mock('@/lib/db', () => ({
  db: {
    teacherProfile: {
      findUnique: async (a: Row) => { rec('teacherProfile.findUnique', a); if (h.teacherThrows) throw new Error('read down'); return h.teacher },
    },
  },
}))
vi.mock('@/lib/teachers/identity-mark-card', () => ({
  syncIdentityMarkCard: async (...a: any[]) => { rec('syncIdentityMarkCard', ...a); if (h.markThrows) throw new Error('mark down'); return h.mark },
}))
vi.mock('@/lib/teachers/revalidate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/teachers/revalidate')>()),
  revalidateTeacherPages: (...a: any[]) => { rec('revalidateTeacherPages', ...a); if (h.purgeThrows) throw new Error('purge down') },
}))
vi.mock('@/lib/log', () => ({
  logError: (...a: any[]) => { rec('logError', ...a); if (h.logThrows) throw new Error('logger down') },
  logWarn: () => {},
  logInfo: () => {},
}))

const { applyIdentityEffects } = await import('./identity-effects')
const { districtPagesOf } = await vi.importActual<typeof import('@/lib/teachers/revalidate')>('@/lib/teachers/revalidate')

const NOW = new Date('2026-10-15T09:05:00+07:00')
// ⚠️ THE COMPOSITE AND THE PERSISTED SCORE DIFFER ON PURPOSE — as they do whenever the cap holds a backlog back (R1:
// 80 cached, a +30 backlog beside a live identity → composite 120, persisted 80 + 6 + 10 = 96). Enforcement must judge
// the PERSISTED one (syncEnforcement: `persistedScore ?? breakdown.score`); were the two equal here, handing it the
// composite would pass unseen — and in production lift a throttle or a restriction on points the seller does not have.
const BREAKDOWN = { score: 120, cached: { score: 80, tier: 'standard', identityCounted: false } }
const TEACHER = { listingId: 'lst-1', currentDistrictKey: 'd7', currentDistrict: 'Quận 7' }
const names = () => h.calls.map((c) => c.m)
const callsOf = (m: string) => h.calls.filter((c) => c.m === m)

beforeEach(() => {
  h.calls = []
  h.trust = { score: 96, tier: 'standard', breakdown: BREAKDOWN }
  h.trustThrows = false
  h.syncThrows = false
  h.teacher = null
  h.teacherThrows = false
  h.purgeThrows = false
  h.logThrows = false
  h.mark = { listingId: 'lst-1', districts: ['d7'], changed: false, shown: false, reason: 'unverified', hidden: false }
  h.markThrows = false
})

describe('applyIdentityEffects', () => {
  it('a teacher: trust → enforcement on THAT breakdown → the teacher read → the card sync → the purge, LAST', async () => {
    h.teacher = TEACHER
    const out = await applyIdentityEffects('p1', 'verified', NOW)
    expect(names()).toEqual(['recomputeTrust', 'syncEnforcement', 'teacherProfile.findUnique', 'syncIdentityMarkCard', 'revalidateTeacherPages'])
    expect(out).toEqual({ trustMoved: true, markChanged: false, purged: true, failed: false })
    // The PERSISTED (capped) 96, never the composite's 120.
    expect(callsOf('syncEnforcement')[0].args).toEqual(['p1', BREAKDOWN, { persistedScore: 96 }])
    expect(callsOf('teacherProfile.findUnique')[0].args[0]).toEqual({ where: { profileId: 'p1' }, select: { listingId: true, currentDistrictKey: true, currentDistrict: true } })
    // The purge gets the listing and every district page the stored row shows on (the real districtPagesOf).
    expect(callsOf('revalidateTeacherPages')[0].args).toEqual(['lst-1', districtPagesOf(TEACHER)])
  })

  it('⛔ the trust recompute takes NO flag — no "approved", no uncapped (R1: the identity step is exempt inside recomputeTrust)', async () => {
    for (const status of ['verified', 'pending', 'rejected', 'expired', 'revoked'] as const) {
      h.calls = []
      await applyIdentityEffects('p1', status, NOW)
      expect(callsOf('recomputeTrust')[0].args, status).toEqual(['p1'])
    }
  })

  // ⛔ ENFORCEMENT RE-SYNCS ON AN UNCHANGED SCORE TOO — the nightly reconcile is its only retry. syncEnforcement is
  // fail-quiet itself (enforcement.ts: it catches and logs its own errors), so an enforcement update that a decision's own
  // recompute missed never marks this result `failed`; the next run, finding the score already moved, must still re-sync.
  // Gating the step on `trustMoved` would leave that state wrong for good.
  it('trustMoved: true only when the persisted score differs from the cached one — and enforcement re-syncs either way', async () => {
    h.trust = { score: 80, tier: 'standard', breakdown: BREAKDOWN }
    expect((await applyIdentityEffects('p1', 'verified', NOW)).trustMoved).toBe(false)
    expect(callsOf('syncEnforcement')).toHaveLength(1)
    expect(callsOf('syncEnforcement')[0].args).toEqual(['p1', BREAKDOWN, { persistedScore: 80 }])
  })

  it('a non-teacher is never purged; enforcement still runs once', async () => {
    const out = await applyIdentityEffects('p1', 'verified', NOW)
    expect(names()).toEqual(['recomputeTrust', 'syncEnforcement', 'teacherProfile.findUnique'])
    expect(out).toEqual({ trustMoved: true, markChanged: false, purged: false, failed: false })
  })

  it('no trust result (the profile is gone): enforcement is skipped — nothing to derive from — and a teacher is still purged', async () => {
    h.trust = null
    h.teacher = TEACHER
    const out = await applyIdentityEffects('p1', 'revoked', NOW)
    expect(names()).toEqual(['recomputeTrust', 'teacherProfile.findUnique', 'syncIdentityMarkCard', 'revalidateTeacherPages'])
    expect(out).toMatchObject({ trustMoved: false, purged: true, failed: false })
  })

  it.each(['pending', 'rejected', 'expired', 'revoked', 'unverified'] as const)('the purge is unconditional for a teacher: derived %s purges too', async (status) => {
    h.teacher = TEACHER
    const out = await applyIdentityEffects('p1', status, NOW)
    expect(callsOf('revalidateTeacherPages')).toHaveLength(1)
    expect(out.purged).toBe(true)
  })

  it('a teacher row with no listing still purges /c/teachers, its districts and the home page (listing id null)', async () => {
    h.teacher = { ...TEACHER, listingId: null }
    await applyIdentityEffects('p1', 'verified', NOW)
    expect(callsOf('revalidateTeacherPages')[0].args[0]).toBeNull()
  })

  describe('C4 — the card\'s "Identity verified" tick', () => {
    it('a teacher: synced with the run\'s clock, AFTER trust and enforcement and BEFORE the purge', async () => {
      h.teacher = TEACHER
      await applyIdentityEffects('p1', 'revoked', NOW)
      expect(callsOf('syncIdentityMarkCard')[0].args).toEqual(['p1', NOW])
      const n = names()
      expect(n.indexOf('syncEnforcement')).toBeLessThan(n.indexOf('syncIdentityMarkCard'))
      expect(n.indexOf('syncIdentityMarkCard')).toBeLessThan(n.indexOf('revalidateTeacherPages'))
    })
    it('`markChanged` is the sync\'s own `changed` — and the purge runs either way (no "nothing changed" skip)', async () => {
      h.teacher = TEACHER
      h.mark = { ...h.mark, changed: true, shown: false, reason: 'revoked', hidden: false }
      expect(await applyIdentityEffects('p1', 'revoked', NOW)).toEqual({ trustMoved: true, markChanged: true, purged: true, failed: false })
      h.calls = []
      h.mark = { ...h.mark, changed: false }
      expect(await applyIdentityEffects('p1', 'revoked', NOW)).toEqual({ trustMoved: true, markChanged: false, purged: true, failed: false })
      expect(callsOf('revalidateTeacherPages')).toHaveLength(1)
    })
    // AUTOMATIC since 2026-10-16: an approval's own recompute WRITES the tick (the sync re-derives it — no switch to wait
    // for), and the purge that follows publishes it.
    it('⛔ an approval turns the tick ON by itself — the sync\'s change, then the purge that publishes it', async () => {
      h.teacher = TEACHER
      h.mark = { ...h.mark, changed: true, shown: true, reason: null, hidden: false }
      expect(await applyIdentityEffects('p1', 'verified', NOW)).toEqual({ trustMoved: true, markChanged: true, purged: true, failed: false })
      const n = names()
      expect(n.indexOf('syncIdentityMarkCard')).toBeLessThan(n.indexOf('revalidateTeacherPages'))
    })
    it('a sync that finds nothing to write (no listing) is no change, and still purges', async () => {
      h.teacher = { ...TEACHER, listingId: null }
      h.mark = null
      expect(await applyIdentityEffects('p1', 'verified', NOW)).toMatchObject({ markChanged: false, purged: true, failed: false })
    })
    it('⚠️ a SYNC throw: logged as identity.effects.mark, failed — and the teacher is STILL purged', async () => {
      h.teacher = TEACHER
      h.markThrows = true
      const out = await applyIdentityEffects('p1', 'verified', NOW)
      expect(out).toEqual({ trustMoved: true, markChanged: false, purged: true, failed: true })
      expect(callsOf('logError')[0].args[1]).toMatchObject({ op: 'identity.effects.mark', profileId: 'p1' })
      expect(callsOf('revalidateTeacherPages')).toHaveLength(1)
    })
    it('a non-teacher is never synced', async () => {
      await applyIdentityEffects('p1', 'verified', NOW)
      expect(callsOf('syncIdentityMarkCard')).toHaveLength(0)
    })
  })

  describe('⚠️ fail-quiet, step by step', () => {
    it('a TRUST throw: logged, failed — enforcement skipped (no breakdown), the teacher still purged', async () => {
      h.trustThrows = true
      h.teacher = TEACHER
      const out = await applyIdentityEffects('p1', 'verified', NOW)
      expect(names()).toEqual(['recomputeTrust', 'logError', 'teacherProfile.findUnique', 'syncIdentityMarkCard', 'revalidateTeacherPages'])
      expect(out).toEqual({ trustMoved: false, markChanged: false, purged: true, failed: true })
      expect(callsOf('logError')[0].args[1]).toMatchObject({ op: 'identity.effects.trust', profileId: 'p1', derived: 'verified' })
    })

    it('an ENFORCEMENT throw: logged, failed — the teacher still purged', async () => {
      h.syncThrows = true
      h.teacher = TEACHER
      const out = await applyIdentityEffects('p1', 'verified', NOW)
      expect(out).toMatchObject({ trustMoved: true, purged: true, failed: true })
      expect(callsOf('logError')[0].args[1]).toMatchObject({ op: 'identity.effects.enforcement' })
    })

    it('a TEACHER-READ throw: logged, failed — and NO purge (it cannot know the listing or the districts), nor a sync', async () => {
      h.teacherThrows = true
      const out = await applyIdentityEffects('p1', 'verified', NOW)
      expect(callsOf('revalidateTeacherPages')).toHaveLength(0)
      expect(callsOf('syncIdentityMarkCard')).toHaveLength(0)
      expect(out).toMatchObject({ purged: false, failed: true })
      expect(callsOf('logError')[0].args[1]).toMatchObject({ op: 'identity.effects.teacher' })
    })

    it('a PURGE throw: logged, failed, purged stays false — and the call still resolves', async () => {
      h.teacher = TEACHER
      h.purgeThrows = true
      await expect(applyIdentityEffects('p1', 'verified', NOW)).resolves.toEqual({ trustMoved: true, markChanged: false, purged: false, failed: true })
      expect(callsOf('logError')[0].args[1]).toMatchObject({ op: 'identity.effects.purge' })
    })

    it('even a logger that throws cannot make it throw', async () => {
      h.trustThrows = true
      h.logThrows = true
      h.teacher = TEACHER
      await expect(applyIdentityEffects('p1', 'verified', NOW)).resolves.toMatchObject({ failed: true, purged: true })
    })
  })
})
