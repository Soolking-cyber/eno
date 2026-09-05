import { beforeEach, describe, expect, it, vi } from 'vitest'

// The cron that drains the durable erasure queue. Pins: the sweep runs only behind `auth: 'cron'`,
// and its counts reach the timer's journal line unchanged.
const h = vi.hoisted(() => ({ calls: 0 }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/core/storage-tombstones-sweep.svc', () => ({
  sweepTombstones: async () => { h.calls++; return { removed: 3, dropped: 1, failed: 1, skipped: 0, remaining: 1, queued: 2 } },
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))

const { GET } = await import('./route.svc')
const req = (auth?: string) => new Request('https://eno.vn/api/cron/storage-tombstones', { headers: auth ? { authorization: auth } : {} })

beforeEach(() => { h.calls = 0; process.env.CRON_SECRET = 'cron-secret' })

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
})
