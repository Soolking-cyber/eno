import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/page-speed — the page-speed totals (speed plan item 5).
 *
 * ⛔ WHAT MUST HOLD: a valid beacon from the live site becomes bucket ops for today (Vietnam) and this edition — and
 * NOTHING is recorded for a preview build, another host, a missing or foreign Origin, a crawler, an oversized or
 * malformed body, or an over-limit caller. Nothing about the caller reaches the ops. Always a bodyless 204, and the
 * database is never touched on the request path (store.ts batches; the limiter is in memory).
 */

const h = vi.hoisted(() => ({ recorded: [] as Array<{ day: string; edition: string; ops: unknown[] }>, allow: true, ips: [] as string[] }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/rum/store', () => ({
  limiterKey: (ip: string) => `key:${ip}`,
  allowBeacon: (key: string) => { h.ips.push(key); return h.allow },
  recordRumOps: (day: string, edition: string, ops: unknown[]) => { h.recorded.push({ day, edition, ops }) },
}))
vi.mock('@/lib/db', () => ({ db: new Proxy({}, { get: () => { throw new Error('the route must not touch the database') } }) }))

const { POST } = await import('./route')
const { EDITION } = await import('@/lib/edition')
const { vnDay } = await import('@/lib/signup-prompt')

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
const BEACON = { v: 1, r: 'home', c: 'browser.phone.vi', m: { ttfb: 180, lcp: 1_750 }, e: 'HIT', o: 'HKG' }
/** A browser's beacon: sendBeacon / fetch(keepalive) always declare the body's length — so does this helper. */
const call = (body: unknown, { raw = false, host = 'eno.vn', origin = 'https://eno.vn' as string | null, ua = UA } = {}) => {
  const text = raw ? (body as string) : JSON.stringify(body)
  return POST(new Request(`https://${host}/api/page-speed`, {
    method: 'POST',
    body: text,
    headers: {
      host, 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)), 'user-agent': ua,
      'cf-connecting-ip': '203.0.113.7', ...(origin ? { origin } : {}),
    },
  }) as unknown as Parameters<typeof POST>[0])
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')
  h.recorded = []; h.allow = true; h.ips = []
})
afterEach(() => { vi.unstubAllEnvs() })

describe('POST /api/page-speed', () => {
  it('records a valid beacon for today (VN) and this edition, and answers a bodyless 204', async () => {
    const res = await call(BEACON)
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    expect(h.recorded).toHaveLength(1)
    expect(h.recorded[0].day).toBe(vnDay(Date.now()))
    expect(h.recorded[0].edition).toBe(EDITION)
    expect(JSON.stringify(h.recorded[0].ops)).toContain('"family":"edge","dims":"HKG|HIT"')
    expect(h.ips).toEqual(['key:203.0.113.7']) // the limit is keyed by limiterKey (an IPv6 /64), not the raw address
  })

  it('a teacher page or a storefront counts on its own host — the proxy admits it (SUBDOMAIN_SELF_WRITES)', async () => {
    await call(BEACON, { host: 'teacher.eno.vn', origin: 'https://teacher.eno.vn' })
    await call(BEACON, { host: 'apple.eno.vn', origin: 'https://apple.eno.vn' })
    expect(h.recorded).toHaveLength(2)
  })

  it('eno.forum counts too — apex, www and its subdomains (every fix ships to both sites)', async () => {
    for (const host of ['eno.forum', 'www.eno.forum', 'teacher.eno.forum', 'apple.eno.forum']) await call(BEACON, { host, origin: `https://${host}` })
    expect(h.recorded).toHaveLength(4)
  })

  it('⛔ records nothing off the live site, without an Origin, from another origin, or from a crawler', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect((await call(BEACON)).status).toBe(204)
    vi.stubEnv('NODE_ENV', 'production')
    await call(BEACON, { host: 'localhost:3000', origin: 'http://localhost:3000' })
    await call(BEACON, { origin: null })
    await call(BEACON, { origin: 'https://evil.example' })
    await call(BEACON, { origin: 'https://www.eno.vn' }) // another host of ours is still another origin
    await call(BEACON, { origin: 'http://eno.vn' }) // and another scheme is another origin (codex)
    await call(BEACON, { ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' })
    expect(h.recorded).toEqual([])
  })

  it('⛔ records nothing without a declared length — a chunked body is never buffered', async () => {
    const res = await POST(new Request('https://eno.vn/api/page-speed', {
      method: 'POST',
      body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(JSON.stringify(BEACON))); c.close() } }),
      // @ts-expect-error — Node's undici needs `duplex` for a stream body; the DOM types do not know it
      duplex: 'half',
      headers: { host: 'eno.vn', origin: 'https://eno.vn', 'content-type': 'application/json', 'user-agent': UA },
    }) as unknown as Parameters<typeof POST>[0])
    expect(res.status).toBe(204)
    expect(h.recorded).toEqual([])
  })

  it('⛔ records nothing for an oversized, malformed or meaningless body', async () => {
    await call('x'.repeat(2_000), { raw: true })
    await call('{not json', { raw: true })
    await call({ ...BEACON, v: 9 })
    await call({ v: 1, r: 'home', c: 'browser.phone.vi' }) // valid, but nothing to count
    expect(h.recorded).toEqual([])
  })

  it('⛔ an over-limit caller records nothing', async () => {
    h.allow = false
    expect((await call(BEACON)).status).toBe(204)
    expect(h.recorded).toEqual([])
  })
})
