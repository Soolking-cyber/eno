import { NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * /auth/callback (plan §7.6, §8): the `native=1` hop carries only a code or a MAPPED error, a known `p`, and an
 * explicit empty fragment; a cancel is a silent return to /signin; `p=apple` keeps Apple's refresh token and
 * strips Apple's provider tokens from the cookie (only when GoTrue says the code was Apple's) — best effort: neither a
 * failed keep nor a failed strip ever fails the sign-in. Google is untouched.
 */
const h = vi.hoisted(() => ({
  events: [] as string[],
  exchange: null as null | (() => Promise<{ data: { user: unknown; session: unknown }; error: unknown }>),
  setSession: vi.fn(async (_s: { access_token: string; refresh_token: string }) => { h.events.push('set-session'); return { error: null } }),
  store: vi.fn(async (_i: Record<string, unknown>) => { h.events.push('store'); return 'stored' }),
  finish: vi.fn(async (_u: unknown, origin: string, next: string) => { h.events.push('finish'); return NextResponse.redirect(`${origin}${next}`) }),
  /** GoTrue's flow state for the code (auth.flow_state via pkceCodeProvider): which provider minted it, for whom. */
  flow: vi.fn(async (_code: string): Promise<{ provider: string; userId: string | null } | null> => { h.events.push('flow'); return { provider: 'apple', userId: 'u-1' } }),
  signOut: vi.fn(async (_o: { scope: string }) => { h.events.push('sign-out'); return { error: null } }),
  appleOnOffer: true,
  /** GoTrue has Facebook on (src/lib/auth/facebook.ts) — off unless a test says so. */
  facebookOn: false,
  /** ADMIN_EMAILS, as src/lib/admin.ts reads it. */
  admins: [] as string[],
}))
vi.mock('@/lib/auth/facebook', () => ({ facebookSignInEnabled: async () => h.facebookOn }))
vi.mock('@/lib/admin', () => ({ isAdminEmail: (e: string | null | undefined) => !!e && h.admins.includes(e.toLowerCase()) }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({ auth: { exchangeCodeForSession: () => { h.events.push('exchange'); return h.exchange!() }, setSession: h.setSession, signOut: h.signOut } }),
}))
vi.mock('@/lib/auth-finish', () => ({
  authRedirect: (to: string) => { const r = NextResponse.redirect(to); r.headers.set('Cache-Control', 'private, no-store, max-age=0'); return r },
  finishSignIn: (u: unknown, o: string, n: string) => h.finish(u, o, n),
}))
vi.mock('@/lib/auth/apple-siwa', () => ({
  appleServicesId: () => 'vn.eno.web',
  storeAppleToken: (i: Record<string, unknown>) => h.store(i),
  pkceCodeProvider: (code: string) => h.flow(code),
  appleOnOffer: () => h.appleOnOffer,
}))

const { GET } = await import('./route')
const call = (qs: string) => GET(new Request(`https://eno.vn/auth/callback${qs}`))

const APPLE_USER = {
  id: 'u-1',
  identities: [{ provider: 'apple', id: '001.legacy', identity_data: { sub: '001.abc' } }],
  app_metadata: { provider: 'apple', providers: ['apple'] },
}
const SESSION = { access_token: 'at', refresh_token: 'rt', provider_token: 'apple-at', provider_refresh_token: 'apple-rt' }

