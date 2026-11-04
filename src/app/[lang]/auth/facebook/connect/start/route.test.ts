import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ claims: null as Record<string, unknown> | null, configured: true }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServer: async () => ({ auth: { getClaims: async () => ({ data: h.claims ? { claims: h.claims } : null }) } }) }))
vi.mock('@/lib/auth/facebook-connect', () => ({
  buildConnectUrl: (s: string) => `https://www.facebook.com/dialog/oauth?state=${s}`,
  confirmationValid: (c: string | null, u: string, sid: string) => c === 'OK' && u === 'user-1' && sid === 'sess-1',
  facebookConnectConfigured: () => h.configured,
  FB_OK_COOKIE: 'eno_fbc_ok',
  FB_TX_TTL_SECONDS: 600,
  fbTxCookieName: (s: string) => `eno_fbc_${s.slice(0, 12)}`,
  newConnectState: () => 's'.repeat(43),
  readCookie: (r: Request, n: string) => r.headers.get('cookie')?.split('; ').find((c) => c.startsWith(`${n}=`))?.slice(n.length + 1) ?? null,
}))

const { GET } = await import('./route')
const call = (cookie: string | null = 'eno_fbc_ok=OK') => GET(new Request('https://eno.vn/auth/facebook/connect/start', { headers: { host: 'eno.vn', ...(cookie ? { cookie } : {}) } }))

beforeEach(() => { h.configured = true; h.claims = { sub: 'user-1', session_id: 'sess-1' } })

describe('Connect Facebook start', () => {
  it('leaves for Facebook with an httpOnly cookie binding this user to the state', async () => {
    const r = await call()
    expect(r.headers.get('location')).toContain('www.facebook.com/dialog/oauth')
    const c = r.headers.get('set-cookie')!
    expect(c).toContain('eno_fbc_ssssssssssss=')
    expect(decodeURIComponent(c)).toContain('"u":"user-1"')
    expect(c.toLowerCase()).toContain('httponly')
    expect(c.toLowerCase()).toContain('samesite=lax')
    expect(c.toLowerCase()).toContain('secure')
  })
  it.each([
    ['no confirmation: a stolen session, even one signed in by code a minute ago', null, { sub: 'user-1', session_id: 'sess-1', amr: [{ method: 'otp', timestamp: 1 }] }],
    ['another session’s confirmation', 'eno_fbc_ok=OK', { sub: 'user-1', session_id: 'sess-2' }],
    ['no session id', 'eno_fbc_ok=OK', { sub: 'user-1' }],
  ])('%s never reaches Facebook', async (_n, cookie, claims) => {
    h.claims = claims
    const r = await call(cookie)
    expect(r.headers.get('location')).toContain('fb=expired')
    expect(r.headers.get('set-cookie')).toBeNull()
  })
  it('signed out goes to sign-in, back to this row', async () => {
    h.claims = null
    expect(decodeURIComponent((await call()).headers.get('location')!)).toContain('/signin?next=/dashboard/settings?tab=privacy')
  })
  it('off: no Facebook', async () => {
    h.configured = false
    expect((await call()).headers.get('location')).toContain('fb=failed')
  })
})
