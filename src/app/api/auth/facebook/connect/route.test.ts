import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  state: { connected: false, canDisconnect: false, email: 'a@x.example' as string | null },
  signInOn: true,
  broken: false,
  configured: true,
  user: { email: 'a@x.example' } as { email?: string } | null,
  sessionId: 's1' as string | null,
  mail: vi.fn(async () => true),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/api/handler', () => ({
  ApiError: class extends Error { constructor(public code: string, public status: number) { super(code) } },
  route: (_o: unknown, fn: (c: { req: Request; userId: string }) => Promise<Response>) => (req: Request) => fn({ req, userId: 'u1' }),
}))
vi.mock('@/lib/admin', () => ({ isAdminEmail: (e: string | null) => e === 'op@x.example' }))
vi.mock('@/lib/auth/facebook', () => ({ facebookSignInEnabled: async () => h.signInOn }))
vi.mock('@/lib/auth/google-oauth', () => ({ canonicalAuthOrigin: () => 'https://eno.vn' }))
vi.mock('@/lib/auth/facebook-connect', () => ({
  FB_CODE_COOKIE: 'eno_fbc_code', FB_CODE_TTL_SECONDS: 600,
  facebookConnectConfigured: () => h.configured,
  facebookConnectionState: async () => { if (h.broken) throw new Error('relation does not exist'); return h.state },
  newConnectCode: () => '004217',
  sealConnectCode: (c: string, u: string, s: string) => `sealed-${c}-${u}-${s}`,
}))
vi.mock('@/lib/emails/facebook-connect-code', () => ({ renderFacebookConnectCodeEmail: ({ code }: { code: string }) => ({ subject: 's', html: code, text: code }) }))
vi.mock('@/lib/mail', () => ({ sendMail: h.mail }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }), getClaims: async () => ({ data: h.sessionId ? { claims: { session_id: h.sessionId } } : null }) } }),
}))

const { GET, POST } = await import('./route')
const get = () => (GET as unknown as (r: Request) => Promise<Response>)(new Request('https://eno.vn/api/auth/facebook/connect'))
const post = (body: unknown = { lang: 'en', to: 'victim@x.example' }) => (POST as unknown as (r: Request) => Promise<Response>)(new Request('https://eno.vn/api/auth/facebook/connect', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  h.state = { connected: false, canDisconnect: false, email: 'a@x.example' }
  h.broken = false; h.signInOn = true; h.configured = true; h.user = { email: 'a@x.example' }; h.sessionId = 's1'
  h.mail.mockClear().mockResolvedValue(true)
})

describe('GET: what the row shows', () => {
  it('offers Connect only with the secret and Facebook sign-in on', async () => {
    expect(await (await get()).json()).toEqual({ on: true, connected: false, canDisconnect: false })
    h.signInOn = false
    expect((await (await get()).json()).on).toBe(false)
    h.signInOn = true; h.configured = false
    expect((await (await get()).json()).on).toBe(false)
  })
  it('never offers an operator Connect', async () => {
    h.state.email = 'op@x.example'
    expect((await (await get()).json()).on).toBe(false)
  })
  it('reports the connection whatever the switches say, so Disconnect stays reachable', async () => {
    h.signInOn = false; h.state = { connected: true, canDisconnect: true, email: 'a@x.example' }
    expect(await (await get()).json()).toEqual({ on: false, connected: true, canDisconnect: true })
  })
})

describe('GET: the states around it', () => {
  it('no secret: no Disconnect, whose code it could not seal', async () => {
    h.configured = false; h.state = { connected: true, canDisconnect: true, email: 'a@x.example' }
    expect(await (await get()).json()).toEqual({ on: false, connected: true, canDisconnect: false })
  })
  it('a box whose script hasn’t run: off, not a 500', async () => {
    h.broken = true
    const r = await get()
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ on: false, connected: false, canDisconnect: false })
  })
})

describe('POST: the code', () => {
  it('mails the session’s own account, whatever the body names, and seals the code to this session in an httpOnly cookie', async () => {
    const r = await post()
    expect(r.status).toBe(200)
    expect(h.mail).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@x.example', text: '004217' }))
    const c = r.headers.get('set-cookie')!
    expect(c).toContain('eno_fbc_code=sealed-004217-u1-s1')
    expect(c.toLowerCase()).toContain('httponly')
    // The code itself never reaches the browser's script.
    expect(JSON.stringify(await r.json())).not.toContain('004217')
  })
  it('no mail sent, no cookie', async () => {
    h.mail.mockResolvedValue(false)
    await expect(post()).rejects.toMatchObject({ code: 'send_failed' })
  })
  it('an operator gets no code', async () => {
    h.user = { email: 'op@x.example' }
    await expect(post()).rejects.toMatchObject({ code: 'forbidden' })
    expect(h.mail).not.toHaveBeenCalled()
  })
})
