import 'server-only'

/**
 * CONTENT-ADDRESSED URL FOR AN ADMIN-CURATED BRAND LOGO.
 *
 * ⛔ WHY THIS EXISTS: `/brands` WAS 2.27 MB OF HTML AND 648 KB OF IT WAS LOGOS. `BrandLogo`
 * renders a curated full `<svg>` as a CSS mask via `url("data:image/svg+xml,…")`, and
 * `encodeURIComponent` inflates SVG source roughly 2.7×. Measured 2026-09-20: 44 brands hold a
 * full `<svg>` in `Brand.logoPath` (241 kB in the database) which became **176 inline data URIs
 * totalling 648 kB — 28% of the page** — re-sent on every request and shared with nothing.
 * Serving the same bytes from a URL makes them cacheable once and reused across every surface.
 *
 * ⚠️ THE HASH IS THE POINT, NOT DECORATION. An admin can edit a logo, so a bare
 * `/api/brand-logo/<slug>` could not carry a long TTL without serving a stale mark for a year.
 * Keying on a hash of the SVG source makes the URL change whenever the art changes, which is what
 * earns `immutable`. Same reasoning as the `?v=` stamps on the category glyphs and icon sprite.
 */

/** FNV-1a, 32-bit — short, stable, and dependency-free. Not a security hash; it only has to change
 *  when the bytes change. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

/** True when this brand's stored logo is a full `<svg>` document (the case that inlines badly). */
export function isFullSvgLogo(logoPath: string | null | undefined): boolean {
  if (!logoPath) return false
  const raw = logoPath.trim()
  const at = raw.search(/<svg[\s>]/i)
  return at >= 0
}

/**
 * The cacheable URL for a brand's curated logo, or null when there is nothing to serve — in which
 * case `BrandLogo` keeps its existing behaviour (simple-icons path data, or a monogram chip).
 */
export function brandLogoUrl(brand: { slug: string; logoPath?: string | null }): string | null {
  // ⛔ THE SAME PREDICATE THE ROUTE USES, DELIBERATELY. If these two disagreed, a logo the route
  // refuses would still get a URL here and `BrandLogo` would render a masked span over a 404 — an
  // invisible hole where a brand mark should be, with no fallback. One check, both callers.
  if (!brand.logoPath || !sanitizeBrandSvg(brand.logoPath)) return null
  return `/api/brand-logo/${encodeURIComponent(brand.slug)}?v=${fnv1a(brand.logoPath.trim())}`
}

/**
 * A curated logo's SVG, or null when it is missing, malformed, or CARRIES ANYTHING ACTIVE.
 *
 * ⛔ THIS REJECTS, IT DOES NOT CLEAN — AND THE FIRST VERSION GOT THAT BACKWARDS. It tried to strip
 * `<script>`, `on…=` and `javascript:` with regexes, and two reviewers walked straight through it
 * on 2026-09-20: `<svg/onload=…>` (a `/` is not whitespace, so `\son[a-z]+` never matched), a
 * `<script>` with NO closing tag (browsers execute it to EOF, neither strip pattern matched),
 * `<sc<script></script>ript>` reassembling into a live tag after a single-pass replace, SMIL
 * (`<set attributeName="onload" …>`, `<animate attributeName="href" values="javascript:…">`), and
 * entity-encoded targets (`href="jav&#x61;script:…"`). A denylist that rewrites hostile input is a
 * losing game; the only safe move on a file we serve from our OWN origin is to refuse it.
 *
 * ⛔ WHY IT MATTERS HERE SPECIFICALLY: the route serves `image/svg+xml` from eno.vn, the URL is
 * public and navigable, and the app-wide CSP allows `script-src 'self' 'unsafe-inline'` — a
 * per-route CSP header does NOT help, because next.config's `headers()` overrides anything the
 * route sets (measured). On passwordless auth, script on our origin is a session.
 *
 * ⚠️ ENTITIES ARE DECODED BEFORE SCANNING, or `jav&#x61;script:` hides from every pattern below.
 * ⚠️ REJECTION IS SAFE TO THE USER: `brandLogoUrl()` runs this same check, so a refused logo never
 * gets a URL at all and `BrandLogo` falls back to the monogram chip — a named circle, not a hole.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(quot|apos|amp|lt|gt|Tab|NewLine|colon);?/gi, (m, n) =>
      ({ quot: '"', apos: "'", amp: '&', lt: '<', gt: '>', tab: '\t', newline: '\n', colon: ':' })[String(n).toLowerCase()] ?? m,
    )
}

/**
 * Anything here means the file is refused outright.
 *
 * ⚠️ ELEMENT NAMES ARE MATCHED WITH AN OPTIONAL XML NAMESPACE PREFIX. A reviewer pointed out that
 * `<svg:script>` executes exactly like `<script>` in an SVG document and sailed past a bare
 * `/<\s*script/i`. Every element rule below therefore carries `(?:[a-z0-9_.-]+:)?`.
 *
 * ⚠️ THE href RULE ALLOWS WHAT REAL ARTWORK ACTUALLY CONTAINS. Refusing every scheme also refused
 * `<image xlink:href="data:image/png;base64,…">` and `<a href="https://acme.com">`, both routine in
 * exported logos — and a refusal here is invisible: `brandLogoUrl()` returns null and the brand
 * quietly becomes a monogram. So raster data URIs and http(s) links are permitted; `data:image/svg+xml`
 * is NOT, because a nested SVG can carry script of its own.
 */
