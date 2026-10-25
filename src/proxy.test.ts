import { describe, expect, it, vi, afterEach } from 'vitest'
import { isLoopbackSelfOrigin } from './proxy'

/**
 * ⛔ THE WRITE-ORIGIN GUARD MADE THE LOCAL PREVIEW UNTESTABLE. `NEXT_PUBLIC_APP_URL` is a real host
 * even in a preview, so a browser on `http://localhost:3101` sent an Origin that was never in the
 * allow-list and EVERY mutating request 403'd — discovered when a payout save failed for a reason
 * that had nothing to do with the form.
 *
 * ⚠️ THE CARVE-OUT IS A SECURITY BOUNDARY, so these tests are mostly about what it REFUSES.
 */

const req = (host: string) =>
  ({ headers: new Headers({ host }), url: `http://${host}/api/x` })

afterEach(() => vi.unstubAllEnvs())

describe('isLoopbackSelfOrigin', () => {
  it('allows a local preview to write to itself', () => {
    expect(isLoopbackSelfOrigin(req('localhost:3101'), 'http://localhost:3101')).toBe(true)
    expect(isLoopbackSelfOrigin(req('127.0.0.1:3000'), 'http://127.0.0.1:3000')).toBe(true)
  })

  it('⛔ an Origin claiming localhost cannot authorise a write to a REAL host', () => {
    // The half that matters. Without comparing against the request's own Host, anyone could send
    // `Origin: http://localhost` to production and bypass the guard entirely.
    expect(isLoopbackSelfOrigin(req('eno.forum'), 'http://localhost:3101')).toBe(false)
    expect(isLoopbackSelfOrigin(req('www.eno.vn'), 'http://localhost')).toBe(false)
    expect(isLoopbackSelfOrigin(req('apple.eno.vn'), 'http://localhost:3101')).toBe(false)
  })

  it('⛔ a REAL host writing to itself is still refused — this is not a same-origin rule', () => {
    /**
     * ⛔ THE HOLE THE GUARD EXISTS FOR. A general same-origin exemption would let a storefront host
     * write as its own visitor, which is exactly the attack the write-origin pin was added to stop.
     * Loopback only.
     */
    expect(isLoopbackSelfOrigin(req('apple.eno.vn'), 'https://apple.eno.vn')).toBe(false)
    expect(isLoopbackSelfOrigin(req('eno.forum'), 'https://eno.forum')).toBe(false)
  })

  it('⛔ a hostname that merely CONTAINS localhost is not loopback', () => {
    for (const o of ['https://localhost.evil.com', 'https://notlocalhost', 'https://localhost.co']) {
      expect(isLoopbackSelfOrigin(req('localhost.evil.com'), o), o).toBe(false)
    }
  })

  it('⛔ a malformed Origin or Host is refused, not thrown on', () => {
    for (const o of ['', 'not a url', 'javascript:alert(1)']) {
      expect(() => isLoopbackSelfOrigin(req('localhost:3101'), o), o).not.toThrow()
      expect(isLoopbackSelfOrigin(req('localhost:3101'), o), o).toBe(false)
    }
    expect(isLoopbackSelfOrigin({ headers: new Headers(), url: 'http://x/' }, 'http://localhost')).toBe(false)
  })

  it('⚠️ neither the port NOR the loopback spelling need match', () => {
    /**
     * ⚠️ AN EARLIER VERSION ALSO REQUIRED THE TWO HOSTNAMES TO BE IDENTICAL, and mutation-testing
     * showed that line was dead weight — the "both must be loopback" rule already refuses a real
     * host. All the equality added was rejecting a browser on `127.0.0.1` talking to a server that
     * calls itself `localhost`: the same machine, refused for no reason. These cases pin that.
     */
    expect(isLoopbackSelfOrigin(req('localhost:3101'), 'http://localhost:3000')).toBe(true)
    expect(isLoopbackSelfOrigin(req('localhost:3101'), 'http://127.0.0.1:3101')).toBe(true)
    expect(isLoopbackSelfOrigin(req('127.0.0.1:3101'), 'http://localhost:3101')).toBe(true)
  })
})

/**
 * ⛔ THE LANGUAGE REWRITE DECIDES WHICH HTML EVERY VISITOR GETS. Pages live under the hidden `[lang]`
 * segment, so a request that is not rewritten reaches no page at all, and a request rewritten into
 * the wrong variant is a Vietnamese reader served English (or the reverse) from first paint.
 */
