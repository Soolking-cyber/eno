import { NextResponse } from 'next/server'
import { RequestCookies, ResponseCookies } from 'next/dist/compiled/@edge-runtime/cookies'
import { MutableRequestCookiesAdapter, appendMutableCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE STRIP, MEASURED THROUGH THE REAL CLIENT (commit gate round 11, opus): route.test.ts mocks Supabase whole, so it
 * cannot see what the BROWSER ends up holding. Here only GoTrue's HTTP answers are faked: @supabase/ssr 0.12 writes the
 * cookies, and `cookies()` is Next's own route-handler store (MutableRequestCookiesAdapter — reads see this request's
 * writes), turned into Set-Cookie exactly as Next does (appendMutableCookies). The question: after a web Apple sign-in,
 * does any cookie the browser keeps still carry Apple's tokens, and is the session left readable?
 */
const SB = 'https://sbtest.example'
const APPLE_RT = 'r.APPLE-REFRESH-SECRET'
const APPLE_AT = 'a.APPLE-ACCESS-SECRET'
const h = vi.hoisted(() => ({
  store: null as unknown,
  user: null as Record<string, unknown> | null,
  providerPad: 0,
  stored: [] as Array<Record<string, unknown>>,
}))
vi.mock('next/headers', () => ({ cookies: async () => h.store }))
vi.mock('@/lib/auth-finish', () => ({
  authRedirect: (to: string) => NextResponse.redirect(to),
  finishSignIn: async (_u: unknown, origin: string, next: string) => NextResponse.redirect(`${origin}${next}`),
}))
vi.mock('@/lib/auth/apple-siwa', () => ({
  appleServicesId: () => 'vn.eno.web',
  appleOnOffer: () => true,
  pkceCodeProvider: async () => ({ provider: 'apple', userId: null }),
  storeAppleToken: async (i: Record<string, unknown>) => { h.stored.push(i); return 'stored' },
}))

const { GET } = await import('./route')
const { createSupabaseServer } = await import('@/lib/supabase/server')

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const accessToken = `${b64({ alg: 'HS256' })}.${b64({ sub: 'u-1', exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated', aud: 'authenticated' })}.sig`
const appleUser = (metaPad: number) => ({
  id: 'u-1', aud: 'authenticated', role: 'authenticated', email: 'x@privaterelay.appleid.com',
  app_metadata: { provider: 'apple', providers: ['apple'] },
  user_metadata: { iss: 'https://appleid.apple.com', sub: '001.abc', email: 'x@privaterelay.appleid.com', full_name: 'An Apple User', pad: 'm'.repeat(metaPad) },
  identities: [{ id: '001.abc', identity_id: 'i-1', user_id: 'u-1', provider: 'apple', identity_data: { sub: '001.abc', email: 'x@privaterelay.appleid.com' } }],
  created_at: '2026-10-09T00:00:00Z',
})

/** A browser's jar: name → value. */
type Jar = Map<string, string>
/** Next's route-handler cookie store over this request's Cookie header. */
const storeFor = (jar: Jar) => {
  const headers = new Headers()
  if (jar.size) headers.set('cookie', [...jar].map(([n, v]) => `${n}=${v}`).join('; '))
  return MutableRequestCookiesAdapter.wrap(new RequestCookies(headers))
}
/** What the browser holds after the response: Next's Set-Cookie list (the route's own cookies win) applied to the jar. */
function applyResponse(jar: Jar, res: Response | null): Jar {
  const out = new Headers(res?.headers)
  appendMutableCookies(out, h.store as ReturnType<typeof storeFor>)
  const next = new Map(jar)
  for (const c of new ResponseCookies(out).getAll()) {
    const expired = c.maxAge === 0 || (c.expires !== undefined && new Date(c.expires).getTime() <= Date.now())
    // A removal parses back with NO value (`name=; Max-Age=0` → value undefined in @edge-runtime/cookies).
    if (expired || !c.value) next.delete(c.name)
    else next.set(c.name, c.value)
  }
  return next
}
const decode = (v: string) => (v.startsWith('base64-') ? Buffer.from(v.slice(7), 'base64url').toString('utf8') : v)
/** The session as @supabase/ssr's combineChunks reads it: the bare key first, else .0, .1, … until one is missing. */
function sessionIn(jar: Jar): Record<string, unknown> | null {
  const key = [...jar.keys()].find((n) => /^sb-[^.]*-auth-token$/.test(n))
    ?? [...jar.keys()].find((n) => /^sb-[^.]*-auth-token\.0$/.test(n))?.replace(/\.0$/, '')
  if (!key) return null
  let raw = jar.get(key)
  if (!raw) {
    const parts: string[] = []
    for (let i = 0; jar.has(`${key}.${i}`); i++) parts.push(jar.get(`${key}.${i}`)!)
    raw = parts.join('')
  }
  return JSON.parse(decode(raw)) as Record<string, unknown>
}
/** Every auth cookie's value, each decoded alone AND the session's chunks joined — a secret split across two still shows. */
function everythingTheBrowserCanRead(jar: Jar): string {
  const auth = [...jar].filter(([n]) => n.startsWith('sb-')).sort(([a], [b]) => a.localeCompare(b))
  const chunks = auth.filter(([n]) => /^sb-[^.]*-auth-token\.\d+$/.test(n)).map(([, v]) => v)
  const joined = chunks.join('')
  return [...auth.map(([, v]) => decode(v)), joined ? decode(joined) : ''].join('\n')
}

