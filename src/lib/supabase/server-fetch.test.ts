import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * src/lib/supabase/server-fetch.ts — the server-side Supabase clients' fetch (speed plan item 6).
 *
 * What these pin: the switch is off unless the runtime flag says 'true'; only four method+path pairs on the EXACT public
 * origin move to the gateway, query intact, init passed through by identity; everything else — the guarded OAuth starts,
 * mailed-link endpoints, admin, storage, rest, look-alike hosts, Request objects — goes out exactly as before; the one
 * fallback fires only for a connection that never opened and a body that can be re-sent. And, through the REAL
 * @supabase/ssr + supabase-js: getUser() on a cookie session lands on the gateway while the cookie keeps its name.
 */

const cookieJar = vi.hoisted(() => ({ cookies: [] as { name: string; value: string }[] }))
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => cookieJar.cookies, set: () => {} }),
  headers: async () => new Headers(),
}))

const PUBLIC = 'https://sb.eno.vn'
const INTERNAL = 'http://supabase-envoy:8000'

const { internalSupabaseUrl, supabaseServerFetch, SUPABASE_INTERNAL_ORIGIN, setInternalSupabaseTimeoutsForTests } = await import('./server-fetch')

const fetchMock = vi.fn(async (..._args: unknown[]) => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', PUBLIC)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test_only')
  vi.stubEnv('SUPABASE_INTERNAL_FETCH', 'true')
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  setInternalSupabaseTimeoutsForTests()
})

describe('which calls move to the gateway', () => {
  it('is the same fixed target as the listing-images route', () => {
    expect(SUPABASE_INTERNAL_ORIGIN).toBe(INTERNAL)
  })

  it.each([
    ['GET', `${PUBLIC}/auth/v1/user`, `${INTERNAL}/auth/v1/user`],
    ['POST', `${PUBLIC}/auth/v1/token?grant_type=refresh_token`, `${INTERNAL}/auth/v1/token?grant_type=refresh_token`],
    ['POST', `${PUBLIC}/auth/v1/token?grant_type=pkce`, `${INTERNAL}/auth/v1/token?grant_type=pkce`],
    ['POST', `${PUBLIC}/auth/v1/token?grant_type=refresh_token&x=1`, `${INTERNAL}/auth/v1/token?grant_type=refresh_token&x=1`],
    ['POST', `${PUBLIC}/auth/v1/logout?scope=global`, `${INTERNAL}/auth/v1/logout?scope=global`],
    ['GET', `${PUBLIC}/auth/v1/.well-known/jwks.json`, `${INTERNAL}/auth/v1/.well-known/jwks.json`],
    // The default port is the same origin.
    ['GET', `${PUBLIC}:443/auth/v1/user`, `${INTERNAL}/auth/v1/user`],
  ])('%s %s → %s', (method, input, expected) => {
    expect(internalSupabaseUrl(input, method)).toBe(expected)
    expect(internalSupabaseUrl(new URL(input), method)).toBe(expected)
  })

  it.each([
    // Guarded by nginx on the public route, or a mailed link GoTrue builds from the request — must keep the public route.
    ['GET', `${PUBLIC}/auth/v1/authorize?provider=google`],
    ['GET', `${PUBLIC}/auth/v1/user/identities/authorize?provider=linkedin_oidc`],
    ['PUT', `${PUBLIC}/auth/v1/user`],
    ['POST', `${PUBLIC}/auth/v1/verify`],
    ['GET', `${PUBLIC}/auth/v1/verify?token=x&type=signup`],
    ['POST', `${PUBLIC}/auth/v1/otp`],
    ['GET', `${PUBLIC}/auth/v1/callback`],
    ['GET', `${PUBLIC}/auth/v1/settings`],
    ['POST', `${PUBLIC}/auth/v1/admin/generate_link`],
    ['GET', `${PUBLIC}/auth/v1/admin/users/abc`],
    ['POST', `${PUBLIC}/storage/v1/object/listings/a.webp`],
    ['POST', `${PUBLIC}/storage/v1/object/sign/teacher-cvs/a.pdf`],
    ['GET', `${PUBLIC}/rest/v1/visa_applications?select=id`],
    ['GET', `${PUBLIC}/functions/v1/x`],
    // /token for any grant but refresh and PKCE (a server-side id_token or password sign-in), or an ambiguous query.
    ['POST', `${PUBLIC}/auth/v1/token?grant_type=id_token`],
    ['POST', `${PUBLIC}/auth/v1/token?grant_type=password`],
    ['POST', `${PUBLIC}/auth/v1/token`],
    ['POST', `${PUBLIC}/auth/v1/token?grant_type=refresh_token&grant_type=password`],
    ['POST', `${PUBLIC}/auth/v1/token?grant_type=REFRESH_TOKEN`],
    // The wrong method on a listed path, and paths that only LOOK listed.
    ['GET', `${PUBLIC}/auth/v1/token?grant_type=refresh_token`],
    ['POST', `${PUBLIC}/auth/v1/user`],
    ['GET', `${PUBLIC}/auth/v1/user/`],
    ['GET', `${PUBLIC}//auth/v1/user`],
    ['GET', `${PUBLIC}/auth/v1/user%2F`],
    ['GET', `${PUBLIC}/auth/v1/constructor`],
    ['GET', `${PUBLIC}/auth/v1/__proto__`],
    // Not the public origin: a look-alike host, another scheme, another port, another host entirely.
    ['GET', 'https://sb.eno.vn.evil.test/auth/v1/user'],
    ['GET', 'http://sb.eno.vn/auth/v1/user'],
    ['GET', 'https://sb.eno.vn:8443/auth/v1/user'],
    ['GET', 'https://eno.vn/auth/v1/user'],
    ['GET', 'not a url'],
  ])('%s %s stays public', (method, input) => {
    expect(internalSupabaseUrl(input, method)).toBeNull()
  })

  it('is off unless the runtime flag is exactly "true"', () => {
    for (const v of ['', '1', 'TRUE', 'yes']) {
      vi.stubEnv('SUPABASE_INTERNAL_FETCH', v)
      expect(internalSupabaseUrl(`${PUBLIC}/auth/v1/user`, 'GET')).toBeNull()
    }
  })

  it('leaves a Request object alone', () => {
    expect(internalSupabaseUrl(new Request(`${PUBLIC}/auth/v1/user`), 'GET')).toBeNull()
  })

  it('stays public when the public URL itself is missing', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    expect(internalSupabaseUrl(`${PUBLIC}/auth/v1/user`, 'GET')).toBeNull()
  })
})