describe('language rewrite into the hidden [lang] segment', () => {
  const run = async (path: string, init: { method?: string; headers?: Record<string, string> } = {}) => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
    const { NextRequest } = await import('next/server')
    const { proxy } = await import('./proxy')
    const res = proxy(new NextRequest(`https://eno.vn${path}`, { method: init.method ?? 'GET', headers: { host: 'eno.vn', ...(init.headers ?? {}) } }))
    const target = res.headers.get('x-middleware-rewrite')
    return { status: res.status, rewrite: target ? new URL(target).pathname : null, contentLanguage: res.headers.get('content-language'), setCookie: res.headers.get('set-cookie') }
  }

  it('renders Vietnamese for a Vietnamese browser and English otherwise', async () => {
    expect((await run('/', { headers: { 'accept-language': 'vi-VN,vi;q=0.9' } })).rewrite).toBe('/vi')
    expect((await run('/c/rentals', { headers: { 'accept-language': 'vi' } })).rewrite).toBe('/vi/c/rentals')
    expect((await run('/c/rentals', { headers: { 'accept-language': 'en-US' } })).rewrite).toBe('/en/c/rentals')
    expect((await run('/c/rentals')).rewrite).toBe('/en/c/rentals')
    expect((await run('/', { headers: { 'accept-language': 'vi' } })).contentLanguage).toBe('vi')
  })

  it('⛔ Content-Language is EXACTLY the rendered variant on every edge-cached route family', async () => {
    // infra/cloudflare/eno-html-edge-cache.js stores a page only if this header equals its key's
    // variant (`en` / `vi`, lowercase, no region). Emit `vi-VN`, or drop it, and the edge cache
    // silently stores nothing — every test there stays green, TTFB goes back to origin speed.
    for (const path of ['/', '/c/rentals', '/privacy', '/safety', '/sellers/s1', '/terms']) {
      for (const [al, want] of [['vi-VN,vi;q=0.9', 'vi'], ['en-US,en;q=0.9', 'en']] as const) {
        const r = await run(path, { headers: { 'accept-language': al } })
        expect(r.contentLanguage, `${path} ${al}`).toBe(want)
        expect(r.rewrite?.split('/')[1], `${path} ${al}`).toBe(want)
        // …and it sets no cookie: the Worker refuses to store a response that does.
        expect(r.setCookie, `${path} ${al}`).toBeNull()
      }
    }
  })

  it('lets the lang cookie override the browser', async () => {
    expect((await run('/about', { headers: { 'accept-language': 'vi', cookie: 'lang=en' } })).rewrite).toBe('/en/about')
    expect((await run('/about', { headers: { 'accept-language': 'en', cookie: 'lang=vi' } })).rewrite).toBe('/vi/about')
  })

  it('keeps the query string', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
    const { NextRequest } = await import('next/server')
    const { proxy } = await import('./proxy')
    const res = proxy(new NextRequest('https://eno.vn/?category=rentals&sort=newest', { headers: { host: 'eno.vn', 'accept-language': 'vi' } }))
    const u = new URL(res.headers.get('x-middleware-rewrite')!)
    expect(u.pathname).toBe('/vi')
    expect(u.search).toBe('?category=rentals&sort=newest')
  })

  it('⛔ a public /en/… or /vi/… is not a second URL for the page', async () => {
    expect((await run('/vi/c/rentals', { headers: { 'accept-language': 'vi' } })).rewrite).toBe('/vi/~/not-found')
    expect((await run('/en', { headers: { 'accept-language': 'en' } })).rewrite).toBe('/en/~/not-found')
    // …but a path that merely starts with those letters is an ordinary page
    expect((await run('/vietnam-evisa', { headers: { 'accept-language': 'en' } })).rewrite).toBe('/en/vietnam-evisa')
  })

  it('rewrites a Server Action POST too — it posts to the page URL', async () => {
    const r = await run('/listings/abc', { method: 'POST', headers: { origin: 'https://eno.vn', 'accept-language': 'vi' } })
    expect(r.rewrite).toBe('/vi/listings/abc')
  })

  it('still refuses a cross-origin write before routing', async () => {
    const r = await run('/listings/abc', { method: 'POST', headers: { origin: 'https://evil.example', 'accept-language': 'vi' } })
    expect(r.status).toBe(403)
  })

  it('⛔ tells Cloudflare never to store a language-dependent page', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
    const { NextRequest } = await import('next/server')
    const { proxy } = await import('./proxy')
    const res = proxy(new NextRequest('https://eno.vn/', { headers: { host: 'eno.vn', 'accept-language': 'vi' } }))
    expect(res.headers.get('cloudflare-cdn-cache-control')).toBe('no-store')
  })

  it('the matcher skips only the real root handlers, not handles that merely start like them', async () => {
    const { config } = await import('./proxy')
    const re = new RegExp(`^${config.matcher[1]}$`)
    for (const p of ['/', '/c/rentals', '/listing-images-shop', '/sitemaps-shop', '/apple', '/mdx', '/auth/callback', '/ogilvy']) expect(re.test(p), p).toBe(true)
    for (const p of ['/listing-images', '/listing-images/x', '/sitemaps', '/sitemaps/pages.xml', '/sitemaps/listings-0.xml', '/md/home', '/app', '/_next/static/a.js', '/icon.svg', '/agents.md', '/og', '/og/teach-in-vietnam', '/og/teach-in-vietnam/1200x630.png']) expect(re.test(p), p).toBe(false)
  })

  it('⛔ every route handler left at the src/app root is excluded — a rewrite would 404 it', async () => {
    const { config } = await import('./proxy')
    const { readdirSync, statSync } = await import('node:fs')
    const re = new RegExp(`^${config.matcher[1]}$`)
    for (const name of readdirSync('src/app')) {
      if (name === '[lang]' || !statSync(`src/app/${name}`).isDirectory()) continue
      expect(re.test(`/${name}`), `/${name}`).toBe(false)
    }
  })

  it('never rewrites /api', async () => {
    const r = await run('/api/listings', { headers: { 'accept-language': 'vi' } })
    expect(r.rewrite).toBe(null)
  })

  it('composes with the storefront subdomain and its internal-path guard', async () => {
    expect((await run('/', { headers: { host: 'apple.eno.vn', 'accept-language': 'vi' } })).rewrite).toBe('/vi/s/apple')
    expect((await run('/s/apple', { headers: { 'accept-language': 'en' } })).rewrite).toBe('/en/~/not-found')
  })
})

