import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/auth/apple/native (plan §7.7, §8): one attempt per nonce cookie; `next` sanitized; a token with no
 * nonce claim, a different nonce or a foreign audience never reaches GoTrue; the name is written with
 * updateUser BEFORE finishSignInPath; the code exchange is kept only for the same Apple ID; no token, code or
 * nonce in any log. (route.session.test.ts proves the Set-Cookie session carries the name, with the real
 * @supabase/ssr client.)
 */
const RAW = 'raw-nonce-0123456789abcdefghijklmnopqrstuvw'
const BUNDLE = 'vn.eno.app'
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

const h = vi.hoisted(() => ({
  jar: new Map<string, { value: string; options?: Record<string, unknown> }>(),
  events: [] as string[],
  logs: [] as string[],
  signIn: null as null | ((a: { provider: string; token: string; nonce: string }) => Promise<unknown>),
  updateUser: null as null | ((a: { data: Record<string, unknown> }) => Promise<unknown>),
  finishArgs: [] as Array<{ user: unknown; next: string }>,
  exchange: null as null | ((client: string, code: string) => Promise<unknown>),
  store: [] as Array<Record<string, unknown>>,
  marketplace: true,
}))
// The edition is a build-time constant; the getter lets one file test both (the aasa route.test.ts pattern).
vi.mock('@/lib/edition', async (orig) => ({
  ...(await orig<typeof import('@/lib/edition')>()),
  get IS_MARKETPLACE() { return h.marketplace },
}))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const c = h.jar.get(name)
      return c && c.value ? { name, value: c.value } : undefined
    },
    getAll: () => [...h.jar].filter(([, c]) => c.value).map(([name, c]) => ({ name, value: c.value })),
    set: (name: string, value: string, options?: Record<string, unknown>) => { h.jar.set(name, { value, options }) },
  }),
}))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.9' }))
vi.mock('@/lib/api/handler', async () => {
  const { NextResponse } = await import('next/server')
  return { apiFail: (code: string, status = 400) => NextResponse.json({ error: code }, { status }) }
})
vi.mock('@/lib/log', () => ({
  logWarn: (m: string, c?: unknown) => { h.logs.push(`${m} ${JSON.stringify(c ?? {})}`) },
  logError: (e: unknown, c?: unknown) => { h.logs.push(`${String(e)} ${JSON.stringify(c ?? {})}`) },
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({
    auth: {
      signInWithIdToken: (a: { provider: string; token: string; nonce: string }) => { h.events.push('sign-in'); return h.signIn!(a) },
      updateUser: (a: { data: Record<string, unknown> }) => { h.events.push('update-user'); return h.updateUser!(a) },
    },
  }),
}))
vi.mock('@/lib/auth-finish', () => ({
  finishSignInPath: async (user: unknown, next: string) => { h.events.push('finish'); h.finishArgs.push({ user, next }); return next === '/' ? '/onboard?next=%2F' : next },
}))
vi.mock('@/lib/auth/apple-siwa', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/apple-siwa')>()),
  exchangeCode: (client: string, code: string) => { h.events.push('exchange'); return h.exchange!(client, code) },
  storeAppleToken: async (i: Record<string, unknown>) => { h.events.push('store'); h.store.push(i); return 'stored' },
}))

const { POST } = await import('./route')

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const token = (claims: Record<string, unknown>) => `${b64({ alg: 'RS256', kid: 'k' })}.${b64(claims)}.c2lnbmF0dXJl`
const CLAIMS = { iss: 'https://appleid.apple.com', aud: BUNDLE, sub: '001.abc', nonce: sha(RAW), email: 'x@privaterelay.appleid.com' }
const USER = { id: 'u-1', user_metadata: {}, app_metadata: { provider: 'apple', providers: ['apple'] } }