/** Start the PKCE flow the real way (the verifier lands in the jar), then come back through /auth/callback. */
async function appleSignIn(jar: Jar): Promise<{ jar: Jar; res: Response }> {
  h.store = storeFor(jar)
  const sb = await createSupabaseServer()
  const { error } = await sb.auth.signInWithOAuth({ provider: 'apple', options: { redirectTo: 'https://eno.vn/auth/callback?p=apple&next=%2Fx', skipBrowserRedirect: true } })
  expect(error).toBeNull()
  const started = applyResponse(jar, null)
  h.store = storeFor(started)
  const res = await GET(new Request('https://eno.vn/auth/callback?code=c-1&p=apple&next=%2Fx'))
  return { jar: applyResponse(started, res), res }
}

beforeEach(() => {
  h.store = null; h.user = appleUser(0); h.providerPad = 0; h.stored = []
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SB)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'pkce') {
      return json({
        access_token: accessToken, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'rt-1', provider_token: APPLE_AT + 'p'.repeat(h.providerPad), provider_refresh_token: APPLE_RT + 'q'.repeat(h.providerPad), user: h.user,
      })
    }
    if (url.pathname === '/auth/v1/user' && (init?.method ?? 'GET') === 'GET') return json(h.user)
    return new Response('{}', { status: 404 })
  }))
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('/auth/callback — Apple\'s tokens leave the browser\'s cookies, the session stays readable (real client)', () => {
  it('a typical Apple account: kept server-side, gone from every cookie, signed in', async () => {
    const { jar, res } = await appleSignIn(new Map())
    expect(res.headers.get('location')).toBe('https://eno.vn/x')
    expect(h.stored).toEqual([expect.objectContaining({ userId: 'u-1', clientId: 'vn.eno.web', appleSub: '001.abc', refreshToken: APPLE_RT })])
    const session = sessionIn(jar)
    expect(session).toMatchObject({ access_token: accessToken, refresh_token: 'rt-1', user: { id: 'u-1' } })
    expect(session).not.toHaveProperty('provider_token')
    expect(session).not.toHaveProperty('provider_refresh_token')
    const all = everythingTheBrowserCanRead(jar)
    expect(all).not.toContain('APPLE-REFRESH-SECRET')
    expect(all).not.toContain('APPLE-ACCESS-SECRET')
  })

  it.each([
    ['the strip drops a chunk (big provider tokens)', 0, 2_500],
    ['a big profile, chunked both before and after', 5_000, 0],
    ['both', 5_000, 2_500],
  ])('%s: no stale chunk survives, the session decodes', async (_label, metaPad, providerPad) => {
    h.user = appleUser(metaPad)
    h.providerPad = providerPad
    const { jar } = await appleSignIn(new Map())
    const session = sessionIn(jar)
    expect(session).toMatchObject({ refresh_token: 'rt-1', user: { id: 'u-1' } })
    expect(session).not.toHaveProperty('provider_refresh_token')
    expect(everythingTheBrowserCanRead(jar)).not.toContain('APPLE-REFRESH-SECRET')
    // Chunks are contiguous from .0 and nothing sits beside the bare key: combineChunks reads exactly the new session.
    const names = [...jar.keys()].filter((n) => /^sb-[^.]*-auth-token(\.\d+)?$/.test(n)).sort()
    const bare = names.filter((n) => !/\.\d+$/.test(n))
    if (bare.length) expect(names).toEqual(bare)
    else expect(names.map((n) => Number(n.split('.').pop()))).toEqual(names.map((_, i) => i))
  })

  it('an older, longer session already in the jar is replaced whole', async () => {
    h.user = appleUser(9_000)
    h.providerPad = 2_500
    const first = await appleSignIn(new Map())
    h.user = appleUser(0)
    h.providerPad = 0
    const { jar } = await appleSignIn(first.jar)
    expect(sessionIn(jar)).toMatchObject({ user: { id: 'u-1', user_metadata: { pad: '' } } })
    expect(everythingTheBrowserCanRead(jar)).not.toContain('APPLE-REFRESH-SECRET')
    expect([...jar.keys()].filter((n) => /^sb-[^.]*-auth-token\.\d+$/.test(n))).toEqual([])
  })
})
