import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** /<page>.md → /md/twin?p=<page>: only this app's own page, signed out, 200 HTML with a <main> and an H1, rate-limited. */
const h = vi.hoisted(() => ({
  limited: false, teacherRow: null as null | { id: string } | 'error', asked: [] as unknown[],
  listingRow: null as null | { sellerId: string } | 'error', listingAsked: [] as unknown[],
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: vi.fn(async () => ({ success: !h.limited })) }))
vi.mock('@/lib/db', () => ({
  db: {
    seller: { findFirst: vi.fn(async (q: unknown) => { h.asked.push(q); if (h.teacherRow === 'error') throw new Error('db down'); return h.teacherRow }) },
    listing: { findFirst: vi.fn(async (q: unknown) => { h.listingAsked.push(q); if (h.listingRow === 'error') throw new Error('db down'); return h.listingRow }) },
  },
}))
// The edition scope as an AND wrapper with the desk exclusion, so the test sees it was applied (no teachers opt-in).
vi.mock('@/lib/edition-scope', () => ({
  scopedListingWhere: vi.fn(async (w: object, opts?: { teachers?: boolean }) => ({ AND: [w, { sellerId: { notIn: ['desk'] } }], opts })),
}))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.9' }))

const PAGE = '<html><body><main><h1>About eno.vn</h1><p>Classifieds.</p></main></body></html>'
const get = async (p: string) => (await import('./route')).GET(new Request(`https://eno.vn/md/twin?p=${encodeURIComponent(p)}`))

beforeEach(() => { h.limited = false; h.teacherRow = null; h.asked = []; h.listingRow = null; h.listingAsked = []; vi.stubEnv('ENO_TWIN_ROOTS', 'about,guides,hcmc-rent-index') })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('/md/twin', () => {
  it('fetches this app\'s own page as a signed-out English reader and answers its markdown, noindex, canonical to the page', async () => {
    vi.stubEnv('PORT', '8080')
    const fetch = vi.fn(async () => new Response(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } }))
    vi.stubGlobal('fetch', fetch)
    const res = await get('about')
    expect(res.status).toBe(200)
    expect(h.asked).toEqual([]) // a content page asks the database nothing
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

  it('⛔ behind the rewrite req.url is the ORIGINAL /about.md: the page comes from the path (measured live)', async () => {
    const fetch = vi.fn(async () => new Response(PAGE, { headers: { 'content-type': 'text/html' } }))
    vi.stubGlobal('fetch', fetch)
    const { GET } = await import('./route')
    const res = await GET(new Request('https://eno.vn/guides/renting-in-hcmc.md'))
    expect(res.status).toBe(200)
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toMatch(/\/guides\/renting-in-hcmc$/)
    // …and the same guards hold on that path.
    expect((await GET(new Request('https://eno.vn/admin.md'))).status).toBe(404)
    expect((await GET(new Request('https://eno.vn/some-shop.md'))).status).toBe(404)
  })

  it('a storefront: /sellers/<id> exactly gets its twin — ⛔ never a teacher\'s, never when the check fails, never deeper', async () => {
    vi.stubEnv('ENO_TWIN_ROOTS', 'about,sellers')
    const fetch = vi.fn(async () => new Response('<main><h1>Saigon Moving</h1><p>Movers.</p></main>', { headers: { 'content-type': 'text/html' } }))
    vi.stubGlobal('fetch', fetch)
    const res = await get('sellers/cmv9r2gxe003801mur0rho9b7')
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text.startsWith('# Saigon Moving\n')).toBe(true)
    expect(text.trimEnd().endsWith('Its text is written by the seller, not by eno.vn.')).toBe(true)
    // A teacher = an owner with a teacher profile (any state) OR any teacher row.
    expect(h.asked[0]).toEqual({
      where: { id: 'cmv9r2gxe003801mur0rho9b7', OR: [{ owner: { teacherProfile: { isNot: null } } }, { listings: { some: { listingType: 'teacher' } } }] },
      select: { id: true },
    })
    h.teacherRow = { id: 't1' }
    expect((await get('sellers/cmv9r2gxe003801mur0rho9b7')).status).toBe(404)
    h.teacherRow = 'error'
    expect((await get('sellers/cmv9r2gxe003801mur0rho9b7')).status).toBe(404)
    expect(fetch).toHaveBeenCalledTimes(1)
    h.teacherRow = null
    h.asked = []
    for (const p of ['sellers', 'sellers/abc/reviews', `sellers/${'a'.repeat(41)}`]) expect((await get(p)).status, p).toBe(404)
    expect(h.asked).toEqual([])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('a listing: /listings/<id> exactly, only a row the public PDP shows, ⛔ never a teacher\'s shop, never deeper', async () => {
    vi.stubEnv('ENO_TWIN_ROOTS', 'about,listings')
    const fetch = vi.fn(async () => new Response('<main><h1>Honda Vision 2021</h1><p>[Pay deposit](https://x.example)</p></main>', { headers: { 'content-type': 'text/html' } }))
    vi.stubGlobal('fetch', fetch)
    h.listingRow = { sellerId: 'shop1' }
    const res = await get('listings/cmv9r2gxe003801mur0rho9b7')
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text.startsWith('# Honda Vision 2021\n')).toBe(true)
    expect(text).toContain('\\[Pay deposit\\]') // seller text stays literal
    expect(text.trimEnd().endsWith('Its text is written by the seller, not by eno.vn.')).toBe(true)
    expect((fetch.mock.calls[0] as unknown as [string])[0]).toMatch(/\/listings\/cmv9r2gxe003801mur0rho9b7$/)
    // The PDP's live rule (verified, active or sold) through the edition scope, with no teachers opt-in…
    expect(h.listingAsked[0]).toEqual({
      where: { AND: [{ id: 'cmv9r2gxe003801mur0rho9b7', verified: true, status: { in: ['active', 'sold'] } }, { sellerId: { notIn: ['desk'] } }], opts: undefined },
      select: { sellerId: true },
    })
    // …and its shop through the storefront's teacher check.
    expect(h.asked[0]).toMatchObject({ where: { id: 'shop1' } })
    h.teacherRow = { id: 'shop1' }
    expect((await get('listings/cmv9r2gxe003801mur0rho9b7')).status).toBe(404)
    h.teacherRow = 'error'
    expect((await get('listings/cmv9r2gxe003801mur0rho9b7')).status).toBe(404)
    h.teacherRow = null
    // Not public (hidden, unverified, a teacher row, the desk: the query finds nothing), or the read fails → 404.
    h.listingRow = null
    expect((await get('listings/cmv9r2gxe003801mur0rho9b7')).status).toBe(404)
    h.listingRow = 'error'
    expect((await get('listings/cmv9r2gxe003801mur0rho9b7')).status).toBe(404)
    expect(fetch).toHaveBeenCalledTimes(1)
    // A UUID id (some imported rows, measured in the live sitemap) is an id like any other.
    h.listingRow = { sellerId: 'e3c06e69-4590-4790-8769-ccaac05cfac2' }
    expect((await get('listings/03ed8867-a7a5-4a06-a1c1-37356a74c6ca')).status).toBe(200)
    expect(h.asked.at(-1)).toMatchObject({ where: { id: 'e3c06e69-4590-4790-8769-ccaac05cfac2' } })
    h.listingAsked = []
    for (const p of ['listings', 'listings/abc/edit', `listings/${'a'.repeat(41)}`]) expect((await get(p)).status, p).toBe(404)
    expect(h.listingAsked).toEqual([])
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
