import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBrowserClient } from '@supabase/ssr'
import { authCookieOptions } from '@/lib/supabase/cookie-options'
import { inAppHost, IN_APP_HOST_VALUES } from '@/lib/in-app-browser'
import { handoffNonce } from '@/lib/auth/handoff-client'

/**
 * POST /api/auth/handoff/open (Sign in with Apple plan A2 / §7.13, §8): the stored authorize URL — which
 * /auth/escape later 302s visitors to — must be this project's Google PKCE flow returning to THIS site's
 * /auth/callback for THIS nonce. A non-Google provider, a missing code_challenge, any other redirect_to, an
 * unknown `via` — and any query key supabase-js does not send (`scopes` above all) — are refused.
 * ⛔ AND IT ACCEPTS EXACTLY WHAT THE REAL CLIENT SENDS, ON EVERY HOST THE APP IS SERVED FROM (opus gate O1, 2026-10-08):
 * the URL is built here by the production client (@supabase/ssr createBrowserClient), from the redirectTo
 * sign-in-form.tsx computes — and a guard at the bottom reads sign-in-form.tsx, browser.ts, auth-origin.ts and
 * preview.mjs, so the mirror cannot drift from the client.
 */
const h = vi.hoisted(() => ({ opened: [] as Array<[string, string]> }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.9' }))
vi.mock('@/lib/auth/handoff', () => ({
  HANDOFF_COOKIE: 'eno_handoff',
  HANDOFF_TTL_MS: 15 * 60_000,
  isNonce: (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_-]{40,90}$/.test(v),
  openHandoff: async (nonce: string, url: string) => { h.opened.push([nonce, url]) },
}))

const { POST } = await import('./route')

const NONCE = 'n'.repeat(43)
const CHALLENGE = 'C'.repeat(43)
/**
 * A hand-built authorize URL, for the refusals — the shape the real client produces (the first tests read it off
 * the production client itself): provider, redirect_to, code_challenge, code_challenge_method.
 */
const authorize = (o: { provider?: string; redirectTo?: string; challenge?: string | null; method?: string; extra?: string } = {}) => {
  const p = [`provider=${encodeURIComponent(o.provider ?? 'google')}`]
  p.push(`redirect_to=${encodeURIComponent(o.redirectTo ?? `https://eno.vn/auth/callback?handoff=${NONCE}&via=zalo`)}`)
  if (o.challenge !== null) p.push(new URLSearchParams({ code_challenge: o.challenge ?? CHALLENGE, code_challenge_method: o.method ?? 's256' }).toString())
  if (o.extra) p.push(o.extra)
  return `https://sb.example/auth/v1/authorize?${p.join('&')}`
}

/**
 * What the sign-in form's hand-off really sends: the URL from the client the form really uses — @supabase/ssr's
 * createBrowserClient with the production cookie options (src/lib/supabase/browser.ts; the guard at the bottom pins
 * that), so an ssr-level default (e.g. auth-js's appendPkceFlowIdToRedirects adding sb_flow_id to redirect_to) fails
 * HERE, not as a dead hand-off in production (verifier, 2026-10-09: the bare supabase-js client could not see one).
 * Outside a browser it needs a cookie jar: in memory. No singleton, no network.
 */
async function realAuthorizeUrl(redirectTo: string): Promise<string> {
  const jar = new Map<string, string>()
  const sb = createBrowserClient('https://sb.example', 'anon-key', {
    cookieOptions: authCookieOptions({ proto: 'https:' }),
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cs) => { for (const c of cs) jar.set(c.name, c.value) },
    },
    isSingleton: false,
    global: { fetch: () => Promise.reject(new Error('no network in this test')) },
  })
  const { data, error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } })
  if (error || !data.url) throw error ?? new Error('no url')
  return data.url
}

/**
 * sign-in-form.tsx's hand-off, computed the way it computes it (the source guard below pins every expression):
 *   authOrigin = AUTH_USES_REQUEST_ORIGIN ? window.location.origin : (NEXT_PUBLIC_APP_URL || window.location.origin)
 *   via        = handoffVia() — inAppHost(), else 'pwa' for an iOS home-screen app
 *   redirectTo = `${authOrigin}/auth/callback?handoff=${encodeURIComponent(nonce)}${via ? `&via=${encodeURIComponent(via)}` : ''}`
 */
