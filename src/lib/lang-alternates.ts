import type { Metadata } from 'next'
import { hasViTwin, viTwinPath, VI_PILOT, type ViPilot } from '@/lib/lang-pinned'

/** The reciprocal hreflang set every page with a `/vi` twin declares — one code for Vietnamese site-wide (`vi-VN`). */
export type HreflangSet = Record<'en' | 'vi-VN' | 'x-default', string>

/**
 * Does a page's own `robots` keep it out of the index? `{ index: false }`, or a string naming `noindex` / `none`.
 * Absent, `index: true` or anything else → false.
 */
export function isNoindex(robots: Metadata['robots'] | undefined): boolean {
  if (!robots) return false
  if (typeof robots === 'string') return /(?:^|[\s,])(?:noindex|none)(?:$|[\s,])/i.test(robots)
  return robots.index === false
}

/**
 * ⛔ THE HEAD OF EVERY PAGE WITH A `/vi` TWIN (the pilot `/` and `/c/furniture-appliances`, and the phase-1 families —
 * categories, category×district, help, schools; owner 2026-11-19): its canonical and the reciprocal alternates — the
 * plain URL for `en` and `x-default`, `/vi` + the path for `vi-VN` — or `null`, and the page keeps the plain canonical
 * it always had (and declares no hreflang).
 *
 * - ⛔ THE CANONICAL FOLLOWS THE LANGUAGE THE PAGE RENDERED (`lang`, the `[lang]` segment the proxy chose), not the
 *   URL that served it: `/vi/x` and a Vietnamese reader's plain `/x` (cookie or Accept-Language — a family's plain URL
 *   negotiates) are ONE ISR entry, the same HTML, and both say canonical `/vi/x`. Googlebot sends no cookie and no
 *   Accept-Language, so it reads English at `/x` and Vietnamese at `/vi/x`, each self-canonical. On a pilot path the
 *   plain URL is English for everyone (V-a), so the same rule gives the pilot's head unchanged.
 * - ⛔ NULL ON A NOINDEX PAGE (critic #3): an empty category, a district under the floor, a school with nothing of its
 *   own, an open awards year. Advertising a twin there invites a crawl of a page we asked Google to drop and earns
 *   "missing return tag" errors. Pass the `robots` the page EMITS — build the metadata first and hand this its
 *   `.robots`, so the two cannot disagree.
 * - NULL WHEN `path` HAS NO TWIN (`hasViTwin`: not a pilot path, not a family path, or eno.forum, whose lists are
 *   empty) — e.g. a district slug outside the family pattern. So this never declares a `/vi…` URL that 404s.
 *
 * `path` is the PUBLIC plain path the canonical names (`/c/rentals`, never `/vi/…` and no query). `origin` (no
 * trailing slash needed) makes every URL absolute — the pilot's `/` is the bare origin, as before; without it the
 * URLs are root-relative and `metadataBase` resolves them (pass whichever the page's canonical already used, so its
 * non-twin head is unchanged).
 * ⚠️ IT DOES NOT TOUCH THE SHARE CARD. A page whose og:url follows its canonical (the category, the district — their
 * card is in the variant's words) passes `.canonical` to `pageShare`; a page whose card is English on both variants
 * (help, schools) keeps its plain og:url.
 */
export function langAlternatesFor(
  path: string,
  lang: string,
  robots: Metadata['robots'] | undefined,
  origin = '',
  lists: ViPilot = VI_PILOT,
): { canonical: string; languages: HreflangSet } | null {
  if (isNoindex(robots) || !hasViTwin(path, lists)) return null
  const base = origin.replace(/\/+$/, '')
  // The root WITH its slash (Seobility, 2026-11-23: "https://eno.vn" was crawled as a link to a redirect). One URL either way.
  const at = (p: string) => (base ? `${base}${p}` : p)
  const en = at(path)
  const vi = at(viTwinPath(path))
  return { canonical: lang === 'vi' ? vi : en, languages: { en, 'vi-VN': vi, 'x-default': en } }
}
