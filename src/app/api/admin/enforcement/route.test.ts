import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/admin/enforcement — THE SCAM-HOLD BRANCHES ON THE WIRE (2026-09-23).
 *
 * A scam hold is re-derived by the daily sync, so any console move that only touched the enforcement
 * row (lift, overturn, a hand-set state below held) was undone within a day. The rules themselves are
 * proved end to end in src/lib/scam-hold.test.ts; this file proves the ROUTE sends each console action
 * to the right place and refuses the ones that would be undone — with the codes the console maps.
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  admin: 'mod@eno.vn' as string | null,
  action: null as Row | null,
  scamHold: false,
  fx: [] as Array<{ m: string; args: unknown[] }>,
  scamResult: { ok: true, state: 'throttled', charges: 1 } as Row,
  charges: [] as Row[] | null,
}))

vi.mock('@/lib/admin', () => ({
  getAdmin: async () => h.admin,
  getCurrentProfile: async () => { throw new Error('auth: admin must not resolve a Profile') },
  getCurrentProfileId: async () => { throw new Error('auth: admin must not resolve a profile id') },
}))
vi.mock('@/lib/db', () => ({
  db: {
    enforcementAction: { findUnique: async () => h.action },
    profile: { findUnique: async (a: Row) => ({ id: a.where.id }) },
  },
}))
vi.mock('@/lib/enforcement', async () => {
  const machine = await vi.importActual<typeof import('@/lib/enforcement-machine')>('@/lib/enforcement-machine')
  return {
    ENFORCEMENT_REASON: machine.ENFORCEMENT_REASON,
    ENFORCEMENT_STATES: machine.ENFORCEMENT_STATES,
    FLAG_REASONS: machine.FLAG_REASONS,
    liftAction: async (...a: unknown[]) => { h.fx.push({ m: 'liftAction', args: a }); return true },
    applyEnforcement: async (...a: unknown[]) => { h.fx.push({ m: 'applyEnforcement', args: a }); return true },
    dismissFlag: async () => true,
    upholdAppeal: async () => true,
  }
})
vi.mock('@/lib/scam-hold', () => ({
  profileHasScamHold: async (pid: string) => { h.fx.push({ m: 'profileHasScamHold', args: [pid] }); return h.scamHold },
  releaseScamHold: async (...a: unknown[]) => { h.fx.push({ m: 'releaseScamHold', args: a }); return h.scamResult },
  overturnScamHold: async (...a: unknown[]) => { h.fx.push({ m: 'overturnScamHold', args: a }); return h.scamResult },
  scamChargesForAction: async (...a: unknown[]) => { h.fx.push({ m: 'scamChargesForAction', args: a }); return h.charges },
}))
vi.mock('@/lib/log', () => ({ logError: () => {}, logWarn: () => {}, logInfo: () => {} }))

import { GET, POST } from './route'

