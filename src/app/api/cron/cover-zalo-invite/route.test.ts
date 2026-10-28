import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// GET /api/cron/cover-zalo-invite — the one-time "Zalo for urgent cover" invite (owner, 2026-10-29), run by hand. Pinned:
// cron auth; marketplace only (one sender: both editions share the database); ?dryRun=1 reaches the run as a dry run;
// a run with failures answers 500 (the unit goes red); the answer stays under 200 bytes and names no one. The run itself
// (src/lib/teachers/zalo-invite.ts) is proved on a real Postgres in zalo-invite.it.test.ts.
const h = vi.hoisted(() => ({ marketplace: true, calls: [] as Array<{ dryRun: boolean }>, failed: 0, stopped: undefined as string | undefined }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/edition', async (orig) => ({ ...(await orig<typeof import('@/lib/edition')>()), get IS_MARKETPLACE() { return h.marketplace } }))
vi.mock('@/lib/teachers/zalo-invite', () => ({
  runCoverZaloInvite: async (o: { dryRun: boolean }) => {
    h.calls.push(o)
    return { dryRun: o.dryRun, eligible: 150, chat: 40, bell: 100, paused: 10, held: 0, failed: h.failed, left: 0, live: true, ...(h.stopped ? { stopped: h.stopped } : {}) }
  },
}))

const { GET } = await import('./route')
const req = (qs = '', auth: string | null = 'Bearer cron-secret') =>
  new Request(`https://eno.vn/api/cron/cover-zalo-invite${qs}`, { headers: auth ? { authorization: auth } : {} })

beforeEach(() => { process.env.CRON_SECRET = 'cron-secret'; h.marketplace = true; h.calls = []; h.failed = 0; h.stopped = undefined })
afterEach(() => { vi.clearAllMocks() })

describe('GET /api/cron/cover-zalo-invite', () => {
  it('cron auth only', async () => {
    for (const a of [null, 'Bearer nope']) expect((await GET(req('', a) as never, {} as never)).status).toBe(401)
    expect(h.calls).toEqual([])
  })
  it('?dryRun=1 is a dry run; without it, a run — the answer is counts only, under 200 bytes', async () => {
    const dry = await GET(req('?dryRun=1') as never, {} as never)
    expect(h.calls).toEqual([{ dryRun: true }])
    const body = await dry.text()
    expect(body.length).toBeLessThan(200)
    expect(JSON.parse(body)).toMatchObject({ ok: true, dryRun: true, eligible: 150, chat: 40, bell: 100, paused: 10 })
    await GET(req() as never, {} as never)
    expect(h.calls.at(-1)).toEqual({ dryRun: false })
  })
  it('a run with failures answers 500', async () => {
    h.failed = 2
    const r = await GET(req() as never, {} as never)
    expect(r.status).toBe(500)
    expect(await r.json()).toMatchObject({ ok: false, failed: 2 })
  })
  it('no operator, no lock store, or a reply that could not be read for a STOP: red; busy or quiet: a 200 to run again later', async () => {
    for (const [stopped, status] of [['no-operator', 500], ['lock-error', 500], ['stops-failed', 500], ['busy', 200], ['quiet', 200]] as const) {
      h.stopped = stopped
      expect((await GET(req() as never, {} as never)).status, stopped).toBe(status)
    }
  })
  it('⛔ marketplace only — eno.forum never runs it', async () => {
    h.marketplace = false
    const r = await GET(req() as never, {} as never)
    expect(await r.json()).toMatchObject({ skipped: 'marketplace_only' })
    expect(h.calls).toEqual([])
  })
})
