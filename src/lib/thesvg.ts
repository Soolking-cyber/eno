import 'server-only'

// Wider brand-logo coverage via theSVG (thesvg.org — 6,100+ brand marks). simple-icons
// (~3,400) is our primary monotone source; this fills the gaps. theSVG ships FULL-COLOUR
// SVGs, but BrandLogo renders any stored `logoPath` <svg> as a CSS mask-image filled with
// currentColor — i.e. a MONOTONE silhouette in our colour (the logo's own fills are
// ignored). So we just fetch the raw SVG, sanitize, and store it.
//
// The JSON API returns the SPA shell to non-browsers, but the raw file URL is a static,
// predictable, key-less endpoint: https://thesvg.org/icons/<slug>/default.svg

const BASE = 'https://thesvg.org/icons'
const MAX_BYTES = 60_000
const TIMEOUT_MS = 7000

/** Candidate theSVG slugs for a brand — covers hyphenated + collapsed spellings
 *  ("Louis Vuitton" → louis-vuitton / louisvuitton). */
export function thesvgCandidates(name: string, slug: string, normalized: string): string[] {
  const hyph = (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
  return [...new Set([slug, normalized, hyph, hyph.replace(/-/g, '')].filter(Boolean))]
}

/** Strip anything active/external from a fetched SVG. The logo is only ever rendered as
 *  a mask-image data URI (which can't execute script), so this is defense-in-depth — we
 *  never persist a <script>/handler/remote reference. Keeps internal `#fragment` refs
 *  (clipPath/use) so the silhouette still renders. */
export function sanitizeSvg(input: string): string | null {
  const at = input.search(/<svg[\s>]/i)
  if (at < 0) return null
  const end = input.search(/<\/svg>/i)
  if (end < 0) return null
  let s = input.slice(at, end + '</svg>'.length)
  s = s
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '') // event handlers
    .replace(/\s(?:xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*'|[^\s>#][^\s>]*)/gi, '') // external refs (keep #frag)
    .trim()
  if (!s.startsWith('<svg') || s.length > MAX_BYTES) return null
  return s
}

/** Fetch the first matching brand SVG from theSVG, sanitized — or null. */
export async function fetchThesvgLogo(name: string, slug: string, normalized: string): Promise<string | null> {
  for (const cand of thesvgCandidates(name, slug, normalized)) {
    try {
      const r = await fetch(`${BASE}/${encodeURIComponent(cand)}/default.svg`, {
        headers: { Accept: 'image/svg+xml' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!r.ok) continue
      if (!(r.headers.get('content-type') || '').includes('svg')) continue
      const clean = sanitizeSvg(await r.text())
      if (clean) return clean
    } catch {
      // try the next candidate
    }
  }
  return null
}