const post = (body: Record<string, unknown>) =>
  POST(new Request('https://eno.vn/api/auth/apple/native', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://eno.vn' }, body: JSON.stringify(body) }))
const credential = (extra: Record<string, unknown> = {}) => ({
  identityToken: token(CLAIMS), authorizationCode: 'c.SECRETCODE', user: '001.abc', fullName: 'Jane Doe', givenName: 'Jane', familyName: 'Doe', next: '/listings/x', ...extra,
})

beforeEach(() => {
  h.jar.clear(); h.events = []; h.logs = []; h.finishArgs = []; h.store = []
  h.jar.set('eno_apple_nonce', { value: RAW })
  h.signIn = async () => ({ data: { user: USER, session: { access_token: 'at' } }, error: null })
  h.updateUser = async (a) => ({ data: { user: { ...USER, user_metadata: a.data } }, error: null })
  h.exchange = async () => ({ ok: true, refreshToken: 'r.SECRETREFRESH', sub: '001.abc' })
  h.marketplace = true
  vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', 'ios')
  vi.stubEnv('APPLE_SIWA_BUNDLE_ID', BUNDLE)
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
})
afterEach(() => vi.unstubAllEnvs())

describe('POST /api/auth/apple/native — the happy path', () => {
  it('raw nonce to GoTrue; name written BEFORE finishSignInPath; token kept for the bundle; { to }', async () => {
    const res = await post(credential())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ to: '/listings/x' })
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(h.events.slice(0, 3)).toEqual(['sign-in', 'update-user', 'finish'])
    expect(h.events).toContain('store')
    // the nonce cookie is spent
    expect(h.jar.get('eno_apple_nonce')).toEqual({ value: '', options: expect.objectContaining({ maxAge: 0, path: '/api/auth/apple', httpOnly: true, sameSite: 'strict' }) })
    expect(h.finishArgs[0].user).toMatchObject({ id: 'u-1', user_metadata: { full_name: 'Jane Doe', name: 'Jane Doe' } })
    expect(h.store).toEqual([{ userId: 'u-1', clientId: BUNDLE, appleSub: '001.abc', refreshToken: 'r.SECRETREFRESH' }])
  })

  it('hands GoTrue the RAW nonce and the token as sent', async () => {
    let seen: { provider: string; token: string; nonce: string } | null = null
    h.signIn = async (a) => { seen = a; return { data: { user: USER, session: {} }, error: null } }
    const c = credential()
    await post(c)
    expect(seen).toEqual({ provider: 'apple', token: c.identityToken, nonce: RAW })
  })

  it('the name is cleaned, built from the parts when there is no full name, and never overwrites one', async () => {
    let written: Record<string, unknown> | null = null
    h.updateUser = async (a) => { written = a.data; return { data: { user: { ...USER, user_metadata: a.data } }, error: null } }
    await post(credential({ fullName: null, givenName: 'Ann\u202E', familyName: 'Lee\n' }))
    expect(written).toEqual({ full_name: 'Ann Lee', name: 'Ann Lee' })
    h.events = []
    h.jar.set('eno_apple_nonce', { value: RAW })
    h.signIn = async () => ({ data: { user: { ...USER, user_metadata: { full_name: 'Kept Name' } }, session: {} }, error: null })
    await post(credential())
    expect(h.events).not.toContain('update-user')
    h.events = []
    h.jar.set('eno_apple_nonce', { value: RAW })
    h.signIn = async () => ({ data: { user: USER, session: {} }, error: null })
    await post(credential({ fullName: null, givenName: null, familyName: null })) // a returning user: Apple sends no name
    expect(h.events).not.toContain('update-user')
  })

  it('a failed name write still signs in, with the user GoTrue returned', async () => {
    h.updateUser = async () => ({ data: { user: null }, error: { status: 500 } })
    const res = await post(credential())
    expect(res.status).toBe(200)
    expect(h.finishArgs[0].user).toEqual(USER)
  })
})

