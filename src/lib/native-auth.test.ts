// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The native sign-in helpers (plan §7.5): the deep link forwards the QUERY only, nativeOAuth starts clean and
 * names the provider for the callback, iOS build 3 runs Google in ASWebAuthenticationSession, and native Sign
 * in with Apple goes nonce → Apple's sheet → our route → a same-origin path.
 */
const h = vi.hoisted(() => ({
  events: [] as string[],
  pluginAvailable: false,
  webAuth: null as null | ((url: string, ephemeral: boolean) => Promise<{ url: string }>),
  credential: null as null | ((nonce: string) => Promise<Record<string, unknown>>),
  browserOpen: vi.fn(async (_o: { url: string }) => { h.events.push('browser-open') }),
}))
vi.mock('@/lib/auth-pkce', () => ({ clearStalePkceCookies: () => { h.events.push('clear-pkce'); return 0 } }))
vi.mock('@/lib/native-sign-in-plugin', () => ({
  signInPluginAvailable: () => h.pluginAvailable,
  webAuthSession: (url: string, ephemeral: boolean) => h.webAuth!(url, ephemeral),
  appleCredential: (nonce: string) => h.credential!(nonce),
  signInPluginErrorCode: (e: unknown) => (e as { code?: string })?.code ?? null,
}))
vi.mock('@capacitor/browser', () => ({ Browser: { open: (o: { url: string }) => h.browserOpen(o) } }))

const { authCallbackPathFromDeepLink, nativeOAuth, nativeAppleSignIn, NativeAuthError, nativeAuthErrorCode } = await import('./native-auth')

const realLocation = window.location
const assign = vi.fn()
const pluginError = (code: string) => Object.assign(new Error(code), { code })

beforeEach(() => {
  h.events = []
  h.pluginAvailable = false
  h.webAuth = null
  h.credential = null
  h.browserOpen.mockClear()
  assign.mockReset()
  Object.defineProperty(window, 'location', { configurable: true, value: { origin: 'https://eno.vn', href: 'https://eno.vn/listings/x', assign } })
})
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
  vi.unstubAllGlobals()
})

describe('authCallbackPathFromDeepLink', () => {
  it('keeps the query and drops any fragment', () => {
    expect(authCallbackPathFromDeepLink('enovn://auth-callback?code=abc&next=%2Fx&p=apple#')).toBe('/auth/callback?code=abc&next=%2Fx&p=apple')
    expect(authCallbackPathFromDeepLink('enovn://auth-callback?code=abc#access_token=SECRET&refresh_token=R')).toBe('/auth/callback?code=abc')
    expect(authCallbackPathFromDeepLink('enovn://auth-callback#access_token=SECRET')).toBe('/auth/callback')
  })
  it('matches the scheme AND the host, nothing looser', () => {
    expect(authCallbackPathFromDeepLink('enovn://open?path=%2Fauth-callback')).toBeNull()
    expect(authCallbackPathFromDeepLink('https://eno.vn/auth-callback?code=x')).toBeNull()
    expect(authCallbackPathFromDeepLink('enonative://auth-callback?code=x')).toBeNull()
    expect(authCallbackPathFromDeepLink('enovn://open?url=enovn%3A%2F%2Fauth-callback%3Fcode%3Dx')).toBeNull()
    expect(authCallbackPathFromDeepLink('not a url')).toBeNull()
  })
})

describe('nativeOAuth', () => {
  const sb = (url = 'https://sb.eno.vn/auth/v1/authorize?provider=apple&code_challenge=c') => {
    const signInWithOAuth = vi.fn(async (_a: { provider: string; options: { redirectTo: string; skipBrowserRedirect: boolean } }) => {
      h.events.push('sign-in-with-oauth')
      return { data: { url }, error: null }
    })
    return { client: { auth: { signInWithOAuth } } as never, signInWithOAuth }
  }

  it('Android, Apple: clears stale PKCE cookies FIRST, names the provider, opens the Custom Tab', async () => {
    const { client, signInWithOAuth } = sb()
    await nativeOAuth(client, 'apple', '/listings/x')
    expect(h.events).toEqual(['clear-pkce', 'sign-in-with-oauth', 'browser-open'])
    const arg = signInWithOAuth.mock.calls[0][0]
    expect(arg.provider).toBe('apple')
    expect(arg.options.skipBrowserRedirect).toBe(true)
    expect(arg.options.redirectTo).toBe('https://eno.vn/auth/callback?next=%2Flistings%2Fx&native=1&p=apple')
    expect(h.browserOpen.mock.calls[0][0].url).toBe('https://sb.eno.vn/auth/v1/authorize?provider=apple&code_challenge=c')
  })

  it('iOS build 3: Google runs in an EPHEMERAL ASWebAuthenticationSession and the WebView loads the callback', async () => {
    h.pluginAvailable = true
    h.webAuth = vi.fn(async () => ({ url: 'enovn://auth-callback?code=c1&next=%2F&p=google#' }))
    const { client, signInWithOAuth } = sb('https://sb.eno.vn/auth/v1/authorize?provider=google')
    await nativeOAuth(client, 'google', '/')
    expect(h.webAuth).toHaveBeenCalledWith('https://sb.eno.vn/auth/v1/authorize?provider=google', true)
    expect(signInWithOAuth.mock.calls[0][0].options.redirectTo).toContain('&native=1&p=google')
    expect(h.browserOpen).not.toHaveBeenCalled()
    expect(assign).toHaveBeenCalledWith('/auth/callback?code=c1&next=%2F&p=google')
  })

  it('iOS build 3: closing the sheet is a silent cancel; a non-callback result is a failure', async () => {
    h.pluginAvailable = true
    h.webAuth = vi.fn(async () => { throw pluginError('canceled') })
    const e1 = await nativeOAuth(sb().client, 'google', '/').catch((e) => e)
    expect(nativeAuthErrorCode(e1)).toBe('canceled')
    h.webAuth = vi.fn(async () => ({ url: 'https://evil.example/?code=x' }))
    const e2 = await nativeOAuth(sb().client, 'google', '/').catch((e) => e)
    expect(e2).toBeInstanceOf(NativeAuthError)
    expect(nativeAuthErrorCode(e2)).toBe('oauth_failed')
    expect(assign).not.toHaveBeenCalled()
  })

  it('an OAuth URL that never came back is an error, not a silent no-op', async () => {
    const signInWithOAuth = vi.fn(async () => ({ data: { url: null }, error: null }))
    await expect(nativeOAuth({ auth: { signInWithOAuth } } as never, 'google', '/')).rejects.toThrow()
    expect(h.browserOpen).not.toHaveBeenCalled()
  })
})