let errorLog: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
  h.events = []
  h.exchange = async () => ({ data: { user: APPLE_USER, session: SESSION }, error: null })
  h.setSession.mockClear(); h.store.mockClear(); h.finish.mockClear(); h.flow.mockClear(); h.signOut.mockClear()
  h.appleOnOffer = true
  h.facebookOn = false
  h.admins = []
  h.store.mockImplementation(async () => { h.events.push('store'); return 'stored' })
  h.flow.mockImplementation(async () => { h.events.push('flow'); return { provider: 'apple', userId: 'u-1' } })
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('native=1 — the hop back into the app', () => {
  it('forwards the code, next and p, and ends Location with an explicit empty fragment', async () => {
    const res = await call('?native=1&next=%2Flistings%2Fx&p=apple&code=c-123')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('enovn://auth-callback?code=c-123&next=%2Flistings%2Fx&p=apple#')
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(h.events).toEqual([]) // nothing is exchanged in the tab's jar
  })

  it('forwards a MAPPED error and never error_description', async () => {
    const cancel = await call('?native=1&next=%2F&p=apple&error=user_cancelled_authorize&error_description=%3Cscript%3Eevil')
    expect(cancel.headers.get('location')).toBe('enovn://auth-callback?error=cancel&next=%2F&p=apple#')
    const google = await call('?native=1&p=google&error=access_denied&error_description=The+user+denied')
    expect(google.headers.get('location')).toBe('enovn://auth-callback?error=cancel&next=%2F&p=google#')
    const disabled = await call('?native=1&error=access_denied&error_code=signup_disabled&error_description=Signups+not+allowed')
    expect(disabled.headers.get('location')).toBe('enovn://auth-callback?error=signup_disabled&next=%2F#')
    const other = await call('?native=1&error=server_error&error_description=boom')
    expect(other.headers.get('location')).toBe('enovn://auth-callback?error=oauth&next=%2F#')
    for (const r of [cancel, google, disabled, other]) expect(r.headers.get('location')).not.toMatch(/description|evil|denied|boom/)
  })

  it('does NOT hop with neither a code nor an error — it shows /signin inside the tab', async () => {
    const res = await call('?native=1&next=%2Fx&p=apple')
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('https://eno.vn/signin')
  })

  it('drops an unknown p, and sanitizes next', async () => {
    const res = await call('?native=1&code=c&p=evil&next=https%3A%2F%2Fevil.example')
    expect(res.headers.get('location')).toBe('enovn://auth-callback?code=c&next=%2F#')
  })
})

describe('the error branch', () => {
  it('a cancel — Apple\'s user_cancelled_authorize, the app\'s cancel, Google\'s bare access_denied — is a silent /signin', async () => {
    for (const qs of ['?error=user_cancelled_authorize&p=apple', '?error=cancel&p=apple', '?error=access_denied']) {
      const res = await call(`${qs}&next=%2Flistings%2Fx`)
      expect(res.headers.get('location'), qs).toBe('https://eno.vn/signin?next=%2Flistings%2Fx')
    }
    expect(errorLog).not.toHaveBeenCalled()
  })
  it('a cancel is logged with which cancel it was and a capped description — a bare access_denied stays visible', async () => {
    const log = vi.mocked(console.log)
    log.mockClear()
    await call(`?error=access_denied&error_description=${encodeURIComponent('Database error saving new user ' + 'x'.repeat(300))}`)
    const [, detail] = log.mock.calls.find(([m]) => m === '[auth] oauth cancelled') ?? []
    expect(detail).toMatchObject({ provider: 'unknown', error: 'access_denied' })
    expect((detail as { description: string }).description).toMatch(/^Database error saving new user x+$/)
    expect((detail as { description: string }).description).toHaveLength(120)
  })
  it('signup_disabled is unchanged, from GoTrue and from the app\'s hop', async () => {
    expect((await call('?error=access_denied&error_code=signup_disabled')).headers.get('location')).toBe('https://eno.vn/?auth_error=signup_disabled')
    expect((await call('?error=signup_disabled&p=apple')).headers.get('location')).toBe('https://eno.vn/?auth_error=signup_disabled')
  })
  it('anything else is oauth, logged', async () => {
    expect((await call('?error=server_error&error_description=x')).headers.get('location')).toBe('https://eno.vn/?auth_error=oauth')
    expect((await call('?error=oauth')).headers.get('location')).toBe('https://eno.vn/?auth_error=oauth')
    expect(errorLog).toHaveBeenCalled()
  })
})

