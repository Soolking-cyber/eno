import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The IndexNow cron route, end to end over a fake kv, a fake collector and a fake engine (a stubbed
 * `fetch`) — nothing here can reach a real IndexNow endpoint.
 */
const h = vi.hoisted(() => ({
  marketplace: true,
  kv: new Map<string, unknown>(),
  kvWrites: 0,
  collect: null as null | (() => Promise<{ urls: Map<string, string>; frozen: string[]; children: [] }>),
}))

vi.mock('@/lib/edition', async (orig) => ({
  ...(await orig<typeof import('@/lib/edition')>()),
  get IS_MARKETPLACE() { return h.marketplace },
}))
vi.mock('@/lib/ratelimit', () => ({
  kv: {
    get: async (k: string) => (h.kv.has(k) ? structuredClone(h.kv.get(k)) : null),
    set: async (k: string, v: unknown, o?: { nx?: boolean }) => {
      h.kvWrites++
      if (o?.nx && h.kv.has(k)) return null
      h.kv.set(k, structuredClone(v))
      return 'OK'
    },
    del: async (k: string) => { h.kvWrites++; h.kv.delete(k) },
  },
  rateLimit: async () => ({ success: true }),
}))
vi.mock('./collect', () => ({ collectSitemaps: () => h.collect!() }))

import { GET } from './route'

const CRON_TOKEN = 'test-cron-token'
const KEY = '0123456789abcdef0123456789abcdef'
const U = (p: string) => `https://eno.vn${p}`
const SNAP = 'indexnow:v1:eno.vn'
const HOLD = 'indexnow:hold'
const LEASE = 'indexnow:lease'

function siteMap(n: number, extra: Record<string, string> = {}) {
  const m = new Map<string, string>()
  for (let i = 0; i < n; i++) m.set(U(`/listings/l${i}`), '2026-09-01T00:00:00.000Z')
  m.set(U('/hcmc-rent-index'), '2026-09-30T00:00:00.000Z')
  for (const [k, v] of Object.entries(extra)) m.set(U(k), v)
  return m
}
function serve(urls: Map<string, string>, frozen: string[] = []) {
  h.collect = async () => ({ urls, frozen, children: [] })
}
const call = (query = '', auth = true) =>
  GET(new Request(`http://127.0.0.1:3001/api/cron/indexnow${query}`, { headers: auth ? { authorization: `Bearer ${CRON_TOKEN}` } : {} }))

let engine: ReturnType<typeof vi.fn>
function engineAnswers(...statuses: number[]) {
  engine = vi.fn(async () => new Response('', { status: statuses.length > 1 ? statuses.shift()! : statuses[0] }))
  vi.stubGlobal('fetch', engine)
}
const sentBodies = () => engine.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string))

beforeEach(() => {
  h.marketplace = true
  h.kv = new Map()
  h.kvWrites = 0
  vi.stubEnv('CRON_SECRET', CRON_TOKEN)
  vi.stubEnv('INDEXNOW_KEY', KEY)
  vi.stubEnv('INDEXNOW_ENDPOINT', '')
  serve(siteMap(100))
  engineAnswers(200)
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('guards', () => {
  it('401 without the secret', async () => {
    expect((await call('', false)).status).toBe(401)
  })

  it('404 on eno.forum', async () => {
    h.marketplace = false
    expect((await call()).status).toBe(404)
  })

  it('no key: 200 {skipped:"no_key"}, touching nothing — no kv read or write, no sitemap, no ping', async () => {
    vi.stubEnv('INDEXNOW_KEY', '')
    h.collect = async () => { throw new Error('must not collect') }
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ skipped: 'no_key' })
    expect(h.kvWrites).toBe(0)
    expect(engine).not.toHaveBeenCalled()
  })

  it('a malformed key is no key', async () => {
    vi.stubEnv('INDEXNOW_KEY', 'bad_key_1')
    expect(await (await call()).json()).toEqual({ skipped: 'no_key' })
  })

  it('a held lease: 200 {skipped:"running"}, and the other run\'s lease is not released', async () => {
    h.kv.set(LEASE, 1)
    expect(await (await call()).json()).toEqual({ skipped: 'running' })
    expect(h.kv.has(LEASE)).toBe(true)
  })

  it('releases its own lease when done', async () => {
    await call()
    expect(h.kv.has(LEASE)).toBe(false)
  })

  it("an overrun run never releases the lease a later run took meanwhile", async () => {
    h.collect = async () => {
      h.kv.set(LEASE, 'someone-elses-token') // our lease expired and another run took it
      return { urls: siteMap(10), frozen: [], children: [] }
    }
    await call()
    expect(h.kv.get(LEASE)).toBe('someone-elses-token')
  })
})

