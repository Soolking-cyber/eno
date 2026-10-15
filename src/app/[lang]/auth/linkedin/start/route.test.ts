import { beforeEach, describe, expect, it, vi } from 'vitest'

// GET /auth/linkedin/start — every refusal goes back to `next` with a reason; a start records consent first and lands
// the PKCE verifier on this host (the cookie adapter), never a second sign-in over an existing session.
const h = vi.hoisted(() => ({
  enabled: true,
  session: null as unknown,
  oauth: vi.fn(async (_o: unknown) => ({ data: { url: 'https://sb.eno.vn/auth/v1/authorize?provider=linkedin_oidc' }, error: null })),
  audits: [] as Array<Record<string, unknown>>,
  auditFails: false,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/linkedin', () => ({ linkedinSignInEnabled: async () => h.enabled }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({ auth: { getSession: async () => ({ data: { session: h.session } }), signInWithOAuth: h.oauth } }),
}))
vi.mock('@/lib/db', () => ({ db: { $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ $executeRaw: async () => 0 }) } }))
vi.mock('@/lib/compliance/audit', () => ({
  appendAudit: async (_tx: unknown, i: Record<string, unknown>) => { if (h.auditFails) throw new Error('x'); h.audits.push(i) },
}))

const { GET } = await import('./route')
const { LINKEDIN_NOTICE_VERSION } = await import('@/lib/teachers/import-notice')
const NEXT = encodeURIComponent('/teachers/join?import=linkedin&goal=cover')
const start = (qs: string, headers: Record<string, string> = {}) => GET(new Request(`https://eno.vn/auth/linkedin/start${qs}`, { headers: { host: 'eno.vn', ...headers } }))

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
  vi.stubEnv('NODE_ENV', 'production')
  Object.assign(h, { enabled: true, session: null, audits: [], auditFails: false })
  h.oauth.mockClear()
})

describe('GET /auth/linkedin/start', () => {
  it('starts from the teacher pages — the join form on either host, the edit page', async () => {
    for (const referer of ['https://eno.vn/teachers/join?import=linkedin', 'https://teacher.eno.vn/', 'https://eno.vn/teachers/edit']) {
      h.oauth.mockClear()
      await start(`?n=${LINKEDIN_NOTICE_VERSION}&next=${NEXT}`, { referer })
      expect(h.oauth, referer).toHaveBeenCalledTimes(1)
    }
  })

  it('records consent, then 3xx to GoTrue with the canonical callback, next kept, extended login on', async () => {
    const res = await start(`?n=${LINKEDIN_NOTICE_VERSION}&next=${NEXT}`)
    expect(res.status).toBeGreaterThanOrEqual(300)
    expect(res.headers.get('location')).toBe('https://sb.eno.vn/auth/v1/authorize?provider=linkedin_oidc')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    const opts = (h.oauth.mock.calls[0][0] as { provider: string; options: { redirectTo: string; queryParams: Record<string, string>; skipBrowserRedirect: boolean } })
    expect(opts.provider).toBe('linkedin_oidc')
    const cb = new URL(opts.options.redirectTo)
    expect(cb.origin + cb.pathname).toBe('https://eno.vn/auth/callback')
    expect(cb.searchParams.get('next')).toBe('/teachers/join?import=linkedin&goal=cover')
    expect(cb.searchParams.get('p')).toBe('linkedin')
    expect(opts.options.queryParams).toEqual({ enable_extended_login: 'true' })
    expect(h.audits).toHaveLength(1)
    expect(h.audits[0]).toMatchObject({ actorId: null, action: 'auth.linkedin.consent', subjectType: 'consent' })
    expect(res.headers.get('set-cookie')).toMatch(new RegExp(`eno_li_consent=${h.audits[0].subjectId as string};.*HttpOnly`, 'i'))
  })

  it.each([
    ['an old notice version', `?n=2020-01-01&next=${NEXT}`, {}, 'notice'],
    ['no notice version at all', `?next=${NEXT}`, {}, 'notice'],
    ['a cross-site navigation (silent forced sign-in)', `?n=${LINKEDIN_NOTICE_VERSION}&next=${NEXT}`, { 'sec-fetch-site': 'cross-site' }, 'off'],
    ['⛔ a link planted on a page with no notice (a chat message)', `?n=${LINKEDIN_NOTICE_VERSION}&next=${NEXT}`, { referer: 'https://eno.vn/messages/abc' }, 'notice'],
    ['⛔ the same link with its Referer suppressed (rel=noreferrer)', `?n=${LINKEDIN_NOTICE_VERSION}&next=${NEXT}`, { 'sec-fetch-site': 'same-origin' }, 'notice'],
    ['⛔ a /teachers/join Referer from another site', `?n=${LINKEDIN_NOTICE_VERSION}&next=${NEXT}`, { referer: 'https://evil.example/teachers/join' }, 'notice'],
  ])('refuses %s → back to next with li=%s', async (_l, qs, headers, li) => {
    const res = await start(qs, headers)
    expect(res.headers.get('location')).toBe(`https://eno.vn/teachers/join?goal=cover&li=${li}`)
    expect(h.oauth).not.toHaveBeenCalled()
    expect(h.audits).toEqual([])
  })

  it('LinkedIn off in GoTrue → li=off, nothing recorded', async () => {
    h.enabled = false
    const res = await start(`?n=${LINKEDIN_NOTICE_VERSION}&next=${NEXT}`)
    expect(res.headers.get('location')).toBe('https://eno.vn/teachers/join?goal=cover&li=off')
  })

  it('⛔ already signed in here → never a second sign-in (it could switch accounts); the import intent is kept', async () => {
    h.session = { access_token: 'x' }
    const res = await start(`?n=${LINKEDIN_NOTICE_VERSION}&next=${NEXT}`)
    expect(res.headers.get('location')).toBe('https://eno.vn/teachers/join?import=linkedin&goal=cover&li=signed_in')
    expect(h.oauth).not.toHaveBeenCalled()
  })

  it('no consent record → no redirect to LinkedIn', async () => {
    h.auditFails = true
    const res = await start(`?n=${LINKEDIN_NOTICE_VERSION}&next=${NEXT}`)
    expect(res.headers.get('location')).toBe('https://eno.vn/teachers/join?goal=cover&li=failed')
    expect(h.oauth).not.toHaveBeenCalled()
  })

  it('an off-site next is refused (safeNextPath)', async () => {
    const res = await start(`?n=2020&next=${encodeURIComponent('https://evil.example/x')}`)
    expect(res.headers.get('location')?.startsWith('https://eno.vn/')).toBe(true)
  })
})
