import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  sub: 'user-1' as string | null,
  live: 'user-1' as string | null,
  read: vi.fn(),
  connect: vi.fn(),
  refresh: vi.fn(async () => ({})),
  mail: vi.fn(async () => true),
  log: vi.fn(),
  queue: vi.fn(async () => ({ ok: true, id: 'j1' })),
  alreadyConnected: null as string | null,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/log', () => ({ logError: h.log, logWarn: vi.fn() }))
vi.mock('@/lib/mail', () => ({ sendMail: h.mail }))
vi.mock('@/lib/emails/facebook-connected', () => ({ renderFacebookConnectedEmail: ({ lang }: { lang: string }) => ({ subject: `notice-${lang}`, html: 'h', text: 't' }) }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({ auth: { getClaims: async () => ({ data: h.sub ? { claims: { sub: h.sub, session_id: 'sess-1', email: 'stale@x.example' } } : null }), getUser: async () => ({ data: { user: h.live ? { id: h.live, email: 'a@x.example' } : null } }), refreshSession: h.refresh } }),
}))
vi.mock('@/lib/auth/facebook-connect', () => ({
  fbTxCookieName: (s: string) => `eno_fbc_${(s.startsWith('n.') ? s.slice(2) : s).slice(0, 12)}`,
  isConnectState: (v: string | null) => !!v && /^(?:n\.)?[\w-]{43}$/.test(v),
  isNativeConnectState: (v: string) => v.startsWith('n.'),
  isPkceVerifier: (v: unknown) => typeof v === 'string' && /^[\w-]{43,128}$/.test(v),
  FB_CONNECT_APP_RETURN: 'enovn://fb-connect',
  readFacebookProfile: h.read,
  connectFacebookIdentity: h.connect,
  connectedFacebookId: async () => h.alreadyConnected,
}))

vi.mock('@/lib/fb-import/jobs', () => ({ createImportJob: h.queue }))
vi.mock('@/lib/ssrf', () => ({ safeFetch: async () => new Response('picture') }))

const { GET } = await import('./route')

const STATE = 's'.repeat(43)
const VER = 'v'.repeat(64)
const COOKIE = `eno_fbc_${STATE.slice(0, 12)}`
const PROFILE = { id: '123456', email: 'a@x.example', name: 'An', picture: null }
const tx = (u = 'user-1', s = STATE) => `${COOKIE}=${encodeURIComponent(JSON.stringify({ s, u, v: VER }))}`
const call = (query: string, cookie?: string) =>
  GET(new Request(`https://eno.vn/auth/facebook/connect/callback?${query}`, { headers: { host: 'eno.vn', ...(cookie ? { cookie } : {}) } }))
const fb = (r: Response) => new URL(r.headers.get('location')!).searchParams.get('fb')

beforeEach(() => {
  h.sub = 'user-1'
  h.live = 'user-1'
  h.read.mockReset().mockResolvedValue({ ok: true, profile: PROFILE })
  h.connect.mockReset().mockResolvedValue('ok')
  h.refresh.mockClear()
  h.mail.mockClear().mockResolvedValue(true)
  h.queue.mockClear()
})

