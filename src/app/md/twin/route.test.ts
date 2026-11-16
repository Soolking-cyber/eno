import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** /<page>.md → /md/twin?p=<page>: only this app's own page, signed out, 200 HTML with a <main> and an H1, rate-limited. */
const h = vi.hoisted(() => ({ limited: false }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: vi.fn(async () => ({ success: !h.limited })) }))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.9' }))

const PAGE = '<html><body><main><h1>About eno.vn</h1><p>Classifieds.</p></main></body></html>'
const get = async (p: string) => (await import('./route')).GET(new Request(`https://eno.vn/md/twin?p=${encodeURIComponent(p)}`))

beforeEach(() => { h.limited = false; vi.stubEnv('ENO_TWIN_ROOTS', 'about,guides,hcmc-rent-index') })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('/md/twin', () => {
  it('fetches this app\'s own page as a signed-out English reader and answers its markdown, noindex, canonical to the page', async () => {
    vi.stubEnv('PORT', '8080')
    const fetch = vi.fn(async () => new Response(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } }))
    vi.stubGlobal('fetch', fetch)
    const res = await get('about')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8')
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('link')).toMatch(/\/about>; rel="canonical"$/)
    expect((await res.text()).startsWith('# About eno.vn\n')).toBe(true)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:8080/about')
    expect((init.headers as Record<string, string>).cookie).toBeUndefined()
    expect((init.headers as Record<string, string>).host).toBe(new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://eno.forum').host)
    expect(init.redirect).toBe('manual')
  })

  it('⛔ refuses every path that is not a plain lower-case slug — before fetching anything', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    for (const p of ['', '../etc/passwd', 'a/../b', '//evil.example', 'About', 'a?x=1', 'a b', 'x/', 'a//b', '%2e%2e', 'http://x',
      'api/mcp', 'admin', 'dashboard/listings', 'listings/abc', 'sellers/x', 'messages/1', 'c/rentals', 'teachers/x', 'en/listings/x', 'vi/sellers/y']) {
      expect((await get(p)).status, p).toBe(404)
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('⛔ only a root page on the build\'s allowlist: a storefront handle or an unlisted page is refused; no list refuses all', async () => {
    const fetch = vi.fn(async () => new Response(PAGE, { headers: { 'content-type': 'text/html' } }))
    vi.stubGlobal('fetch', fetch)
    expect((await get('some-shop')).status).toBe(404)
    expect((await get('guides/renting-in-hcmc')).status).toBe(200)
    vi.stubEnv('ENO_TWIN_ROOTS', '')
    expect((await get('about')).status).toBe(404)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('a page that redirects, fails, is not HTML or has no <main>/H1 has no twin', async () => {
    for (const r of [new Response(null, { status: 308, headers: { location: '/x' } }), new Response('x', { status: 404 }),
      new Response('{}', { headers: { 'content-type': 'application/json' } }), new Response('<html><body><p>x</p></body></html>', { headers: { 'content-type': 'text/html' } })]) {
      vi.stubGlobal('fetch', vi.fn(async () => r))
      expect((await get('about')).status).toBe(404)
    }
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('down') }))
    expect((await get('about')).status).toBe(404)
  })

  it('rate-limited per address: 429, nothing fetched', async () => {
    h.limited = true
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const res = await get('about')
    expect(res.status).toBe(429)
    expect(fetch).not.toHaveBeenCalled()
  })
})