describe('nativeAppleSignIn', () => {
  const NONCE_HEX = 'a'.repeat(64)
  type Call = { path: string; body: Record<string, unknown> | null }
  const calls: Call[] = []
  const stubFetch = (answers: Record<string, () => Response | Promise<Response>>) => {
    calls.length = 0
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null })
      const a = answers[path]
      if (!a) throw new Error(`unexpected fetch ${path}`)
      return a()
    }))
  }
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  it('nonce → Apple sheet → our route → the path it answers', async () => {
    stubFetch({
      '/api/auth/apple/nonce': () => json(200, { nonce: NONCE_HEX }),
      '/api/auth/apple/native': () => json(200, { to: '/onboard?next=%2Flistings%2Fx' }),
    })
    h.credential = vi.fn(async () => ({ identityToken: 'id.tok.en', authorizationCode: 'code-1', user: '001.abc', fullName: 'Jane Doe', givenName: 'Jane', familyName: 'Doe', email: 'j@privaterelay.appleid.com' }))
    await nativeAppleSignIn('/listings/x')
    expect(h.credential).toHaveBeenCalledWith(NONCE_HEX)
    expect(calls.map((c) => c.path)).toEqual(['/api/auth/apple/nonce', '/api/auth/apple/native'])
    expect(calls[1].body).toEqual({
      identityToken: 'id.tok.en', authorizationCode: 'code-1', user: '001.abc', email: 'j@privaterelay.appleid.com',
      givenName: 'Jane', familyName: 'Doe', fullName: 'Jane Doe', next: '/listings/x',
    })
    expect(assign).toHaveBeenCalledWith('/onboard?next=%2Flistings%2Fx')
  })

  it('navigates only to a same-origin path — never //host, /\\host or an absolute URL', async () => {
    h.credential = vi.fn(async () => ({ identityToken: 't' }))
    for (const to of ['//evil.example/x', '/\\evil.example', 'https://evil.example/', 'javascript:alert(1)', 42, null]) {
      stubFetch({ '/api/auth/apple/nonce': () => json(200, { nonce: NONCE_HEX }), '/api/auth/apple/native': () => json(200, { to }) })
      assign.mockReset()
      await nativeAppleSignIn('/')
      expect(assign, String(to)).toHaveBeenCalledWith('/')
    }
  })

  it('a cancelled sheet is silent and calls nothing further', async () => {
    stubFetch({ '/api/auth/apple/nonce': () => json(200, { nonce: NONCE_HEX }) })
    h.credential = vi.fn(async () => { throw pluginError('canceled') })
    const e = await nativeAppleSignIn('/').catch((x) => x)
    expect(nativeAuthErrorCode(e)).toBe('canceled')
    expect(calls.map((c) => c.path)).toEqual(['/api/auth/apple/nonce'])
    expect(assign).not.toHaveBeenCalled()
  })

  it('maps every failure to unavailable or failed', async () => {
    h.credential = vi.fn(async () => { throw pluginError('unavailable') })
    stubFetch({ '/api/auth/apple/nonce': () => json(200, { nonce: NONCE_HEX }) })
    expect(nativeAuthErrorCode(await nativeAppleSignIn('/').catch((x) => x))).toBe('apple_unavailable')

    h.credential = vi.fn(async () => { throw pluginError('busy') })
    expect(nativeAuthErrorCode(await nativeAppleSignIn('/').catch((x) => x))).toBe('apple_failed')

    stubFetch({ '/api/auth/apple/nonce': () => json(503, { error: 'not_configured' }) })
    expect(nativeAuthErrorCode(await nativeAppleSignIn('/').catch((x) => x))).toBe('apple_unavailable')

    stubFetch({ '/api/auth/apple/nonce': () => json(200, { nonce: 'not-hex' }) })
    expect(nativeAuthErrorCode(await nativeAppleSignIn('/').catch((x) => x))).toBe('apple_failed')

    h.credential = vi.fn(async () => ({ identityToken: 't' }))
    stubFetch({ '/api/auth/apple/nonce': () => json(200, { nonce: NONCE_HEX }), '/api/auth/apple/native': () => json(400, { error: 'invalid_token' }) })
    expect(nativeAuthErrorCode(await nativeAppleSignIn('/').catch((x) => x))).toBe('apple_failed')

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    expect(nativeAuthErrorCode(await nativeAppleSignIn('/').catch((x) => x))).toBe('apple_failed')
    expect(assign).not.toHaveBeenCalled()
  })
})
