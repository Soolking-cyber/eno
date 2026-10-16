import { parseContextClass, vnDay } from '@/lib/signup-prompt'
import {
  RUM_APP_CACHE,
  RUM_COLOS,
  RUM_EDGE_STATES,
  RUM_LCP_KINDS,
  RUM_MAX,
  RUM_MAX_NAVS,
  RUM_METRICS,
  RUM_VERSION,
  bucketOf,
  isRumRoute,
  memoryTier,
  type RumMetric,
  type RumScale,
} from './shared'

// ── A beacon → the +1s (and, for a CLS/INP that grew later, the −1/+1 moves) it is allowed to make ─────────
//
// Pure: no I/O, no clock. The route (src/app/api/page-speed/route.ts) adds the day and the edition.
// ⛔ NOTHING THE CLIENT SENT IS STORED AS SENT. Every label is checked against a closed set (src/lib/rum/shared.ts)
// and every number against its range; a number becomes a bucket id here, so the stored row never holds it.
// ⚠️ Rows are keyed (family, dims, bucket):
//   ttfb|fcp|lcp|cls|inp|hyd  `<route>|<class>`   the page view's numbers
//   hydx                      `<route>|<class>`   hidden before its links worked: ms on the page by then
//   nav                       `<route>|<class>`   a soft navigation: ms to the next page's first frame (route = target)
//   edge                      `<colo>|<state>`    ttfb by Cloudflare data centre × what answered
//   origin                    `<state>`           edge→origin ms, from the Worker, when this view waited for the box
//   app                       `<route>|<ncache>`  the app's time to its first byte, from nginx at the box (any page)
//   lcpk                      `<route>|<kind>`    lcp by what the largest paint was
//   dev                       `<lcp|hyd>|<tier>`  lcp / hyd by device memory tier (Chromium only)

export interface RumOp {
  family: string
  dims: string
  bucket: number
  delta: 1 | -1
  /** A move only: the VN day its first beacon was counted on (unset = the day the beacon arrives). */
  day?: string
}

/** Most ops one beacon can produce: 6 metrics + hydx + edge + origin + app + lcpk + 2 dev + 2×2 moves + RUM_MAX_NAVS. */
export const RUM_MAX_OPS = 17 + RUM_MAX_NAVS

const SCALE: Record<RumMetric, RumScale> = { ttfb: 'ttfb', fcp: 'ms', lcp: 'ms', cls: 'cls', inp: 'inp', hyd: 'ms' }