function clientRedirectTo(o: { page: string; localAuth: boolean; appUrl: string | undefined; nonce: string; ua?: string; pwa?: boolean }): string {
  const authOrigin = o.localAuth ? o.page : (o.appUrl || o.page)
  const via = (o.ua ? inAppHost(o.ua) : null) ?? (o.pwa ? 'pwa' : null)
  const viaQ = via ? `&via=${encodeURIComponent(via)}` : ''
  return `${authOrigin}/auth/callback?handoff=${encodeURIComponent(o.nonce)}${viaQ}`
}

/** The client's POST: relative (`fetch('/api/auth/handoff/open')`), so Origin and Host are the page's own. */
const post = (authUrl: string, o: { page?: string; host?: string; nonce?: string } = {}) => {
  const page = o.page ?? 'https://eno.vn'
  return POST(new Request(`${page}/api/auth/handoff/open`, {
    method: 'POST',
    headers: { origin: page, host: o.host ?? new URL(page).host, 'content-type': 'application/json' },
    body: JSON.stringify({ nonce: o.nonce ?? NONCE, authUrl }),
  }))
}
const open = (authUrl: string, nonce = NONCE) => post(authUrl, { nonce })

/** Real user agents, one per hand-off origin the confirm screens name (in-app-browser.ts IN_APP_HOSTS). */
const UAS: Record<string, string> = {
  facebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.40.94;FBBV/600000000;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBID/phone;FBLC/vi_VN;FBOP/5]',
  messenger: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/470.0.0.24.109;FBBV/600000001;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBID/phone;FBLC/vi_VN;FBOP/5]',
  instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 334.0.4.32.98 (iPhone15,2; iOS 17_5; vi_VN; vi; scale=3.00; 1179x2556; 609378127)',
  zalo: 'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36 Zalo android/12210160 ZaloTheme/light ZaloLanguage/vn',
  tiktok: 'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.179 Mobile Safari/537.36 trill_340204 BytedanceWebview/d8a21c6',
  line: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.8.0',
  google: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/321.0.645944285 Mobile/15E148 Safari/604.1',
  other: 'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36',
}

beforeEach(() => {
  h.opened = []
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://sb.example')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
  vi.stubEnv('LOCAL_AUTH', '')
})
afterEach(() => vi.unstubAllEnvs())

