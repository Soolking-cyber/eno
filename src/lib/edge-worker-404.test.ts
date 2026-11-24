import { afterEach, describe, expect, it, vi } from 'vitest'
import worker, { STATIC_404_THEME, static404Nav, static404Wanted } from '../../infra/cloudflare/eno-html-edge-cache.js'

// The Worker's 404 links for a reader without JavaScript (owner 2026-11-24, SEO/GEO audit "404 page contains a link back to
// homepage" + "theme-color present"): every eno 404 is Next's error-fallback document with an empty <body>.
const html404 = (lang = 'en') => new Response('<html><head></head><body><div hidden></div></body></html>', { status: 404, headers: { 'content-type': 'text/html; charset=utf-8', 'content-language': lang } })
const get = (headers: Record<string, string> = {}, method = 'GET') => new Request('https://eno.vn/nope/xyz/abc', { method, headers })

describe('static404Wanted', () => {
  it('a GET for a 404 HTML document, and nothing else', () => {
    expect(static404Wanted(get(), html404())).toBe(true)
    expect(static404Wanted(get({ rsc: '1' }), html404())).toBe(false) // a client navigation has no document
    expect(static404Wanted(get({}, 'HEAD'), html404())).toBe(false)
    expect(static404Wanted(get(), new Response('ok', { status: 200, headers: { 'content-type': 'text/html' } }))).toBe(false)
    expect(static404Wanted(get(), new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } }))).toBe(false)
  })
})

describe('static404Nav', () => {
  it('links home first, then search, help, contact and the sitemap; and removes itself in a browser', () => {
    const nav = static404Nav(false)
    expect([...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual(['/', '/?q=', '/help', '/contact', '/sitemap.xml'])
    expect(nav).toContain('>Home<')
    expect(nav).not.toContain('eno.vn') // brand-free: the Worker serves eno.forum's routes too
    expect(nav).toMatch(/<script>document\.querySelectorAll\("\[data-eno-static-404\]"\)\.forEach\(function\(n\)\{n\.remove\(\)\}\)<\/script>$/)
    expect(STATIC_404_THEME).toContain('data-eno-static-404') // the same script removes the meta too
  })
  it('in Vietnamese for a Vietnamese 404', () => {
    expect(static404Nav(true)).toContain('>Trang chủ<')
  })
})

describe('the Worker on a 404 document (HTMLRewriter stubbed)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('prepends the nav to <body> and writes theme-color into <head> when the page has none', async () => {
    const calls: Record<string, { element: (el: unknown) => void }> = {}
    const body = { prepend: vi.fn() }
    const end = { before: vi.fn() }
    const head = { onEndTag: (cb: (e: typeof end) => void) => cb(end) }
    class Rewriter {
      on(sel: string, h: { element: (el: unknown) => void }) { calls[sel] = h; return this }
      transform(r: Response) { calls['head'].element(head); calls['body'].element(body); return r }
    }
    vi.stubGlobal('HTMLRewriter', Rewriter)
    vi.stubGlobal('fetch', vi.fn(async () => html404('vi')))
    vi.stubGlobal('caches', { default: { match: async () => undefined, put: async () => {} } })
    const res = await worker.fetch(get(), {}, { waitUntil: () => {}, passThroughOnException: () => {} })
    expect(res.status).toBe(404)
    expect(end.before).toHaveBeenCalledWith(STATIC_404_THEME, { html: true })
    expect(body.prepend).toHaveBeenCalledWith(static404Nav(true), { html: true })
  })
})

describe('the removal script, and the CSP it depends on', () => {
  it('removes the nav and the theme-color meta in a browser (jsdom)', async () => {
    const { JSDOM } = await import('jsdom')
    const dom = new JSDOM(`<!doctype html><html><head>${STATIC_404_THEME}</head><body>${static404Nav(false)}<div id="app"></div></body></html>`, { runScripts: 'dangerously' })
    expect(dom.window.document.querySelectorAll('[data-eno-static-404]').length).toBe(0)
    expect(dom.window.document.getElementById('app')).not.toBeNull()
  })

  it('⛔ next.config.ts keeps script-src \'unsafe-inline\' with no nonce and no \'strict-dynamic\' (else browsers would show the nav)', async () => {
    const { readFileSync } = await import('node:fs')
    const cfg = readFileSync('next.config.ts', 'utf8')
    const scriptSrc = cfg.split('\n').filter((l) => l.includes('"script-src '))
    expect(scriptSrc.length).toBeGreaterThan(0)
    for (const l of scriptSrc) {
      expect(l).toMatch(/script-src 'self' 'unsafe-inline'/)
      expect(l).not.toMatch(/'strict-dynamic'|'nonce-/)
    }
  })
})
