import { beforeEach, describe, expect, it, vi } from 'vitest'

// GET/POST /api/saved-listings/price-alerts — the price-drop alerts switch's own endpoint (owner, 2026-11-17). Pinned: only the
// session's account (never an id from the body); an OFF is NEVER rate-limited, an ON is (20 an hour, strict); an older notice is
// 409 notice_changed; a bad body 400; answers are `private, no-store`. The rules: src/lib/price-alerts.test.ts.
type Row = Record<string, any>
const h = vi.hoisted(() => ({
  rl: [] as unknown[][],
  rlOk: true,
  rlThrows: false,
  me: { id: 'p-b' } as Row | null,
  sets: [] as Array<{ profileId: string; on: boolean; notice: unknown }>,
  reads: [] as string[],
  on: true,
  throws: null as unknown,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => h.me, getCurrentProfileId: async () => h.me?.id ?? null, getAdmin: async () => null, isAdminEmail: () => false }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async (...a: unknown[]) => { h.rl.push(a); if (h.rlThrows) throw new Error('limiter down'); return { success: h.rlOk, resetSec: 0 } },
  kv: { set: async () => 'OK', get: async () => null },
}))
vi.mock('@/lib/log', () => ({ logError: () => {} }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/price-alerts', () => {
  class PriceAlertNoticeChangedError extends Error { constructor() { super('notice_changed') } }
  return {
    PriceAlertNoticeChangedError,
    readPriceAlerts: async (profileId: string) => { h.reads.push(profileId); return h.on },
    setPriceAlerts: async (profileId: string, on: boolean, notice: unknown) => {
      h.sets.push({ profileId, on, notice })
      if (h.throws) throw h.throws
      return on
    },
  }
})

const { GET, POST } = await import('./route')
const { PriceAlertNoticeChangedError } = await import('@/lib/price-alerts')
const URL_ = 'https://eno.vn/api/saved-listings/price-alerts'
const post = async (body: unknown, headers: Record<string, string> = {}) => {
  const res = await POST(new Request(URL_, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }) as never, {} as never)
  return { status: res.status, body: (await res.json()) as Row, cache: res.headers.get('cache-control') }
}
const get = async () => {
  const res = await GET(new Request(URL_) as never, {} as never)
  return { status: res.status, body: (await res.json()) as Row, cache: res.headers.get('cache-control') }
}
const ON = { on: true, notice: '2026-11-18' }

beforeEach(() => {
  h.me = { id: 'p-b' }; h.sets = []; h.reads = []; h.throws = null; h.on = true
  h.rl = []; h.rlOk = true; h.rlThrows = false
})

describe('GET /api/saved-listings/price-alerts', () => {
  it('needs a signed-in account', async () => {
    h.me = null
    expect((await get()).status).toBe(401)
    expect(h.reads).toEqual([])
  })
  it('answers the SESSION account’s switch — { on }, never cached', async () => {
    expect(await get()).toEqual({ status: 200, body: { on: true }, cache: 'private, no-store' })
    expect(h.reads).toEqual(['p-b'])
  })
})

describe('POST /api/saved-listings/price-alerts', () => {
  it('needs a signed-in account — and never saves without one', async () => {
    h.me = null
    expect((await post({ on: false })).status).toBe(401)
    expect(h.sets).toEqual([])
  })

  it('an ON hands the shown notice through, for the SESSION’s account — never one named in the body', async () => {
    expect(await post({ ...ON, profileId: 'p-a' })).toEqual({ status: 200, body: { on: true }, cache: 'private, no-store' })
    expect(h.sets).toEqual([{ profileId: 'p-b', on: true, notice: '2026-11-18' }])
  })

  it('⛔ a tab acting for ANOTHER account is refused before anything is written (409 account_changed); its own account passes', async () => {
    expect((await post(ON, { 'x-eno-acting-account': 'p-a' })).status).toBe(409)
    expect((await post({ on: false }, { 'x-eno-acting-account': 'p-a' })).status).toBe(409)
    expect(h.sets).toEqual([])
    expect((await post(ON, { 'x-eno-acting-account': 'p-b' })).status).toBe(200)
  })

  it('⛔ an OFF needs nothing else and ignores anything else', async () => {
    for (const body of [{ on: false }, { on: false, notice: 'old', profileId: 'p-a' }]) {
      h.sets = []
      expect((await post(body)).status, JSON.stringify(body)).toBe(200)
      expect(h.sets).toEqual([{ profileId: 'p-b', on: false, notice: null }])
    }
  })

  it('⛔ an OFF is NEVER rate-limited — it saves with the bucket spent and with the limiter down', async () => {
    h.rlOk = false
    expect((await post({ on: false })).status).toBe(200)
    h.rlThrows = true
    expect((await post({ on: false })).status).toBe(200)
    expect(h.rl).toEqual([])
    expect(h.sets).toHaveLength(2)
  })

  it('an ON is capped (20 an hour, strict, per account) — a spent bucket is 429 and saves nothing', async () => {
    h.rlOk = false
    expect((await post(ON)).status).toBe(429)
    expect(h.sets).toEqual([])
    expect(h.rl[0]).toEqual(['saved-price-alerts', 'p-b', 20, '1 h', { strict: true }])
  })

  it('⛔ a page that showed another notice → 409 notice_changed', async () => {
    h.throws = new PriceAlertNoticeChangedError()
    expect((await post({ on: true, notice: '2026-01-01' })).body).toEqual({ error: 'notice_changed' })
    expect((await post({ on: true, notice: '2026-01-01' })).status).toBe(409)
  })

  it.each([
    ['not JSON', '{nope'],
    ['no switch', {}],
    ['a switch that is not a boolean', { on: 'true', notice: '2026-11-18' }],
    ['an ON with no notice', { on: true }],
    ['an ON with an absurd notice', { on: true, notice: 'x'.repeat(41) }],
  ])('%s → 400 bad_request, nothing saved', async (_name, body) => {
    expect((await post(body)).status).toBe(400)
    expect(h.sets).toEqual([])
  })

  it('anything else thrown is the generic 500, never its text', async () => {
    h.throws = new Error('connection string postgres://secret@db')
    expect((await post({ on: false })).body).toEqual({ error: 'internal_error' })
  })
})
