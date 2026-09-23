import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/disputes/[id]/withdraw — the reporter closes their own open case.
 *
 * ⚠️ Pinned here (audit 2026-09-23, #15): a case RE-OPENED BY THE RESPONDENT'S APPEAL is not the
 * reporter's to withdraw. Withdrawal writes 'dismissed', and a dismissed report no longer charges
 * trust — so without the `appealedAt: null` guard a reporter could end the respondent's appeal
 * un-reviewed, or (pressured by a scammer) wipe an admin-confirmed penalty with no admin looking.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({
  me: 'rep1' as string | null,
  loaded: null as { report: Row; role: 'reporter' | 'respondent' } | null,
  updateCount: 1,
  calls: [] as Array<{ m: string; args: any }>,
}))

vi.mock('@/lib/db', () => ({
  db: {
    report: {
      updateMany: async (a: Row) => { h.calls.push({ m: 'report.updateMany', args: a }); return { count: h.updateCount } },
    },
  },
}))
vi.mock('@/lib/admin', () => ({
  getAdmin: async () => null,
  getCurrentProfile: async () => { throw new Error('userId mode must not load a Profile') },
  getCurrentProfileId: async () => h.me,
}))
vi.mock('@/lib/dispute', () => ({
  loadDisputeForParty: async () => h.loaded,
  respondentProfileId: async () => 'resp1',
  notifyDispute: async (...a: unknown[]) => { h.calls.push({ m: 'notifyDispute', args: a }) },
}))
vi.mock('@/lib/log', () => ({ logError: () => {}, logWarn: () => {}, logInfo: () => {} }))

import { POST } from './route'

async function post(id = 'r1') {
  const res = await POST(new Request(`https://eno.vn/api/disputes/${id}/withdraw`, { method: 'POST' }), { params: Promise.resolve({ id }) })
  return { status: res.status, text: await res.text() }
}

beforeEach(() => {
  h.me = 'rep1'
  h.loaded = { report: { id: 'r1', reporterProfileId: 'rep1', targetProfileId: 'resp1', targetSellerId: null }, role: 'reporter' }
  h.updateCount = 1
  h.calls = []
})

describe('withdraw', () => {
  it('the claim is guarded open + mine + NOT UNDER APPEAL', async () => {
    const r = await post()
    expect(r.status).toBe(200)
    expect(r.text).toBe('{"ok":true}')
    const upd = h.calls.find((c) => c.m === 'report.updateMany')!.args
    expect(upd.where).toEqual({ id: 'r1', status: 'open', reporterProfileId: 'rep1', appealedAt: null })
    expect(upd.data).toEqual({ status: 'dismissed', resolvedBy: 'withdrawn-by-reporter', resolvedAt: expect.any(Date) })
  })

  it('a case under appeal (the guard matches nothing) → 409 already_resolved, respondent not told it is over', async () => {
    h.updateCount = 0
    const r = await post()
    expect(r.status).toBe(409)
    expect(r.text).toContain('already_resolved')
    expect(h.calls.filter((c) => c.m === 'notifyDispute')).toHaveLength(0)
  })

  it('the respondent can never withdraw → 403', async () => {
    h.loaded = { ...h.loaded!, role: 'respondent' }
    expect((await post()).status).toBe(403)
    expect(h.calls.filter((c) => c.m === 'report.updateMany')).toHaveLength(0)
  })
})
