import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Human-protected enforcement survives the system (review of audit #20, 2026-09-23) ─────────────
//
// The pure rules are in enforcement-machine.test.ts (planSystemMove). This drives the DB wiring
// against a small stateful fake of EnforcementAction + Profile, because the three defects were all
// in HOW rows moved, not in the rule:
//   1. a system escalation LIFTED an admin's action, so the later downgrade had nothing to stop at;
//   2. syncEnforcement applied a decision made on a stale snapshot (a ban-evasion hold landing in
//      between was lifted with no human involved);
//   3. an upheld appeal on an action the system can never lift promised "it lifts automatically".

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  profile: { enforcementState: 'good_standing', goodStandingSince: null as Date | null, locale: 'en' } as Row,
  actions: [] as Row[],
  seq: 0,
  profileReads: 0,
  /** Runs on the Nth profile.findUnique — a write landing between two reads. */
  onProfileRead: null as null | ((n: number) => void),
  /** What the in-transaction row lock reads; defaults to the live state. */
  lockedState: null as string | null,
  notices: [] as Row[],
  pending: [] as Promise<unknown>[],
}))

function match(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return (v.in as unknown[]).includes(row[k])
      if ('notIn' in v) return !(v.notIn as unknown[]).includes(row[k])
      if ('gt' in v) return row[k] != null && row[k] > v.gt
      if ('lte' in v) return row[k] != null && row[k] <= v.lte
    }
    return row[k] === v
  })
}
const newest = (rows: Row[]) => [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

vi.mock('./db', () => {
  const db: Row = {
    profile: {
      findUnique: async () => {
        h.profileReads++
        h.onProfileRead?.(h.profileReads)
        return { ...h.profile }
      },
      update: async (a: Row) => { Object.assign(h.profile, a.data); return {} },
      updateMany: async (a: Row) => { Object.assign(h.profile, a.data); return { count: 1 } },
    },
    enforcementAction: {
      findFirst: async (a: Row) => newest(h.actions.filter((r) => match(r, a.where)))[0] ?? null,
      findMany: async (a: Row) => (a.orderBy ? newest(h.actions.filter((r) => match(r, a.where))) : h.actions.filter((r) => match(r, a.where))),
      findUnique: async (a: Row) => h.actions.find((r) => r.id === a.where.id) ?? null,
      update: async (a: Row) => { Object.assign(h.actions.find((r) => r.id === a.where.id)!, a.data); return {} },
      updateMany: async (a: Row) => {
        const hit = h.actions.filter((r) => match(r, a.where))
        for (const r of hit) Object.assign(r, a.data)
        return { count: hit.length }
      },
      create: async (a: Row) => {
        const row = { id: `a${++h.seq}`, adminNote: null, expiresAt: null, pulledListingIds: null, appealedAt: null, appealOutcome: null, createdAt: new Date(Date.now() + h.seq), ...a.data }
        h.actions.push(row)
        return { id: row.id }
      },
    },
    listing: { findMany: async () => [], updateMany: async () => ({ count: 0 }), updateManyAndReturn: async () => [] },
    seller: { findMany: async () => [] },
    bannedIdentity: { deleteMany: async () => ({ count: 0 }), create: async () => ({}) },
    notification: { create: async (a: Row) => { h.notices.push(a.data); return {} } },
    $queryRaw: async () => [{ enforcementState: h.lockedState ?? h.profile.enforcementState }],
  }
  db.$transaction = async (fn: (tx: Row) => unknown) => fn(db)
  return { db }
})
vi.mock('./compliance/seller-publish-gate', () => ({
  partitionByIdentityGate: async (ids: string[]) => ({ allowed: ids, held: [] }),
  settleHolds: async () => 0,
}))
vi.mock('./push', () => ({ sendPushToProfile: async () => 0 }))
vi.mock('next/server', () => ({ after: (fn: () => Promise<unknown>) => { h.pending.push(fn()) } }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: () => {} }))

const { syncEnforcement, applyEnforcement, upholdAppeal } = await import('./enforcement')

const breakdown = (o: { scam?: boolean; score?: number; C?: number }) => ({
  score: o.score ?? 80,
  C: o.C ?? 0,
  inputs: { hasScamHold: !!o.scam, reports90: { count: 0, distinctReporters: 0, scams: 0 }, transactions365: 0 },
}) as never

const seed = (state: string, row: Row) => {
  h.profile.enforcementState = state
  h.actions.push({ id: `a${++h.seq}`, profileId: 'p1', state, status: 'active', expiresAt: null, pulledListingIds: null, adminNote: null, appealedAt: null, appealOutcome: null, createdAt: new Date(Date.now() - 60_000), ...row })
  return h.actions[h.actions.length - 1]
}
const active = () => h.actions.filter((a) => a.status === 'active')

