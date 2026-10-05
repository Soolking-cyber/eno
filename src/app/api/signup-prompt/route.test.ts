import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/signup-prompt — the "Join eno" prompt's anonymous daily totals.
 *
 * ⛔ WHAT MUST HOLD: one +1 on `signup-prompt:<Vietnam day>:<edition>:<event>` for a known event from
 * the live site — and NOTHING read or written for an unknown event, a malformed or oversized body, a
 * cross-origin or crawler caller, an over-limit caller, or ANY run that is not the live site (a local
 * preview is a production build wired to the production database). Nothing about the caller reaches
 * the counter. Always a bodyless 204.
 */

const h = vi.hoisted(() => ({
  incr: [] as Array<{ key: string; by: number; ttl?: number }>,
  limits: [] as Array<{ name: string; key: string; limit: number }>,
  deny: false,
  incrThrows: false,
  logged: [] as unknown[],
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async (name: string, key: string, limit: number) => {
    h.limits.push({ name, key, limit })
    return { success: !h.deny }
  },
  kv: {
    incrby: async (key: string, by: number, ttl?: number) => {
      if (h.incrThrows) throw new Error('db down')
      h.incr.push({ key, by, ttl })
      return 1
    },
  },
}))
vi.mock('@/lib/log', () => ({ logError: (e: unknown) => { h.logged.push(e) } }))

const { POST } = await import('./route')
const { EDITION } = await import('@/lib/edition')
const { vnDay, SIGNUP_PROMPT_EVENTS } = await import('@/lib/signup-prompt')

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
const call = (body: unknown, { raw = false, host = 'eno.vn', origin = 'https://eno.vn' as string | null, ua = UA } = {}) =>
  POST(new Request(`https://${host}/api/signup-prompt`, {
    method: 'POST',
    body: raw ? (body as string) : JSON.stringify(body),
    headers: { host, 'content-type': 'application/json', 'user-agent': ua, 'cf-connecting-ip': '203.0.113.7', ...(origin ? { origin } : {}) },
  }) as unknown as Parameters<typeof POST>[0])

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production')
  h.incr = []
  h.limits = []
  h.deny = false
  h.incrThrows = false
  h.logged = []
})

describe('POST /api/signup-prompt', () => {
  it('⛔ every one of the seven events adds one to today’s total for this edition — the key holds nothing about the caller', async () => {
    for (const e of SIGNUP_PROMPT_EVENTS) {
      const res = await call({ e })
      expect(res.status).toBe(204)
      expect(await res.text()).toBe('')
    }
    const day = vnDay(Date.now())
    // A client that sends no context class (an old tab, before UX3 J1) is counted as "unknown".
    expect(h.incr.map((i) => i.key)).toEqual(SIGNUP_PROMPT_EVENTS.map((e) => `signup-prompt:${day}:${EDITION}:${e}:unknown`))
    for (const i of h.incr) {
      expect(i.by).toBe(1)
      expect(i.ttl).toBeGreaterThan(365 * 24 * 60 * 60)
      expect(i.key).not.toContain('203.0.113.7')
    }
  })

  it('⛔ UX3 J1: the coarse context class rides the key — only one of the 24 fixed classes, anything else is "unknown"', async () => {
    await call({ e: 'shown', c: 'inapp-zalo.phone.vi' })
    await call({ e: 'left_open', c: 'Mozilla/5.0 (iPhone) Zalo 25.1' })
    await call({ e: 'shown', c: { evil: true } })
    const day = vnDay(Date.now())
    expect(h.incr.map((i) => i.key)).toEqual([
      `signup-prompt:${day}:${EDITION}:shown:inapp-zalo.phone.vi`,
      `signup-prompt:${day}:${EDITION}:left_open:unknown`,
      `signup-prompt:${day}:${EDITION}:shown:unknown`,
    ])
  })

  it('⛔ UX3 J1: a sign-in gate action adds one to that gate’s total; the timed prompt and unknown gates/actions are dropped', async () => {
    await call({ g: 'save_search', a: 'open', c: 'browser.phone.vi' })
    await call({ g: 'chat', a: 'completed' })
    await call({ g: 'timed', a: 'open' })
    await call({ g: 'checkout', a: 'open' })
    await call({ g: 'chat', a: 'shown' })
    const day = vnDay(Date.now())
    expect(h.incr.map((i) => i.key)).toEqual([
      `signin-gate:${day}:${EDITION}:save_search:open:browser.phone.vi`,
      `signin-gate:${day}:${EDITION}:chat:completed:unknown`,
    ])
    for (const i of h.incr) expect(i.key).not.toContain('203.0.113.7')
  })

  it('⛔ a local preview (not the live host) or a dev build writes nothing — not even the limiter', async () => {
    await call({ e: 'shown' }, { host: 'localhost:3000', origin: 'http://localhost:3000' })
    vi.stubEnv('NODE_ENV', 'development')
    await call({ e: 'shown' })
    expect(h.incr).toEqual([])
    expect(h.limits).toEqual([])
  })

  it('unknown events, junk and oversized bodies are dropped', async () => {
    for (const body of [{ e: 'hacked' }, { e: '__proto__' }, { e: 1 }, {}, null]) await call(body)
    await call('not json', { raw: true })
    await call(JSON.stringify({ e: 'shown', pad: 'x'.repeat(400) }), { raw: true })
    expect(h.incr).toEqual([])
  })

  it('cross-origin and crawler callers are dropped; a same-origin call without an Origin header counts', async () => {
    await call({ e: 'shown' }, { origin: 'https://evil.example' })
    await call({ e: 'shown' }, { ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' })
    expect(h.incr).toEqual([])
    await call({ e: 'shown' }, { origin: null })
    expect(h.incr).toHaveLength(1)
  })

  it('over the per-IP limit: nothing counted', async () => {
    h.deny = true
    await call({ e: 'dismissed' })
    expect(h.limits[0]).toMatchObject({ name: 'signup-prompt', limit: 60 })
    expect(h.incr).toEqual([])
  })

  it('a database fault is logged and the caller still gets its 204', async () => {
    h.incrThrows = true
    const res = await call({ e: 'google_click' })
    expect(res.status).toBe(204)
    expect(h.logged).toHaveLength(1)
  })
})