/**
 * ⛔ A FIXED-LANGUAGE GUIDE RENDERS IN ITS ARTICLE'S LANGUAGE FOR EVERY VISITOR (SEO wave B, V1). Googlebot
 * sends no Accept-Language, so before this it read every Vietnamese guide as Vietnamese prose inside
 * English chrome. Pinning is by the path the guide already has: no new URL, no redirect, no cookie.
 */
describe('fixed-language guides', () => {
  const run = async (path: string, init: { method?: string; host?: string; headers?: Record<string, string> } = {}) => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
    const { NextRequest } = await import('next/server')
    const { proxy } = await import('./proxy')
    const host = init.host ?? 'eno.vn'
    const res = proxy(new NextRequest(`https://${host}${path}`, { method: init.method ?? 'GET', headers: { host, ...(init.headers ?? {}) } }))
    const target = res.headers.get('x-middleware-rewrite')
    return { status: res.status, rewrite: target ? new URL(target).pathname : null, contentLanguage: res.headers.get('content-language'), setCookie: res.headers.get('set-cookie'), location: res.headers.get('location') }
  }
  const VI = '/thanh-ly-do-gia-dung-cu-tphcm'
  const EN = '/secondhand-furniture-ho-chi-minh-city'

  it('a Vietnamese guide is Vietnamese whatever the cookie or the browser says', async () => {
    const cases: Record<string, string>[] = [{}, { cookie: 'lang=en' }, { 'accept-language': 'en-US,en;q=0.9' }, { cookie: 'lang=en', 'accept-language': 'vi' }, { cookie: 'lang=ko' }]
    for (const headers of cases) {
      const r = await run(VI, { headers })
      expect(r.rewrite, JSON.stringify(headers)).toBe(`/vi${VI}`)
      expect(r.contentLanguage, JSON.stringify(headers)).toBe('vi')
      expect(r.setCookie, JSON.stringify(headers)).toBeNull()
      expect(r.location, JSON.stringify(headers)).toBeNull()
    }
  })

  it('an English guide is English for a Vietnamese browser and a vi cookie (V-f)', async () => {
    const cases: Record<string, string>[] = [{ 'accept-language': 'vi-VN,vi;q=0.9' }, { cookie: 'lang=vi' }]
    for (const headers of cases) {
      const r = await run(EN, { headers })
      expect(r.rewrite, JSON.stringify(headers)).toBe(`/en${EN}`)
      expect(r.contentLanguage, JSON.stringify(headers)).toBe('en')
    }
  })

  it('keeps the query string', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
    const { NextRequest } = await import('next/server')
    const { proxy } = await import('./proxy')
    const res = proxy(new NextRequest(`https://eno.vn${VI}?utm_source=x`, { headers: { host: 'eno.vn', cookie: 'lang=en' } }))
    const u = new URL(res.headers.get('x-middleware-rewrite')!)
    expect(u.pathname).toBe(`/vi${VI}`)
    expect(u.search).toBe('?utm_source=x')
  })

  it('POST requests are pinned too — a Server Action posts to the page URL', async () => {
    const r = await run(VI, { method: 'POST', headers: { origin: 'https://eno.vn', cookie: 'lang=en' } })
    expect(r.rewrite).toBe(`/vi${VI}`)
  })

  it('pins on eno.forum as well (V-i)', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.eno.forum')
    const { NextRequest } = await import('next/server')
    const { proxy } = await import('./proxy')
    const res = proxy(new NextRequest(`https://www.eno.forum${VI}`, { headers: { host: 'www.eno.forum', 'accept-language': 'en-US' } }))
    expect(new URL(res.headers.get('x-middleware-rewrite')!).pathname).toBe(`/vi${VI}`)
  })

  it('a storefront host pins nothing: a guide asked of it goes to the apex, where the guide is pinned', async () => {
    // Since the sweep of 2026-10-22 every page path but `/` on a shop's host 302s to the apex (see below).
    expect(await run(VI, { host: 'apple.eno.vn', headers: { 'accept-language': 'en-US' } })).toMatchObject({ status: 302, location: `https://eno.vn${VI}`, rewrite: null })
    expect(await run(EN, { host: 'apple.eno.vn', headers: { cookie: 'lang=vi' } })).toMatchObject({ status: 302, location: `https://eno.vn${EN}`, rewrite: null })
  })

  /**
   * ⛔ ON A SHOP'S HOST, ONLY `/` IS THE SHOP (sweep, 2026-10-22). The ordinary app answered every other path there, always
   * signed out (host-only cookie), so a tap on a product kept the visitor where Chat, Save and sign-in cannot work.
   */
  it('⛔ a shop host sends every other GET/HEAD page path to the same path on the apex — 302, never stored', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
    const { NextRequest } = await import('next/server')
    const { proxy } = await import('./proxy')
    for (const [path, method] of [['/listings/abc?ref=share', 'GET'], ['/signin', 'GET'], ['/c/rentals', 'HEAD']] as const) {
      const res = proxy(new NextRequest(`https://sdcstore.eno.vn${path}`, { method, headers: { host: 'sdcstore.eno.vn', cookie: 'lang=vi' } }))
      expect(res.status, path).toBe(302)
      expect(res.headers.get('location'), path).toBe(`https://eno.vn${path}`)
      expect(res.headers.get('cache-control'), path).toBe('private, no-store')
    }
    // The shop itself still renders on its host, and a Server Action's POST keeps its route.
    expect((await run('/', { host: 'sdcstore.eno.vn', headers: { cookie: 'lang=vi' } })).rewrite).toBe('/vi/s/sdcstore')
    expect((await run('/', { host: 'sdcstore.eno.vn', method: 'POST', headers: { origin: 'https://sdcstore.eno.vn', cookie: 'lang=vi' } })).location).toBeNull()
  })

  it('every other page keeps negotiating, including a guide with no declared language', async () => {
    for (const path of ['/', '/c/rentals', '/about', '/furnishing-a-home-in-vietnam', `${VI}/x`]) {
      expect((await run(path, { headers: { cookie: 'lang=en' } })).rewrite?.split('/')[1], path).toBe('en')
      expect((await run(path, { headers: { cookie: 'lang=vi' } })).rewrite?.split('/')[1], path).toBe('vi')
    }
  })

  it('a public /en/<guide> is still not a second URL', async () => {
    expect((await run(`/en${VI}`, { headers: { cookie: 'lang=en' } })).rewrite).toBe('/en/~/not-found')
  })

  it('the cross-origin write guard still runs first', async () => {
    expect((await run(VI, { method: 'POST', headers: { origin: 'https://evil.example' } })).status).toBe(403)
  })
})

