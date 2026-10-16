import { browserContext, deviceClass } from '@/lib/in-app-browser'
import type { NavigationType } from '@/lib/nav-progress'
import { RUM_ENDPOINT, RUM_MAX_NAVS, RUM_SAMPLE, RUM_VERSION, routeGroupOf, type RumBeacon, type RumLcpKind, type RumRoute } from './shared'

// ── Page-speed totals: the browser half that runs on EVERY page (speed plan item 5, 2026-10-16) ──────────
//
// Started by src/instrumentation-client.ts before hydration, so it sees the whole load — including a visitor who
// leaves before the page is usable, the slow tail a lazily loaded script would never see. It measures what the
// browser keeps for free (navigation + paint entries, one buffered LCP observer), the lab's "usable" moment, and
// soft navigations; CLS and INP come from web-vitals, loaded later in its own chunk (./vitals.ts).
//
// ⛔ ANONYMOUS BY CONSTRUCTION, AND NOT CONSENT-GATED (owner, 2026-10-16: "Anonymous, no consent" — the
// "Sign-up reminder counts" rule). It stores NOTHING on the device and sends only numbers and closed-set labels;
// the server keeps daily bucket totals (src/lib/rum/ops.ts). /privacy: "Page speed measurements".
// ⛔ NEVER UNDER AUTOMATION (`navigator.webdriver`): the lab harness and every e2e suite would count themselves.
// ⚠️ It is in every page's first JavaScript: no dependency beyond in-app-browser (already on every page) and
// shared.ts, every callback guarded — a measurement must never cost the visitor a broken page.

type State = {
  host: string
  path: string
  search: string
  route: RumRoute | null
  ctx: string
  lcp: number | null
  lcpKind: RumLcpKind | null
  hyd: number | null
  /** the page had enough links to judge "usable" by */
  hydJudged: boolean
  cls: number | null
  inp: number | null
  /** what the first beacon carried (and when, in page time), for the moves a later one may make */
  sent: null | { cls: number | null; inp: number | null; at: number }
  navs: [RumRoute, number][]
  navSeq: number
}

let S: State | null = null

/** The edition's apex (storefront-host.ts storefrontBaseHost, inlined at build — no import, this file is first-load). */
function baseHost(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://eno.vn').hostname.replace(/^www\./, '')
  } catch {
    return 'eno.vn'
  }
}

function landingRoute(s: State): RumRoute {
  if (!s.route) {
    let teacher = false
    try { teacher = !!document.querySelector('[data-rum="teacher"]') } catch { teacher = false }
    s.route = routeGroupOf(s.host, s.path, s.search, teacher, baseHost())
  }
  return s.route
}

function routeOfUrl(url: string): RumRoute {
  try {
    const u = new URL(url, location.href)
    // Before the navigation commits there is no DOM to ask: a teacher profile is told apart when it lands (rumNavStart).
    return routeGroupOf(u.host, u.pathname, u.search, false, baseHost())
  } catch {
    return 'other'
  }
}

/** React marks a hydrated element with an own `__reactProps$<id>` key (lab/inpage.js reads the same mark). */
function propsOf(el: Element): Record<string, unknown> | null {
  for (const k of Object.keys(el)) if (k.startsWith('__reactProps$')) return (el as unknown as Record<string, Record<string, unknown>>)[k]
  return null
}

/**
 * A link inside HTML React only INJECTS (dangerouslySetInnerHTML — the guide and legal bodies) never gets props of its
 * own, so a page full of them would never reach 95% (commit-gate review, opus). Once the nearest hydrated ancestor is
 * that container, the link is not React's to hydrate and counts neither way. Until then it is pending, like any other.
 */
function rawHtmlLink(el: Element): boolean {
  let p = el.parentElement
  for (let d = 0; p && d < 12; d++, p = p.parentElement) {
    const props = propsOf(p)
    if (props) return 'dangerouslySetInnerHTML' in props
  }
  return false
}

/**
 * "Usable" the way the lab measures it: ≥95% of the page's links carry React's props (links React only injected as
 * raw HTML aside — rawHtmlLink). A stride sample of ≤40 links,
 * re-read every 250 ms (links stream in), so a slow phone pays for ~40 Object.keys calls 4× a second until hydration
 * — then it stops, and it stops for good at 30 s or when the page is hidden.
 */
