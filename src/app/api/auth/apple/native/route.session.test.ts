import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * B1, end to end through the REAL @supabase/ssr server client: after the native route, the session cookie the
 * WebView receives already carries Apple's name — so /onboard (which prefills from the cookie's user) has it, and
 * the profile ensureProfile seeds from the same user does too. Only GoTrue's HTTP answers are faked.
 */
const RAW = 'raw-nonce-0123456789abcdefghijklmnopqrstuvw'
const SB = 'https://sbtest.example'
const h = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  gotrue: [] as Array<{ method: string; path: string; body: Record<string, unknown> | null }>,
  finishUser: null as unknown,
}))
// Native Apple is open only on eno.vn (C2) — the edition is a build-time constant, mocked here.
vi.mock('@/lib/edition', async (orig) => ({ ...(await orig<typeof import('@/lib/edition')>()), IS_MARKETPLACE: true }))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (h.jar.get(name) ? { name, value: h.jar.get(name)! } : undefined),
    getAll: () => [...h.jar].filter(([, v]) => v).map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => { h.jar.set(name, value) },
  }),
}))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.9' }))
vi.mock('@/lib/log', () => ({ logWarn: () => {}, logError: () => {} }))
vi.mock('@/lib/api/handler', async () => {
  const { NextResponse } = await import('next/server')
  return { apiFail: (code: string, status = 400) => NextResponse.json({ error: code }, { status }) }
})
vi.mock('@/lib/auth-finish', () => ({
  finishSignInPath: async (user: unknown, next: string) => { h.finishUser = user; return `/onboard?next=${encodeURIComponent(next)}` },
}))

const { POST } = await import('./route')

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const ID_TOKEN = `${b64({ alg: 'RS256' })}.${b64({ iss: 'https://appleid.apple.com', aud: 'vn.eno.app', sub: '001.abc', nonce: createHash('sha256').update(RAW).digest('hex') })}.sig`
const accessToken = `${b64({ alg: 'HS256' })}.${b64({ sub: 'u-1', exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })}.sig`
const baseUser = {
  id: 'u-1', aud: 'authenticated', role: 'authenticated', email: 'x@privaterelay.appleid.com',
  app_metadata: { provider: 'apple', providers: ['apple'] }, user_metadata: { iss: 'https://appleid.apple.com', sub: '001.abc' },
  identities: [{ id: '001.abc', identity_id: 'i-1', user_id: 'u-1', provider: 'apple', identity_data: { sub: '001.abc' } }],
  created_at: '2026-10-08T00:00:00Z',
}

/** The auth cookie(s) as the browser will hold them, decoded back to the session JSON. */
function sessionFromJar(): Record<string, unknown> | null {
  const names = [...h.jar.keys()].filter((n) => /^sb-.*-auth-token(\.\d+)?$/.test(n) && h.jar.get(n)).sort()
  if (!names.length) return null
  const joined = names.map((n) => h.jar.get(n)!).join('')
  const raw = joined.startsWith('base64-') ? Buffer.from(joined.slice(7), 'base64url').toString('utf8') : joined
  return JSON.parse(raw) as Record<string, unknown>
}

beforeEach(() => {
  h.jar.clear(); h.gotrue = []; h.finishUser = null
  h.jar.set('eno_apple_nonce', RAW)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SB)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
  vi.stubEnv('APPLE_SIWA_BUNDLE_ID', 'vn.eno.app')
  vi.stubEnv('NEXT_PUBLIC_APPLE_SIGNIN', 'ios')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    h.gotrue.push({ method: init?.method ?? 'GET', path: url.pathname + url.search, body })
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'id_token') {
      return json({ access_token: accessToken, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'rt-1', user: baseUser })
    }
    if (url.pathname === '/auth/v1/user' && init?.method === 'PUT') {
      return json({ ...baseUser, user_metadata: { ...baseUser.user_metadata, ...(body?.data as object) } })
    }
    return new Response('{}', { status: 404 })
  }))
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('the session cookie after native Sign in with Apple', () => {
  it('carries full_name, written with updateUser on the same client', async () => {
    const res = await POST(new Request('https://eno.vn/api/auth/apple/native', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://eno.vn' },
      body: JSON.stringify({ identityToken: ID_TOKEN, fullName: 'Jane Doe', next: '/listings/x' }),
    }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ to: '/onboard?next=%2Flistings%2Fx' })
    // GoTrue saw the id_token grant with the RAW nonce, then the name write.
    expect(h.gotrue.map((g) => `${g.method} ${g.path}`)).toEqual(['POST /auth/v1/token?grant_type=id_token', 'PUT /auth/v1/user'])
    expect(h.gotrue[0].body).toMatchObject({ provider: 'apple', id_token: ID_TOKEN, nonce: RAW })
    expect(h.gotrue[1].body).toMatchObject({ data: { full_name: 'Jane Doe', name: 'Jane Doe' } })
    const session = sessionFromJar()
    expect(session).not.toBeNull()
    expect((session!.user as { user_metadata: Record<string, unknown> }).user_metadata.full_name).toBe('Jane Doe')
    expect(session!.refresh_token).toBe('rt-1')
    // …and the profile is provisioned from that same user.
    expect((h.finishUser as { user_metadata: Record<string, unknown> }).user_metadata.full_name).toBe('Jane Doe')
  })
})