describe('the code branch', () => {
  it('p=apple: keeps the token for the Services ID, THEN rewrites the session, THEN finishes', async () => {
    const res = await call('?code=c&p=apple&next=%2Fx')
    expect(res.headers.get('location')).toBe('https://eno.vn/x')
    // GoTrue's flow state is read BEFORE the exchange (which deletes it)
    expect(h.events).toEqual(['flow', 'exchange', 'store', 'set-session', 'finish'])
    expect(h.flow).toHaveBeenCalledWith('c')
    expect(h.store).toHaveBeenCalledWith({ userId: 'u-1', clientId: 'vn.eno.web', appleSub: '001.abc', refreshToken: 'apple-rt' })
    expect(h.setSession).toHaveBeenCalledWith({ access_token: 'at', refresh_token: 'rt' })
  })

  it('a failed keep still signs in — and still strips the provider tokens', async () => {
    h.store.mockImplementation(async () => { h.events.push('store'); throw new Error('db down') })
    const res = await call('?code=c&p=apple&next=%2Fx')
    expect(res.headers.get('location')).toBe('https://eno.vn/x')
    expect(h.events).toEqual(['flow', 'exchange', 'store', 'set-session', 'finish'])
    h.events = []
    h.store.mockImplementation(async () => { h.events.push('store'); return 'failed' })
    expect((await call('?code=c&p=apple')).headers.get('location')).toBe('https://eno.vn/')
    expect(h.events).toEqual(['flow', 'exchange', 'store', 'set-session', 'finish'])
  })

  it('a session rewrite that fails once is retried, and the sign-in goes on', async () => {
    h.setSession.mockImplementationOnce(async () => { h.events.push('set-session'); throw new Error('gotrue blip') })
    expect((await call('?code=c&p=apple')).headers.get('location')).toBe('https://eno.vn/')
    expect(h.events).toEqual(['flow', 'exchange', 'store', 'set-session', 'set-session', 'finish'])
    expect(h.signOut).not.toHaveBeenCalled()
  })

  it('a rewrite that keeps failing is logged and the sign-in goes on (best effort — the token is useless without eno\'s secret)', async () => {
    h.setSession.mockImplementation(async () => { h.events.push('set-session'); return { error: { status: 500 } } as never })
    try {
      expect((await call('?code=c&p=apple&next=%2Fx')).headers.get('location')).toBe('https://eno.vn/x')
      expect(h.events).toEqual(['flow', 'exchange', 'store', 'set-session', 'set-session', 'finish'])
      expect(h.signOut).not.toHaveBeenCalled()
    } finally {
      h.setSession.mockImplementation(async () => { h.events.push('set-session'); return { error: null } })
    }
  })

  it('p=apple without an Apple identity or a refresh token keeps nothing', async () => {
    h.exchange = async () => ({ data: { user: { id: 'u-2', identities: [{ provider: 'google', id: 'g' }] }, session: { ...SESSION } }, error: null })
    await call('?code=c&p=apple')
    expect(h.store).not.toHaveBeenCalled()
    h.exchange = async () => ({ data: { user: APPLE_USER, session: { access_token: 'at', refresh_token: 'rt' } }, error: null })
    h.events = []
    await call('?code=c&p=apple')
    expect(h.events).toEqual(['flow', 'exchange', 'finish']) // no provider tokens: nothing to keep, nothing to strip
  })

  it('⛔ Google (no p, or p=google) is unchanged apart from the flow read: no keep, no rewrite, no new way to fail', async () => {
    h.exchange = async () => ({ data: { user: { id: 'u-3', identities: [{ provider: 'google', id: 'g' }] }, session: { access_token: 'at', refresh_token: 'rt', provider_token: 'g-at' } }, error: null })
    h.flow.mockImplementation(async () => { h.events.push('flow'); return { provider: 'google', userId: 'u-3' } })
    for (const qs of ['?code=c&next=%2Fy', '?code=c&next=%2Fy&p=google']) {
      h.events = []
      expect((await call(qs)).headers.get('location')).toBe('https://eno.vn/y')
      expect(h.events).toEqual(['flow', 'exchange', 'finish'])
    }
    expect(h.store).not.toHaveBeenCalled()
    expect(h.setSession).not.toHaveBeenCalled()
    // …and a GoTrue that would fail every setSession changes nothing for Google (round 5, opus)
    h.setSession.mockImplementation(async () => { h.events.push('set-session'); return { error: { status: 500 } } as never })
    try {
      expect((await call('?code=c&next=%2Fy')).headers.get('location')).toBe('https://eno.vn/y')
    } finally {
      h.setSession.mockImplementation(async () => { h.events.push('set-session'); return { error: null } })
    }
  })

  it('⛔ a stalled flow read is cut short and the sign-in goes on — GoTrue could not vouch, so nothing is touched', async () => {
    vi.useFakeTimers()
    try {
      h.flow.mockImplementation(() => new Promise(() => { h.events.push('flow') }))
      const pending = call('?code=c&p=apple&next=%2Fx')
      await vi.advanceTimersByTimeAsync(1_600)
      expect((await pending).headers.get('location')).toBe('https://eno.vn/x')
      expect(h.store).not.toHaveBeenCalled()
      expect(h.events).toEqual(['flow', 'exchange', 'finish'])
    } finally {
      vi.useRealTimers()
    }
  })

  // ⛔ Round 4 (codex): an Apple flow started WITHOUT `p=apple` reached the exchange unchecked and left Apple's refresh
  // token in the JS-readable cookie. Every code is checked now.
  it('⛔ before Apple is configured here, no sign-in reads GoTrue\'s flow state (round 8): exchange, finish — nothing else', async () => {
    h.appleOnOffer = false
    expect((await call('?code=c&p=apple&next=%2Fx')).headers.get('location')).toBe('https://eno.vn/x')
    expect(h.events).toEqual(['exchange', 'finish'])
    expect(h.flow).not.toHaveBeenCalled()
  })

  it('⛔ an Apple flow with no p marker is still kept AND stripped', async () => {
    const res = await call('?code=c&next=%2Fx')
    expect(res.headers.get('location')).toBe('https://eno.vn/x')
    expect(h.events).toEqual(['flow', 'exchange', 'store', 'set-session', 'finish'])
    expect(h.store).toHaveBeenCalledWith({ userId: 'u-1', clientId: 'vn.eno.web', appleSub: '001.abc', refreshToken: 'apple-rt' })
  })

  /**
   * ⛔ C4 (codex, commit gate 2026-10-08): `p=apple` is a query parameter anyone can add to any callback. On an account
   * where Google and Apple are linked (GoTrue links same-email identities), a GOOGLE callback carrying it found the
   * Apple identity and kept GOOGLE's provider_refresh_token as an Apple token — sent to Apple at deletion. Which
   * provider minted the code is GoTrue's to say (its flow state); anything but a clear `apple` keeps nothing.
   */
  describe('⛔ C4 — only GoTrue can say a code was Apple\'s', () => {
    const LINKED = {
      id: 'u-1',
      identities: [{ provider: 'google', id: 'g-1', identity_data: { sub: 'g-1' } }, { provider: 'apple', id: '001.legacy', identity_data: { sub: '001.abc' } }],
      app_metadata: { provider: 'google', providers: ['google', 'apple'] },
    }
    const GOOGLE_SESSION = { access_token: 'at', refresh_token: 'rt', provider_token: 'ya29.google-at', provider_refresh_token: '1//google-rt' }

    it('a GOOGLE callback carrying p=apple on a linked Google+Apple account stores NOTHING — and still signs in', async () => {
      h.exchange = async () => ({ data: { user: LINKED, session: GOOGLE_SESSION }, error: null })
      h.flow.mockImplementation(async () => { h.events.push('flow'); return { provider: 'google', userId: 'u-1' } })
      const res = await call('?code=c&p=apple&next=%2Fx')
      expect(res.headers.get('location')).toBe('https://eno.vn/x')
      expect(h.store).not.toHaveBeenCalled()
      // a Google flow: Google's tokens are left exactly as before this work (round 5)
      expect(h.events).toEqual(['flow', 'exchange', 'finish'])
      const warned = (console.warn as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => JSON.stringify(c))
      // a Google flow on a linked account is an ordinary Google sign-in: nothing to keep, nothing to warn about
      expect(warned.some((w) => w.includes('apple_token_not_kept'))).toBe(false)
      expect(warned.join('\n')).not.toMatch(/google-rt|google-at/)
    })

    it('no answer from GoTrue\'s flow state (unreadable, no row, an error) stores nothing either', async () => {
      h.flow.mockImplementation(async () => { h.events.push('flow'); return null })
      expect((await call('?code=c&p=apple&next=%2Fx')).headers.get('location')).toBe('https://eno.vn/x')
      expect(h.store).not.toHaveBeenCalled()
      h.flow.mockImplementation(async () => { throw new Error('boom') })
      expect((await call('?code=c&p=apple')).headers.get('location')).toBe('https://eno.vn/')
      expect(h.store).not.toHaveBeenCalled()
    })

    it('an Apple flow state issued to ANOTHER user stores nothing', async () => {
      h.flow.mockImplementation(async () => ({ provider: 'apple', userId: 'u-someone-else' }))
      await call('?code=c&p=apple')
      expect(h.store).not.toHaveBeenCalled()
    })

    it('an Apple flow state with no user recorded (yet) is still Apple\'s: kept', async () => {
      h.flow.mockImplementation(async () => ({ provider: 'apple', userId: null }))
      await call('?code=c&p=apple')
      expect(h.store).toHaveBeenCalledTimes(1)
    })

    // Commit gate round 2 (verifier): GoTrue keeps the provider as the authorize request spelled it — a hand-made
    // `provider=Apple` leaves an `Apple` identity (pkceCodeProvider lowercases the flow's). It is still Apple's token.
    it('an identity GoTrue spelled `Apple` is still the Apple identity: kept, under its sub', async () => {
      h.exchange = async () => ({
        data: { user: { id: 'u-1', identities: [{ provider: 'Apple', id: '001.legacy', identity_data: { sub: '001.abc' } }], app_metadata: { provider: 'Apple', providers: ['Apple'] } }, session: SESSION },
        error: null,
      })
      await call('?code=c&p=apple')
      expect(h.store).toHaveBeenCalledWith({ userId: 'u-1', clientId: 'vn.eno.web', appleSub: '001.abc', refreshToken: 'apple-rt' })
    })
  })

  it('⛔ a failed sign-in from the teacher form lands back on the form, not home (owner, 2026-10-11)', async () => {
    h.exchange = async () => ({ data: { user: null, session: null }, error: { message: 'bad code', status: 400 } })
    expect((await call('?code=c&p=apple&next=%2Fteachers%2Fjoin')).headers.get('location')).toBe('https://eno.vn/teachers/join?auth_error=exchange')
    expect((await call('?error=server_error&next=%2Fteachers%2Fjoin')).headers.get('location')).toBe('https://eno.vn/teachers/join?auth_error=oauth')
  })

  it('a failed exchange still answers auth_error=exchange', async () => {
    h.exchange = async () => ({ data: { user: null, session: null }, error: { message: 'bad code', status: 400 } })
    expect((await call('?code=c&p=apple')).headers.get('location')).toBe('https://eno.vn/?auth_error=exchange')
    expect(h.store).not.toHaveBeenCalled()
  })
})

