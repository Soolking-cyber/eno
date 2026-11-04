import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  sub: 'user-1' as string | null,
  live: 'user-1' as string | null,
  read: vi.fn(),
  connect: vi.fn(),
  refresh: vi.fn(async () => ({})),
  mail: vi.fn(async () => true),
  log: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/log', () => ({ logError: h.log }))
vi.mock('@/lib/mail', () => ({ sendMail: h.mail }))
vi.mock('@/lib/emails/facebook-connected', () => ({ renderFacebookConnectedEmail: ({ lang }: { lang: string }) => ({ subject: `notice-${lang}`, html: 'h', text: 't' }) }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({ auth: { getClaims: async () => ({ data: h.sub ? { claims: { sub: h.sub, session_id: 'sess-1', email: 'stale@x.example' } } : null }), getUser: async () => ({ data: { user: h.live ? { id: h.live, email: 'a@x.example' } : null } }), refreshSession: h.refresh } }),
}))
vi.mock('@/lib/auth/facebook-connect', () => ({
  fbTxCookieName: (s: string) => `eno_fbc_${s.slice(0, 12)}`,
  isConnectState: (v: string | null) => !!v && /^[\w-]{43}$/.test(v),
  FB_OK_COOKIE: 'eno_fbc_ok',
  confirmationValid: (c: string | null, _u: string, sid: string) => c === 'OK' && sid === 'sess-1',
  readCookie: (r: Request, n: string) => r.headers.get('cookie')?.split('; ').find((c) => c.startsWith(`${n}=`))?.slice(n.length + 1) ?? null,
  readFacebookProfile: h.read,
  connectFacebookIdentity: h.connect,
}))

const { GET } = await import('./route')

const STATE = 's'.repeat(43)
const COOKIE = `eno_fbc_${STATE.slice(0, 12)}`
const PROFILE = { id: '123456', email: 'a@x.example', name: 'An', picture: null }
const tx = (u = 'user-1', s = STATE, ok = true) => `${COOKIE}=${encodeURIComponent(JSON.stringify({ s, u }))}${ok ? '; eno_fbc_ok=OK' : ''}`
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
})

describe('Connect Facebook callback', () => {
  it('connects the signed-in person who started it, refreshes the session and burns the cookie', async () => {
    const r = await call(`code=C&state=${STATE}`, tx())
    expect(fb(r)).toBe('connected')
    expect(h.connect).toHaveBeenCalledWith('user-1', PROFILE)
    expect(h.refresh).toHaveBeenCalled()
    expect(r.headers.get('set-cookie')).toContain(`${COOKIE}=;`)
    expect(r.headers.get('set-cookie')).toContain('eno_fbc_ok=;')
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

  // ⛔ THE TRANSACTION COOKIE ISN'T SIGNED: a stolen session can set its own and skip /start. It can't make the confirmation.
  it('a session with no confirmed code reads nothing, even with a matching cookie', async () => {
    expect(fb(await call(`code=C&state=${STATE}`, tx('user-1', STATE, false)))).toBe('expired')
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
    expect(r.headers.get('set-cookie')).not.toContain('eno_fbc_(')
    expect(r.status).toBe(307)
  })

  it.each([
    ['already', 'connected'],
    ['other_facebook', 'other'],
    ['held_elsewhere', 'held'],
    ['operator', 'refused'],
    ['no_account', 'failed'],
    ['no_email', 'no_email'],
    ['bad_input', 'failed'],
  ])('database answer %s → fb=%s, and only a new link refreshes the session', async (answer, param) => {
    h.connect.mockResolvedValue(answer)
    expect(fb(await call(`code=C&state=${STATE}`, tx()))).toBe(param)
    expect(h.refresh).not.toHaveBeenCalled()
    expect(h.mail).not.toHaveBeenCalled()
  })

  it('no email from Facebook links nothing', async () => {
    h.read.mockResolvedValue({ ok: false, reason: 'no_email' })
    expect(fb(await call(`code=C&state=${STATE}`, tx()))).toBe('no_email')
    expect(h.connect).not.toHaveBeenCalled()
  })

  it('a database failure lands on the message, not a 500', async () => {
    h.connect.mockRejectedValue(new Error('boom'))
    const r = await call(`code=C&state=${STATE}`, tx())
    expect(r.status).toBe(307)
    expect(fb(r)).toBe('failed')
  })
})
