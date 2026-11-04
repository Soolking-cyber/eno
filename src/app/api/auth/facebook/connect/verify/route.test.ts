import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ sessionId: 's1' as string | null, matches: true }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/api/handler', () => ({ route: (_o: unknown, fn: (c: { req: Request; userId: string }) => Promise<Response>) => (req: Request) => fn({ req, userId: 'u1' }) }))
vi.mock('@/lib/auth/google-oauth', () => ({ canonicalAuthOrigin: () => 'https://eno.vn' }))
vi.mock('@/lib/auth/facebook-connect', () => ({
  connectCodeMatches: (c: string | null, code: string, u: string, s: string) => h.matches && c === 'SEALED' && code === '004217' && u === 'u1' && s === 's1',
  FB_CODE_COOKIE: 'eno_fbc_code', FB_OK_COOKIE: 'eno_fbc_ok', FB_OK_TTL_SECONDS: 900,
  readCookie: (r: Request, n: string) => r.headers.get('cookie')?.split('; ').find((c) => c.startsWith(`${n}=`))?.slice(n.length + 1) ?? null,
  sealConfirmation: () => 'CONFIRMED',
}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServer: async () => ({ auth: { getClaims: async () => ({ data: h.sessionId ? { claims: { session_id: h.sessionId } } : null }) } }) }))

const { POST } = await import('./route')
const post = (code: unknown, cookie = 'eno_fbc_code=SEALED') => (POST as unknown as (r: Request) => Promise<Response>)(new Request('https://eno.vn/x', { method: 'POST', headers: { cookie }, body: JSON.stringify({ code }) }))

beforeEach(() => { h.sessionId = 's1'; h.matches = true })

describe('POST verify', () => {
  it('a right code gives this session an httpOnly confirmation and burns the code', async () => {
    const r = await post('004217')
    expect(r.status).toBe(200)
    const c = r.headers.get('set-cookie')!
    expect(c).toContain('eno_fbc_ok=CONFIRMED')
    expect(c).toContain('eno_fbc_code=;')
    expect(c.toLowerCase()).toContain('httponly')
  })
  it.each([
    ['a wrong code', '111111', 'eno_fbc_code=SEALED'],
    ['no code cookie', '004217', 'other=1'],
    ['a non-string code', 4217, 'eno_fbc_code=SEALED'],
  ])('%s: refused, no confirmation', async (_n, code, cookie) => {
    const r = await post(code, cookie)
    expect(r.status).toBe(400)
    expect(r.headers.get('set-cookie')).toBeNull()
  })
  it('no session id: refused', async () => {
    h.sessionId = null
    expect((await post('004217')).status).toBe(400)
  })
})
