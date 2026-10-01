import { beforeEach, describe, expect, it, vi } from 'vitest'

// The cron that calls the listing-tombstone retention sweep. Pinned: it runs only behind the cron
// secret, its counts reach the timer's journal line, a BACKLOG is red, and an investigation hold is not.
const h = vi.hoisted(() => ({ calls: 0, result: { scrubbed: 0, held: 0, remaining: 0, noAuditRow: 0 } }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/core/listing-tombstone-retention', () => ({
  sweepListingTombstoneRetention: async () => { h.calls++; return h.result },
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))

const { GET } = await import('./route')
const req = (auth?: string) =>
  new Request('https://eno.vn/api/cron/listing-tombstone-retention', { headers: auth ? { authorization: auth } : {} })

beforeEach(() => { h.calls = 0; h.result = { scrubbed: 0, held: 0, remaining: 0, noAuditRow: 0 }; process.env.CRON_SECRET = 'cron-secret' })

describe('GET /api/cron/listing-tombstone-retention', () => {
  it('refuses without the bearer or with the wrong one — and never runs the sweep', async () => {
    for (const a of [undefined, 'Bearer nope']) expect((await GET(req(a))).status).toBe(401)
    expect(h.calls).toBe(0)
  })

  it('a clean run (nothing due yet, or all done) is a 200 carrying the counts', async () => {
    h.result = { scrubbed: 4, held: 0, remaining: 0, noAuditRow: 0 }
    const res = await GET(req('Bearer cron-secret'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, scrubbed: 4, remaining: 0 })
    expect(h.calls).toBe(1)
  })

  it('a backlog is red — personal data past its date behind a green journal is the outcome to avoid', async () => {
    h.result = { scrubbed: 1000, held: 0, remaining: 12, noAuditRow: 0 }
    const res = await GET(req('Bearer cron-secret'))
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ ok: false, remaining: 12 })
  })

  it('an investigation hold is NOT a failure — keeping evidence while a case is open is the rule working', async () => {
    h.result = { scrubbed: 0, held: 3, remaining: 0, noAuditRow: 0 }
    expect((await GET(req('Bearer cron-secret'))).status).toBe(200)
  })
})