describe('POST /api/auth/handoff/open', () => {
  // ⛔ THE ALLOW-LIST BELOW IS EXACTLY WHAT supabase-js SENDS — measured on the production client, so an upgrade that
  // adds a key fails HERE (and gets a decision), not as a dead hand-off in production.
  it('accepts the URL the production client (@supabase/ssr over supabase-js) builds for the hand-off, with or without a via', async () => {
    for (const redirectTo of [`https://eno.vn/auth/callback?handoff=${NONCE}&via=zalo`, `https://eno.vn/auth/callback?handoff=${NONCE}`]) {
      const url = await realAuthorizeUrl(redirectTo)
      expect([...new URL(url).searchParams.keys()].sort()).toEqual(['code_challenge', 'code_challenge_method', 'provider', 'redirect_to'])
      const res = await open(url)
      expect(res.status, url).toBe(200)
    }
    expect(h.opened).toHaveLength(2)
  })

  it('⛔ refuses a fragment on the authorize URL itself — a stored #access_token could ride the redirects (round 9)', async () => {
    const url = await realAuthorizeUrl(`https://eno.vn/auth/callback?handoff=${NONCE}`)
    expect((await post(url)).status).toBe(200)
    for (const frag of ['#access_token=a&refresh_token=b', '#x', '#']) {
      const res = await post(url + frag)
      expect(res.status, frag).toBe(400)
      expect(await res.json()).toEqual({ error: 'bad_url' })
    }
  })

  it('refuses any provider but Google', async () => {
    for (const provider of ['apple', 'github', 'Google']) {
      const res = await open(authorize({ provider }))
      expect(res.status, provider).toBe(400)
      expect(await res.json()).toEqual({ error: 'bad_url' })
    }
    expect((await open(authorize({ extra: 'provider=google' })).then((r) => r.status))).toBe(400) // a second provider
  })

  it('refuses a missing, malformed or non-S256 code_challenge (the implicit flow puts tokens in the URL)', async () => {
    expect((await open(authorize({ challenge: null }))).status).toBe(400)
    expect((await open(authorize({ challenge: 'short' }))).status).toBe(400)
    expect((await open(authorize({ challenge: `${'C'.repeat(42)}!` }))).status).toBe(400)
    expect((await open(authorize({ method: 'plain' }))).status).toBe(400)
  })

  it('refuses every other redirect_to — foreign hosts, schemes, paths, another nonce, anything extra', async () => {
    for (const redirectTo of [
      `https://eno.vn/auth/callback?handoff=${'x'.repeat(43)}`,           // another handoff
      `https://eno.vn/auth/callback?handoff=${NONCE}&next=%2Fx`,         // anything extra
      `https://eno.vn/auth/callback?handoff=${NONCE}&via=zalo&p=apple`,
      `enovn://eno.vn/auth/callback?handoff=${NONCE}`,                   // another scheme on SITE_URL's host
      'http://127.0.0.1:9/',                                              // a loopback IP
      `http://localhost:3000/auth/callback?handoff=${NONCE}`,            // the preview's, on a production box
      `http://eno.vn/auth/callback?handoff=${NONCE}`,
      `https://eno.vn.evil.example/auth/callback?handoff=${NONCE}`,
      `https://evil.example/auth/callback?handoff=${NONCE}`,
      `https://www.eno.forum/auth/callback?handoff=${NONCE}`,            // the other edition's origin
      `https://www.eno.vn/auth/callback?handoff=${NONCE}`,               // a twin host: the client never sends it
      `https://apple.eno.vn/auth/callback?handoff=${NONCE}`,             // a storefront host: nor this
      `https://eno.vn/auth/callback-evil?handoff=${NONCE}`,
      `https://eno.vn/x/auth/callback?handoff=${NONCE}`,
      `https://eno.vn//auth/callback?handoff=${NONCE}`,                  // only when the env itself ends in "/"
      `https://eno.vn/auth/callback?handoff=${NONCE}#x`,
    ]) {
      expect((await open(authorize({ redirectTo }))).status, redirectTo).toBe(400)
    }
    expect((await open(authorize({ extra: `redirect_to=${encodeURIComponent('https://evil.example/')}` }))).status).toBe(400) // a second redirect_to
    expect(h.opened).toEqual([])
  })

  // ⛔ Review, 2026-10-08: GoTrue adds `scopes` to Google's own and passes every other parameter on to Google, so a
  // crafted row could send whoever opens /auth/escape?h=… to a consent screen for, say, Gmail.
  it('refuses any query key supabase-js does not send — scopes first of all', async () => {
    for (const extra of [
      `scopes=${encodeURIComponent('https://www.googleapis.com/auth/gmail.readonly')}`,
      'skip_http_redirect=true',
      'access_type=offline',
      'prompt=consent',
      'login_hint=victim%40example.com',
      'Provider=google',
      'redirect_to',
    ]) {
      const res = await open(authorize({ extra }))
      expect(res.status, extra).toBe(400)
      expect(await res.json()).toEqual({ error: 'bad_url' })
    }
    expect(h.opened).toEqual([])
  })

  it('refuses an unknown via', async () => {
    for (const via of ['evil', 'Zalo', '', 'zalo%20']) {
      expect((await open(authorize({ redirectTo: `https://eno.vn/auth/callback?handoff=${NONCE}&via=${via}` }))).status, via).toBe(400)
    }
  })

  it('keeps the host and path pins', async () => {
    expect((await open(authorize().replace('https://sb.example', 'https://evil.supabase.co'))).status).toBe(400)
    expect((await open(authorize().replace('/auth/v1/authorize', '/auth/v1/authorize-evil'))).status).toBe(400)
  })
})

/**
 * ⛔ O1 (opus, commit gate 2026-10-08): "the pin can reject legitimate visitors" — the real client's URL, on every host
 * the app is served from, with every `via` it can send. Measured beside it: eno.forum 308s to www.eno.forum and
 * www.eno.vn to eno.vn, so the canonical host is the one a visitor's page is on.
 * The preview rows prove THIS route only: once part C is installed, production GoTrue (nginx's authorize guard, and
 * I8's --drop-localhost-redirect) refuses a loopback redirect_to, so a preview's hand-off stops at GoTrue's authorize.
 */
