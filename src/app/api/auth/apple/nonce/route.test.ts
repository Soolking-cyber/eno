import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// POST /api/auth/apple/nonce (plan §7.7, §8): the raw nonce only ever travels in an HttpOnly, Secure,
// SameSite=Strict cookie scoped to /api/auth/apple for 10 minutes; the app is handed sha256(raw) in hex.
const h = vi.hoisted(() => ({ limited: false, marketplace: true }))
vi.mock('@/lib/db', () => ({ db: {} }))
// The edition is a build-time constant; the getter lets one file test both (the aasa route.test.ts pattern).
vi.mock('@/lib/edition', async (orig) => ({
  ...(await orig<typeof import('@/lib/edition')>()),
  get IS_MARKETPLACE() { return h.marketplace },
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: !h.limited }) }))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.9' }))
vi.mock('@/lib/api/handler', async () => {
  const { NextResponse } = await import('next/server')
  return { apiFail: (code: string, status = 400) => NextResponse.json({ error: code }, { status }) }
})

const { POST } = await import('./route')
const post = (origin: string | null = 'https://eno.vn') =>
  POST(new Request('https://eno.vn/api/auth/apple/nonce', { method: 'POST', headers: origin ? { origin } : {} }))

beforeEach(() => {
  h.limited = false
  h.marketplace = true
  vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', 'ios')
  vi.stubEnv('APPLE_SIWA_BUNDLE_ID', 'vn.eno.app')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
  vi.stubEnv('NODE_ENV', 'production')
})
afterEach(() => vi.unstubAllEnvs())

describe('POST /api/auth/apple/nonce', () => {
  it('sets the raw nonce in a locked-down cookie and answers its SHA-256 hex', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toContain('no-store')
    const { nonce } = (await res.json()) as { nonce: string }
    expect(nonce).toMatch(/^[0-9a-f]{64}$/)
    const raw = res.cookies.get('eno_apple_nonce')?.value
    expect(raw).toMatch(/^[\w-]{43}$/) // 32 bytes, base64url
    expect(createHash('sha256').update(raw!).digest('hex')).toBe(nonce)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toMatch(/eno_apple_nonce=/)
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/Secure/i)
    expect(setCookie).toMatch(/SameSite=strict/i)
    expect(setCookie).toMatch(/Path=\/api\/auth\/apple(;|$)/)
    expect(setCookie).toMatch(/Max-Age=600/)
  })

  it('a fresh nonce every time', async () => {
    const a = (await (await post()).json()) as { nonce: string }
    const b = (await (await post()).json()) as { nonce: string }
    expect(a.nonce).not.toBe(b.nonce)
  })

  it('refuses a cross-origin or origin-less POST in production, before the limiter', async () => {
    h.limited = true
    expect((await post('https://evil.example')).status).toBe(403)
    expect((await post(null)).status).toBe(403)
  })

  it('429 over the per-IP limit; 503 when Apple is not configured here — and no cookie either way', async () => {
    h.limited = true
    const limited = await post()
    expect(limited.status).toBe(429)
    expect(limited.cookies.get('eno_apple_nonce')).toBeUndefined()
    h.limited = false
    vi.stubEnv('APPLE_SIWA_BUNDLE_ID', '')
    const off = await post()
    expect(off.status).toBe(503)
    expect(await off.json()).toEqual({ error: 'not_configured' })
    expect(off.cookies.get('eno_apple_nonce')).toBeUndefined()
  })

  // ⛔ Commit gate round 2, C2: the bundle ID sits in BOTH editions' env, so it alone opened this route on eno.forum and
  // through the dark deploy. It answers only where the iOS app can show the button: `ios` in the flag, on eno.vn.
  it.each([
    ['the flag empty (the dark deploy)', '', true],
    ['`web` alone', 'web', true],
    ['`web-test` alone', 'web-test', true],
    ['eno.forum, even with `ios,web`', 'ios,web', false],
  ])('503 not_configured — %s — exactly as unconfigured, and no cookie', async (_label, flag, marketplace) => {
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', flag)
    h.marketplace = marketplace
    const res = await post()
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'not_configured' })
    expect(res.cookies.get('eno_apple_nonce')).toBeUndefined()
  })

  it('`ios` among other tokens on eno.vn: open', async () => {
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', 'ios,web-test')
    expect((await post()).status).toBe(200)
  })
})