describe('source failures', () => {
  it('a collector throw is a 503 and leaves the snapshot and the hold untouched', async () => {
    const hold = { reason: 'r', removed: [U('/x')], count: 2, firstAt: '2026-09-01T00:00:00.000Z', lastAt: '2026-09-01T12:00:00.000Z', overlap: 1 }
    h.kv.set(SNAP, { v: 1, savedAt: 'x', urls: { [U('/a')]: '' } })
    h.kv.set(HOLD, hold)
    h.collect = async () => { throw new Error('/sitemaps/listings-0.xml answered 500') }
    const res = await call()
    expect(res.status).toBe(503)
    expect((await res.json()).detail).toMatch(/listings-0/)
    expect(h.kv.get(SNAP)).toEqual({ v: 1, savedAt: 'x', urls: { [U('/a')]: '' } })
    expect(h.kv.get(HOLD)).toEqual(hold)
    expect(engine).not.toHaveBeenCalled()
  })
})

describe('runs', () => {
  it('a baseline drops a hold left from before the snapshot went missing', async () => {
    h.kv.set(HOLD, { reason: 'r', removed: [U('/x')], count: 2, firstAt: '2026-09-01T00:00:00.000Z', lastAt: 'x', overlap: 1 })
    await call()
    expect(h.kv.has(SNAP)).toBe(true)
    expect(h.kv.has(HOLD)).toBe(false)
  })

  it('first run: saves a baseline, sends nothing', async () => {
    const res = await call()
    expect(await res.json()).toMatchObject({ baseline: 101 })
    expect(Object.keys((h.kv.get(SNAP) as { urls: object }).urls)).toHaveLength(101)
    expect(engine).not.toHaveBeenCalled()
  })

  it('then sends only what changed, with host, key and keyLocation, to Bing by default', async () => {
    await call()
    const next = siteMap(100, { '/new': '2026-10-01' })
    next.delete(U('/listings/l7'))
    serve(next)
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ sent: 2, added: 1, removed: 1 })
    expect(engine).toHaveBeenCalledTimes(1)
    expect(engine.mock.calls[0][0]).toBe('https://www.bing.com/indexnow')
    expect((engine.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'Content-Type': 'application/json; charset=utf-8' })
    expect(sentBodies()[0]).toEqual({ host: 'eno.vn', key: KEY, keyLocation: `https://eno.vn/${KEY}.txt`, urlList: [U('/new'), U('/listings/l7')] })
    expect((h.kv.get(SNAP) as { urls: Record<string, string> }).urls[U('/new')]).toBe('2026-10-01')
  })

  it('nothing changed: no POST at all', async () => {
    await call()
    expect(await (await call()).json()).toMatchObject({ sent: 0 })
    expect(engine).not.toHaveBeenCalled()
  })

  it('INDEXNOW_ENDPOINT reroutes to a loopback fake only; any other override, https included, falls back to Bing', async () => {
    await call()
    serve(siteMap(100, { '/new': '2026-10-01' }))
    vi.stubEnv('INDEXNOW_ENDPOINT', 'http://127.0.0.1:3296/indexnow')
    await call()
    expect(engine.mock.calls[0][0]).toBe('http://127.0.0.1:3296/indexnow')
    h.kv.delete(SNAP)
    await call()
    serve(siteMap(100, { '/new2': '2026-10-01' }))
    vi.stubEnv('INDEXNOW_ENDPOINT', 'http://evil.example/indexnow')
    await call()
    expect(engine.mock.calls[1][0]).toBe('https://www.bing.com/indexnow')
    h.kv.delete(SNAP)
    await call()
    serve(siteMap(100, { '/new3': '2026-10-01' }))
    vi.stubEnv('INDEXNOW_ENDPOINT', 'https://evil.example/indexnow')
    await call()
    expect(engine.mock.calls[2][0]).toBe('https://www.bing.com/indexnow')
  })

  it('?dry=1 returns the plan and writes nothing — not even the lease', async () => {
    await call()
    const next = siteMap(100, { '/new': '2026-10-01' })
    serve(next)
    const writes = h.kvWrites
    const before = structuredClone(h.kv.get(SNAP))
    const body = await (await call('?dry=1')).json()
    expect(body).toMatchObject({ dry: true, would: 'send', urlList: [U('/new')], added: [U('/new')] })
    expect(h.kvWrites).toBe(writes)
    expect(h.kv.get(SNAP)).toEqual(before)
    expect(engine).not.toHaveBeenCalled()
  })

  it('?dry=1 on a first run reports the baseline it would record', async () => {
    const body = await (await call('?dry=1')).json()
    expect(body).toMatchObject({ dry: true, would: 'baseline', urls: 101 })
    expect(h.kv.has(SNAP)).toBe(false)
  })

  it('?rebaseline=1 accepts now, sends nothing, drops the hold', async () => {
    await call()
    h.kv.set(HOLD, { reason: 'r', removed: [], count: 1, firstAt: 'x', lastAt: 'x', overlap: 1 })
    const next = siteMap(10)
    serve(next)
    expect(await (await call('?rebaseline=1')).json()).toMatchObject({ rebaseline: 'manual' })
    expect(Object.keys((h.kv.get(SNAP) as { urls: object }).urls)).toHaveLength(11)
    expect(h.kv.has(HOLD)).toBe(false)
    expect(engine).not.toHaveBeenCalled()
  })

  it('a trip: 409 with count, firstAt and overlap; nothing sent; the snapshot is kept', async () => {
    await call()
    const before = structuredClone(h.kv.get(SNAP))
    serve(siteMap(40))
    const res = await call()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'guard_tripped', count: 1, overlap: 1, removed: 60 })
    expect(h.kv.get(SNAP)).toEqual(before)
    expect((h.kv.get(HOLD) as { removed: string[] }).removed).toHaveLength(60)
    expect(engine).not.toHaveBeenCalled()
  })

  it('the builder freezing the rentals URLs: 200, pings only the rest, the hold untouched when nothing trips', async () => {
    const districts: Record<string, string> = {}
    for (let i = 0; i < 22; i++) districts[`/c/rentals/d${i}`] = ''
    serve(siteMap(30, districts))
    await call()
    const hold = { reason: 'old', removed: [U('/gone')], count: 1, firstAt: '2026-09-01T00:00:00.000Z', lastAt: '2026-09-01T00:00:00.000Z', overlap: 1 }
    const frozenNow = siteMap(30, { '/new': '2026-10-01' })
    frozenNow.delete(U('/hcmc-rent-index'))
    serve(frozenNow, ['/c/rentals/', '/hcmc-rent-index'])
    h.kv.set(HOLD, hold)
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ sent: 1, removed: 0, frozenKept: 23 })
    expect(sentBodies()[0].urlList).toEqual([U('/new')])
    // An accepted send drops the hold; the frozen entries are saved with their old values.
    const saved = (h.kv.get(SNAP) as { urls: Record<string, string> }).urls
    expect(saved[U('/c/rentals/d0')]).toBe('')
    expect(saved[U('/hcmc-rent-index')]).toBe('2026-09-30T00:00:00.000Z')
  })

  it('churn: 409, 409, then an automatic re-baseline that pings no removals, then normal', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-10-01T01:30:00Z'))
      serve(siteMap(300))
      await call()
      const gone = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => U(`/listings/l${from + i}`))
      const drop = (m: Map<string, string>, locs: string[]) => { for (const l of locs) m.delete(l); return m }

      vi.setSystemTime(new Date('2026-10-01T13:30:00Z'))
      serve(drop(siteMap(300), gone(0, 60)))
      expect((await call()).status).toBe(409)

      vi.setSystemTime(new Date('2026-10-02T01:30:00Z'))
      serve(drop(siteMap(300, { '/a': '2026-10-01' }), [...gone(0, 60), ...gone(200, 203)]))
      const r2 = await call()
      expect(r2.status).toBe(409)
      expect(await r2.json()).toMatchObject({ count: 2 })

      vi.setSystemTime(new Date('2026-10-02T13:30:00Z'))
      serve(drop(siteMap(300, { '/a': '2026-10-01', '/b': '2026-10-02' }), [...gone(2, 60), ...gone(200, 207)]))
      const r3 = await call()
      expect(r3.status).toBe(200)
      expect(await r3.json()).toMatchObject({ rebaseline: 'auto', sent: 2 })
      expect(sentBodies()[0].urlList).toEqual([U('/a'), U('/b')])
      expect(h.kv.has(HOLD)).toBe(false)

      vi.setSystemTime(new Date('2026-10-03T01:30:00Z'))
      serve(drop(siteMap(300, { '/a': '2026-10-01', '/b': '2026-10-02' }), [...gone(2, 60), ...gone(200, 208)]))
      const r4 = await call()
      expect(await r4.json()).toMatchObject({ sent: 1, removed: 1 })
      expect(sentBodies()[1].urlList).toEqual([U('/listings/l207')])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("the engine's answers", () => {
  async function changeOnce() {
    await call()
    serve(siteMap(100, { '/new': '2026-10-01' }))
  }

  it.each([200, 202])('%i: accepted, snapshot saved', async (status) => {
    await changeOnce()
    engineAnswers(status)
    expect((await call()).status).toBe(200)
    expect((h.kv.get(SNAP) as { urls: Record<string, string> }).urls[U('/new')]).toBe('2026-10-01')
  })

  it.each([429, 500, 503])('%i: deferred — 200, snapshot kept, the same URL is offered next run', async (status) => {
    await changeOnce()
    engineAnswers(status)
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ deferred: status, sent: 0 })
    expect((h.kv.get(SNAP) as { urls: Record<string, string> }).urls[U('/new')]).toBeUndefined()
    engineAnswers(200)
    await call()
    expect(sentBodies()[0].urlList).toEqual([U('/new')])
  })

  it('a network error is deferred too', async () => {
    await changeOnce()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    expect(await (await call()).json()).toMatchObject({ deferred: 'fetch failed' })
  })

  it.each([400, 403, 422])('%i: rejected — non-200 (502), snapshot kept, logged loudly', async (status) => {
    await changeOnce()
    engineAnswers(status)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call()
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: 'engine_rejected', status })
    expect((h.kv.get(SNAP) as { urls: Record<string, string> }).urls[U('/new')]).toBeUndefined()
    expect(err.mock.calls.some((c) => String(c[0]).includes('ENGINE REJECTED'))).toBe(true)
    err.mockRestore()
  })
})
