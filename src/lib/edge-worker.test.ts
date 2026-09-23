import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RequestCookies } from 'next/dist/compiled/@edge-runtime/cookies'
import { langVariantFor, LANG_COOKIE } from '@/lib/lang-variant'
import { LANGS } from '@/lib/i18n/langs'

/**
 * infra/cloudflare/eno-html-edge-cache.js — the edge Worker that caches HTML per language.
 *
 * ⛔ THE DRIFT TEST IS THE POINT. The Worker keys its cache on the language the ORIGIN will render,
 * and it has to compute that itself (it deploys as one file). Its first version keyed on the raw
 * inputs and drifted from Next's cookie parsing — audit #127: `lang=EN`, `lang=%76%69` and a
 * duplicated `lang=` were each keyed one language and rendered the other. So the matrix below runs
 * the REAL Worker against Next's REAL cookie parser and the app's REAL langVariantFor: a Worker copy
 * that drifts fails here, not in the cache.
 *
 * Also pinned: markdown requests reach the origin (audit #88); a force-dynamic page is never stored
 * and is evicted on refresh (#402); a response in the wrong language is never stored.
 */

import worker from '../../infra/cloudflare/eno-html-edge-cache.js'

type Origin = { status?: number; html?: string; headers?: Record<string, string> }
const h = {
  store: new Map<string, Response>(),
  matched: [] as string[],
  origin: [] as Request[],
  respond: (_req: Request): Origin => ({}),
  waits: [] as Promise<unknown>[],
}

function originResponse(o: Origin, variant: string): Response {
  return new Response(o.html ?? `<html lang="${variant}">x</html>`, {
    status: o.status ?? 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'content-language': variant, 'cache-control': 's-maxage=21600', ...o.headers },
  })
}

