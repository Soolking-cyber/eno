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
