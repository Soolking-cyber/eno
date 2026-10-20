import { beforeEach, describe, expect, it, vi } from 'vitest'

/** A STOP's withdrawal and its acknowledgement are ONE transaction (desk.ts honourStop). */
vi.mock('server-only', () => ({}))
// A plain function, not a vi.fn: a spy whose async implementation throws reports its own unhandled rejection here.
const calls: unknown[][] = []
let impl: () => Promise<unknown> = async () => ({ id: 'm1' })
vi.mock('@/lib/messages', () => ({ insertMessage: (...a: unknown[]) => { calls.push(a); return impl() } }))
vi.mock('@/lib/support-thread', () => ({ getOrCreateListinglessThread: vi.fn() }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: vi.fn() }))
vi.mock('@/lib/push', () => ({ sendPushToProfile: vi.fn() }))
vi.mock('@/lib/db', () => ({
  db: {
    $executeRaw: vi.fn((s: TemplateStringsArray, ...v: unknown[]) => ({ sql: s.join('?'), v })),
    $queryRaw: vi.fn((s: TemplateStringsArray, ...v: unknown[]) => ({ sql: s.join('?'), v })),
  },
}))
const { honourStop, pauseJobDms } = await import('./desk')
const NOW = new Date('2026-10-21T03:00:00Z')

beforeEach(() => { calls.length = 0; impl = async () => ({ id: 'm1' }) })

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
    expect(flip.sql).toMatch(/set "pausedAt" =[\s\S]*"pausedAt" is null[\s\S]*"optInAt" < [\s\S]*1 \/ \(select count/)
    impl = async () => { throw { code: 'P2010', meta: { driverAdapterError: { cause: { code: '22012' } } } } }
    expect(await pauseJobDms('t-1', 'op-1', 'c1', NOW, NOW)).toBe(false)
  })
})
