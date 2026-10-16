// ── Page-speed totals: the half the browser and the server share (speed plan item 5, 2026-10-16) ──────
//
// Real visitors' load and response times, kept as DAILY TOTALS per bucket and nothing else — the "Sign-up
// reminder counts" rule (src/lib/signup-counters.ts), chosen by the owner for this measurement on 2026-10-16
// ("Anonymous, no consent"). The browser measures the page it just showed and sends the numbers with a coarse
// label; the server (src/lib/rum/ops.ts → src/app/api/page-speed/route.ts) turns each number into +1 on one
// bucket of one day's histogram. /privacy says exactly that ("Page speed measurements").
//
// ⛔ EVERYTHING HERE IS A CLOSED SET OR A NUMBER, ON PURPOSE. A label the server does not recognise is dropped or
// stored as "other", never as sent: that is what keeps a total from carrying anything about the visitor.
// ⚠️ This file ships in every page's first JavaScript (via src/lib/rum/early.ts) — keep it small and import-free.

export const RUM_ENDPOINT = '/api/page-speed'
export const RUM_VERSION = 1

/** Share of page loads that measure. 1 = all: the volume is small, and the server batches every 30 s. */
export const RUM_SAMPLE = 1

/** The kind of page. `teacher` is a listing page that renders a teacher profile (`[data-rum="teacher"]`). */
export const RUM_ROUTES = ['home', 'category', 'listing', 'teacher', 'search', 'store', 'chat', 'account', 'content', 'other'] as const
export type RumRoute = (typeof RUM_ROUTES)[number]
export const isRumRoute = (v: unknown): v is RumRoute => typeof v === 'string' && (RUM_ROUTES as readonly string[]).includes(v)

/**
 * The page view's own numbers, in ms from the start of the navigation (cls is the layout-shift score):
 *   ttfb — first byte · fcp — first content · lcp — largest content · cls — how far the page jumped
 *   inp  — the slowest response to a tap or key (web-vitals' Interaction to Next Paint)
 *   hyd  — when ≥95% of a sample of the page's links carry React's props: the lab's "usable" (lab/inpage.js)
 */
export const RUM_METRICS = ['ttfb', 'fcp', 'lcp', 'cls', 'inp', 'hyd'] as const
export type RumMetric = (typeof RUM_METRICS)[number]

/** The Cloudflare data centres that serve Vietnam (measured 2026-10-15: HKG 68%, SIN 26%); anything else is "other". */
export const RUM_COLOS = ['HKG', 'SIN', 'SGN', 'HAN', 'BKK', 'KUL', 'TPE', 'NRT'] as const

/**
 * What answered the document. From the HTML Worker's Server-Timing `ecache` on its routes (/, /c/*, the legal pages —
 * infra/cloudflare/eno-html-edge-cache.js): HIT/STALE from the edge copy, MISS stored after an origin fetch, DYN an
 * origin page the edge may not keep, PASS a signed-in reader. ORIGIN = no Worker on this path, but nginx's timing is
 * there (every listing, teacher and search page goes straight to the box). BROWSER = the browser's own HTTP cache
 * answered (its Server-Timing is a replay, so it is ignored). NONE = no timing at all.
 */
export const RUM_EDGE_STATES = ['HIT', 'STALE', 'MISS', 'DYN', 'PASS', 'ORIGIN', 'BROWSER', 'NONE'] as const
export type RumEdgeState = (typeof RUM_EDGE_STATES)[number]

/** Next's own ISR state for an origin answer (`x-nextjs-cache`, relayed as Server-Timing `ncache`). */
export const RUM_APP_CACHE = ['HIT', 'STALE', 'MISS', 'REVALIDATED'] as const

/** What the largest paint was: an image (incl. a video poster's frame source), text, or a video. */
export const RUM_LCP_KINDS = ['img', 'text', 'video'] as const
export type RumLcpKind = (typeof RUM_LCP_KINDS)[number]

/** navigator.deviceMemory as a tier (Chromium only; it reports 0.25–8 GB). */
export function memoryTier(v: unknown): 1 | 2 | 4 | 8 | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null
  return v <= 1 ? 1 : v <= 2 ? 2 : v <= 4 ? 4 : 8
}

// ── Buckets: each value lands on the largest lower edge ≤ it; the edges are the stored bucket ids ──────────
const MS = [0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1200, 1400, 1600, 1800, 2000, 2250, 2500, 2750, 3000, 3500, 4000, 4500, 5000, 6000, 7000, 8000, 9000, 10000, 12000, 15000, 20000, 30000]
const TTFB = [0, 50, 100, 150, 200, 250, 300, 350, 400, 500, 600, 700, 800, 1000, 1200, 1500, 1800, 2200, 2600, 3000, 4000, 5000, 7500, 10000, 20000]
const INP = [0, 25, 50, 75, 100, 125, 150, 175, 200, 250, 300, 350, 400, 500, 600, 800, 1000, 1500, 2000, 3000, 5000]
/** CLS × 1000, so the ids stay integers. */
const CLS = [0, 10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2500]
const ORIGIN = [0, 10, 20, 30, 40, 50, 60, 80, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000]