/**
 * ⛔ A SUBDOMAIN PAGE MAY POST ITS FOUR ANONYMOUS BEACONS TO ITSELF — teacher.<base> and every storefront, nothing else
 * (2026-10-15). Every background POST from those pages used to 403 here, so their visitors were never counted and their
 * consent choices never recorded. ⚠️ A CARVE-OUT FROM A SECURITY BOUNDARY, so most of these cases pin what it still
 * REFUSES. (CSP reports are their own rule: any origin — see the next describe.)
 */
describe('subdomain self-writes', () => {
  const run = async (host: string | null, path: string, origin: string | null, app = 'https://eno.vn', method = 'POST') => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', app)
    const { NextRequest } = await import('next/server')
    const { proxy } = await import('./proxy')
    const headers: Record<string, string> = {}
    if (host !== null) headers.host = host
    if (origin !== null) headers.origin = origin
    return proxy(new NextRequest(`https://${host ?? 'teacher.eno.vn'}${path}`, { method, headers })).status
  }
  const PATHS = ['/api/site-stats', '/api/translate', '/api/consent', '/api/signup-prompt', '/api/page-speed']
  const FORUM = 'https://www.eno.forum'

  const VN_PAGES = ['teacher.eno.vn', 'apple.eno.vn', 'eno-trading.eno.vn', 'sdcstore.eno.vn', 'luathoangphi.eno.vn']
  const FORUM_PAGES = ['teacher.eno.forum', 'apple.eno.forum']

  it('lets a teacher or storefront page post its beacons to its own host, on both editions', async () => {
    for (const p of PATHS) {
      for (const h of VN_PAGES) expect(await run(h, p, `https://${h}`), `${h} ${p}`).toBe(200)
      for (const h of FORUM_PAGES) expect(await run(h, p, `https://${h}`, FORUM), `${h} ${p}`).toBe(200)
    }
    // A Host header in another case, or carrying the default port, is the same host; a browser's Origin is lowercase and
    // portless.
    expect(await run('Apple.ENO.vn', '/api/site-stats', 'https://apple.eno.vn')).toBe(200)
    expect(await run('apple.eno.vn:443', '/api/site-stats', 'https://apple.eno.vn')).toBe(200)
  })

  it('⛔ every other path from those pages is still refused — exact paths, not a prefix', async () => {
    for (const h of ['teacher.eno.vn', 'apple.eno.vn']) {
      for (const p of ['/api/teachers/profile', '/api/listings', '/api/conversations', '/api/consent/', '/api/consent/x', '/API/consent', '/api/site-stats-x', '/']) {
        expect(await run(h, p, `https://${h}`), `${h} ${p}`).toBe(403)
      }
    }
  })

  it('⛔ a subdomain page cannot write to the apex, www, or ANOTHER subdomain', async () => {
    for (const [host, origin] of [
      ['eno.vn', 'https://teacher.eno.vn'], ['www.eno.vn', 'https://teacher.eno.vn'], ['apple.eno.vn', 'https://teacher.eno.vn'],
      ['eno.vn', 'https://apple.eno.vn'], ['www.eno.vn', 'https://apple.eno.vn'], ['banana.eno.vn', 'https://apple.eno.vn'],
      ['teacher.eno.vn', 'https://apple.eno.vn'],
    ]) expect(await run(host, '/api/consent', origin), `${origin} → ${host}`).toBe(403)
    expect(await run('www.eno.forum', '/api/consent', 'https://apple.eno.forum', FORUM)).toBe(403)
  })

  it('⛔ infra, nested, reserved, underscore and look-alike hosts are not subdomain pages', async () => {
    for (const h of ['sb.eno.vn', 'mail.eno.vn', 'schools.eno.vn', 'a.b.eno.vn', 'sdc_store.eno.vn', 'evil-eno.vn', 'eno.vn.evil.com']) {
      expect(await run(h, '/api/site-stats', `https://${h}`), h).toBe(403)
    }
  })

  it('⛔ POST only — a PUT, PATCH or DELETE from those pages is refused, whatever the route would do', async () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      for (const h of ['teacher.eno.vn', 'apple.eno.vn']) {
        for (const p of PATHS) expect(await run(h, p, `https://${h}`, 'https://eno.vn', method), `${method} ${h}${p}`).toBe(403)
      }
    }
  })

  it('⛔ the Origin must be exactly this page\'s own scheme and host', async () => {
    const origins = ['https://evil.example', 'http://teacher.eno.vn', 'https://teacher.eno.vn.evil.com', 'https://teacher.eno.forum', 'null', 'not a url', 'https://teacher.eno.vn:8443']
    for (const o of origins) expect(await run('teacher.eno.vn', '/api/consent', o), o).toBe(403)
    for (const o of ['http://apple.eno.vn', 'https://apple.eno.vn:8443', 'https://apple.eno.vn.evil.com', 'https://evil@apple.eno.vn', 'https://apple.eno.vn/path', 'https://apple.eno.vn?x', 'https://apple.eno.vn/']) {
      expect(await run('apple.eno.vn', '/api/consent', o), o).toBe(403)
    }
    // …and a non-default port in the HOST is another origin too (only :443 — the default — is the same page).
    for (const h of ['apple.eno.vn:8443', 'apple.eno.vn:80', 'teacher.eno.vn:3000']) {
      expect(await run(h, '/api/consent', `https://${h.replace(/:\d+$/, '')}`), h).toBe(403)
    }
    // The other edition's subdomains are not this build's: an eno.vn image never answers for teacher/apple.eno.forum.
    for (const h of FORUM_PAGES) expect(await run(h, '/api/consent', `https://${h}`), h).toBe(403)
  })

  it('⛔ no Host header, or an unconfigured or malformed build, is refused or stands down — never throws', async () => {
    expect(await run(null, '/api/consent', 'https://teacher.eno.vn')).toBe(403)
    // No NEXT_PUBLIC_APP_URL: the guard as a whole stands down (it invents no boundary), so nothing here can be 403.
    expect(await run('teacher.eno.vn', '/api/consent', 'https://teacher.eno.vn', '')).toBe(200)
    expect(await run('apple.eno.vn', '/api/consent', 'https://apple.eno.vn', 'not a url')).toBe(200)
  })

  it('⛔ nothing the carve-out admits acts as the signed-in visitor (the reason it is safe)', async () => {
    const { SUBDOMAIN_SELF_WRITES } = await import('./proxy')
    const { readFileSync, existsSync } = await import('node:fs')
    // ⚠️ A TRIPWIRE, NOT A PROOF (see subdomainSelfWrite): the route and every module it imports directly.
    const SESSION = /getCurrentProfileId|currentClaims|getClaims|getUser\(|getSession\(|requireUser|createServerClient|\.auth\.|cookies\(\)|req\.cookies|headers\(\)|from\s*['"]@\/lib\/supabase/g
    const IMPORT = /from\s*['"]([^'"]+)['"]/g
    const libSource = (rel: string) => {
      const file = [`src/lib/${rel}.ts`, `src/lib/${rel}/index.ts`].find((f) => existsSync(f))
      expect(file, `@/lib/${rel} resolves`).toBeTruthy()
      return readFileSync(file!, 'utf8')
    }
    for (const p of SUBDOMAIN_SELF_WRITES) {
      const src = readFileSync(`src/app${p}/route.ts`, 'utf8')
      for (const [, spec] of src.matchAll(IMPORT)) {
        // Only packages and '@/lib' — a relative or other alias import would be a module this scan never reads.
        expect(spec.startsWith('.') || (spec.startsWith('@/') && !spec.startsWith('@/lib/')), `${p} imports ${spec}`).toBe(false)
        if (!spec.startsWith('@/lib/')) continue
        const rel = spec.slice('@/lib/'.length)
        if (p === '/api/consent' && rel === 'admin') continue // the account lookup — gated below
        expect(libSource(rel).match(SESSION) ?? [], `${p} → ${spec}`).toEqual([])
      }
      const reads = src.match(SESSION) ?? []
      if (p !== '/api/consent') { expect(reads, p).toEqual([]); continue }
      // /api/consent names the account on its record — but reads it ONLY on the apex/www (its own test pins the behaviour):
      // no session read but that lookup (its import and its one call), and the call is the gated one.
      expect(reads, p).toEqual(['getCurrentProfileId', 'getCurrentProfileId'])
      expect(src.match(/getCurrentProfileId\(/g), p).toHaveLength(1)
      expect(src, p).toMatch(/isCanonicalEnoHost\(req\.headers\.get\('host'\)\) \? await getCurrentProfileId\(\)/)
    }
  })
})

/**
 * ⛔ A BROWSER'S OWN CSP REPORT IS NEVER REFUSED (2026-10-15). On eno.vn itself 626 of 788 reports in 24 h were 403'd
 * here — the browser does not stamp them with the page's origin — so the evidence for promoting CSP from Report-Only was
 * mostly lost. The sink reads no session and writes one rate-limited log line.
 */
describe('CSP reports', () => {
  const run = async (host: string, origin: string, method = 'POST', path = '/api/csp-report') => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
    const { NextRequest } = await import('next/server')
    const { proxy } = await import('./proxy')
    return proxy(new NextRequest(`https://${host}${path}`, { method, headers: { host, origin } })).status
  }

  it('accepts a report POSTed from any origin, on the apex, the teacher page and a storefront', async () => {
    for (const host of ['eno.vn', 'teacher.eno.vn', 'apple.eno.vn']) {
      for (const origin of ['null', 'https://eno.vn', 'https://teacher.eno.vn', 'https://apple.eno.vn', 'https://evil.example']) {
        expect(await run(host, origin), `${host} ← ${origin}`).toBe(200)
      }
    }
  })

  it('⛔ only a POST to that exact path — not another method, not a look-alike path', async () => {
    for (const method of ['PUT', 'PATCH', 'DELETE']) expect(await run('eno.vn', 'https://evil.example', method), method).toBe(403)
    for (const path of ['/api/csp-report/', '/api/csp-report/x', '/api/csp-reports', '/API/csp-report']) {
      expect(await run('eno.vn', 'https://evil.example', 'POST', path), path).toBe(403)
    }
  })
})

/**
 * ⛔ AN UNDERSCORE HOST IS NEVER THE SITE (SEO wave B, I2b). Measured live 2026-09-29: https://sdc_store.eno.vn/
 * and its /llms.txt answered 200 with the whole marketplace (canonical eno.vn, no noindex) — a duplicate host
 * Search Console had crawled. Owner, 2026-09-28: a storefront's subdomain is its handle without underscores.
 */
describe('underscore hosts', () => {
  const run = async (host: string, path = '/', init: { method?: string; headers?: Record<string, string>; app?: string } = {}) => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', init.app ?? 'https://eno.vn')
    const { NextRequest } = await import('next/server')
    const { proxy } = await import('./proxy')
    const res = proxy(new NextRequest(`https://eno.vn${path}`, { method: init.method ?? 'GET', headers: { host, 'accept-language': 'vi', ...(init.headers ?? {}) } }))
    const target = res.headers.get('x-middleware-rewrite')
    return { status: res.status, location: res.headers.get('location'), rewrite: target ? new URL(target).pathname : null, robots: res.headers.get('x-robots-tag') }
  }

  it('308s to the underscore-free storefront host, path and query kept', async () => {
    expect(await run('sdc_store.eno.vn')).toMatchObject({ status: 308, location: 'https://sdcstore.eno.vn/' })
    expect((await run('sdc_store.eno.vn', '/llms.txt')).location).toBe('https://sdcstore.eno.vn/llms.txt')
    expect((await run('sdc_store.eno.vn', '/c/rentals?sort=newest&page=2')).location).toBe('https://sdcstore.eno.vn/c/rentals?sort=newest&page=2')
    expect((await run('sdc_store.eno.vn', '/api/listings')).location).toBe('https://sdcstore.eno.vn/api/listings')
  })

  it('multiple underscores, a hyphen kept, any case, a port, a punycode label', async () => {
    expect((await run('a_b_c_d.eno.vn')).location).toBe('https://abcd.eno.vn/')
    expect((await run('my_shop-two.eno.vn')).location).toBe('https://myshop-two.eno.vn/')
    expect((await run('SDC_Store.ENO.VN')).location).toBe('https://sdcstore.eno.vn/')
    expect((await run('sdc_store.eno.vn:443')).location).toBe('https://sdcstore.eno.vn/')
    expect((await run('xn--_bcher-kva.eno.vn')).location).toBe('https://xn--bcher-kva.eno.vn/')
  })

  it('stays on this edition\'s own zone: eno.forum subdomains go to eno.forum, never www', async () => {
    const r = await run('sdc_store.eno.forum', '/c/rentals', { app: 'https://www.eno.forum' })
    expect(r).toMatchObject({ status: 308, location: 'https://sdcstore.eno.forum/c/rentals' })
  })

  it('every method moves (308 keeps it), and a write from a foreign page is still refused first', async () => {
    expect(await run('sdc_store.eno.vn', '/listings/abc', { method: 'POST' })).toMatchObject({ status: 308, location: 'https://sdcstore.eno.vn/listings/abc' })
    expect((await run('sdc_store.eno.vn', '/listings/abc', { method: 'POST', headers: { origin: 'https://sdc_store.eno.vn' } })).status).toBe(403)
  })

  it('⛔ a path that looks like another host stays a path on ours — never an open redirect', async () => {
    for (const path of ['//evil.example/x', '/\\evil.example/x', '/%2F%2Fevil.example']) {
      const loc = (await run('sdc_store.eno.vn', path)).location!
      expect(new URL(loc).host, path).toBe('sdcstore.eno.vn')
    }
  })

  it('⛔ an underscore host that can be no storefront is a 404, noindex — like random-test-xyz.eno.vn', async () => {
    for (const host of ['x_y.eno.vn', 'w_w_w.eno.vn', 's_b.eno.vn', 'sign_in.eno.vn', 'a.b_c.eno.vn', 'sdc_store.eno.forum']) {
      const r = await run(host, '/')
      expect(r, host).toMatchObject({ location: null, rewrite: '/vi/~/not-found', robots: 'noindex' })
    }
    // Not a page request: a plain 404, still noindex.
    expect(await run('x_y.eno.vn', '/api/listings')).toMatchObject({ status: 404, rewrite: null, robots: 'noindex' })
    // An unconfigured build has no zone to send it to.
    expect(await run('sdc_store.eno.vn', '/', { app: '' })).toMatchObject({ location: null, rewrite: '/vi/~/not-found', robots: 'noindex' })
  })

  it('leaves every host without an underscore exactly as it was: apex, www, storefront, random, punycode', async () => {
    expect(await run('eno.vn')).toMatchObject({ location: null, rewrite: '/vi', robots: null })
    expect(await run('www.eno.vn')).toMatchObject({ location: null, rewrite: '/vi', robots: null })
    expect(await run('sdcstore.eno.vn')).toMatchObject({ location: null, rewrite: '/vi/s/sdcstore', robots: null })
    expect(await run('random-test-xyz.eno.vn')).toMatchObject({ location: null, rewrite: '/vi/s/random-test-xyz' })
    expect(await run('xn--bcher-kva.eno.vn')).toMatchObject({ location: null, rewrite: '/vi/s/xn--bcher-kva' })
    // Any page path but `/` on a shop host goes to the apex (sweep, 2026-10-22).
    expect(await run('sdcstore.eno.vn', '/c/rentals')).toMatchObject({ status: 302, location: 'https://eno.vn/c/rentals', rewrite: null })
  })

  it('the matcher sends EVERY path of an underscore host here, dotted ones included', async () => {
    const { config } = await import('./proxy')
    const entry = config.matcher.find((m) => typeof m === 'object') as { source: string; has: { type: string; value: string }[] }
    expect(entry.source).toBe('/:path*')
    const re = new RegExp(`^${entry.has[0].value}$`)
    expect(entry.has[0].type).toBe('host')
    for (const host of ['sdc_store.eno.vn', 'a_b.eno.forum', '_x.eno.vn']) expect(re.test(host), host).toBe(true)
    for (const host of ['eno.vn', 'www.eno.forum', 'sdcstore.eno.vn', 'random-test-xyz.eno.vn']) expect(re.test(host), host).toBe(false)
  })
})

