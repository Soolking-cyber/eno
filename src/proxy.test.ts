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
    for (const p of ['/', '/c/rentals', '/listing-images-shop', '/apple', '/mdx', '/auth/callback']) expect(re.test(p), p).toBe(true)
    for (const p of ['/listing-images', '/listing-images/x', '/md/home', '/app', '/_next/static/a.js', '/icon.svg', '/agents.md']) expect(re.test(p), p).toBe(false)
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