beforeEach(() => {
  h.profile = { enforcementState: 'good_standing', goodStandingSince: null, locale: 'en' }
  h.actions = []
  h.seq = 0
  h.profileReads = 0
  h.onProfileRead = null
  h.lockedState = null
  h.notices = []
  h.pending = []
})

describe('a system escalation cannot be used to erase a human action', () => {
  it('admin throttle → scam hold → clean derive: back to the ADMIN throttle, never good_standing', async () => {
    const admin = seed('throttled', { reason: 'admin_manual', decidedBy: 'mod@eno.vn', adminNote: 'fix your photos' })

    await syncEnforcement('p1', breakdown({ scam: true }))
    expect(h.profile.enforcementState).toBe('held')
    expect(admin.status).toBe('superseded') // set aside, NOT lifted

    await syncEnforcement('p1', breakdown({}))
    expect(h.profile.enforcementState).toBe('throttled')
    const [now] = active()
    // The human action itself is back in force — human-protected, with its note.
    expect(now).toMatchObject({ state: 'throttled', reason: 'admin_manual', decidedBy: 'mod@eno.vn', adminNote: 'fix your photos' })
    expect(admin.status).toBe('lifted') // the floor row is retired once re-instated

    // …and tomorrow's clean derive leaves it alone.
    await syncEnforcement('p1', breakdown({}))
    expect(h.profile.enforcementState).toBe('throttled')
  })

  it('an escalation over a SYSTEM action still just lifts it (no floor for what the system may end)', async () => {
    const sys = seed('warned', { reason: 'conduct_warning', decidedBy: 'system' })
    await syncEnforcement('p1', breakdown({ scam: true }))
    expect(sys.status).toBe('lifted')
    await syncEnforcement('p1', breakdown({}))
    expect(h.profile.enforcementState).toBe('good_standing')
  })
})

describe('a system decision is only valid for the snapshot it was made on', () => {
  it('a ban-evasion hold landing between the sync\'s read and its write is NOT lifted', async () => {
    const warning = seed('warned', { reason: 'conduct_warning', decidedBy: 'system' })
    // The sync reads 'warned' first; a login's checkBanEvasion commits a hold before the write.
    h.onProfileRead = (n) => {
      if (n !== 2) return
      warning.status = 'lifted'
      h.actions.push({ id: 'ban', profileId: 'p1', state: 'held', reason: 'ban_evasion_review', decidedBy: 'system', status: 'active', expiresAt: null, pulledListingIds: null, adminNote: null, createdAt: new Date() })
      h.profile.enforcementState = 'held'
    }
    await syncEnforcement('p1', breakdown({}))
    expect(h.profile.enforcementState).toBe('held')
    expect(h.actions.find((a) => a.id === 'ban')!.status).toBe('active')
  })

  it('state moved under the row lock: a system transition is skipped, an admin one fails loudly', async () => {
    seed('warned', { reason: 'conduct_warning', decidedBy: 'system' })
    h.lockedState = 'held'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await applyEnforcement('p1', { state: 'good_standing', reason: 'good_standing', expiresAt: null }, { decidedBy: 'system' })).toBe(false)
    expect(active()).toHaveLength(1) // nothing superseded
    await expect(applyEnforcement('p1', { state: 'suspended', reason: 'admin_manual', expiresAt: null }, { decidedBy: 'mod@eno.vn' })).rejects.toThrow(/changed concurrently/)
    expect(h.profile.enforcementState).toBe('warned')
    warn.mockRestore()
    err.mockRestore()
  })
})

describe('upholdAppeal tells the truth about who lifts it', () => {
  const upheld = async (row: Row) => {
    const a = seed(row.state, { ...row, appealedAt: new Date() })
    expect(await upholdAppeal(a.id)).toBe(true)
    await Promise.all(h.pending)
    return h.notices[0].body as string
  }

  it('a human-protected action (ban-evasion review, admin action) never promises an automatic lift', async () => {
    expect(await upheld({ state: 'held', reason: 'ban_evasion_review', decidedBy: 'system' })).not.toMatch(/automatically/)
    h.notices = []
    expect(await upheld({ state: 'throttled', reason: 'admin_manual', decidedBy: 'mod@eno.vn' })).toMatch(/review your account again/)
  })

  it('a system-derived action keeps the "lifts automatically" copy', async () => {
    expect(await upheld({ state: 'held', reason: 'scam_hold', decidedBy: 'system' })).toMatch(/lifts automatically/)
  })
})
