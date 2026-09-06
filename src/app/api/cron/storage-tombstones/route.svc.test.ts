import { beforeEach, describe, expect, it, vi } from 'vitest'

// The cron that drains the durable erasure queue. Pins: the sweep runs only behind `auth: 'cron'`,
// and its counts reach the timer's journal line unchanged.
const h = vi.hoisted(() => ({ calls: 0, statusCalls: 0 }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/core/storage-tombstones-sweep.svc', () => ({
  sweepTombstones: async () => { h.calls++; return { removed: 3, dropped: 1, failed: 1, skipped: 0, remaining: 1, queued: 2 } },
  tombstoneStatus: async () => {
    h.statusCalls++
    return {
      queued: 7, due: 2, failing: 1,
      oldestDueAt: '2026-09-01T00:00:00.000Z', oldestQueuedAt: '2026-09-01T00:00:00.000Z',
      byReason: { account_deleted: 5, kyc_capture_intent: 2 },
      checkedAt: '2026-09-06T00:00:00.000Z',
    }
  },
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))

const { GET } = await import('./route.svc')
const req = (auth?: string, query = '') => new Request(`https://eno.vn/api/cron/storage-tombstones${query}`, { headers: auth ? { authorization: auth } : {} })

beforeEach(() => { h.calls = 0; h.statusCalls = 0; process.env.CRON_SECRET = 'cron-secret' })

describe('GET /api/cron/storage-tombstones', () => {
  it('refuses without the bearer, with the wrong bearer, and with CRON_SECRET unset — and never sweeps', async () => {
    for (const a of [undefined, 'Bearer nope']) expect((await GET(req(a))).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await GET(req('Bearer cron-secret'))).status).toBe(401)
    expect(h.calls).toBe(0)
  })
  it('sweeps behind the secret and reports the counts', async () => {
    const res = await GET(req('Bearer cron-secret'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, removed: 3, dropped: 1, failed: 1, skipped: 0, remaining: 1, queued: 2 })
    expect(h.calls).toBe(1)
  })

  /**
   * ⛔ ASKING WHETHER THE QUEUE IS DRAINING MUST NOT DRAIN IT. Before `?status=1` the only figures
   * available came from the sweep's own response, so an operator checking on deletions had to
   * perform deletions. `h.calls` staying 0 is the whole assertion.
   */
  it('reports the queue without sweeping when asked for status', async () => {
    const res = await GET(req('Bearer cron-secret', '?status=1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, queued: 7, due: 2, failing: 1, byReason: { kyc_capture_intent: 2 } })
    expect(h.calls).toBe(0)
    expect(h.statusCalls).toBe(1)
  })

  it('the status view is behind the same secret', async () => {
    expect((await GET(req(undefined, '?status=1'))).status).toBe(401)
    expect(h.statusCalls).toBe(0)
  })

  it('never returns a storage path — a path identifies a person’s document', async () => {
    const body = await (await GET(req('Bearer cron-secret', '?status=1'))).text()
    expect(body).not.toMatch(/\.(jpg|jpeg|png|webp|pdf|mp4)/i)
  })
})