beforeEach(() => {
  h.store = new Map(); h.matched = []; h.origin = []; h.waits = []
  h.respond = () => ({})
  vi.stubGlobal('caches', {
    default: {
      match: async (req: Request) => { h.matched.push(req.url); const r = h.store.get(req.url); return r ? r.clone() : undefined },
      put: async (req: Request, res: Response) => { h.store.set(req.url, res.clone()) },
      delete: async (req: Request) => h.store.delete(req.url),
    },
  })
  vi.stubGlobal('fetch', async (req: Request) => {
    h.origin.push(req)
    // The origin renders whatever the app's own rule says for these headers.
    const variant = langVariantFor(new RequestCookies(req.headers).get(LANG_COOKIE)?.value, req.headers.get('accept-language'))
    return originResponse(h.respond(req), variant)
  })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

const ctx = { waitUntil: (p: Promise<unknown>) => { h.waits.push(p) } }
const call = (path: string, headers: Record<string, string> = {}) =>
  worker.fetch(new Request(`https://eno.vn${path}`, { headers }), {}, ctx) as Promise<Response>
const keyVariant = () => new URL(h.matched.at(-1)!).searchParams.get('__k')

describe('edge Worker — the key is the language the origin renders (audit #127)', () => {
  const COOKIES = [
    null, 'lang=en', 'lang=vi', 'lang=EN', 'lang=VI', 'lang=%76%69', 'lang=%65%6E', 'lang=en; lang=vi', 'lang=vi; lang=en',
    'lang=vi;lang=en', 'lang=ko', 'lang=zh-Hans', 'lang=zh-hans', 'lang=garbage', 'lang=', 'lang="vi"', 'x=1; lang=vi',
    'lang=vi; x=1', 'xlang=vi', 'lang=%E0%A4', 'lang', 'lang=vi%', 'a=b;  lang=vi',
    // A duplicate whose LAST value cannot be decoded: Next skips it, so the earlier one stands.
    'lang=vi; lang=%E0%A4', 'lang=en; lang=%E0%A4',
    // Regional tags are NOT supported cookie values at the origin either — both fall through.
    'lang=en-US', 'lang=vi-VN',
    // Whitespace: Next's parser does not trim, so neither may the Worker's copy.
    'lang=vi ; x=1', 'x=1;\tlang=vi', ' lang=vi', 'lang= vi',
  ]
  const ACCEPT = [
    null, 'vi', 'en-US,en;q=0.9', 'vi-VN,vi;q=0.9,en;q=0.8', 'zh-CN,vi;q=0.5', 'fr;q=0,vi', '*', 'ko,vi', 'VI', 'en;q=0.1, vi;q=0.9',
    'zh-TW,vi', 'de,vi;q=0.8', 'vi;q=0.5,en;q=0.5', 'vi;q=abc,en', 'en;q=1.5,vi', ' vi , en ', 'x-klingon,vi', '',
  ]

  for (const cookie of COOKIES) {
    for (const al of ACCEPT) {
      it(`cookie=${JSON.stringify(cookie)} accept-language=${JSON.stringify(al)}`, async () => {
        const headers: Record<string, string> = {}
        if (cookie != null) headers.cookie = cookie
        if (al != null) headers['accept-language'] = al
        await call('/', headers)
        const expected = langVariantFor(new RequestCookies(new Headers(headers)).get(LANG_COOKIE)?.value, al)
        expect(keyVariant()).toBe(expected)
      })
    }
  }

  it("the Worker's LANGS literal is EXACTLY the app's list — both directions", async () => {
    // The loop below catches a code the Worker LACKS; only a direct comparison catches one it KEEPS
    // after the app drops it (that cookie would then key `en` while the origin falls through).
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../../infra/cloudflare/eno-html-edge-cache.js', import.meta.url), 'utf8')
    const literal = /const LANGS = (\[[^\]]*\]);/.exec(src)?.[1]
    expect(literal, 'LANGS literal not found in the Worker').toBeTruthy()
    expect(JSON.parse(literal!)).toEqual([...LANGS])
  })

  it("the Worker's LANGS list is the app's (a new language must reach both)", async () => {
    // Every supported code as a cookie, WITH a Vietnamese browser: a supported cookie wins, so the
    // app renders en for every code but vi. A code missing from the Worker's copy would fall through
    // to Accept-Language and key `vi` — without the header it would fall to `en` and pass anyway.
    for (const code of LANGS) {
      h.matched = []
      await call('/', { cookie: `lang=${code}`, 'accept-language': 'vi' })
      expect(keyVariant(), code).toBe(code === 'vi' ? 'vi' : 'en')
    }
  })
})

describe('edge Worker — what may be stored', () => {
  it('a normal page is stored and the next reader HITs', async () => {
    const a = await call('/terms', { 'accept-language': 'vi' })
    expect(a.headers.get('x-eno-cache')).toBe('MISS')
    const b = await call('/terms', { 'accept-language': 'vi' })
    expect(b.headers.get('x-eno-cache')).toBe('HIT')
    expect(h.origin).toHaveLength(1)
  })

  it('a force-dynamic page (private, no-store) is passed through and NEVER stored (audit #402)', async () => {
    h.respond = () => ({ headers: { 'cache-control': 'private, no-cache, no-store, max-age=0, must-revalidate' } })
    const r = await call('/sellers/s1')
    expect(r.headers.get('x-eno-cache')).toBeNull()
    expect(r.headers.get('cache-control')).toMatch(/no-store/)
    expect(h.store.size).toBe(0)
    await call('/sellers/s1')
    expect(h.origin).toHaveLength(2) // every reader reaches the origin
  })

  it('a response that sets a cookie was rendered for one visitor — passed through, never stored', async () => {
    h.respond = () => ({ headers: { 'set-cookie': 'eno_handoff=abc; Path=/; HttpOnly' } })
    const r = await call('/')
    expect(r.headers.get('set-cookie')).toMatch(/eno_handoff/) // the visitor still gets it
    expect(h.store.size).toBe(0)
  })

  it('a page the origin does not mark shared-cacheable (no s-maxage, or no-cache) is never stored', async () => {
    for (const cc of ['public, max-age=0', 'public, max-age=60', 's-maxage=60, no-cache', 's-maxage=0']) {
      h.store.clear()
      h.respond = () => ({ headers: { 'cache-control': cc } })
      await call('/terms')
      expect(h.store.size, cc).toBe(0)
    }
  })

  it('a refresh refused ONLY for its Set-Cookie keeps the shared copy — one visitor cannot empty it', async () => {
    const now = Date.now()
    await call('/terms')
    vi.spyOn(Date, 'now').mockReturnValue(now + 301_000)
    h.respond = () => ({ headers: { 'set-cookie': 'ab=1; Path=/' } })
    await call('/terms')
    await Promise.all(h.waits)
    expect(h.store.size).toBe(1)
  })

  it('a 304 on refresh keeps the copy (unchanged is not moved)', async () => {
    const now = Date.now()
    await call('/terms')
    vi.spyOn(Date, 'now').mockReturnValue(now + 301_000)
    vi.stubGlobal('fetch', async () => new Response(null, { status: 304 }))
    await call('/terms')
    await Promise.all(h.waits)
    expect(h.store.size).toBe(1)
  })

  it('a response in the wrong language for its key is never stored', async () => {
    // The origin disagrees with the key (a future drift): it renders en for a vi request.
    vi.stubGlobal('fetch', async (req: Request) => { h.origin.push(req); return originResponse({}, 'en') })
    await call('/', { 'accept-language': 'vi' })
    expect(h.store.size).toBe(0)
  })

  it('a page that TURNS force-dynamic is evicted on the next stale refresh', async () => {
    const now = Date.now()
    await call('/sellers/s2') // stored while it still sent s-maxage
    expect(h.store.size).toBe(1)
    vi.spyOn(Date, 'now').mockReturnValue(now + 301_000) // past FRESH_TTL
    h.respond = () => ({ headers: { 'cache-control': 'private, no-store' } })
    const r = await call('/sellers/s2')
    expect(r.headers.get('x-eno-cache')).toBe('STALE')
    await Promise.all(h.waits)
    expect(h.store.size).toBe(0)
  })

  it('a refresh that comes back in the wrong language neither overwrites NOR evicts the copy', async () => {
    // The mismatch describes this visitor's headers, not the document — the stored copy was checked
    // against its key when it was stored. Evicting would let one visitor empty the entry for all.
    const now = Date.now()
    await call('/', { 'accept-language': 'vi' })
    const before = await h.store.get([...h.store.keys()][0])!.clone().text()
    vi.spyOn(Date, 'now').mockReturnValue(now + 301_000)
    vi.stubGlobal('fetch', async (req: Request) => { h.origin.push(req); return originResponse({ html: 'ENGLISH' }, 'en') })
    await call('/', { 'accept-language': 'vi' })
    await Promise.all(h.waits)
    expect(h.store.size).toBe(1)
    expect(await h.store.get([...h.store.keys()][0])!.clone().text()).toBe(before)
  })
})

describe('edge Worker — markdown negotiation reaches the origin (audit #88)', () => {
  it('Accept: text/markdown bypasses the cache even when an HTML entry exists', async () => {
    await call('/') // plant an HTML entry for the default key
    h.matched = []
    h.respond = () => ({ html: '# eno', headers: { 'content-type': 'text/markdown; charset=utf-8' } })
    const r = await call('/', { accept: 'text/markdown' })
    expect(r.headers.get('content-type')).toMatch(/markdown/)
    expect(h.matched).toEqual([]) // never looked in the cache
  })
  it('is case-insensitive, unlike the zone Cache Rule it replaces', async () => {
    await call('/', { accept: 'TEXT/MARKDOWN' })
    expect(h.matched).toEqual([])
  })
})
