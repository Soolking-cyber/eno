// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The browser half of the page-speed totals (src/lib/rum/early.ts).
 * ⛔ What must hold: nothing runs under automation or for a page opened hidden; the first hide sends the page view's
 * numbers once (with the edge timing read from Server-Timing — but a browser-cache replay's timing is ignored); later
 * hides send only what grew and new soft navigations; "usable" is the lab's ≥95%-of-links rule; and nothing is ever
 * written to the device.
 */

const h = vi.hoisted(() => ({ setters: null as null | { cls: (v: number) => void; inp: (v: number) => void } }))
vi.mock('./vitals', () => ({ watchVitals: (s: typeof h.setters) => { h.setters = s } }))

let sent: unknown[] = []
let types: string[] = []
let visibility: DocumentVisibilityState = 'visible'
let lcpCallback: ((list: { getEntries: () => unknown[] }) => void) | null = null
let navEntry: Record<string, unknown> | null = null
let fcpAt: number | null = null

async function boot() {
  vi.resetModules()
  const mod = await import('./early')
  mod.startRum()
  return mod
}
// NOT bubbling, on purpose: the listener must sit on document, where the browser fires it (commit-gate review, codex).
const hide = () => { visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')) }
const show = () => { visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')) }
const lastBeacon = () => sent.at(-1) as Record<string, any>

beforeEach(() => {
  vi.useFakeTimers()
  sent = []
  types = []
  visibility = 'visible'
  lcpCallback = null
  h.setters = null
  navEntry = { responseStart: 180, transferSize: 4_000, decodedBodySize: 39_000, activationStart: 0, serverTiming: [] }
  fcpAt = 1_200
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => false })
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    value: (_url: string, blob: Blob) => { types.push(blob.type); void blob.text().then((t) => sent.push(JSON.parse(t))); return true },
  })
  vi.spyOn(performance, 'getEntriesByType').mockImplementation(((type: string) => (type === 'navigation' && navEntry ? [navEntry] : [])) as never)
  vi.spyOn(performance, 'getEntriesByName').mockImplementation(((name: string) => (name === 'first-contentful-paint' && fcpAt !== null ? [{ startTime: fcpAt }] : [])) as never)
  vi.stubGlobal('PerformanceObserver', class {
    constructor(cb: typeof lcpCallback) { lcpCallback = cb }
    observe() {}
  })
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number)
  document.documentElement.lang = 'vi'
  document.body.innerHTML = ''
  window.history.replaceState(null, '', '/listings/abc')
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

/** Lets the Blob.text() in the stubbed sendBeacon resolve. */
const settle = async () => { await vi.advanceTimersByTimeAsync(0); await Promise.resolve() }

describe('startRum', () => {
  it('⛔ never under automation, and never for a page opened in the background', async () => {
    Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => true })
    await boot()
    hide(); await settle()
    expect(sent).toEqual([])
    Object.defineProperty(navigator, 'webdriver', { configurable: true, get: () => false })
    visibility = 'hidden'
    await boot()
    hide(); await settle()
    expect(sent).toEqual([])
  })

  it('the first hide sends the page view once: route, class, numbers, LCP kind — nothing stored on the device', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const cookie = vi.spyOn(document, 'cookie', 'set')
    await boot()
    lcpCallback!({ getEntries: () => [{ startTime: 1_750, url: 'https://eno.vn/_next/image?x', element: document.createElement('img') }] })
    hide(); await settle()
    hide(); await settle()
    expect(sent).toHaveLength(1)
    const b = lastBeacon()
    expect(b).toMatchObject({ v: 1, r: 'listing', m: { ttfb: 180, fcp: 1200, lcp: 1750 }, lk: 'img' })
    expect(b.c).toMatch(/^browser\.(phone|desktop)\.vi$/)
    expect(setItem).not.toHaveBeenCalled()
    expect(cookie).not.toHaveBeenCalled()
  })

  it('a teacher profile is told apart by its page marker', async () => {
    document.body.innerHTML = '<div data-rum="teacher"></div>'
    await boot()
    hide(); await settle()
    expect(lastBeacon().r).toBe('teacher')
  })

  it('reads the edge timing from Server-Timing: colo, state, origin wait, app time, Next cache', async () => {
    navEntry!.serverTiming = [
      { name: 'edge', description: 'HKG', duration: 0 }, { name: 'app', description: '', duration: 87.4 },
      { name: 'ncache', description: 'MISS', duration: 0 }, { name: 'ecache', description: 'MISS', duration: 0 },
      { name: 'origin', description: '', duration: 140.2 },
    ]
    await boot()
    hide(); await settle()
    expect(lastBeacon()).toMatchObject({ o: 'HKG', e: 'MISS', d: 140, a: 87, nc: 'MISS' })
  })

  it('no Worker entry but nginx timing: ORIGIN — and a browser-cache replay is BROWSER, its stale timing dropped', async () => {
    navEntry!.serverTiming = [{ name: 'edge', description: 'SIN', duration: 0 }, { name: 'app', description: '', duration: 40 }]
    await boot()
    hide(); await settle()
    expect(lastBeacon()).toMatchObject({ e: 'ORIGIN', o: 'SIN', a: 40 })
    navEntry = { ...navEntry!, transferSize: 0, decodedBodySize: 39_000 }
    visibility = 'visible' // a new page load (startRum skips a page that starts hidden)
    await boot()
    hide(); await settle()
    expect(lastBeacon().e).toBe('BROWSER')
    expect(lastBeacon().o).toBeUndefined()
    expect(lastBeacon().a).toBeUndefined()
  })

  it('no first paint before the hide: no fcp and no lcp', async () => {
    fcpAt = null
    await boot()
    lcpCallback!({ getEntries: () => [{ startTime: 900, url: '', element: null }] })
    hide(); await settle()
    expect(lastBeacon().m).toEqual({ ttfb: 180 })
  })
})