async function post(body: unknown) {
  const res = await POST(new Request('https://eno.vn/api/admin/enforcement', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  return { status: res.status, body: (await res.json()) as Row }
}
const effects = (m: string) => h.fx.filter((f) => f.m === m)

beforeEach(() => {
  h.admin = 'mod@eno.vn'
  h.action = { profileId: 'p1', reason: 'scam_hold', status: 'active' }
  h.scamHold = true
  h.fx = []
  h.scamResult = { ok: true, state: 'throttled', charges: 1 }
  h.charges = []
})

describe('lift', () => {
  it('⛔ refuses while the account derives a scam hold — the sync would re-hold it', async () => {
    expect(await post({ action: 'lift', id: 'a1' })).toEqual({ status: 409, body: { error: 'scam_hold_use_release' } })
    expect(effects('liftAction')).toHaveLength(0)
  })

  it('refuses a lift of an admin suspension sitting on top of a scam hold too', async () => {
    h.action = { profileId: 'p1', reason: 'admin_manual', status: 'active' }
    expect((await post({ action: 'lift', id: 'a1' })).status).toBe(409)
    expect(effects('liftAction')).toHaveLength(0)
  })

  it('lifts as before when no scam charge holds the account (a stale scam row included)', async () => {
    h.scamHold = false
    expect(await post({ action: 'lift', id: 'a1' })).toEqual({ status: 200, body: { ok: true } })
    expect(effects('liftAction')[0].args[1]).toMatchObject({ to: 'lifted', by: 'mod@eno.vn' })
  })
})

describe('overturn', () => {
  it('on a scam_hold row, goes to the ledger overturn — never a bare liftAction', async () => {
    expect(await post({ action: 'overturn', id: 'a1' })).toEqual({ status: 200, body: { ok: true, state: 'throttled', charges: 1 } })
    expect(effects('overturnScamHold')[0].args[0]).toMatchObject({ actionId: 'a1', admin: 'mod@eno.vn' })
    expect(effects('liftAction')).toHaveLength(0)
  })

  it('carries the overturn\'s refusal code and status through', async () => {
    h.scamResult = { ok: false, status: 409, error: 'legacy_charge' }
    expect(await post({ action: 'overturn', id: 'a1' })).toEqual({ status: 409, body: { error: 'legacy_charge' } })
  })

  it('on another row of a scam-held account, refuses with the pointer', async () => {
    h.action = { profileId: 'p1', reason: 'admin_manual', status: 'active' }
    expect((await post({ action: 'overturn', id: 'a1' })).body).toEqual({ error: 'scam_hold_use_release' })
    expect(effects('liftAction')).toHaveLength(0)
  })

  it('overturns an ordinary action exactly as before', async () => {
    h.action = { profileId: 'p1', reason: 'conduct_restricted', status: 'active' }
    h.scamHold = false
    expect(await post({ action: 'overturn', id: 'a1' })).toEqual({ status: 200, body: { ok: true } })
    expect(effects('liftAction')[0].args[1]).toMatchObject({ to: 'overturned' })
  })
})

describe('release_scam_hold / overturn_scam', () => {
  it('passes the plan and the admin to the release', async () => {
    const plan = 'Refunded the buyer and now ships with tracking only.'
    expect((await post({ action: 'release_scam_hold', id: 'a1', plan })).status).toBe(200)
    expect(effects('releaseScamHold')[0].args[0]).toMatchObject({ actionId: 'a1', admin: 'mod@eno.vn', plan })
  })

  it('answers a refusal with its own status and fields (the console words them)', async () => {
    h.scamResult = { ok: false, status: 409, error: 'release_too_soon', eligibleAt: '2026-10-07T00:00:00.000Z' }
    expect(await post({ action: 'release_scam_hold', id: 'a1', plan: 'x'.repeat(40) })).toEqual({ status: 409, body: { error: 'release_too_soon', eligibleAt: '2026-10-07T00:00:00.000Z' } })
    h.scamResult = { ok: false, status: 400, error: 'plan_required', min: 30 }
    expect(await post({ action: 'release_scam_hold', id: 'a1' })).toEqual({ status: 400, body: { error: 'plan_required', min: 30 } })
  })

  it('overturn_scam reaches the ledger overturn from any row', async () => {
    h.action = { profileId: 'p1', reason: 'admin_manual', status: 'active' }
    expect((await post({ action: 'overturn_scam', id: 'a1' })).status).toBe(200)
    expect(effects('overturnScamHold')).toHaveLength(1)
  })

  it('both need an id', async () => {
    expect((await post({ action: 'release_scam_hold', plan: 'x'.repeat(40) })).status).toBe(400)
    expect((await post({ action: 'overturn_scam' })).status).toBe(400)
  })

  it('a non-admin gets the 403 before anything runs', async () => {
    h.admin = null
    expect((await post({ action: 'release_scam_hold', id: 'a1', plan: 'x'.repeat(40) })).status).toBe(403)
    expect(effects('releaseScamHold')).toHaveLength(0)
  })
})

describe('set-state', () => {
  it('⛔ refuses a hand-set state BELOW held on a scam-held account', async () => {
    for (const state of ['good_standing', 'warned', 'throttled']) {
      expect(await post({ action: 'set-state', profileId: 'p1', state })).toEqual({ status: 409, body: { error: 'scam_hold_use_release' } })
    }
    expect(effects('applyEnforcement')).toHaveLength(0)
  })

  it('still allows escalating a scam-held account (held stays a no-op, suspended applies)', async () => {
    expect((await post({ action: 'set-state', profileId: 'p1', state: 'suspended' })).status).toBe(200)
    expect(effects('applyEnforcement')).toHaveLength(1)
    // …and never even asks the ledger for an escalation.
    expect(effects('profileHasScamHold')).toHaveLength(0)
  })

  it('downgrades as before when no scam charge holds the account', async () => {
    h.scamHold = false
    expect((await post({ action: 'set-state', profileId: 'p1', state: 'good_standing' })).status).toBe(200)
    expect(effects('applyEnforcement')).toHaveLength(1)
  })
})

describe('overturn names its reports (review, 2026-09-24)', () => {
  it('forwards the admin\'s selection WHOLE to the ledger overturn, on both actions', async () => {
    await post({ action: 'overturn', id: 'a1', reportIds: ['r1', 'r2'] })
    expect(effects('overturnScamHold')[0].args[0]).toMatchObject({ actionId: 'a1', reportIds: ['r1', 'r2'] })
    h.action = { profileId: 'p1', reason: 'admin_manual', status: 'active' }
    await post({ action: 'overturn_scam', id: 'a1', reportIds: Array.from({ length: 30 }, (_, i) => `r${i}`) })
    // Not truncated: 30 ticked is 30 forwarded (it used to be cut to 20 without a word — review 2026-09-24).
    expect((effects('overturnScamHold')[1].args[0] as Row).reportIds).toHaveLength(30)
  })

  it('a malformed element refuses the WHOLE selection — never dropped into a partial overturn', async () => {
    expect(await post({ action: 'overturn', id: 'a1', reportIds: ['r1', 7, 'r2'] })).toEqual({ status: 400, body: { error: 'invalid_input' } })
    expect(await post({ action: 'overturn_scam', id: 'a1', reportIds: 'r1' })).toEqual({ status: 400, body: { error: 'invalid_input' } })
    expect(effects('overturnScamHold')).toHaveLength(0)
  })

  it('a selection past the bound is REFUSED, never applied in part', async () => {
    const r = await post({ action: 'overturn_scam', id: 'a1', reportIds: Array.from({ length: 101 }, (_, i) => `r${i}`) })
    expect(r).toEqual({ status: 400, body: { error: 'too_many_rows', max: 100 } })
    expect(effects('overturnScamHold')).toHaveLength(0)
  })

  it('no selection → the core decides (reportIds undefined, never an empty list that means "all")', async () => {
    await post({ action: 'overturn', id: 'a1' })
    expect((effects('overturnScamHold')[0].args[0] as Row).reportIds).toBeUndefined()
  })

  it('choose_reports carries the charge list to the console; `remaining` rides a success', async () => {
    const charges = [{ reportId: 'r1', stage: 'held' }, { reportId: 'r2', stage: 'held' }]
    h.scamResult = { ok: false, status: 409, error: 'choose_reports', charges }
    expect(await post({ action: 'overturn', id: 'a1' })).toEqual({ status: 409, body: { error: 'choose_reports', charges } })
    h.scamResult = { ok: true, state: 'held', charges: 1, remaining: 1 }
    expect(await post({ action: 'overturn', id: 'a1', reportIds: ['r1'] })).toEqual({ status: 200, body: { ok: true, state: 'held', charges: 1, remaining: 1 } })
  })

  it('open_reports carries its count and ids', async () => {
    h.scamResult = { ok: false, status: 409, error: 'open_reports', count: 2, reportIds: ['r8', 'r9'] }
    expect(await post({ action: 'release_scam_hold', id: 'a1', plan: 'x'.repeat(40) })).toEqual({ status: 409, body: { error: 'open_reports', count: 2, reportIds: ['r8', 'r9'] } })
  })
})

describe('GET ?charges=<actionId> — the overturn dialog\'s list', () => {
  async function get(qs: string) {
    const res = await GET(new Request(`https://eno.vn/api/admin/enforcement${qs}`))
    return { status: res.status, body: (await res.json()) as Row }
  }

  it('answers the standing charges of that action\'s account', async () => {
    h.charges = [{ reportId: 'r1', stage: 'held', confirmedAt: '2026-09-01T00:00:00.000Z', listingId: 'L1', reason: 'scam', reportStatus: 'confirmed' }]
    expect(await get('?charges=a1')).toEqual({ status: 200, body: { charges: h.charges } })
    expect(effects('scamChargesForAction')[0].args).toEqual(['a1'])
  })

  it('409 not_active for a row that is no longer active', async () => {
    h.charges = null
    expect(await get('?charges=gone')).toEqual({ status: 409, body: { error: 'not_active' } })
  })

  it('is admin-only like the rest of the console', async () => {
    h.admin = null
    expect((await get('?charges=a1')).status).toBe(403)
    expect(effects('scamChargesForAction')).toHaveLength(0)
  })
})