const ACTIVE_CONTENT: readonly RegExp[] = [
  /<\s*(?:[a-z0-9_.-]+:)?script/i,
  /<\s*(?:[a-z0-9_.-]+:)?(foreignObject|iframe|embed|object|handler|audio|video)/i,
  // SMIL can assign an event handler or a javascript: target at runtime, with no `on…=` in sight.
  /<\s*(?:[a-z0-9_.-]+:)?(set|animate|animateTransform|animateMotion|discard)\b/i,
  // An event handler after ANY separator — whitespace, `/`, a quote — not just whitespace.
  /[\s/"'`]on[a-z]+\s*=/i,
  /(javascript|vbscript|livescript)\s*:/i,
  // Raster data URIs are fine; text/html and a nested SVG are not.
  /data\s*:\s*(text\/|image\/svg)/i,
  /<!ENTITY/i,
  /**
   * ⛔ `<use>` AND `<image>` MAY ONLY POINT INWARDS OR AT INLINE RASTER DATA. Relaxing the general
   * href rule to admit `https:` (so ordinary `<a>` links in exported artwork stop being refused)
   * re-admitted `<use href="https://evil.test/x.svg#a">`, which the test suite caught. An external
   * `<use>` pulls a remote document into the render, and even where the browser blocks that it has
   * already told a third party the viewer's IP and the page they were on. A brand mark has no
   * business fetching anything.
   */
  /<\s*(?:[a-z0-9_.-]+:)?(use|image)\b[^>]*?(?:xlink\s*:\s*)?href\s*=\s*["']?(?!#|data:image\/(?:png|jpe?g|gif|webp))[^"'>\s]/i,
]

export function sanitizeBrandSvg(logoPath: string): string | null {
  const raw = logoPath.trim()
  const at = raw.search(/<svg[\s>]/i)
  if (at < 0) return null
  const v = raw.slice(at)

  const probe = decodeEntities(v)
  for (const rule of ACTIVE_CONTENT) if (rule.test(probe)) return null

  // ⛔ THE NAMESPACE MUST BE FORCED. Pasted and AI-generated SVGs routinely omit or mangle it
  // (e.g. "http://w3.org"), and the browser then renders nothing at all — a blank mask reads as
  // "the logo is missing" rather than "the file is malformed". Same fix as brand-logo.tsx.
  return v.replace(/<svg\b[^>]*>/i, (tag) =>
    tag
      .replace(/\s+xmlns\s*=\s*("[^"]*"|'[^']*')/i, '')
      .replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"'),
  )
}

// ── The box /brands draws a mark in ──────────────────────────────────────────────────────────────

/**
 * WHERE /brands DRAWS A MARK, SO EVERY BRAND READS AT ONE OPTICAL SIZE (2026-11-06 audit). simple-icons draws every logo
 * inside the same 24×24 square, so in a 44px box the Apple glyph filled the square while the SAMSUNG, SONY and TOSHIBA
 * wordmarks came out as 7px slivers. This crops path data to what it actually draws and gives every mark one AREA — a
 * wordmark wide and short, a glyph narrow and tall — inside a 112×44 slot. A curated `<svg>` document (painted as a mask
 * from its URL) is sized from its own viewBox.
 *
 * ⚠️ AN OVER-ESTIMATE BY CONSTRUCTION, SO NO MARK IS EVER CUT: a Bézier is bounded by its control points, an arc by its
 * endpoints and the points where its x and y peak inside its sweep, and the result is clamped to the 24×24 artboard —
 * the worst case is the old square. Anything it cannot read is null, and BrandLogo keeps its `size` square. Measured
 * against all 3,450 paths in the installed simple-icons: every one parses.
 */
export type BrandLogoFit = { width: number; height: number; viewBox?: string }

const SLOT_W = 112
const SLOT_H = 44
const SLOT_AREA = 1700

/** One area for every mark, inside the slot: a 6:1 wordmark ≈ 101×17, a square glyph ≈ 41×41. */
function slotBox(aspect: number): { width: number; height: number } {
  let h = Math.sqrt(SLOT_AREA / aspect)
  let w = h * aspect
  if (h > SLOT_H) { h = SLOT_H; w = h * aspect }
  if (w > SLOT_W) { w = SLOT_W; h = w / aspect }
  return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) }
}

const PATH_NUM = /[\s,]*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/y
const PATH_FLAG = /[\s,]*([01])/y
const PATH_CMD = /[\s,]*([MmLlHhVvCcSsQqTtAaZz])/y
const PATH_END = /[\s,]*$/y

/** The drawn extent of path data on its 24×24 artboard, as a viewBox and its width:height; null if it cannot be read. */
function pathExtent(d: string): { viewBox: string; aspect: number } | null {
  let i = 0
  const take = (re: RegExp): string | null => {
    re.lastIndex = i
    const m = re.exec(d)
    if (!m) return null
    i = re.lastIndex
    return m[1]
  }
  const num = (): number => {
    const s = take(PATH_NUM)
    if (s === null) throw new Error('path: number expected')
    return Number(s)
  }
  const flag = (): number => {
    const s = take(PATH_FLAG)
    if (s === null) throw new Error('path: arc flag expected')
    return Number(s)
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const add = (px: number, py: number) => {
    if (px < minX) minX = px
    if (px > maxX) maxX = px
    if (py < minY) minY = py
    if (py > maxY) maxY = py
  }
  // An elliptical arc: its centre from the endpoint form (SVG 1.1 implementation notes, F.6.5), then the points where
  // its x and its y peak, wherever its sweep reaches them — exact, whatever the radius.
  // ⚠️ NOT POINTS SAMPLED ALONG THE SWEEP (2026-11-06 review): the gap between two samples grows with the radius, so no
  // fixed pad covers it — 24 samples put a radius-100 arc's top at y 12.64 where it peaks at 12, and cut the mark.
  const arc = (x1: number, y1: number, rxIn: number, ryIn: number, deg: number, large: number, sweep: number, x2: number, y2: number) => {
    add(x2, y2)
    let rx = Math.abs(rxIn), ry = Math.abs(ryIn)
    if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) return
    const phi = (deg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi)
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2
    const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy
    const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
    if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda) }
    const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
    const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, (rx * rx * ry * ry - den) / den))
    const cxp = (coef * rx * y1p) / ry, cyp = (-coef * ry * x1p) / rx
    const cx = cos * cxp - sin * cyp + (x1 + x2) / 2, cy = sin * cxp + cos * cyp + (y1 + y2) / 2
    const t1 = Math.atan2((y1p - cyp) / ry, (x1p - cxp) / rx)
    let dt = Math.atan2((-y1p - cyp) / ry, (-x1p - cxp) / rx) - t1
    if (sweep && dt < 0) dt += 2 * Math.PI
    if (!sweep && dt > 0) dt -= 2 * Math.PI
    // x peaks where −rx·cos·sin t − ry·sin·cos t = 0 and y where −rx·sin·sin t + ry·cos·cos t = 0, each twice a turn.
    // Brought into [lo, lo + 2π), a peak at or before `hi` lies on the drawn arc; the endpoints cover the rest.
    const lo = Math.min(t1, t1 + dt), hi = Math.max(t1, t1 + dt), TAU = 2 * Math.PI
    const tx = Math.atan2(-ry * sin, rx * cos), ty = Math.atan2(ry * cos, rx * sin)
    for (const peak of [tx, tx + Math.PI, ty, ty + Math.PI]) {
      const t = lo + ((((peak - lo) % TAU) + TAU) % TAU)
      if (t <= hi) add(cx + rx * cos * Math.cos(t) - ry * sin * Math.sin(t), cy + rx * sin * Math.cos(t) + ry * cos * Math.sin(t))
    }
  }
  let cmd = ''
  // (qx, qy): the last control point, which S and T reflect. Reflecting one a strict reader would not only widens the box.
  let x = 0, y = 0, sx = 0, sy = 0, qx = 0, qy = 0
  try {
    for (;;) {
      const c = take(PATH_CMD)
      if (c) cmd = c
      else {
        PATH_END.lastIndex = i
        if (PATH_END.test(d)) break
        // Numbers with no command before them, or after Z (which takes none): not path data.
        if (!cmd || cmd === 'z' || cmd === 'Z') return null
      }
      const rel = cmd >= 'a'
      const ox = rel ? x : 0, oy = rel ? y : 0
      switch (cmd.toLowerCase()) {
        case 'z': x = sx; y = sy; qx = x; qy = y; break
        case 'm': x = ox + num(); y = oy + num(); sx = x; sy = y; add(x, y); qx = x; qy = y; cmd = rel ? 'l' : 'L'; break
        case 'l': x = ox + num(); y = oy + num(); add(x, y); qx = x; qy = y; break
        case 'h': x = ox + num(); add(x, y); qx = x; qy = y; break
        case 'v': y = oy + num(); add(x, y); qx = x; qy = y; break
        case 'c': { const x1 = ox + num(), y1 = oy + num(), x2 = ox + num(), y2 = oy + num(); x = ox + num(); y = oy + num(); add(x1, y1); add(x2, y2); add(x, y); qx = x2; qy = y2; break }
        case 's': { add(2 * x - qx, 2 * y - qy); const x2 = ox + num(), y2 = oy + num(); x = ox + num(); y = oy + num(); add(x2, y2); add(x, y); qx = x2; qy = y2; break }
        case 'q': { const x1 = ox + num(), y1 = oy + num(); x = ox + num(); y = oy + num(); add(x1, y1); add(x, y); qx = x1; qy = y1; break }
        case 't': { const x1 = 2 * x - qx, y1 = 2 * y - qy; x = ox + num(); y = oy + num(); add(x1, y1); add(x, y); qx = x1; qy = y1; break }
        case 'a': { const x0 = x, y0 = y, rx = num(), ry = num(), deg = num(), large = flag(), sweep = flag(); x = ox + num(); y = oy + num(); arc(x0, y0, rx, ry, deg, large, sweep, x, y); qx = x; qy = y; break }
        default: return null
      }
    }
  } catch {
    return null
  }
  const PAD = 0.25
  const left = Math.max(0, minX - PAD), top = Math.max(0, minY - PAD)
  const w = Math.min(24, maxX + PAD) - left, h = Math.min(24, maxY + PAD) - top
  if (!(w > 0 && h > 0)) return null
  const r = (v: number) => Math.round(v * 1000) / 1000
  return { viewBox: `${r(left)} ${r(top)} ${r(w)} ${r(h)}`, aspect: w / h }
}

/** A curated `<svg>` document's width:height, from its viewBox (else its width and height); null if it states neither. */
function svgAspect(svg: string): number | null {
  const tag = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? ''
  const box = /\sviewBox\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1].trim().split(/[\s,]+/).map(Number)
  const w = box?.length === 4 ? box[2] : Number(/\swidth\s*=\s*["']?([\d.]+)/i.exec(tag)?.[1])
  const h = box?.length === 4 ? box[3] : Number(/\sheight\s*=\s*["']?([\d.]+)/i.exec(tag)?.[1])
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? w / h : null
}

/** The box BrandLogo draws this mark in on /brands (`logo` is brandIconPath()'s value), or null for its `size` square. */
export function brandLogoFit(logo: string | null | undefined): BrandLogoFit | null {
  const raw = logo?.trim()
  if (!raw) return null
  if (/<svg[\s>]/i.test(raw)) {
    const aspect = svgAspect(raw)
    return aspect === null ? null : slotBox(aspect)
  }
  const extent = pathExtent(raw)
  return extent === null ? null : { ...slotBox(extent.aspect), viewBox: extent.viewBox }
}
