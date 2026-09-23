import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/consent — the record of consent (Decree 356/2025 Art 6(2)).
 *
 * ⛔ WHAT MUST HOLD: one append-only audit row per valid choice, carrying the purposes, versions,
 * surface, edition, locale and the optional profile id — and NOTHING written for a malformed body, a
 * body its own consent cookie does not back, an over-limit caller, or ANY run that is not the live
 * site (a local preview is a production build wired to the production database), because a junk
 * row in that log can never be deleted. Always a bodyless 204.
 */

const h = vi.hoisted(() => ({
  audits: [] as Record<string, unknown>[],
  profileId: null as string | null,
  limits: [] as Array<{ name: string; key: string; limit: number }>,
  /** Limiter names that refuse outright; every other limit COUNTS, like the real one. */
  deny: new Set<string>(),
  counts: new Map<string, number>(),
  auditThrows: false,
  /** Everything that happened inside the transaction, in order. */
  txLog: [] as string[],
  txOptions: [] as unknown[],
  profileLookups: 0,
}))

vi.mock('@/lib/admin', () => ({ getCurrentProfileId: async () => { h.profileLookups++; return h.profileId } }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async (name: string, key: string, limit: number) => {
    h.limits.push({ name, key, limit })
    const k = `${name}|${key}`
    const n = (h.counts.get(k) ?? 0) + 1
    h.counts.set(k, n)
    return { success: !h.deny.has(name) && n <= limit }
  },
}))
vi.mock('@/lib/compliance/audit', () => ({
  appendAudit: async (_tx: unknown, input: Record<string, unknown>) => {
    h.txLog.push('appendAudit')
    if (h.auditThrows) throw new Error('db down')
    h.audits.push(input)
  },
}))
vi.mock('@/lib/db', () => ({
  db: {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>, opts?: unknown) => {
      h.txOptions.push(opts)
      const tx = {
        $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
          h.txLog.push(`sql:${strings.join('?')}|${values.join(',')}`)
          return 1
        },
      }
      return fn(tx)
    },
  },
}))
vi.mock('@/lib/log', () => ({ logError: () => {} }))

const { POST } = await import('./route')

const CID = 'c0ffee00-1234-4abc-8def-001122334455'
const TS = Math.floor(Date.now() / 1000) - 2
const valid = { cid: CID, p: true, a: false, d: true, v: 2, copy: '2026-09-23', surface: 'banner', action: 'save', locale: 'vi', ts: TS }
/** The cookie setConsent() writes before the beacon leaves — `bits` = p a d. */
const cookieOf = (bits = '101', cid = CID, ts = TS) => `eno-consent-v2=v2.${bits}.${ts}.${cid}`

const call = (body: unknown, { raw = false, ua = 'Mozilla/5.0 (Macintosh)', type = 'application/json', cookie = cookieOf() as string | null, host = 'eno.vn', ip = '203.0.113.7' } = {}) =>
  POST(new Request(`https://${host}/api/consent`, {
    method: 'POST',
    body: raw ? (body as string) : JSON.stringify(body),
    headers: { host, 'content-type': type, 'user-agent': ua, 'cf-connecting-ip': ip, ...(cookie ? { cookie } : {}) },
  }))

beforeEach(() => {
  // The live site: a production build answering on a real eno host. Tests that need anything else say so.
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('EDGE_SECRET', '')
  h.audits = []
  h.profileId = null
  h.limits = []
  h.deny = new Set()
  h.counts = new Map()
  h.auditThrows = false
  h.txLog = []
  h.txOptions = []
  h.profileLookups = 0
})
afterEach(() => { vi.unstubAllEnvs() })