describe('⛔ O1 — every host, preview and via the real client sends is accepted; nothing else', () => {
  const vias = [...Object.keys(UAS).map((k) => ({ label: k, ua: UAS[k] })), { label: 'pwa', pwa: true }, { label: 'none' }] as Array<{ label: string; ua?: string; pwa?: boolean }>

  it('the UA list covers every via the confirm screens know — a new in-app host needs a line here', () => {
    const produced = new Set(vias.map((v) => (v.ua ? inAppHost(v.ua) : v.pwa ? 'pwa' : null)).filter(Boolean))
    expect(produced).toEqual(new Set([...IN_APP_HOST_VALUES, 'pwa']))
  })

  const hosts: Array<{ name: string; env: Record<string, string>; page: string; localAuth: boolean }> = [
    { name: 'eno.vn (marketplace, production)', env: { NEXT_PUBLIC_APP_URL: 'https://eno.vn' }, page: 'https://eno.vn', localAuth: false },
    { name: 'www.eno.forum (services, production)', env: { NEXT_PUBLIC_APP_URL: 'https://www.eno.forum' }, page: 'https://www.eno.forum', localAuth: false },
    { name: 'a local preview of eno.vn (preview.mjs: NODE_ENV production + LOCAL_AUTH)', env: { NEXT_PUBLIC_APP_URL: 'https://eno.vn', LOCAL_AUTH: '1' }, page: 'http://localhost:3000', localAuth: true },
    { name: 'the same preview on 127.0.0.1', env: { NEXT_PUBLIC_APP_URL: 'https://eno.vn', LOCAL_AUTH: '1' }, page: 'http://127.0.0.1:3000', localAuth: true },
    { name: 'the same preview on [::1]', env: { NEXT_PUBLIC_APP_URL: 'https://eno.vn', LOCAL_AUTH: '1' }, page: 'http://[::1]:3000', localAuth: true },
    { name: 'a local preview of eno.forum (:3101)', env: { NEXT_PUBLIC_APP_URL: 'https://www.eno.forum', LOCAL_AUTH: '1' }, page: 'http://localhost:3101', localAuth: true },
    { name: '`next dev`', env: { NODE_ENV: 'development', NEXT_PUBLIC_APP_URL: 'https://eno.vn' }, page: 'http://localhost:3000', localAuth: true },
  ]
  for (const host of hosts) {
    it(`${host.name}: every via → 200, with the row holding the exact URL`, async () => {
      for (const [k, v] of Object.entries(host.env)) vi.stubEnv(k, v)
      for (const via of vias) {
        const nonce = handoffNonce()
        const url = await realAuthorizeUrl(clientRedirectTo({ page: host.page, localAuth: host.localAuth, appUrl: host.env.NEXT_PUBLIC_APP_URL, nonce, ua: via.ua, pwa: via.pwa }))
        const res = await post(url, { page: host.page, nonce })
        expect(res.status, `${host.name} / ${via.label}: ${url}`).toBe(200)
        expect(h.opened.at(-1)).toEqual([nonce, url])
      }
    })
  }

  it('NEXT_PUBLIC_APP_URL with a trailing slash: the client concatenates it raw — that exact redirect_to is accepted, the normalized one is not what it sends', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn/')
    const sent = clientRedirectTo({ page: 'https://eno.vn', localAuth: false, appUrl: 'https://eno.vn/', nonce: NONCE, ua: UAS.zalo })
    expect(sent).toBe(`https://eno.vn//auth/callback?handoff=${NONCE}&via=zalo`)
    expect((await post(await realAuthorizeUrl(sent))).status).toBe(200)
    expect((await post(await realAuthorizeUrl(`https://eno.vn/auth/callback?handoff=${NONCE}&via=zalo`))).status).toBe(400)
  })

  it('in production the Host header moves nothing: a storefront or twin Host still expects the canonical redirect_to', async () => {
    const canonical = await realAuthorizeUrl(clientRedirectTo({ page: 'https://apple.eno.vn', localAuth: false, appUrl: 'https://eno.vn', nonce: NONCE, ua: UAS.facebook }))
    expect(new URL(canonical).searchParams.get('redirect_to')).toBe(`https://eno.vn/auth/callback?handoff=${NONCE}&via=facebook`)
    for (const host of ['apple.eno.vn', 'www.eno.vn', 'localhost:3000']) {
      const res = await POST(new Request('https://eno.vn/api/auth/handoff/open', {
        method: 'POST', headers: { origin: 'https://eno.vn', host, 'content-type': 'application/json' }, body: JSON.stringify({ nonce: NONCE, authUrl: canonical }),
      }))
      expect(res.status, host).toBe(200)
    }
    const storefrontRedirect = await realAuthorizeUrl(`https://apple.eno.vn/auth/callback?handoff=${NONCE}`)
    expect((await post(storefrontRedirect, { host: 'apple.eno.vn' })).status).toBe(400)
  })

  it('a page on a storefront or twin host is refused at the Origin check, as every write from one is (src/proxy.ts: a storefront is a read surface)', async () => {
    for (const page of ['https://apple.eno.vn', 'https://www.eno.vn']) {
      const url = await realAuthorizeUrl(clientRedirectTo({ page, localAuth: false, appUrl: 'https://eno.vn', nonce: NONCE }))
      const res = await post(url, { page })
      expect(res.status, page).toBe(403)
      expect(await res.json()).toEqual({ error: 'bad_origin' })
    }
  })

  describe('the local-preview exception cannot be reached any other way', () => {
    it('the flag with a NON-loopback Host (a production box wrongly carrying LOCAL_AUTH): a loopback Origin is refused, and so is a loopback redirect_to', async () => {
      vi.stubEnv('LOCAL_AUTH', '1')
      const loop = await realAuthorizeUrl(`http://localhost:3000/auth/callback?handoff=${NONCE}`)
      expect((await post(loop, { page: 'http://localhost:3000', host: 'eno.vn' })).status).toBe(403)
      expect((await post(loop, { page: 'https://eno.vn', host: 'eno.vn' })).status).toBe(400)
    })
    it('a loopback Host WITHOUT the server flag (a production build serving localhost): refused, as before', async () => {
      const loop = await realAuthorizeUrl(`http://localhost:3000/auth/callback?handoff=${NONCE}`)
      expect((await post(loop, { page: 'http://localhost:3000' })).status).toBe(403)
    })
    it('in the preview: an Origin that is not the request\'s own loopback origin is refused, and the canonical redirect_to is not what the page sends', async () => {
      vi.stubEnv('LOCAL_AUTH', '1')
      const loop = await realAuthorizeUrl(`http://localhost:3000/auth/callback?handoff=${NONCE}`)
      const res = await POST(new Request('http://localhost:3000/api/auth/handoff/open', {
        method: 'POST', headers: { origin: 'http://localhost:3001', host: 'localhost:3000', 'content-type': 'application/json' }, body: JSON.stringify({ nonce: NONCE, authUrl: loop }),
      }))
      expect(res.status).toBe(403)
      const canonical = await realAuthorizeUrl(`https://eno.vn/auth/callback?handoff=${NONCE}`)
      expect((await post(canonical, { page: 'http://localhost:3000' })).status).toBe(400)
      expect((await post(await realAuthorizeUrl(`http://localhost:3001/auth/callback?handoff=${NONCE}`), { page: 'http://localhost:3000' })).status).toBe(400)
    })
  })

  /** The mirror above is only as good as its match with the client: these are the expressions it reproduces. */
  it('the source still computes the hand-off the way clientRedirectTo mirrors it', () => {
    const form = readFileSync('src/components/marketplace/sign-in-form.tsx', 'utf8')
    for (const expr of [
      'if (AUTH_USES_REQUEST_ORIGIN) return window.location.origin',
      'return process.env.NEXT_PUBLIC_APP_URL || window.location.origin',
      'const via = handoffVia()',
      "const viaQ = via ? `&via=${encodeURIComponent(via)}` : ''",
      // The WHOLE options object (round 10, opus): a key added after skipBrowserRedirect (queryParams…) would reach the
      // authorize URL, and the query pin above would then refuse every in-app hand-off.
      'options: { redirectTo: `${authOrigin}/auth/callback?handoff=${encodeURIComponent(nonce)}${viaQ}`, skipBrowserRedirect: true },',
      "await fetch('/api/auth/handoff/open', {",
      'const host = inAppHost()',
      "return 'pwa'",
      "return (await import('@/lib/supabase/browser')).createSupabaseBrowser()",
    ]) expect(form, expr).toContain(expr)
    // …and the client the form gets is the one realAuthorizeUrl builds: @supabase/ssr's, with the production cookie options.
    const browser = readFileSync('src/lib/supabase/browser.ts', 'utf8')
    expect(browser).toContain("import { createBrowserClient } from '@supabase/ssr'")
    expect(browser).toContain('{ cookieOptions: authCookieOptions({ proto: globalThis.location?.protocol }) }')
    const origin = readFileSync('src/lib/auth-origin.ts', 'utf8')
    expect(origin).toContain("export const AUTH_USES_REQUEST_ORIGIN = process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_LOCAL_AUTH === '1'")
    expect(origin).toContain("return process.env.NODE_ENV === 'development' || process.env.LOCAL_AUTH === '1'")
    const preview = readFileSync('scripts/preview.mjs', 'utf8')
    expect(preview).toContain("NEXT_PUBLIC_LOCAL_AUTH: '1',")
    expect(preview).toContain("LOCAL_AUTH: '1',")
  })
})
