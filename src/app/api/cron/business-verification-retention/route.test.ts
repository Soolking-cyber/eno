import { beforeEach, describe, expect, it, vi } from 'vitest'

// The cron that finally CALLS the business-verification retention sweep (review S03). Auth is the
// shared `auth: 'cron'` mode; the one thing this file pins is that the sweep runs only behind it
// and that its counts reach the timer's journal line unchanged.
const h = vi.hoisted(() => ({ calls: 0, clean: false, backlog: false, spotless: false }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/core/business-verification-service', () => ({
  sweepVerificationRetention: async () => { h.calls++; if (h.spotless) return { swept: 3, failed: 0, malformed: 0, skippedNonTerminal: 0, remaining: 0 }; if (h.backlog) return { swept: 1000, failed: 0, malformed: 0, skippedNonTerminal: 0, remaining: 7 }; return h.clean ? { swept: 2, failed: 0, malformed: 1, skippedNonTerminal: 0, remaining: 0 } : { swept: 2, failed: 1, malformed: 0, skippedNonTerminal: 0, remaining: 1 } },
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))

const { GET } = await import('./route')
const req = (auth?: string) =>
  new Request('https://eno.vn/api/cron/business-verification-retention', { headers: auth ? { authorization: auth } : {} })

beforeEach(() => { h.calls = 0; h.clean = false; h.backlog = false; h.spotless = false; process.env.CRON_SECRET = 'cron-secret' })

describe('GET /api/cron/business-verification-retention', () => {
  it('refuses without the bearer, with the wrong bearer, and with CRON_SECRET unset — and never runs the sweep', async () => {
    for (const a of [undefined, 'Bearer nope']) {
      const res = await GET(req(a))
      expect(res.status).toBe(401)
    }
    delete process.env.CRON_SECRET
    expect((await GET(req('Bearer cron-secret'))).status).toBe(401)
    expect(h.calls).toBe(0)
  })

  it('runs the sweep behind the secret; a run with failures is a 500 carrying the counts, so the timer unit goes red', async () => {
    const res = await GET(req('Bearer cron-secret'))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toMatchObject({ ok: false, swept: 2, failed: 1, skippedNonTerminal: 0, remaining: 1 })
    expect(typeof body.checkedAt).toBe('string')
    expect(h.calls).toBe(1)
  })
  it('a run that leaves a backlog (remaining > 0) is red too, even with no failures', async () => {
    h.backlog = true
    const res = await GET(req('Bearer cron-secret'))
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ ok: false, failed: 0, remaining: 7 })
  })
  it('a run with only a malformed legacy record is red too — PII past its deadline behind a green journal is the worse outcome', async () => {
    h.clean = true
    const res = await GET(req('Bearer cron-secret'))
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ ok: false, failed: 0, malformed: 1 })
  })
  it('a clean run is a 200', async () => {
    h.spotless = true
    const res = await GET(req('Bearer cron-secret'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, failed: 0, malformed: 0, remaining: 0, skippedNonTerminal: 0 })
  })
})