/**
 * CONTINUE WITH FACEBOOK (2026-10-16): Facebook's access token never stays in the JS-readable session cookie — normally
 * there is none (the flow_state trigger), and when one arrives the session is rewritten without it, FAIL CLOSED: a
 * rewrite that keeps failing undoes the sign-in. A Facebook account without an email gets its own code, never prose.
 */
describe('Continue with Facebook', () => {
  const FB_USER = { id: 'u-9', identities: [{ provider: 'facebook', id: '10229' }], app_metadata: { provider: 'facebook', providers: ['facebook'] } }
  const withToken = { access_token: 'at', refresh_token: 'rt', provider_token: 'EAAB-fb-token' }
  beforeEach(() => {
    h.facebookOn = true
    h.flow.mockImplementation(async () => { h.events.push('flow'); return { provider: 'facebook', userId: 'u-9' } })
  })

  it('no token in the session (the trigger kept it out): exchange, finish — no rewrite', async () => {
    h.exchange = async () => ({ data: { user: FB_USER, session: { access_token: 'at', refresh_token: 'rt' } }, error: null })
    expect((await call('?code=c&p=facebook&next=%2Fteachers%2Fjoin')).headers.get('location')).toBe('https://eno.vn/teachers/join')
    expect(h.events).toEqual(['flow', 'exchange', 'finish'])
  })

  it('a token in the session: rewritten without it, THEN finished — also with no p marker (GoTrue\'s word is enough)', async () => {
    h.exchange = async () => ({ data: { user: FB_USER, session: withToken }, error: null })
    for (const qs of ['?code=c&p=facebook&next=%2Fx', '?code=c&next=%2Fx']) {
      h.events = []
      expect((await call(qs)).headers.get('location')).toBe('https://eno.vn/x')
      expect(h.events).toEqual(['flow', 'exchange', 'set-session', 'finish'])
    }
    expect(h.setSession).toHaveBeenCalledWith({ access_token: 'at', refresh_token: 'rt' })
    expect(h.store).not.toHaveBeenCalled()
  })

  it('⛔ a flow GoTrue could not vouch for, marked p=facebook, is stripped too', async () => {
    h.flow.mockImplementation(async () => { h.events.push('flow'); return null })
    h.exchange = async () => ({ data: { user: FB_USER, session: withToken }, error: null })
    expect((await call('?code=c&p=facebook&next=%2Fx')).headers.get('location')).toBe('https://eno.vn/x')
    expect(h.events).toEqual(['flow', 'exchange', 'set-session', 'finish'])
  })

  it('⛔ FAIL CLOSED: a rewrite that keeps failing undoes the sign-in — signed out, the session cookies expired on the answer, never finished', async () => {
    h.exchange = async () => ({ data: { user: FB_USER, session: withToken }, error: null })
    h.setSession.mockImplementation(async () => { h.events.push('set-session'); return { error: { status: 500 } } as never })
    try {
      const res = await GET(new Request('https://eno.vn/auth/callback?code=c&p=facebook&next=%2Fteachers%2Fjoin', { headers: { cookie: 'sb-sb-auth-token.0=abc; sb-sb-auth-token.1=def; lang=en' } }))
      expect(res.headers.get('location')).toBe('https://eno.vn/teachers/join?auth_error=oauth')
      expect(h.events).toEqual(['flow', 'exchange', 'set-session', 'set-session', 'sign-out'])
      expect(h.finish).not.toHaveBeenCalled()
      const cleared = res.cookies.getAll().filter((c) => c.maxAge === 0).map((c) => c.name).sort()
      expect(cleared).toEqual(['sb-sb-auth-token.0', 'sb-sb-auth-token.1'])
    } finally {
      h.setSession.mockImplementation(async () => { h.events.push('set-session'); return { error: null } })
    }
  })

  it('a stalled flow read on an unmarked return that still carries a provider token: the cookie is rewritten without it, best effort', async () => {
    h.flow.mockImplementation(async () => { h.events.push('flow'); return null })
    h.exchange = async () => ({ data: { user: FB_USER, session: withToken }, error: null })
    expect((await call('?code=c&next=%2Fx')).headers.get('location')).toBe('https://eno.vn/x')
    expect(h.events).toEqual(['flow', 'exchange', 'set-session', 'finish'])
    // …and a rewrite that fails there does not stop the sign-in (it is not known to be Facebook's).
    h.events = []
    h.setSession.mockImplementation(async () => { h.events.push('set-session'); return { error: { status: 500 } } as never })
    try {
      expect((await call('?code=c&next=%2Fx')).headers.get('location')).toBe('https://eno.vn/x')
      expect(h.events).toEqual(['flow', 'exchange', 'set-session', 'set-session', 'finish'])
    } finally {
      h.setSession.mockImplementation(async () => { h.events.push('set-session'); return { error: null } })
    }
  })

  it('⛔ with Apple and Facebook both off, nothing is asked and nothing changes — a Google return keeps its old path', async () => {
    h.appleOnOffer = false
    h.facebookOn = false
    h.exchange = async () => ({ data: { user: { id: 'u-3', identities: [{ provider: 'google', id: 'g' }] }, session: { access_token: 'at', refresh_token: 'rt', provider_token: 'g-at' } }, error: null })
    expect((await call('?code=c&next=%2Fy')).headers.get('location')).toBe('https://eno.vn/y')
    expect(h.events).toEqual(['exchange', 'finish'])
    expect(h.setSession).not.toHaveBeenCalled()
  })

  it('⛔ with Apple off, Facebook on is reason enough to read GoTrue\'s flow (its strip depends on it)', async () => {
    h.appleOnOffer = false
    h.exchange = async () => ({ data: { user: FB_USER, session: withToken }, error: null })
    expect((await call('?code=c&next=%2Fx')).headers.get('location')).toBe('https://eno.vn/x')
    expect(h.events).toEqual(['flow', 'exchange', 'set-session', 'finish'])
    // …and with both off, nobody pays for the read.
    h.facebookOn = false
    h.events = []
    h.exchange = async () => ({ data: { user: { id: 'u-3' }, session: { access_token: 'at', refresh_token: 'rt' } }, error: null })
    expect((await call('?code=c&next=%2Fx')).headers.get('location')).toBe('https://eno.vn/x')
    expect(h.events).toEqual(['exchange', 'finish'])
  })

  it('no email from Facebook: GoTrue\'s fixed refusal becomes auth_error=no_email on the page it came from — never its prose', async () => {
    const qs = '?error=server_error&error_code=unexpected_failure&error_description=Error+getting+user+email+from+external+provider&p=facebook'
    expect((await call(`${qs}&next=%2Fteachers%2Fjoin`)).headers.get('location')).toBe('https://eno.vn/teachers/join?auth_error=no_email')
    expect((await call(qs)).headers.get('location')).toBe('https://eno.vn/?auth_error=no_email')
    // Not marked as our Facebook button's return: the words name Facebook, so it is the generic failure instead.
    expect((await call('?error=server_error&error_code=unexpected_failure&error_description=Error+getting+user+email+from+external+provider&p=google')).headers.get('location')).toBe('https://eno.vn/?auth_error=oauth')
    // Any other server error stays the generic one.
    expect((await call('?error=server_error&error_code=unexpected_failure&error_description=Error+getting+user+profile')).headers.get('location')).toBe('https://eno.vn/?auth_error=oauth')
  })

  it('the database guard\'s refusal (GoTrue: "Error creating identity") becomes auth_error=facebook_linked — for a Facebook return only', async () => {
    const qs = '?error=server_error&error_code=unexpected_failure&error_description=Error+creating+identity'
    expect((await call(`${qs}&p=facebook&next=%2Fteachers%2Fjoin`)).headers.get('location')).toBe('https://eno.vn/teachers/join?auth_error=facebook_linked')
    expect((await call(`${qs}&p=google`)).headers.get('location')).toBe('https://eno.vn/?auth_error=oauth')
  })

  it('⛔ never into an operator\'s account: a Facebook sign-in landing on an ADMIN_EMAILS address is undone — Google\'s is not', async () => {
    h.admins = ['support@eno.vn']
    h.exchange = async () => ({ data: { user: { ...FB_USER, email: 'Support@eno.vn' }, session: { access_token: 'at', refresh_token: 'rt' } }, error: null })
    const res = await GET(new Request('https://eno.vn/auth/callback?code=c&p=facebook&next=%2Fx', { headers: { cookie: 'sb-sb-auth-token=abc' } }))
    expect(res.headers.get('location')).toBe('https://eno.vn/?auth_error=oauth')
    expect(h.events).toEqual(['flow', 'exchange', 'sign-out'])
    expect(res.cookies.getAll().filter((c) => c.maxAge === 0).map((c) => c.name)).toEqual(['sb-sb-auth-token'])
    // The same address through Google's flow signs in as before.
    h.events = []
    h.flow.mockImplementation(async () => { h.events.push('flow'); return { provider: 'google', userId: 'u-9' } })
    h.exchange = async () => ({ data: { user: { id: 'u-9', email: 'support@eno.vn', identities: [{ provider: 'google', id: 'g' }] }, session: { access_token: 'at', refresh_token: 'rt' } }, error: null })
    expect((await call('?code=c&next=%2Fx')).headers.get('location')).toBe('https://eno.vn/x')
    expect(h.events).toEqual(['flow', 'exchange', 'finish'])
  })

  it('a cancel at Facebook\'s dialog (GoTrue forwards a bare access_denied) is a silent /signin, logged as facebook', async () => {
    const log = vi.mocked(console.log)
    log.mockClear()
    expect((await call('?error=access_denied&error_description=Permissions+error&p=facebook&next=%2Fx')).headers.get('location')).toBe('https://eno.vn/signin?next=%2Fx')
    const [, detail] = log.mock.calls.find(([m]) => m === '[auth] oauth cancelled') ?? []
    expect(detail).toMatchObject({ provider: 'facebook', error: 'access_denied' })
    expect(errorLog).not.toHaveBeenCalled()
  })
})
