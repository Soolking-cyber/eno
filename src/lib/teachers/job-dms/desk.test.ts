import { beforeEach, describe, expect, it, vi } from 'vitest'

/** A STOP's withdrawal and its acknowledgement are ONE transaction (desk.ts honourStop). */
vi.mock('server-only', () => ({}))
// A plain function, not a vi.fn: a spy whose async implementation throws reports its own unhandled rejection here.
const calls: unknown[][] = []
let impl: () => Promise<unknown> = async () => ({ id: 'm1' })
vi.mock('@/lib/messages', () => ({ insertMessage: (...a: unknown[]) => { calls.push(a); return impl() } }))
vi.mock('@/lib/support-thread', () => ({ getOrCreateListinglessThread: vi.fn(async () => ({ id: 'c1' })) }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: vi.fn(async () => ({ success: false })) }))
vi.mock('@/lib/push', () => ({ sendPushToProfile: vi.fn() }))
const consent = { row: null as null | { optIn: boolean; noticeVersion: string | null; pausedAt: Date | null } }
vi.mock('@/lib/db', () => ({
  db: {
    $executeRaw: vi.fn((s: TemplateStringsArray, ...v: unknown[]) => ({ sql: s.join('?'), v })),
    $queryRaw: vi.fn((s: TemplateStringsArray, ...v: unknown[]) => ({ sql: s.join('?'), v })),
    teacherJobDmConsent: { findUnique: vi.fn(async () => consent.row) },
    seller: { createMany: vi.fn(async () => ({ count: 0 })) },
    conversation: { findFirst: vi.fn(async () => ({ id: 'c1' })), deleteMany: vi.fn(async () => ({ count: 0 })) },
    teacherJobDmDay: { create: vi.fn(() => ({ ledger: 'day' })) },
    teacherJobDm: { create: vi.fn(() => ({ ledger: 'job' })) },
  },
}))
const { honourStop, pauseJobDms, sendJobDm } = await import('./desk')
const { JOB_DM_DEFAULT_ON, JOB_DM_NOTICE_VERSION } = await import('./constants')
const NOW = new Date('2026-10-21T03:00:00Z')

beforeEach(() => { calls.length = 0; impl = async () => ({ id: 'm1' }); consent.row = null })

describe('sendJobDm — the switch it sends by (default-on, 2026-10-21)', () => {
  const send = () => sendJobDm({ teacherProfileId: 't-1', operatorId: 'op-1', kind: 'jobs', day: '2026-10-21', text: 'Hi', repliesReadAt: NOW, jobs: [{ key: 'post:1', score: 1, reasons: [] }] })
  it('eno\'s default-on is ON: the pre-check passes and the guard inside the batch names both versions', async () => {
    consent.row = { optIn: true, noticeVersion: JOB_DM_DEFAULT_ON, pausedAt: null }
    expect(await send()).toMatchObject({ sent: true })
    const guard = (calls[0][3] as { alongside: { sql?: string; v?: unknown[] }[] }).alongside.find((q) => q.sql?.includes('"TeacherJobDmConsent"'))!
    expect(guard.sql).toMatch(/c\."noticeVersion" = \?[^?]*or c\."noticeVersion" = \?/)
    expect(guard.v).toEqual(expect.arrayContaining([JOB_DM_NOTICE_VERSION, JOB_DM_DEFAULT_ON]))
  })
  it('an ON under an older notice, a paused ON, an OFF or no row is held — no message', async () => {
    for (const row of [{ optIn: true, noticeVersion: '2000-01-01', pausedAt: null }, { optIn: true, noticeVersion: JOB_DM_DEFAULT_ON, pausedAt: NOW }, { optIn: false, noticeVersion: JOB_DM_DEFAULT_ON, pausedAt: null }, null]) {
      consent.row = row
      expect(await send(), JSON.stringify(row)).toEqual({ sent: false, reason: 'held' })
    }
    expect(calls).toHaveLength(0)
  })
})

describe('honourStop', () => {
  it('withdraws and acknowledges in one batch: the teacher lock, the compare-and-set, then the ack', async () => {
    expect(await honourStop('t-1', 'op-1', 'c1', NOW)).toBe(true)
    const [, sender, text, opts] = calls[0]
    expect(sender).toBe('op-1')
    expect(text).toContain('no more job messages')
    const [timeout, lock, flip] = (opts as { alongside: { sql: string; v: unknown[] }[] }).alongside
    expect(timeout.sql).toContain("set_config('lock_timeout'")
    expect(lock.sql).toContain('pg_advisory_xact_lock')
    expect(lock.v).toEqual(['teacher-job-dm:t-1'])
    expect(flip.sql).toMatch(/update "TeacherJobDmConsent" set "optIn" = false[\s\S]*1 \/ \(select count/)
  })
  it('nothing to withdraw (already off): the batch aborts on 22012 and no ack goes out', async () => {
    impl = async () => { throw { code: 'P2010', meta: { driverAdapterError: { cause: { code: '22012' } } } } }
    expect(await honourStop('t-1', 'op-1', 'c1', NOW)).toBe(false)
  })
  it('any other failure rolls back both and is thrown — the next run retries the STOP', async () => {
    impl = async () => { throw new Error('connection lost') }
    await expect(honourStop('t-1', 'op-1', 'c1', NOW)).rejects.toThrow('connection lost')
  })
})

describe('pauseJobDms', () => {
  it('sets the pause and says so in one batch; already paused → the batch aborts and nothing is said twice', async () => {
    expect(await pauseJobDms('t-1', 'op-1', 'c1', NOW, NOW)).toBe(true)
    const [, , text, opts] = calls[0]
    expect(text).toContain('Keep sending jobs')
    const flip = (opts as { alongside: { sql: string }[] }).alongside[2]
    expect(flip.sql).toMatch(/set "pausedAt" =[\s\S]*"pausedAt" is null[\s\S]*"optInAt" <= [\s\S]*1 \/ \(select count/)
    impl = async () => { throw { code: 'P2010', meta: { driverAdapterError: { cause: { code: '22012' } } } } }
    expect(await pauseJobDms('t-1', 'op-1', 'c1', NOW, NOW)).toBe(false)
  })
})