describe('the refusals', () => {
  it('a missing nonce cookie — or one already spent — is 400 invalid_session, before GoTrue', async () => {
    h.jar.clear()
    const res = await post(credential())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_session' })
    h.jar.set('eno_apple_nonce', { value: RAW })
    expect((await post(credential())).status).toBe(200)
    expect((await post(credential())).status).toBe(400) // the same nonce, replayed
    expect(h.events.filter((e) => e === 'sign-in')).toHaveLength(1)
  })

  it('a token with no nonce claim, another nonce, a foreign audience or issuer is 400 invalid_token, before GoTrue', async () => {
    const { nonce: _n, ...noNonce } = CLAIMS
    for (const claims of [noNonce, { ...CLAIMS, nonce: sha('other') }, { ...CLAIMS, aud: 'com.attacker.app' }, { ...CLAIMS, aud: [BUNDLE, 'x'] }, { ...CLAIMS, iss: 'https://evil.example' }]) {
      h.jar.set('eno_apple_nonce', { value: RAW })
      const res = await post(credential({ identityToken: token(claims) }))
      expect(res.status, JSON.stringify(claims)).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid_token' })
    }
    h.jar.set('eno_apple_nonce', { value: RAW })
    expect((await post(credential({ identityToken: 'not.a-jwt-at-all-xxxxxxxx' }))).status).toBe(400)
    expect(h.events).not.toContain('sign-in')
  })

  it('a malformed body is 400 bad_request', async () => {
    expect((await post({ identityToken: 42 })).status).toBe(400)
    h.jar.set('eno_apple_nonce', { value: RAW })
    expect((await post({ ...credential(), fullName: 'x'.repeat(600) })).status).toBe(400)
  })

  it('GoTrue refusing is invalid_token; GoTrue unreachable is 502 failed', async () => {
    h.signIn = async () => ({ data: { user: null, session: null }, error: { status: 400, code: 'bad_jwt' } })
    expect((await post(credential())).status).toBe(400)
    h.jar.set('eno_apple_nonce', { value: RAW })
    h.signIn = async () => { throw new Error('fetch failed') }
    const res = await post(credential())
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'failed' })
  })

  it('503 not_configured without the bundle ID — and the nonce is still spent', async () => {
    vi.stubEnv('APPLE_SIWA_BUNDLE_ID', '')
    expect((await post(credential())).status).toBe(503)
    expect(h.jar.get('eno_apple_nonce')?.value).toBe('')
  })

  // ⛔ Commit gate round 2, C2: the bundle ID sits in BOTH editions' env, so it alone let anyone redeem an Apple identity
  // token here on eno.forum and through the dark deploy. Only `ios` in the flag, on eno.vn — else exactly as unconfigured.
  it.each([
    ['the flag empty (the dark deploy)', '', true],
    ['`web` alone', 'web', true],
    ['`web-test` alone', 'web-test', true],
    ['eno.forum, even with `ios,web`', 'ios,web', false],
  ])('503 not_configured — %s — the nonce spent, GoTrue never asked, nothing kept', async (_label, flag, marketplace) => {
    vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', flag)
    h.marketplace = marketplace
    const res = await post(credential())
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'not_configured' })
    expect(h.jar.get('eno_apple_nonce')?.value).toBe('')
    expect(h.events).toEqual([])
  })

  it('refuses a cross-origin POST in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const res = await POST(new Request('https://eno.vn/api/auth/apple/native', { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' }))
    expect(res.status).toBe(403)
  })
})

describe('next (A4)', () => {
  it('javascript:, //evil and https://evil all become /', async () => {
    for (const next of ['javascript:alert(1)', '//evil.example/x', 'https://evil.example/', '/\\evil.example']) {
      h.jar.set('eno_apple_nonce', { value: RAW })
      h.finishArgs = []
      await post(credential({ next }))
      expect(h.finishArgs[0].next, next).toBe('/')
    }
  })
})

describe('the token kept for revocation', () => {
  it('is NOT kept when Apple\'s id_token names another Apple ID, when the exchange fails, or with no code', async () => {
    h.exchange = async () => ({ ok: true, refreshToken: 'r', sub: '001.someone-else' })
    expect((await post(credential())).status).toBe(200)
    h.jar.set('eno_apple_nonce', { value: RAW })
    h.exchange = async () => ({ ok: false, error: 'invalid_grant' })
    expect((await post(credential())).status).toBe(200)
    h.jar.set('eno_apple_nonce', { value: RAW })
    h.events = []
    expect((await post(credential({ authorizationCode: null }))).status).toBe(200)
    expect(h.events).not.toContain('exchange')
    expect(h.store).toEqual([])
  })
  it('the exchange is asked for the BUNDLE ID with the code as sent', async () => {
    const seen: string[][] = []
    h.exchange = async (client, code) => { seen.push([client, code]); return { ok: true, refreshToken: 'r', sub: '001.abc' } }
    await post(credential())
    expect(seen).toEqual([[BUNDLE, 'c.SECRETCODE']])
  })
  it('an exchange that throws never fails the sign-in', async () => {
    h.exchange = async () => { throw new Error('boom') }
    expect((await post(credential())).status).toBe(200)
  })
  it('⛔ a keep that stalls never holds the answer: past 2.5 s the sign-in is answered (round 9)', async () => {
    vi.useFakeTimers()
    try {
      h.exchange = () => new Promise<never>(() => {})
      const pending = post(credential())
      await vi.advanceTimersByTimeAsync(2_600)
      const res = await pending
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ to: expect.any(String) })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('logs', () => {
  it('carry codes — never the token, the code or the nonce', async () => {
    h.exchange = async () => ({ ok: true, refreshToken: 'r.SECRETREFRESH', sub: '001.other' })
    await post(credential())
    h.jar.set('eno_apple_nonce', { value: RAW })
    await post(credential({ identityToken: token({ ...CLAIMS, aud: 'x' }) }))
    h.jar.set('eno_apple_nonce', { value: RAW })
    h.signIn = async () => { throw new Error('fetch failed') }
    await post(credential())
    const all = h.logs.join('\n')
    expect(h.logs.length).toBeGreaterThan(0)
    expect(all).not.toMatch(/SECRETCODE|SECRETREFRESH|c2lnbmF0dXJl/)
    expect(all).not.toContain(RAW)
    expect(all).not.toContain(sha(RAW))
  })
})