describe('POST /api/consent', () => {
  it('writes ONE audit row with the choice, and answers a bodyless, uncacheable 204', async () => {
    h.profileId = 'profile-1'
    const r = await call(valid)
    expect(r.status).toBe(204)
    expect(await r.text()).toBe('')
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(h.audits).toEqual([{
      actorType: 'user',
      actorId: 'profile-1',
      actorIp: null, // ⚠️ deliberately no IP
      action: 'consent.recorded',
      subjectType: 'consent',
      subjectId: CID,
      detail: {
        p: true, a: false, d: true, version: 2, copyVersion: '2026-09-23', surface: 'banner', action: 'save',
        edition: expect.stringMatching(/^(marketplace|services)$/), locale: 'vi', native: false, clientTs: TS,
      },
    }])
  })

  it('a guest is recorded without a profile id', async () => {
    await call(valid)
    expect(h.audits[0].actorId).toBeNull()
  })

  it('accepts a beacon that arrives as text/plain', async () => {
    await call(valid, { type: 'text/plain;charset=UTF-8' })
    expect(h.audits).toHaveLength(1)
  })

  it('⛔ inside the native app the record carries the EFFECTIVE purposes — analytics/ads never ran there', async () => {
    await call({ ...valid, a: true, d: true }, { ua: 'Mozilla/5.0 (iPhone) EnoNativeApp/1', cookie: cookieOf('111') })
    expect(h.audits[0].detail).toMatchObject({ p: true, a: false, d: false, native: true })
  })

  it.each([
    ['malformed JSON', '{nope', true],
    ['a bad consent id', { ...valid, cid: 'x;y' }, false],
    ['a v1 version', { ...valid, v: 1 }, false],
    ['a non-boolean flag', { ...valid, a: 'yes' }, false],
    ['an unknown surface', { ...valid, surface: 'popup' }, false],
    ['an unknown action', { ...valid, action: 'accept' }, false],
    ['a copy version with odd characters', { ...valid, copy: '<script>' }, false],
  ])('⛔ writes NOTHING for %s (still 204)', async (_l, body, raw) => {
    const r = await call(body, { raw })
    expect(r.status).toBe(204)
    expect(h.audits).toEqual([])
  })

  it.each([
    ['no consent cookie at all', { cookie: null }],
    ['a cookie with a different consent id', { cookie: cookieOf('101', 'ffffffff-1234-4abc-8def-001122334455') }],
    ['a cookie whose purposes differ from the body', { cookie: cookieOf('111') }],
    ['an expired cookie', { cookie: cookieOf('101', CID, TS - 400 * 24 * 3600) }],
    ['a v1 cookie only', { cookie: 'eno-consent=all; eno-cookie-consent=all' }],
  ])('⛔ writes NOTHING for a body its own cookie does not back: %s', async (_l, opts) => {
    const r = await call(valid, opts)
    expect(r.status).toBe(204)
    expect(h.audits).toEqual([])
  })

  it('an unknown locale is recorded as "other", never echoed', async () => {
    await call({ ...valid, locale: 'xx' })
    expect((h.audits[0].detail as Record<string, unknown>).locale).toBe('other')
  })

  it('the limits: 120/h per IP + consent id, a coarse 1,000/h per IP, 20,000/h overall', async () => {
    await call(valid)
    expect(h.audits).toHaveLength(1)
    expect(h.limits).toEqual([
      // ⛔ Keyed on the PAIR: visitors behind one carrier-NAT address no longer share one budget.
      { name: 'consent-record', key: `203.0.113.7|${CID}`, limit: 120 },
      { name: 'consent-record-ip', key: '203.0.113.7', limit: 1_000 },
      { name: 'consent-record-global', key: 'all', limit: 20_000 },
    ])
  })

  it('⛔ carrier NAT: 40 visitors behind ONE address are all recorded (an IP-only 30/h dropped the last 10)', async () => {
    for (let i = 0; i < 40; i++) {
      const cid = `c0ffee00-1234-4abc-8def-${String(i).padStart(12, '0')}`
      await call({ ...valid, cid }, { cookie: cookieOf('101', cid) })
    }
    expect(h.audits).toHaveLength(40)
  })

  it('one browser is capped at 120 records an hour; a script minting consent ids per request, at 1,000 per IP', async () => {
    for (let i = 0; i < 125; i++) await call(valid)
    expect(h.audits).toHaveLength(120)
    h.audits = []
    h.counts = new Map()
    for (let i = 0; i < 1_005; i++) {
      const cid = `c0ffee00-1234-4abc-8def-${String(i).padStart(12, '0')}`
      await call({ ...valid, cid }, { cookie: cookieOf('101', cid) })
    }
    expect(h.audits).toHaveLength(1_000)
  })

  it.each(['consent-record', 'consent-record-ip', 'consent-record-global'])('⛔ over the %s limit nothing is written', async (name) => {
    h.deny = new Set([name])
    const r = await call(valid)
    expect(r.status).toBe(204)
    expect(h.audits).toEqual([])
  })

  it('a failed write is swallowed (the choice is already stored on the device)', async () => {
    h.auditThrows = true
    const r = await call(valid)
    expect(r.status).toBe(204)
  })

  it('⛔ a consent append waits a BOUNDED time for the log’s shared lock, set before the append', async () => {
    await call(valid)
    // lock_timeout, transaction-local, BEFORE appendAudit takes pg_advisory_xact_lock — so a surge
    // of visitor beacons cannot queue held pool connections in front of a KYC or erasure write.
    expect(h.txLog).toEqual([`sql:SELECT set_config('lock_timeout', ?, true)|1000ms`, 'appendAudit'])
    expect(h.txOptions).toEqual([{ maxWait: 1_000 }])
  })
})

describe('⛔ POST /api/consent writes ONLY on the live site', () => {
  it.each([
    ['development (npm run dev:vn)', 'development'],
    ['a test run', 'test'],
  ])('%s: nothing written, and the database is not touched at all', async (_l, env) => {
    vi.stubEnv('NODE_ENV', env)
    const r = await call(valid)
    expect(r.status).toBe(204)
    expect(h.audits).toEqual([])
    expect(h.limits).toEqual([]) // the rate limiter lives in the same database
    expect(h.profileLookups).toBe(0)
  })

  it.each([
    'localhost:3000', // npm run preview:vn — a PRODUCTION build on the tunnel to the production DB
    '127.0.0.1:3101',
    '192.168.1.20:3000',
    'eno.vn.evil.com',
    'evil-eno.vn',
    'eno.vnx',
    'a.b.eno.vn', // storefronts are exactly one label deep
    'shop.eno.forum.evil.com',
  ])('a production build answering on %s: nothing written, the database not touched', async (host) => {
    const r = await call(valid, { host })
    expect(r.status).toBe(204)
    expect(h.audits).toEqual([])
    expect(h.limits).toEqual([])
  })

  it('no Host header at all: nothing written', async () => {
    const r = await POST(new Request('https://eno.vn/api/consent', {
      method: 'POST',
      body: JSON.stringify(valid),
      headers: { 'content-type': 'application/json', cookie: cookieOf() },
    }))
    expect(r.status).toBe(204)
    expect(h.audits).toEqual([])
  })

  it.each(['eno.vn', 'www.eno.vn', 'eno.forum', 'www.eno.forum', 'gmbr.eno.vn', 'ENO.VN', 'eno.vn:443'])('the live host %s IS recorded', async (host) => {
    await call(valid, { host })
    expect(h.audits).toHaveLength(1)
  })
})
