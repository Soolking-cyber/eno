import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: {} }))

const load = async () => {
  vi.resetModules()
  vi.stubEnv('FACEBOOK_APP_ID', '1079252418272870')
  vi.stubEnv('FACEBOOK_APP_SECRET', 'a'.repeat(32))
  return import('./facebook-connect')
}

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('the code Disconnect takes', () => {
  const now = 2_000_000_000
  it('matches only the same code, user and session, until it expires', async () => {
    const { sealConnectCode, connectCodeMatches, FB_CODE_TTL_SECONDS } = await load()
    const c = sealConnectCode('004217', 'u1', 's1', now)
    expect(connectCodeMatches(c, '004217', 'u1', 's1', now)).toBe(true)
    expect(connectCodeMatches(c, '004217', 'u1', 's1', now + FB_CODE_TTL_SECONDS)).toBe(true)
    expect(connectCodeMatches(c, '004217', 'u1', 's1', now + FB_CODE_TTL_SECONDS + 1)).toBe(false)
    expect(connectCodeMatches(c, '004218', 'u1', 's1', now)).toBe(false)
    expect(connectCodeMatches(c, '004217', 'u2', 's1', now)).toBe(false)
    // ⛔ Another session of the same person: a stolen one can't use a code the owner asked for, nor the reverse.
    expect(connectCodeMatches(c, '004217', 'u1', 's2', now)).toBe(false)
  })
  it('a confirmation is not a code, and neither can be forged or stretched', async () => {
    const { sealConnectCode, sealConfirmation, confirmationValid, connectCodeMatches } = await load()
    const ok = sealConfirmation('u1', 's1', now)
    expect(confirmationValid(ok, 'u1', 's1', now)).toBe(true)
    expect(confirmationValid(ok, 'u1', 's2', now)).toBe(false)
    expect(confirmationValid(sealConnectCode('004217', 'u1', 's1', now), 'u1', 's1', now)).toBe(false)
    expect(connectCodeMatches(ok, '004217', 'u1', 's1', now)).toBe(false)
    const [exp, mac] = ok.split('.')
    expect(confirmationValid(`${Number(exp) + 9999}.${mac}`, 'u1', 's1', now)).toBe(false)
    for (const bad of [null, undefined, '', 'x', '1.2.3', `${exp}.`]) expect(confirmationValid(bad, 'u1', 's1', now)).toBe(false)
  })
  it('makes six-digit strings, leading zeros kept', async () => {
    const { newConnectCode } = await load()
    for (let i = 0; i < 50; i++) expect(newConnectCode()).toMatch(/^\d{6}$/)
  })
  it('without the secret nothing ever matches', async () => {
    const { sealConfirmation } = await load()
    const ok = sealConfirmation('u1', 's1', now)
    vi.resetModules(); vi.stubEnv('FACEBOOK_APP_SECRET', '')
    const off = await import('./facebook-connect')
    expect(off.confirmationValid(ok, 'u1', 's1', now)).toBe(false)
  })
})

describe('buildConnectUrl', () => {
  it('asks for email and the public profile on the visitor’s own host, with the state', async () => {
    const { buildConnectUrl } = await load()
    const u = new URL(buildConnectUrl('STATE', 'https://www.eno.forum')!)
    expect(u.origin + u.pathname).toBe('https://www.facebook.com/dialog/oauth')
    expect(u.searchParams.get('client_id')).toBe('1079252418272870')
    expect(u.searchParams.get('redirect_uri')).toBe('https://www.eno.forum/auth/facebook/connect/callback')
    expect(u.searchParams.get('state')).toBe('STATE')
    expect(u.searchParams.get('scope')).toBe('email,public_profile')
    expect(u.toString()).not.toContain('a'.repeat(32))
  })
})