function watchHydration(s: State): void {
  const tick = () => {
    try {
      if (S !== s || s.hyd !== null || s.sent) return
      const links = document.links
      const n = links.length
      if (n >= 4) {
        s.hydJudged = true
        const k = Math.min(n, 40)
        const step = n / k
        let ok = 0
        let owned = 0
        for (let i = 0; i < k; i++) {
          const a = links[Math.floor(i * step)]
          if (propsOf(a)) { ok++; owned++ } else if (!rawHtmlLink(a)) owned++
        }
        if (owned > 0 && ok >= 0.95 * owned) { s.hyd = performance.now(); return }
      }
      if (performance.now() < 30_000 && document.visibilityState === 'visible') setTimeout(tick, 250)
    } catch { /* no measurement beats a broken page */ }
  }
  tick()
}

function observeLcp(s: State): void {
  try {
    new PerformanceObserver((list) => {
      const all = list.getEntries()
      const e = all[all.length - 1] as (PerformanceEntry & { url?: string; element?: Element | null }) | undefined
      if (!e || S !== s || s.sent) return
      s.lcp = e.startTime
      const tag = e.element?.tagName
      s.lcpKind = tag === 'VIDEO' ? 'video' : e.url ? 'img' : 'text'
    }).observe({ type: 'largest-contentful-paint', buffered: true })
  } catch { /* Safari before 26: no LCP */ }
}

/**
 * ⚠️ text/plain, NOT application/json: a Blob of a non-CORS-safelisted type made sendBeacon THROW in Chromium for years
 * (crbug.com/490015 — old Android WebViews still do). The route parses the text whatever its type. And a throwing or
 * refusing sendBeacon still falls through to fetch(keepalive) — the two are not in one try (commit-gate review, opus).
 */