/**
 * ⛔ "teacher.eno.vn," IN A ZALO MESSAGE OPENED `teacher.eno.vn/,` — WHICH 301'd TO THE APEX, WHERE `/,` IS NO PAGE (2026-10-21,
 * 24 visits in a week, every one a 404; src/lib/link-junk.ts). The tail goes, the host and the query stay.
 */
describe('punctuation a chat app took into a link', () => {
  const run = async (host: string, path: string, method = 'GET') => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
    const { NextRequest } = await import('next/server')
    const { proxy } = await import('./proxy')
    const res = proxy(new NextRequest(`https://${host}${path}`, { method, headers: { host, 'accept-language': 'en' } }))
    const target = res.headers.get('x-middleware-rewrite')
    return { status: res.status, location: res.headers.get('location'), rewrite: target ? new URL(target).pathname : null }
  }

  it('teacher.eno.vn/, from Zalo opens the form on the same host, its query kept', async () => {
    const r = await run('teacher.eno.vn', '/,?zarsrc=30&utm_source=zalo&utm_medium=zalo&utm_campaign=zalo')
    expect(r.status).toBe(301)
    const to = new URL(r.location!)
    expect(to.host).toBe('teacher.eno.vn')
    expect(to.pathname).toBe('/')
    expect(to.search).toBe('?zarsrc=30&utm_source=zalo&utm_medium=zalo&utm_campaign=zalo')
    // …where `/` is the form, exactly as before.
    expect(await run('teacher.eno.vn', '/?zarsrc=30')).toMatchObject({ status: 200, location: null, rewrite: '/en/teachers/join' })
    // And a real path there still leaves for the apex.
    expect(await run('teacher.eno.vn', '/c/teachers')).toMatchObject({ status: 301, location: 'https://eno.vn/c/teachers' })
  })

  it('the apex, www and a storefront keep their host; the path loses only its tail', async () => {
    const cases: [string, string, string][] = [
      ['eno.vn', '/teachers/join,', 'https://eno.vn/teachers/join'],
      ['eno.vn', '/teachers/join.', 'https://eno.vn/teachers/join'],
      ['eno.vn', '/c/teachers):', 'https://eno.vn/c/teachers'],
      ['eno.vn', '/listings/abc%E2%80%A6?ref=x', 'https://eno.vn/listings/abc?ref=x'],
      ['www.eno.vn', '/,', 'https://www.eno.vn/'],
      ['apple.eno.vn', '/,', 'https://apple.eno.vn/'],
    ]
    for (const [host, path, want] of cases) {
      expect(await run(host, path), `${host}${path}`).toMatchObject({ status: 301, location: want })
      expect((await run(host, path, 'HEAD')).location, `HEAD ${host}${path}`).toBe(want)
    }
  })

  it('a clean path, a write and an API call are left exactly as they were', async () => {
    expect(await run('eno.vn', '/c/rentals')).toMatchObject({ location: null, rewrite: '/en/c/rentals' })
    expect(await run('apple.eno.vn', '/')).toMatchObject({ location: null, rewrite: '/en/s/apple' })
    expect((await run('eno.vn', '/,', 'POST')).location).toBeNull()
    // A write to a dotted path the new matcher entry now brings here is not moved either: it goes on to the [lang]
    // not-found, a 404 as before.
    expect(await run('eno.vn', '/md/home,', 'POST')).toMatchObject({ location: null, rewrite: '/en/md/home,' })
    expect(await run('eno.vn', '/api/listings,')).toMatchObject({ location: null, rewrite: null })
  })

  it('⛔ a path that looks like another host stays a path on ours — never a relative //host', async () => {
    for (const path of ['//evil.example/x,', '/\\evil.example/x.', '///evil.example,']) {
      const loc = new URL((await run('eno.vn', path)).location!)
      expect(loc.host, path).toBe('eno.vn')
      expect(loc.pathname.startsWith('//'), path).toBe(false)
    }
  })

  it('⛔ NEXT\'S OWN MATCHER sends every mark link-junk.ts strips here, after a dot too — and still no file', async () => {
    // Review, 2026-10-21: the first matcher entry took only a path ENDING in a dot, so `/teachers/join.)` — a full stop
    // inside brackets — never reached the proxy, and a `new RegExp` over the source cannot show what Next compiles
    // (path-to-regexp). unstable_doesMiddlewareMatch runs Next's own compiler and route matcher.
    const { config } = await import('./proxy')
    const { unstable_doesMiddlewareMatch: reaches } = await import('next/experimental/testing/server')
    const { RAW_MARKS, ENCODED_MARKS } = await import('@/lib/link-junk')
    const marks = [...RAW_MARKS, ...ENCODED_MARKS, ...ENCODED_MARKS.map((m) => m.toLowerCase())]
    for (const mark of marks) {
      const paths = [`/teachers/join.${mark}`, `/teachers/join${mark}`, `/c/teachers...${mark}`, `/c/teachers.)${mark}`]
      for (const path of paths) {
        expect(reaches({ config, url: path }), path).toBe(true)
        expect((await run('eno.vn', path)).location, path).toMatch(/^https:\/\/eno\.vn\/(teachers\/join|c\/teachers)$/)
      }
    }
    for (const path of ['/icon.svg', '/llms.txt', '/robots.txt', '/sitemaps/listings-0.xml', '/_next/static/chunks/a.js',
      '/_next/static/chunks/a.js)', '/md/home', '/app', '/listing-images/x.webp', '/agents.md', '/hcmc-rent-index.csv']) {
      expect(reaches({ config, url: path }), path).toBe(false)
    }
    for (const path of ['/', '/c/rentals', '/listings/abc', '/,']) expect(reaches({ config, url: path }), path).toBe(true)
  })

  it('the redirect is the visitor\'s browser\'s alone, and for a day — not a shared cache\'s, not for ever', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
    const { NextRequest } = await import('next/server')
    const { proxy } = await import('./proxy')
    const res = proxy(new NextRequest('https://teacher.eno.vn/,', { headers: { host: 'teacher.eno.vn' } }))
    expect(res.headers.get('cache-control')).toBe('private, max-age=86400')
  })

  it('eno.forum\'s hosts the same: the tail goes, the host stays', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.eno.forum')
    const { NextRequest } = await import('next/server')
    const { proxy } = await import('./proxy')
    for (const [host, path, want] of [
      ['www.eno.forum', '/,', 'https://www.eno.forum/'],
      ['www.eno.forum', '/vietnam-evisa.)', 'https://www.eno.forum/vietnam-evisa'],
      ['apple.eno.forum', '/c/rentals,', 'https://apple.eno.forum/c/rentals'],
      // (teacher.eno.forum never gets here: next.config 308s it to teacher.eno.vn first, whose proxy then cleans the
      // link — measured on the services build, 2026-10-21.)
    ]) {
      const res = proxy(new NextRequest(`https://${host}${path}`, { headers: { host } }))
      expect(res.status, `${host}${path}`).toBe(301)
      expect(res.headers.get('location'), `${host}${path}`).toBe(want)
    }
  })

  it('⛔ the visitor stays on the host they asked: nothing switches off Next\'s same-host RELATIVE Location', async () => {
    // proxy() answers `https://<request host>/…`; Next's adapter turns a redirect to the request's own host into a
    // relative Location (server/web/adapter.js) — unless next.config sets skipMiddlewareUrlNormalize, which would hand
    // the browser whatever host nginx gave Next. Measured on the production build, 2026-10-21: `Location: /?zarsrc=30…`.
    const { readFileSync } = await import('node:fs')
    expect(readFileSync('next.config.ts', 'utf8')).not.toMatch(/skipMiddlewareUrlNormalize/)
  })
})

// Security review 2026-10-22, item 25: teacher.<base> 301s every non-root page to the apex. The target must be
// CONCATENATED onto our origin — `new URL('//evil.example/x', base)` resolves to evil.example, an open redirect.
describe('teacher.<base> page redirect stays on our domain', () => {
  const go = async (path: string) => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
    const { NextRequest } = await import('next/server')
    const { proxy } = await import('./proxy')
    const res = proxy(new NextRequest(`https://teacher.eno.vn${path}`, { method: 'GET', headers: { host: 'teacher.eno.vn' } }))
    return { status: res.status, location: res.headers.get('location') ?? '' }
  }
  afterEach(() => vi.unstubAllEnvs())

  it('an ordinary page 301s to the same path on the apex', async () => {
    const r = await go('/listings/abc?x=1')
    expect(r.status).toBe(301)
    expect(r.location).toBe('https://eno.vn/listings/abc?x=1')
  })

  it.each(['//evil.example/x', '/\\evil.example/x', '//evil.example'])('a %s path never leaves eno.vn', async (p) => {
    const r = await go(p)
    if (r.location) expect(new URL(r.location).hostname).toBe('eno.vn')
  })
})