describe('supabaseServerFetch', () => {
  it('sends a listed POST to the gateway with the SAME init object', async () => {
    const init = { method: 'POST', headers: { apikey: 'k', Authorization: 'Bearer t' }, body: '{"refresh_token":"r"}' }
    await supabaseServerFetch(`${PUBLIC}/auth/v1/token?grant_type=refresh_token`, init)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(`${INTERNAL}/auth/v1/token?grant_type=refresh_token`)
    expect(fetchMock.mock.calls[0][1]).toBe(init)
  })

  it('sends a listed GET with the same method and headers — plus its own capped signal', async () => {
    const headers = { apikey: 'k', Authorization: 'Bearer t' }
    await supabaseServerFetch(`${PUBLIC}/auth/v1/user`, { method: 'GET', headers })
    const sent = fetchMock.mock.calls[0][1] as RequestInit
    expect(fetchMock.mock.calls[0][0]).toBe(`${INTERNAL}/auth/v1/user`)
    expect(sent.method).toBe('GET')
    expect(sent.headers).toBe(headers)
    expect(sent.signal).toBeInstanceOf(AbortSignal)
  })

  /** A fetch that never answers on its own — it rejects only when its signal aborts, as undici does. */
  const hangs = (...args: unknown[]) => {
    const signal = (args[1] as RequestInit | undefined)?.signal
    return new Promise<Response>((_res, rej) => signal?.addEventListener('abort', () => rej(signal.reason), { once: true }))
  }

  it('a GET that the gateway accepts and never answers gives up at its own cap and takes the public route', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setInternalSupabaseTimeoutsForTests({ get: 20 })
    fetchMock.mockImplementationOnce(hangs)
    const res = await supabaseServerFetch(`${PUBLIC}/auth/v1/user`, { method: 'GET' })
    expect(res.status).toBe(200)
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([`${INTERNAL}/auth/v1/user`, `${PUBLIC}/auth/v1/user`])
    warn.mockRestore()
  })

  it('a POST gets no cap of ours — the same init, untouched, so a slow refresh is never cut short', async () => {
    setInternalSupabaseTimeoutsForTests({ get: 20 })
    const init = { method: 'POST', body: '{}' }
    await supabaseServerFetch(`${PUBLIC}/auth/v1/token?grant_type=refresh_token`, init)
    expect(fetchMock.mock.calls[0][1]).toBe(init)
  })

  it('every fallback is counted, logged at most once a minute with the latest reason', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (let i = 0; i < 3; i++) {
      fetchMock.mockRejectedValueOnce(refused('ECONNRESET'))
      await supabaseServerFetch(`${PUBLIC}/auth/v1/user`, { method: 'GET' })
    }
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1)
    warn.mockRestore()
  })

  it("the caller's own signal still reaches the internal call, and its abort is never retried", async () => {
    const ctrl = new AbortController()
    fetchMock.mockImplementationOnce(hangs)
    const pending = supabaseServerFetch(`${PUBLIC}/auth/v1/user`, { method: 'GET', signal: ctrl.signal })
    ctrl.abort()
    await expect(pending).rejects.toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('passes anything else through untouched — input and init', async () => {
    const init = { method: 'PUT', body: '{}' }
    const input = `${PUBLIC}/auth/v1/user`
    await supabaseServerFetch(input, init)
    expect(fetchMock.mock.calls[0][0]).toBe(input)
    expect(fetchMock.mock.calls[0][1]).toBe(init)
    const req = new Request(`${PUBLIC}/auth/v1/user`)
    await supabaseServerFetch(req)
    expect(fetchMock.mock.calls[1][0]).toBe(req)
  })

  it('defaults a missing method to GET, as fetch does', async () => {
    await supabaseServerFetch(`${PUBLIC}/auth/v1/user`)
    expect(fetchMock.mock.calls[0][0]).toBe(`${INTERNAL}/auth/v1/user`)
  })

  it('returns an HTTP error from the gateway as-is — a status is never a reason to try again', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
    const res = await supabaseServerFetch(`${PUBLIC}/auth/v1/user`, { method: 'GET' })
    expect(res.status).toBe(502)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  const refused = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) })

  it.each(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'])('falls back to the public route once when the connection never opened (%s)', async (code) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockRejectedValueOnce(refused(code))
    const init = { method: 'POST', body: '{"refresh_token":"r"}' }
    const res = await supabaseServerFetch(`${PUBLIC}/auth/v1/token?grant_type=refresh_token`, init)
    expect(res.status).toBe(200)
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      `${INTERNAL}/auth/v1/token?grant_type=refresh_token`,
      `${PUBLIC}/auth/v1/token?grant_type=refresh_token`,
    ])
    expect(fetchMock.mock.calls[1][1]).toBe(init)
    warn.mockRestore()
  })

  it.each(['ECONNRESET', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'ETIMEDOUT'])('never replays a call that may have reached GoTrue (%s)', async (code) => {
    fetchMock.mockRejectedValueOnce(refused(code))
    await expect(supabaseServerFetch(`${PUBLIC}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', body: '{}' })).rejects.toThrow('fetch failed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never replays a POST whose error carries no code', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'))
    await expect(supabaseServerFetch(`${PUBLIC}/auth/v1/logout`, { method: 'POST' })).rejects.toThrow('fetch failed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // A GET changes nothing on the server, so any network failure may try the public route (gate review, 2026-10-16).
  it.each([
    ['a reset', refused('ECONNRESET')],
    ['a dropped socket', refused('UND_ERR_SOCKET')],
    ['an error with no code', new TypeError('fetch failed')],
  ])('a GET falls back to the public route after %s', async (_label, err) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockRejectedValueOnce(err)
    const res = await supabaseServerFetch(`${PUBLIC}/auth/v1/.well-known/jwks.json`, { method: 'GET' })
    expect(res.status).toBe(200)
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([`${INTERNAL}/auth/v1/.well-known/jwks.json`, `${PUBLIC}/auth/v1/.well-known/jwks.json`])
    warn.mockRestore()
  })

  it('never retries when the caller gave up — an abort, a timeout signal, an already-aborted signal', async () => {
    fetchMock.mockRejectedValueOnce(new DOMException('aborted', 'AbortError'))
    await expect(supabaseServerFetch(`${PUBLIC}/auth/v1/user`, { method: 'GET' })).rejects.toThrow('aborted')
    fetchMock.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'))
    await expect(supabaseServerFetch(`${PUBLIC}/auth/v1/user`, { method: 'GET' })).rejects.toThrow('timed out')
    const ctrl = new AbortController()
    ctrl.abort()
    fetchMock.mockRejectedValueOnce(refused('ECONNRESET'))
    await expect(supabaseServerFetch(`${PUBLIC}/auth/v1/user`, { method: 'GET', signal: ctrl.signal })).rejects.toThrow('fetch failed')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('never re-sends a body it cannot send twice', async () => {
    fetchMock.mockRejectedValueOnce(refused('ECONNREFUSED'))
    const body = new ReadableStream()
    await expect(supabaseServerFetch(`${PUBLIC}/auth/v1/logout`, { method: 'POST', body, duplex: 'half' } as RequestInit)).rejects.toThrow('fetch failed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

/** A cookie session exactly as @supabase/ssr writes one: `base64-` + base64url(JSON), under the name built from supabaseUrl. */
function sessionCookie() {
  const now = Math.floor(Date.now() / 1000)
  const session = {
    access_token: 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2ln',
    refresh_token: 'refresh-test-only',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600,
    user: { id: 'u1', aud: 'authenticated' },
  }
  return { name: 'sb-sb-auth-token', value: 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url') }
}

describe('through the real @supabase/ssr and supabase-js', () => {
  it('getUser() on a cookie session goes to the gateway, and the cookie is still sb-sb-auth-token', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ id: 'u1', aud: 'authenticated', email: 'u1@example.test' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    cookieJar.cookies = [sessionCookie()]
    const { createSupabaseServer } = await import('./server')
    const supabase = await createSupabaseServer()
    const { data, error } = await supabase.auth.getUser()
    expect(error).toBeNull()
    expect(data.user?.id).toBe('u1')
    const calls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(calls).toEqual([`${INTERNAL}/auth/v1/user`])
    // The token the cookie carried, sent unchanged — only the address moved.
    const headers = new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers)
    expect(headers.get('authorization')).toBe(`Bearer ${'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2ln'}`)
  })

  it('with the flag off, the same call takes the public route', async () => {
    vi.stubEnv('SUPABASE_INTERNAL_FETCH', '')
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ id: 'u1', aud: 'authenticated' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }))
    cookieJar.cookies = [sessionCookie()]
    const { createSupabaseServer } = await import('./server')
    const { data } = await (await createSupabaseServer()).auth.getUser()
    expect(data.user?.id).toBe('u1')
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([`${PUBLIC}/auth/v1/user`])
  })

  it('a session cookie under any OTHER name is not this client’s — so the name really is derived from the public URL', async () => {
    cookieJar.cookies = [{ ...sessionCookie(), name: 'sb-supabase-envoy-auth-token' }]
    const { createSupabaseServer } = await import('./server')
    const { data } = await (await createSupabaseServer()).auth.getUser()
    expect(data.user).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('the other two server clients carry it', () => {
  it('getSupabaseAdmin and the forum bearer client pass global.fetch = supabaseServerFetch', async () => {
    vi.resetModules()
    const seen: unknown[] = []
    vi.doMock('@supabase/supabase-js', async (orig) => ({
      ...(await orig<typeof import('@supabase/supabase-js')>()),
      createClient: (_url: string, _key: string, opts: { global?: { fetch?: unknown } }) => {
        seen.push(opts?.global?.fetch)
        return { auth: { getUser: async () => ({ data: { user: null }, error: new Error('no user') }) } }
      },
    }))
    vi.doMock('@/lib/admin', () => ({ getCurrentProfile: async () => null }))
    vi.doMock('@/lib/db', () => ({ db: {} }))
    vi.doMock('@/lib/profile', () => ({ ensureProfile: async () => null }))
    vi.stubEnv('SUPABASE_SECRET_KEY', 'sb_secret_test_only')
    try {
      const { supabaseServerFetch: fresh } = await import('./server-fetch')
      const { getSupabaseAdmin } = await import('@/lib/supabase-admin')
      getSupabaseAdmin()
      const { getForumAuth } = await import('@/lib/forum/auth')
      await getForumAuth(new Request('https://www.eno.forum/api/x', { headers: { authorization: 'Bearer t' } }))
      expect(seen).toHaveLength(2)
      expect(seen.every((f) => f === fresh)).toBe(true)
    } finally {
      vi.doUnmock('@supabase/supabase-js')
      vi.doUnmock('@/lib/admin')
      vi.doUnmock('@/lib/db')
      vi.doUnmock('@/lib/profile')
    }
  })
})