function send(b: RumBeacon): void {
  let body: string
  try { body = JSON.stringify(b) } catch { return }
  try {
    if (typeof navigator.sendBeacon === 'function'
      && navigator.sendBeacon(RUM_ENDPOINT, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) return
  } catch { /* fall through to fetch */ }
  try {
    // eslint-disable-next-line no-restricted-syntax -- browser code: a lost beacon has no server log to reach
    fetch(RUM_ENDPOINT, { method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8' }, body, keepalive: true }).catch(() => {})
  } catch { /* a measurement must never break the page */ }
}

const round = (v: number) => Math.round(v)

/** The first beacon: the page view's numbers. Later ones: CLS/INP that grew, and soft navigations. */
function flush(): void {
  const s = S
  if (!s) return
  try {
    const route = landingRoute(s)
    // At most RUM_MAX_NAVS per beacon; a longer run between two hides keeps its first ones and drops the rest.
    const navs = s.navs.splice(0).slice(0, RUM_MAX_NAVS)
    if (!s.sent) {
      const nav = performance.getEntriesByType('navigation')[0] as (PerformanceNavigationTiming & { activationStart?: number }) | undefined
      const act = nav?.activationStart || 0
      const m: RumBeacon['m'] = {}
      if (nav && nav.responseStart > 0) m.ttfb = round(Math.max(0, nav.responseStart - act))
      const fcp = performance.getEntriesByName('first-contentful-paint')[0]
      if (fcp) m.fcp = round(Math.max(0, fcp.startTime - act))
      if (fcp && s.lcp !== null) m.lcp = round(Math.max(0, s.lcp - act))
      if (s.hyd !== null) m.hyd = round(Math.max(0, s.hyd - act))
      if (s.cls !== null) m.cls = Math.round(s.cls * 10_000) / 10_000
      if (s.inp !== null) m.inp = round(s.inp)
      const b: RumBeacon = { v: RUM_VERSION, r: route, c: s.ctx, m }
      if (s.hyd === null && s.hydJudged) b.hx = round(performance.now())
      if (m.lcp !== undefined && s.lcpKind) b.lk = s.lcpKind
      const dm = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
      if (typeof dm === 'number') b.dm = dm
      // ⚠️ A document from the browser's own HTTP cache replays the Server-Timing it was stored with (the Worker
      // answers with max-age), so its colo/state/origin describe some earlier load — say BROWSER and drop them.
      if (nav && nav.transferSize === 0 && nav.decodedBodySize > 0) b.e = 'BROWSER'
      else if (nav?.serverTiming?.length) {
        for (const t of nav.serverTiming) {
          if (t.name === 'edge') b.o = t.description
          else if (t.name === 'ecache') b.e = t.description
          else if (t.name === 'origin') b.d = round(t.duration)
          else if (t.name === 'app') b.a = round(t.duration)
          else if (t.name === 'ncache') b.nc = t.description
        }
        // nginx timing without the Worker's: a path the Worker does not route, answered by the box itself.
        if (!b.e) b.e = 'ORIGIN'
      }
      if (navs.length) b.n = navs
      s.sent = { cls: s.cls, inp: s.inp, at: performance.now() }
      send(b)
      return
    }
    const u: NonNullable<RumBeacon['u']> = {}
    if (s.cls !== null && (s.sent.cls === null || s.cls > s.sent.cls)) u.cls = [s.sent.cls, Math.round(s.cls * 10_000) / 10_000]
    if (s.inp !== null && (s.sent.inp === null || s.inp > s.sent.inp)) u.inp = [s.sent.inp, round(s.inp)]
    if (!u.cls && !u.inp && !navs.length) return
    s.sent = { cls: u.cls ? s.cls : s.sent.cls, inp: u.inp ? s.inp : s.sent.inp, at: s.sent.at }
    const b: RumBeacon = { v: RUM_VERSION, r: route, c: s.ctx }
    if (u.cls || u.inp) { b.u = u; b.ua = round(performance.now() - s.sent.at) }
    if (navs.length) b.n = navs
    send(b)
  } catch { /* a measurement must never break the page */ }
}

function loadVitals(s: State): void {
  let started = false
  const go = () => {
    if (started || S !== s) return
    started = true
    import('./vitals')
      .then((v) => v.watchVitals({
        cls: (x) => { if (S === s) s.cls = x },
        inp: (x) => { if (S === s) s.inp = x },
      }))
      // eslint-disable-next-line no-restricted-syntax -- browser code: a chunk that failed to load has no server log to reach; no CLS/INP for this view, the rest still counts
      .catch(() => {})
  }
  const idle = (fn: () => void) => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
    if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(fn, { timeout: 2000 })
    else setTimeout(fn, 300) // Safari / iOS WebViews have no requestIdleCallback
  }
  // After load (the visitor's own requests first) — or at 3 s if load is slower, so a slow page still gets CLS/INP.
  if (document.readyState === 'complete') idle(go)
  else window.addEventListener('load', () => idle(go), { once: true })
  setTimeout(() => idle(go), 3000)
}

/** Once per page load, from src/instrumentation-client.ts. */
export function startRum(): void {
  try {
    if (S || typeof window === 'undefined' || typeof performance === 'undefined') return
    if (navigator.webdriver === true || Math.random() >= RUM_SAMPLE) return
    // A page opened in the background (or prerendered) has no honest paint times: skip it entirely.
    if (document.visibilityState !== 'visible') return
    const lang = (document.documentElement.lang || '').toLowerCase().startsWith('vi') ? 'vi' : 'en'
    const s: State = {
      host: location.host, path: location.pathname, search: location.search, route: null,
      ctx: `${browserContext()}.${deviceClass()}.${lang}`,
      lcp: null, lcpKind: null, hyd: null, hydJudged: false, cls: null, inp: null, sent: null, navs: [], navSeq: 0,
    }
    S = s
    observeLcp(s)
    watchHydration(s)
    // ⚠️ ON document, WHERE THE EVENT IS FIRED — NOT window. web-vitals finalises CLS/INP in its own CAPTURE listener
    // on window (lib/getVisibilityWatcher.js), and the capture phase reaches window before the event reaches its target,
    // so by the time this runs the final values are in. Registration order does not decide it; the phase does — and a
    // listener at the target fires whether or not the event bubbles (commit-gate review, codex).
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
    // Old Safari can unload without a visibilitychange; flush() sends nothing it has already sent.
    window.addEventListener('pagehide', flush)
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => landingRoute(s), { once: true })
    else landingRoute(s)
    loadVitals(s)
  } catch { /* a measurement must never break the page */ }
}

/**
 * A soft navigation, from Next's onRouterTransitionStart: the time until the first frame that shows the new address.
 * Next writes the URL in the commit that renders the new page — its loading state where it has one, so this is
 * "the next page appears", not "its data has arrived". A navigation to the address already shown never changes it
 * and is dropped at 15 s, as is one the visitor hid mid-way; a newer navigation replaces an unfinished one.
 */
export function rumNavStart(url: string, type: NavigationType): void {
  const s = S
  if (!s || type === 'traverse') return
  try {
    const from = location.href
    const t0 = performance.now()
    const id = ++s.navSeq
    const target = routeOfUrl(url)
    const step = () => {
      try {
        if (S !== s || id !== s.navSeq || document.visibilityState !== 'visible') return
        const now = performance.now()
        if (location.href !== from) {
          // The new page has committed: a listing that renders a teacher profile now carries its marker (codex).
          const kind = target === 'listing' && document.querySelector('[data-rum="teacher"]') ? 'teacher' : target
          if (s.navs.length < RUM_MAX_NAVS) s.navs.push([kind, round(now - t0)])
          return
        }
        if (now - t0 < 15_000) requestAnimationFrame(step)
      } catch { /* drop this one */ }
    }
    requestAnimationFrame(step)
  } catch { /* a measurement must never break a navigation */ }
}