describe('readFacebookProfile', () => {
  const answers = (me: unknown, tokenOk = true) => vi.fn(async (url: string) => (
    String(url).includes('/oauth/access_token')
      ? new Response(JSON.stringify(tokenOk ? { access_token: 'TOKEN' } : { error: { message: 'bad' } }), { status: tokenOk ? 200 : 400 })
      : new Response(JSON.stringify(me), { status: 200 })
  ))

  it('reads who this is and proves the token with the app secret', async () => {
    const f = answers({ id: '123456', email: 'A@X.example', name: 'Tran An', first_name: 'An', last_name: 'Tran', picture: { data: { url: 'https://p/x.jpg' } } })
    vi.stubGlobal('fetch', f)
    const { readFacebookProfile } = await load()
    const r = await readFacebookProfile('CODE', 'https://eno.vn')
    expect(r).toEqual({ ok: true, profile: { id: '123456', email: 'a@x.example', name: 'An Tran', picture: 'https://p/x.jpg', pictureIsDefault: false, displayName: 'Tran An' } })
    const meUrl = String(f.mock.calls[1][0])
    expect(meUrl).toMatch(/appsecret_proof=[0-9a-f]{64}/)
    // ⛔ Graph answers 400 to `.as(p40)`: that one word took Connect down (2026-11-05).
    expect(meUrl).not.toContain('.as(')
    expect(f).toHaveBeenCalledTimes(2)
    // Neither the secret nor the token in a URL (nginx and proxy logs).
    expect(meUrl).not.toContain('TOKEN')
    expect(String(f.mock.calls[0][0])).not.toContain('a'.repeat(32))
  })
  it('an import also asks for each picture size, separately, and a size that fails is only a size missing', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (u: unknown) => {
      const url = String(u)
      seen.push(url)
      if (url.includes('/oauth/access_token')) return new Response(JSON.stringify({ access_token: 'TOKEN' }), { status: 200 })
      if (url.includes('/me/picture')) {
        if (url.includes('width=50&')) return new Response('{}', { status: 500 })
        return new Response(JSON.stringify({ data: { url: `https://p/${/width=(\d+)/.exec(url)![1]}.jpg` } }), { status: 200 })
      }
      return new Response(JSON.stringify({ id: '123456', first_name: 'An', picture: { data: { url: 'https://p/x.jpg' } } }), { status: 200 })
    }))
    const { readFacebookProfile } = await load()
    const r = await readFacebookProfile('CODE', 'https://eno.vn', { pictureSizes: true })
    expect(r).toMatchObject({ ok: true, profile: { pictures: ['https://p/x.jpg', 'https://p/40.jpg', 'https://p/80.jpg', 'https://p/100.jpg', 'https://p/160.jpg', 'https://p/200.jpg', 'https://p/320.jpg'] } })
    expect(seen.filter((u) => u.includes('/me/picture'))).toHaveLength(7)
    expect(seen.every((u) => !u.includes('TOKEN') && !u.includes('.as('))).toBe(true)
  })
  it('Graph refuses the profile call: says so with its code, and Connect reports a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: unknown) => String(u).includes('/oauth/access_token') ? new Response(JSON.stringify({ access_token: 'TOKEN' }), { status: 200 }) : new Response(JSON.stringify({ error: { code: 2500, message: 'quotes the request' } }), { status: 400 })))
    const { readFacebookProfile } = await load()
    expect(await readFacebookProfile('CODE', 'https://eno.vn')).toEqual({ ok: false, reason: 'profile' })
  })
  it('no email still connects: the eno account has its own', async () => {
    vi.stubGlobal('fetch', answers({ id: '123456', first_name: 'An' }))
    const { readFacebookProfile, facebookIdentityData } = await load()
    const r = await readFacebookProfile('CODE', 'https://eno.vn')
    expect(r).toEqual({ ok: true, profile: { id: '123456', email: null, name: 'An', picture: null, pictureIsDefault: false, displayName: 'An' } })
    // GoTrue's shape with no address at all: an empty one would be matched against other accounts' empties.
    const d = facebookIdentityData((r as { ok: true; profile: Parameters<typeof facebookIdentityData>[0] }).profile)
    expect(d).not.toHaveProperty('email')
    expect(d).not.toHaveProperty('email_verified')
  })
  it('a refused code or a network failure never throws', async () => {
    vi.stubGlobal('fetch', answers({}, false))
    const a = await load()
    expect(await a.readFacebookProfile('CODE', 'https://eno.vn')).toEqual({ ok: false, reason: 'exchange' })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net') }))
    const b = await load()
    expect(await b.readFacebookProfile('CODE', 'https://eno.vn')).toEqual({ ok: false, reason: 'exchange' })
  })
  it('off without the secret', async () => {
    vi.resetModules()
    vi.stubEnv('FACEBOOK_APP_ID', '1')
    vi.stubEnv('FACEBOOK_APP_SECRET', '')
    const { facebookConnectConfigured, readFacebookProfile } = await import('./facebook-connect')
    expect(facebookConnectConfigured()).toBe(false)
    expect(await readFacebookProfile('CODE', 'https://eno.vn')).toEqual({ ok: false, reason: 'not_configured' })
  })
})

describe('isConnectState', () => {
  it('takes what newConnectState makes, and nothing else', async () => {
    const { isConnectState, newConnectState } = await load()
    expect(isConnectState(newConnectState())).toBe(true)
    for (const bad of [null, '', 'short', 'a\nb'.padEnd(43, 'x'), 'a;b'.padEnd(43, 'x'), 'x'.repeat(44)]) expect(isConnectState(bad)).toBe(false)
  })
})

describe('facebookIdentityData', () => {
  it('has GoTrue’s keys, with sub as the id it signs in by', async () => {
    const { facebookIdentityData } = await load()
    const d = facebookIdentityData({ id: '123456', email: 'a@x.example', name: 'An Tran', picture: null })
    expect(d).toMatchObject({ sub: '123456', provider_id: '123456', name: 'An Tran', full_name: 'An Tran', email: 'a@x.example', email_verified: true })
    expect(d).not.toHaveProperty('picture')
  })
})