export type RumScale = 'ms' | 'ttfb' | 'inp' | 'cls' | 'origin'
export const RUM_EDGES: Record<RumScale, readonly number[]> = { ms: MS, ttfb: TTFB, inp: INP, cls: CLS, origin: ORIGIN }

/** The largest edge ≤ v (v already in the scale's units: CLS × 1000). */
export function bucketOf(scale: RumScale, v: number): number {
  const edges = RUM_EDGES[scale]
  let b = edges[0]
  for (const e of edges) { if (e <= v) b = e; else break }
  return b
}

/** The accepted range of each number, in its own units (cls raw). Anything outside is dropped, not clamped. */
export const RUM_MAX = { ttfb: 120_000, fcp: 120_000, lcp: 120_000, hyd: 120_000, hydx: 120_000, inp: 60_000, cls: 50, origin: 60_000, app: 60_000, nav: 20_000 } as const

/** The soft navigations one beacon may carry — a page view sends at most this many per beacon, the rest are dropped. */
export const RUM_MAX_NAVS = 8

// ── The kind of page ────────────────────────────────────────────────────────────────────────────────────
const ACCOUNT = new Set(['dashboard', 'account', 'saved', 'post', 'onboard', 'checkout', 'signin', 'auth', 'admin', 'disputes', 'reports', 'appeal', 'unsubscribe', 'account-deletion', 'teachers'])
const CONTENT = new Set(['guide', 'help', 'legal', 'privacy', 'terms', 'regulations', 'prohibited', 'safety', 'trust', 'about', 'contact', 'developers', 'partners', 'returns', 'schools', 'teach-in-vietnam', 'hcmc-rent-index', 'forum', 'brands'])

/**
 * The page kind from the address the visitor sees (public URLs carry no /en|/vi — src/proxy.ts rewrites inside).
 * `base` is the edition's apex (storefrontBaseHost): `teacher.<base>` is the teacher host, any other subdomain but
 * www a storefront. A non-empty `q` on the home or a category page is a search (/?q=… is the search page).
 * ⚠️ Single-segment pages with a hyphen are the SEO guides (src/app/[lang]/<slug>); everything unmatched is "other".
 * ⛔ NO VISA OR ITINERARY KIND, ON PURPOSE: this file is in eno.vn's first JavaScript, and the licensed marketplace
 * ships not even the names of those surfaces (CLAUDE.md, the licensing boundary). On eno.forum they count as other pages.
 */
export function routeGroupOf(host: string, pathname: string, search: string, teacherPage: boolean, base: string): RumRoute {
  const h = host.toLowerCase().replace(/:\d+$/, '')
  if (base && h !== base && h !== `www.${base}` && h.endsWith(`.${base}`)) {
    return h === `teacher.${base}` ? 'teacher' : 'store'
  }
  const seg = pathname.split('/').filter(Boolean)
  let q = ''
  try { q = (new URLSearchParams(search).get('q') || '').trim() } catch { q = '' }
  if (q && (seg.length === 0 || seg[0] === 'c')) return 'search'
  if (seg.length === 0) return 'home'
  const top = seg[0]
  if (top === 'c') return 'category'
  if (top === 'listings') {
    if (seg.length === 2) return teacherPage ? 'teacher' : 'listing'
    return seg[2] === 'edit' ? 'account' : 'listing'
  }
  if (top === 's' || top === 'sellers') return 'store'
  if (top === 'messages') return 'chat'
  if (ACCOUNT.has(top)) return 'account'
  if (CONTENT.has(top) || (seg.length === 1 && top.includes('-'))) return 'content'
  return 'other'
}

/** The wire format — short keys, every field optional but `v`, `r`, `c`. */
export interface RumBeacon {
  v: typeof RUM_VERSION
  /** the landing page's kind */
  r: RumRoute
  /** the context class (signup-prompt.ts CONTEXTS × DEVICES × LANGS) */
  c: string
  /** first beacon only: the page view's numbers */
  m?: Partial<Record<RumMetric, number>>
  /** first beacon only, instead of m.hyd: ms on the page when it was hidden before its links worked */
  hx?: number
  /** first beacon only: what the largest paint was */
  lk?: RumLcpKind
  /** first beacon only: navigator.deviceMemory as reported */
  dm?: number
  /**
   * Server-Timing: data centre (nginx `edge`, from CF-Ray; or the Worker's), edge state (Worker `ecache`), edge→origin
   * ms (Worker `origin`), the app's time to its first byte at the box (nginx `app`), Next's cache state (nginx `ncache`)
   */
  o?: string
  e?: string
  d?: number
  a?: number
  nc?: string
  /** a later beacon: CLS/INP grew after the first one — [previously sent or null, now] */
  u?: { cls?: [number | null, number]; inp?: [number | null, number] }
  /** a later beacon: ms since the first beacon, so a move lands on the first beacon's day */
  ua?: number
  /** soft navigations since the last beacon: [target page kind, ms to its first frame] */
  n?: [RumRoute, number][]
}