describe('usable — the lab\'s ≥95%-of-links rule', () => {
  const links = (n: number) => { document.body.innerHTML = Array.from({ length: n }, (_, i) => `<a href="/l/${i}">x</a>`).join('') }
  const hydrate = (share: number) => {
    const all = [...document.links]
    all.slice(0, Math.ceil(all.length * share)).forEach((a) => { (a as unknown as Record<string, unknown>).__reactProps$abc = {} })
  }

  it('records the moment ≥95% of the sampled links carry React props', async () => {
    links(100)
    await boot()
    await vi.advanceTimersByTimeAsync(1_000)
    hydrate(0.5)
    await vi.advanceTimersByTimeAsync(1_000)
    hydrate(1)
    await vi.advanceTimersByTimeAsync(300)
    hide(); await settle()
    const m = lastBeacon().m
    expect(m.hyd).toBeGreaterThan(2_000)
    expect(m.hyd).toBeLessThan(2_700)
    expect(lastBeacon().hx).toBeUndefined()
  })

  it('hidden before the links worked: hx (time on the page) instead of hyd', async () => {
    links(20)
    await boot()
    await vi.advanceTimersByTimeAsync(3_000)
    hide(); await settle()
    expect(lastBeacon().m.hyd).toBeUndefined()
    expect(lastBeacon().hx).toBeGreaterThanOrEqual(3_000)
  })

  it('a page with too few links to judge sends neither', async () => {
    links(2)
    await boot()
    await vi.advanceTimersByTimeAsync(3_000)
    hide(); await settle()
    expect(lastBeacon().m.hyd).toBeUndefined()
    expect(lastBeacon().hx).toBeUndefined()
  })
})

describe('sending', () => {
  it('a text/plain blob (a JSON-typed blob made sendBeacon throw in Chromium for years — crbug 490015)', async () => {
    await boot()
    hide(); await settle()
    expect(types).toEqual(['text/plain;charset=utf-8'])
  })

  it('a sendBeacon that THROWS still falls through to fetch(keepalive)', async () => {
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: () => { throw new TypeError('disallowed') } })
    const posted: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => { posted.push({ url, init }); return Promise.resolve(new Response(null, { status: 204 })) })
    await boot()
    hide(); await settle()
    expect(posted).toHaveLength(1)
    expect(posted[0].url).toBe('/api/page-speed')
    expect(posted[0].init.keepalive).toBe(true)
    expect(JSON.parse(String(posted[0].init.body)).r).toBe('listing')
  })
})