describe('Connect Facebook callback', () => {
  // ⛔ Connecting through Import is the same new way in, and the mail is what a phished owner recovers by.
  const importTx = () => `${COOKIE}=${encodeURIComponent(JSON.stringify({ s: STATE, u: 'user-1', v: VER, f: 'import' }))}`
  it('Import connects Facebook for the first time: the account hears about it, and the job has every picture size', async () => {
    h.alreadyConnected = null
    h.read.mockResolvedValue({ ok: true, profile: { ...PROFILE, picture: 'https://p/400.jpg', pictures: ['https://p/400.jpg', 'https://p/200.jpg'], displayName: 'An Tran' } })
    await call(`code=C&state=${STATE}`, importTx())
    expect(h.mail).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@x.example', subject: 'notice-en' }))
    expect(h.queue).toHaveBeenCalledWith('user-1', 'An Tran', [expect.stringMatching(/^[0-9a-f]{64}$/)])
  })
  it('Import on an account already connected sends no notice', async () => {
    h.alreadyConnected = '123456'
    h.read.mockResolvedValue({ ok: true, profile: { ...PROFILE, picture: 'https://p/400.jpg', pictures: ['https://p/400.jpg'] } })
    await call(`code=C&state=${STATE}`, importTx())
    expect(h.mail).not.toHaveBeenCalled()
    expect(h.connect).not.toHaveBeenCalled()
  })
  it('connects the signed-in person who started it, refreshes the session and burns the cookie', async () => {
    const r = await call(`code=C&state=${STATE}`, tx())
    expect(fb(r)).toBe('connected')
    expect(h.connect).toHaveBeenCalledWith('user-1', PROFILE)
    expect(h.refresh).toHaveBeenCalled()
    expect(r.headers.get('set-cookie')).toContain(`${COOKIE}=;`)
    expect(r.headers.get('cache-control')).toContain('no-store')
    // The account's own address hears about the new way in.
    expect(h.mail).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@x.example', subject: 'notice-en' }))
  })

  it.each([['throws', () => h.mail.mockRejectedValue(new Error('smtp'))], ['answers false', () => h.mail.mockResolvedValue(false)]])('a notice that %s is logged, and is not a failed link', async (_n, arrange) => {
    arrange()
    h.log.mockClear()
    expect(fb(await call(`code=C&state=${STATE}`, tx()))).toBe('connected')
    expect(h.log).toHaveBeenCalledWith(expect.any(Error), { op: 'facebook-connect.notice' })
  })

  // ⛔ LINK CSRF: a URL sent to someone else finds no cookie, or the wrong person, in that browser.
  it.each([
    ['no cookie: a Facebook or callback URL sent to someone else', undefined, 'user-1'],
    ['another transaction’s state in the cookie', tx('user-1', 'x'.repeat(43)), 'user-1'],
    ['a different person is signed in now', tx('user-1'), 'user-2'],
    ['nobody is signed in now', tx('user-1'), null],
    ['a corrupt cookie', `${COOKIE}=%7Bnot-json`, 'user-1'],
    ['a cookie holding valid JSON null', `${COOKIE}=null`, 'user-1'],
  ])('%s: reads nothing from Facebook and links nothing', async (_n, cookie, sub) => {
    h.sub = sub
    const r = await call(`code=C&state=${STATE}`, cookie)
    expect(fb(r)).toBe('failed')
    expect(h.read).not.toHaveBeenCalled()
    expect(h.connect).not.toHaveBeenCalled()
  })

  it('a session GoTrue no longer knows reads nothing, though its token still verifies', async () => {
    h.live = null
    expect(fb(await call(`code=C&state=${STATE}`, tx()))).toBe('failed')
    expect(h.read).not.toHaveBeenCalled()
  })

  it('declining Facebook’s dialog returns quietly', async () => {
    const r = await call(`error=access_denied&state=${STATE}`, tx())
    expect(fb(r)).toBeNull()
    expect(h.read).not.toHaveBeenCalled()
    expect(r.headers.get('set-cookie')).toContain(`${COOKIE}=;`)
  })

  it.each(['((((', '%0a', 'a%3Bb', 'x'.repeat(44)])('a hand-made state %s cannot throw, and sets no cookie from it', async (s) => {
    const r = await call(`code=C&state=${s}`)
    expect(fb(r)).toBe('failed')
    expect(r.headers.get('set-cookie')).toBeNull()
    expect(r.status).toBe(307)
  })

  it.each([
    ['already', 'connected'],
    ['other_facebook', 'other'],
    ['held_elsewhere', 'held'],
    ['operator', 'refused'],
    ['no_account', 'failed'],
    ['no_email', 'failed'],
    ['bad_input', 'failed'],
  ])('database answer %s → fb=%s, and only a new link refreshes the session', async (answer, param) => {
    h.connect.mockResolvedValue(answer)
    expect(fb(await call(`code=C&state=${STATE}`, tx()))).toBe(param)
    expect(h.refresh).not.toHaveBeenCalled()
    expect(h.mail).not.toHaveBeenCalled()
  })

  it('a Facebook that sends no email still connects', async () => {
    const profile = { ...PROFILE, email: null }
    h.read.mockResolvedValue({ ok: true, profile })
    expect(fb(await call(`code=C&state=${STATE}`, tx()))).toBe('connected')
    expect(h.connect).toHaveBeenCalledWith('user-1', profile)
  })

  it('a database failure lands on the message, not a 500', async () => {
    h.connect.mockRejectedValue(new Error('boom'))
    const r = await call(`code=C&state=${STATE}`, tx())
    expect(r.status).toBe(307)
    expect(fb(r)).toBe('failed')
  })

  // ⛔ THE iOS APP'S RETURN: Facebook lands in the app's in-app browser sheet, which holds none of the app's cookies.
  it('⛔ PKCE: the code goes to Facebook with the cookie\'s verifier, and a cookie without one (made before PKCE, or edited) exchanges nothing', async () => {
    h.alreadyConnected = null
    await call(`code=C&state=${STATE}`, tx())
    expect(h.read).toHaveBeenCalledWith('C', 'https://eno.vn', expect.objectContaining({ verifier: VER }))
    h.read.mockClear()
    for (const v of [undefined, '', 'short', 42]) {
      expect(fb(await call(`code=C&state=${STATE}`, `${COOKIE}=${encodeURIComponent(JSON.stringify({ s: STATE, u: 'user-1', v }))}`))).toBe('failed')
    }
    expect(h.read).not.toHaveBeenCalled()
  })

  describe('the iOS app', () => {
    const APP_STATE = `n.${STATE}`
    const appCookie = (u = 'user-1') => `${COOKIE}=${encodeURIComponent(JSON.stringify({ s: APP_STATE, u, v: VER }))}`
    it('in the sheet (no cookie): hands code and state to the app on this phone, keeps nothing, reads nothing from Facebook', async () => {
      const r = await call(`code=C&state=${APP_STATE}`)
      expect(r.status).toBe(302)
      expect(r.headers.get('location')).toBe(`enovn://fb-connect?code=C&state=${encodeURIComponent(APP_STATE)}#`)
      expect(r.headers.get('set-cookie')).toBeNull()
      expect(h.read).not.toHaveBeenCalled()
    })
    it('a decline, or nothing at all, goes back to the app as a bare cancel, never Facebook\'s words', async () => {
      expect((await call(`error=access_denied&error_description=${encodeURIComponent('<b>evil</b>')}&state=${APP_STATE}`)).headers.get('location')).toBe(`enovn://fb-connect?error=cancel&state=${encodeURIComponent(APP_STATE)}#`)
      expect((await call(`state=${APP_STATE}`)).headers.get('location')).toBe(`enovn://fb-connect?error=cancel&state=${encodeURIComponent(APP_STATE)}#`)
    })
    it('in the app (app=1, its cookie): finishes like the web, binding and all', async () => {
      const r = await call(`code=C&state=${APP_STATE}&app=1`, appCookie())
      expect(r.headers.get('location')).not.toMatch(/^enovn:/)
      expect(h.read).toHaveBeenCalledWith('C', 'https://eno.vn', expect.anything())
      expect(h.connect).toHaveBeenCalled()
      h.read.mockClear()
      expect(fb(await call(`code=C&state=${APP_STATE}&app=1`, appCookie('someone-else')))).toBe('failed')
      expect(h.read).not.toHaveBeenCalled()
    })
    it('⛔ the app\'s own attempt (app=1) with its cookie gone fails here, never hands off to itself again', async () => {
      const r = await call(`code=C&state=${APP_STATE}&app=1`)
      expect(r.headers.get('location')).not.toMatch(/^enovn:/)
      expect(fb(r)).toBe('failed')
      expect(h.read).not.toHaveBeenCalled()
    })
    it('a plain web state never hands off, cookie or not', async () => {
      expect(fb(await call(`code=C&state=${STATE}`))).toBe('failed')
    })
  })
})
