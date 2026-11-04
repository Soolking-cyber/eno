import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ claims: null as Record<string, unknown> | null, configured: true, signInOn: true }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/facebook', () => ({ facebookSignInEnabled: async () => h.signInOn }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServer: async () => ({ auth: { getClaims: async () => ({ data: h.claims ? { claims: h.claims } : null }) } }) }))
vi.mock('@/lib/auth/facebook-connect', () => ({
  buildConnectUrl: (s: string) => `https://www.facebook.com/dialog/oauth?state=${s}`,
  facebookConnectConfigured: () => h.configured,
  FB_TX_TTL_SECONDS: 600,
  fbTxCookieName: (s: string) => `eno_fbc_${s.slice(0, 12)}`,
  newConnectState: () => 's'.repeat(43),
}))

const { GET } = await import('./route')
const call = () => GET(new Request('https://eno.vn/auth/facebook/connect/start', { headers: { host: 'eno.vn' } }))

beforeEach(() => { h.signInOn = true; h.configured = true; h.claims = { sub: 'user-1' } })

describe('Connect Facebook start', () => {
  it('a signed-in person goes straight to Facebook, with an httpOnly cookie binding this user to the state', async () => {
    const r = await call()
    expect(r.headers.get('location')).toContain('www.facebook.com/dialog/oauth')
    const c = r.headers.get('set-cookie')!
    expect(c).toContain('eno_fbc_ssssssssssss=')
    expect(decodeURIComponent(c)).toContain('"u":"user-1"')
    expect(c.toLowerCase()).toContain('httponly')
    expect(c.toLowerCase()).toContain('samesite=lax')
    expect(c.toLowerCase()).toContain('secure')
  })
  it('a link from another site starts nothing', async () => {
    const r = await GET(new Request('https://eno.vn/auth/facebook/connect/start', { headers: { host: 'eno.vn', 'sec-fetch-site': 'cross-site' } }))
    expect(r.headers.get('location')).toBe('https://eno.vn/dashboard/settings?tab=privacy')
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
  it('Facebook sign-in off: no new connection, which could never sign in', async () => {
    h.signInOn = false
    expect((await call()).headers.get('location')).toContain('fb=failed')
  })
})