describe('later hides and soft navigations', () => {
  it('CLS/INP arrive from web-vitals; a later hide sends only what GREW, as [sent, now]', async () => {
    await boot()
    await vi.advanceTimersByTimeAsync(3_500) // the vitals chunk loads at 3 s at the latest
    expect(h.setters).not.toBeNull()
    h.setters!.cls(0.02)
    hide(); await settle()
    expect(lastBeacon().m).toMatchObject({ cls: 0.02 })
    expect(lastBeacon().m.inp).toBeUndefined()
    show()
    h.setters!.inp(320)
    h.setters!.cls(0.02)
    hide(); await settle()
    expect(sent).toHaveLength(2)
    expect(lastBeacon()).toEqual({ v: 1, r: 'listing', c: expect.any(String), u: { inp: [null, 320] }, ua: expect.any(Number) })
    expect(lastBeacon().ua).toBeGreaterThanOrEqual(0)
    show(); hide(); await settle()
    expect(sent).toHaveLength(2) // nothing new: nothing sent
  })

  it('a soft navigation is timed to the first frame that shows the new address, by its TARGET kind', async () => {
    const mod = await boot()
    mod.rumNavStart('/c/rentals', 'push')
    await vi.advanceTimersByTimeAsync(400)
    window.history.pushState(null, '', '/c/rentals')
    await vi.advanceTimersByTimeAsync(50)
    hide(); await settle()
    const [[route, ms]] = lastBeacon().n
    expect(route).toBe('category')
    expect(ms).toBeGreaterThanOrEqual(400)
    expect(ms).toBeLessThan(500)
    // The landing kind stays the page that was loaded.
    expect(lastBeacon().r).toBe('listing')
  })

  it('a soft navigation to a teacher profile is told apart once it lands (its marker is in the committed page)', async () => {
    const mod = await boot()
    mod.rumNavStart('/listings/t1', 'push')
    await vi.advanceTimersByTimeAsync(200)
    window.history.pushState(null, '', '/listings/t1')
    document.body.innerHTML = '<div data-rum="teacher"></div>'
    await vi.advanceTimersByTimeAsync(50)
    hide(); await settle()
    expect(lastBeacon().n[0][0]).toBe('teacher')
  })

  it('back/forward, a navigation to the address already shown, and a newer navigation drop the unfinished one', async () => {
    const mod = await boot()
    mod.rumNavStart('/c/a', 'traverse')
    mod.rumNavStart('/listings/abc', 'replace') // same address: never changes
    await vi.advanceTimersByTimeAsync(16_000)
    mod.rumNavStart('/c/a', 'push')
    mod.rumNavStart('/c/b', 'push') // replaces the one above
    await vi.advanceTimersByTimeAsync(100)
    window.history.pushState(null, '', '/c/b')
    await vi.advanceTimersByTimeAsync(50)
    hide(); await settle()
    expect(lastBeacon().n).toHaveLength(1)
  })
})

describe('usable — links React only injected as raw HTML do not hold it back', () => {
  it('a guide whose body links never hydrate still becomes usable when every React-owned link has', async () => {
    document.body.innerHTML = '<nav><a href="/a">a</a><a href="/b">b</a><a href="/c">c</a></nav><article id="body">'
      + Array.from({ length: 30 }, (_, i) => `<p><a href="/g/${i}">g</a></p>`).join('') + '</article>'
    await boot()
    await vi.advanceTimersByTimeAsync(600)
    // React hydrates the nav links and the article container (whose props say dangerouslySetInnerHTML) — never the links
    // inside it.
    for (const a of document.querySelectorAll('nav a')) (a as unknown as Record<string, unknown>).__reactProps$x = {}
    ;(document.getElementById('body') as unknown as Record<string, unknown>).__reactProps$x = { dangerouslySetInnerHTML: { __html: '…' } }
    await vi.advanceTimersByTimeAsync(300)
    hide(); await settle()
    expect(lastBeacon().m.hyd).toBeGreaterThanOrEqual(600)
    expect(lastBeacon().hx).toBeUndefined()
  })

  it('…but a pending container (not hydrated yet) keeps its links pending', async () => {
    document.body.innerHTML = '<nav><a href="/a">a</a></nav><article id="body">' + Array.from({ length: 10 }, (_, i) => `<a href="/g/${i}">g</a>`).join('') + '</article>'
    await boot()
    for (const a of document.querySelectorAll('nav a')) (a as unknown as Record<string, unknown>).__reactProps$x = {}
    await vi.advanceTimersByTimeAsync(1_000)
    hide(); await settle()
    expect(lastBeacon().m.hyd).toBeUndefined()
    expect(lastBeacon().hx).toBeGreaterThanOrEqual(1_000)
  })
})

describe('web-vitals 6 still finalises CLS/INP in a CAPTURE listener on window (the flush relies on it)', () => {
  it('⛔ a version bump that moves it fails here, not silently in the field', async () => {
    const { readFileSync } = await import('node:fs')
    const dir = 'node_modules/web-vitals/dist/modules'
    const watcher = readFileSync(`${dir}/lib/getVisibilityWatcher.js`, 'utf8')
    expect(watcher).toContain("addEventListener('visibilitychange', onVisibilityUpdate, true)")
    for (const f of ['onCLS.js', 'onINP.js']) expect(readFileSync(`${dir}/${f}`, 'utf8')).toContain('visibilityWatcher.onHidden(')
  })
})