const num = (v: unknown, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? v : null

/** In the bucket's units: CLS is stored × 1000. */
const scaled = (metric: RumMetric, v: number): number => (metric === 'cls' ? Math.round(v * 1000) : v)

const oneOf = <T extends string>(set: readonly T[], v: unknown): T | null =>
  typeof v === 'string' && (set as readonly string[]).includes(v) ? (v as T) : null

/**
 * The ops a beacon makes, or null when it is not a beacon at all (wrong version, unknown page kind, not an object).
 * A bad FIELD is dropped on its own; the rest of the beacon still counts.
 */
export function rumOps(body: unknown, now: number = Date.now()): RumOp[] | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const b = body as Record<string, unknown>
  if (b.v !== RUM_VERSION || !isRumRoute(b.r)) return null
  const route = b.r
  const cls = parseContextClass(b.c)
  const rc = `${route}|${cls}`
  const ops: RumOp[] = []
  const add = (family: string, dims: string, scale: RumScale, v: number, delta: 1 | -1 = 1) =>
    ops.push({ family, dims, bucket: bucketOf(scale, v), delta })

  // The page view's own numbers (first beacon).
  const m = b.m && typeof b.m === 'object' && !Array.isArray(b.m) ? (b.m as Record<string, unknown>) : null
  const got: Partial<Record<RumMetric, number>> = {}
  if (m) {
    for (const metric of RUM_METRICS) {
      const v = num(m[metric], RUM_MAX[metric])
      if (v === null) continue
      got[metric] = v
      add(metric, rc, SCALE[metric], scaled(metric, v))
    }
  }
  if (got.hyd === undefined) {
    const hx = num(b.hx, RUM_MAX.hydx)
    if (hx !== null) add('hydx', rc, 'ms', hx)
  }
  if (got.ttfb !== undefined) {
    const state = oneOf(RUM_EDGE_STATES, b.e) ?? 'NONE'
    // A colo means something only for a live answer; a replay or no timing has none.
    const colo = state === 'BROWSER' || state === 'NONE' ? 'none' : (oneOf(RUM_COLOS, b.o) ?? 'other')
    add('edge', `${colo}|${state}`, 'ttfb', got.ttfb)
    // Only a view that WAITED for the box has origin/app times worth keeping (an edge HIT's would be the fill's).
    if (state === 'MISS' || state === 'DYN' || state === 'PASS' || state === 'ORIGIN') {
      const d = num(b.d, RUM_MAX.origin)
      if (d !== null && state !== 'ORIGIN') add('origin', state, 'origin', d)
      const a = num(b.a, RUM_MAX.app)
      if (a !== null) add('app', `${route}|${oneOf(RUM_APP_CACHE, b.nc) ?? 'none'}`, 'origin', a)
    }
  }
  if (got.lcp !== undefined) {
    const kind = oneOf(RUM_LCP_KINDS, b.lk)
    if (kind) add('lcpk', `${route}|${kind}`, 'ms', got.lcp)
  }
  const tier = memoryTier(b.dm)
  if (tier !== null) {
    if (got.lcp !== undefined) add('dev', `lcp|${tier}`, 'ms', got.lcp)
    if (got.hyd !== undefined) add('dev', `hyd|${tier}`, 'ms', got.hyd)
  }

  // A later beacon: CLS/INP grew after the first was sent — move the view from its old bucket to the new one, so
  // each view is counted once, at its final value, without the server ever knowing which view it was.
  const u = b.u && typeof b.u === 'object' && !Array.isArray(b.u) ? (b.u as Record<string, unknown>) : null
  // `ua`: ms since this page view's FIRST beacon (relative — no clock time is sent). A move straddling Vietnamese
  // midnight then lowers the bucket its first beacon raised, not one in the new day (commit-gate review, both seats).
  const age = num(b.ua, 86_400_000)
  const moveDay = age !== null ? vnDay(now - age) : undefined
  if (u && !m) {
    for (const metric of ['cls', 'inp'] as const) {
      const pair = u[metric]
      if (!Array.isArray(pair) || pair.length !== 2) continue
      const after = num(pair[1], RUM_MAX[metric])
      const before = pair[0] === null ? null : num(pair[0], RUM_MAX[metric])
      if (after === null || (pair[0] !== null && before === null)) continue
      if (before !== null && !(after > before)) continue
      const to = bucketOf(SCALE[metric], scaled(metric, after))
      if (before === null) { ops.push({ family: metric, dims: rc, bucket: to, delta: 1, day: moveDay }); continue }
      const from = bucketOf(SCALE[metric], scaled(metric, before))
      if (from === to) continue
      ops.push({ family: metric, dims: rc, bucket: from, delta: -1, day: moveDay }, { family: metric, dims: rc, bucket: to, delta: 1, day: moveDay })
    }
  }

  // Soft navigations: each to its own target page kind.
  if (Array.isArray(b.n)) {
    for (const nav of b.n.slice(0, RUM_MAX_NAVS)) {
      if (!Array.isArray(nav) || nav.length !== 2 || !isRumRoute(nav[0])) continue
      const ms = num(nav[1], RUM_MAX.nav)
      if (ms === null) continue
      add('nav', `${nav[0]}|${cls}`, 'ms', ms)
    }
  }
  return ops.slice(0, RUM_MAX_OPS)
}
