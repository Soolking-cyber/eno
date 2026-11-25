import { DESCRIPTION_MAX_PX, TITLE_MAX_PX, descriptionPx, titlePx } from './serp-width'

/**
 * A META DESCRIPTION LONG ENOUGH TO SAY WHAT THE PAGE IS (Bing Webmaster Tools, 2026-11-20: "Meta descriptions on many of
 * your pages are too short" — 21 pages, from a 28-character seller page to ~90-character category pages; owner "yes").
 * The page's own words come first; then the given facts, in order, only until the text reaches `min` — an extra that would
 * pass `max` (search engines show ~150–160 characters) is skipped whole, never cut mid-sentence; only a lead that is itself
 * too long is cut, at a word. Nothing is invented here: every extra is a fact the caller already shows on the page.
 */
export function fillDescription(lead: string, extras: readonly (string | null | undefined | false)[], opts: { min?: number; max?: number } = {}): string {
  const min = opts.min ?? 120
  // 155, not 160 (Seobility, 2026-11-23: listing descriptions cut at ~160 characters measured ~1030 px against the ~1000 px a
  // result shows, ~6.4 px a character). Bing's floor (`min`) is unchanged, so callers keep their extras short enough to reach it.
  const max = opts.max ?? 155
  let s = lead.replace(/\s+/g, ' ').trim()
  for (const raw of extras) {
    if (s.length >= min) break
    const e = (raw || '').replace(/\s+/g, ' ').trim()
    if (!e) continue
    const next = !s ? e : `${s}${/[.!?…:]$/.test(s) ? ' ' : '. '}${e}`
    if (fitsDescription(next, max) || !s) s = next
  }
  return clipDescription(s, max)
}

/**
 * ⛔ CHARACTERS AND PIXELS BOTH (Seobility crawl 3, 2026-11-24): 136 listing titles within 60 characters still measured past
 * 580 px — capitals, "Đ", "—" are wide — and 85 descriptions within 155 characters past 1,000 px. A title or description
 * fits when it is within the caller's character limit AND within the result's width (serp-width.ts, Seobility's own measure).
 * The pixel test only ever makes a limit stricter.
 */
export function fitsTitle(s: string, max = 60): boolean {
  return s.length <= max && titlePx(s) <= TITLE_MAX_PX
}
export function fitsDescription(s: string, max = 155): boolean {
  return s.length <= max && descriptionPx(s) <= DESCRIPTION_MAX_PX
}

/** clip() to `max` characters, then a word at a time shorter until `width(s)` is within `maxPx`. */
function clipToWidth(s: string, max: number, width: (t: string) => number, maxPx: number): string {
  let out = clip(s, max)
  for (let m = Math.min(max, out.length); width(out) > maxPx && m > 12; m--) out = clip(s, m)
  return out
}
/** A title cut at a word to fit `max` characters and, by default, the result's width (`maxPx`). */
export function clipTitle(s: string, max = 60, maxPx = TITLE_MAX_PX): string {
  return clipToWidth(s, max, titlePx, maxPx)
}
/** A description cut at a word to fit `max` characters and the result's width. */
export function clipDescription(s: string, max = 155): string {
  return clipToWidth(s, max, descriptionPx, DESCRIPTION_MAX_PX)
}

/**
 * A description that fits (fitsDescription), cut after a sentence where it can be: the longest run of its own whole
 * sentences that fits and is still as long as fillDescription's floor (120 characters, Bing's "too short"), otherwise
 * clipDescription's cut at a word — never shorter than that cut would be by much (gate review, 2026-11-25: a 72-character
 * first sentence must not replace a ~150-character clip). Seobility crawl 4 (2026-11-25): 29 hand-written guide
 * descriptions at 1,006–1,591 px of 1,000.
 * A sentence ends at ".", "!" or "?" followed by a space and a capital or digit (or the end), and not after an abbreviation
 * or a single letter: "TP.HCM", "2.5", "TP. Hồ Chí Minh", "Q. 1", "e.g. this" are not ends (gate review).
 * ⚠️ Scanned, not a lookbehind regex (the marketplace build refuses those).
 */
const SENTENCE_MIN = 120
const NOT_AN_END = new Set(['tp', 'q', 'p', 'tx', 'st', 'mr', 'mrs', 'ms', 'dr', 'no', 'vs', 'e.g', 'i.e', 'etc', 'approx'])
function endsSentence(s: string, i: number): boolean {
  if (!'.!?'.includes(s[i])) return false
  if (i + 1 < s.length) {
    if (!/\s/.test(s[i + 1])) return false
    const next = s.slice(i + 1).trimStart()[0]
    if (next && !(/[0-9"“(]/.test(next) || next !== next.toLowerCase())) return false
  }
  if (s[i] !== '.') return true
  // The word before the stop, without an opening bracket or quote: "(TP. Hồ Chí Minh)" is not an end.
  const word = s.slice(s.lastIndexOf(' ', i - 1) + 1, i).toLowerCase().replace(/^[("“‘'[]+/, '')
  return word.length > 1 && !NOT_AN_END.has(word)
}
export function sentenceDescription(s: string, max = 155): string {
  if (fitsDescription(s, max)) return s
  let best = ''
  for (let i = 0; i < s.length; i++) {
    if (!endsSentence(s, i)) continue
    const cut = s.slice(0, i + 1)
    if (!fitsDescription(cut, max)) break
    best = cut
  }
  return best.length >= SENTENCE_MIN ? best : clipDescription(s, max)
}

/** At most `max` characters, cut at the last word boundary and closed with "…". */
export function clip(s: string, max = 160): string {
  if (s.length <= max) return s
  const cut = s.slice(0, max - 1)
  const at = cut.lastIndexOf(' ')
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:·—-]+$/, '')}…`
}

/**
 * A page title with the site's name only when it fits (Bing, 2026-11-20: "Title too long" — a 79-character guide title):
 * "<title> | <site>" while that is at most `max` characters, otherwise the title alone (itself cut at a word if longer).
 */
export function titleWithSite(title: string, siteName: string, max = 70): string {
  const full = `${title} | ${siteName}`
  return fitsTitle(full, max) ? full : clipTitle(title, max)
}

/**
 * A listing's <title>: "<title> — <price> | <site>" within `max` characters (Seobility, 2026-11-23: imported titles measured
 * 953–1045 px against the ~580 px a result shows, ~60 characters). The site's name goes first, then the title is cut at a word;
 * the price is never cut. ⚠️ So a stated salary range long enough to leave the title under 24 characters (about 33
 * characters and up, "15.000.000 – 25.000.000 đ / tháng") runs past `max`: a title that says nothing is worse than a long one.
 */
export function titleWithPrice(title: string, price: string, siteName: string, max = 60): string {
  const tail = price ? ` — ${price}` : ''
  const withSite = `${title}${tail} | ${siteName}`
  if (fitsTitle(withSite, max)) return withSite
  if (fitsTitle(`${title}${tail}`, max)) return `${title}${tail}`
  // The title gets what the price leaves, in characters and in pixels — never under 24 characters / 200 px (the note above).
  return `${clipTitle(title, Math.max(24, max - tail.length), Math.max(200, TITLE_MAX_PX - titlePx(tail)))}${tail}`
}

/**
 * A shop's <title>: "<name> — listings on <site>" (Seobility, 2026-11-23: "CellphoneS | eno.vn" measured under the ~200 px a title
 * needs to say what the page is). A name too long for the phrase keeps the old "<name> | <site>" rule (titleWithSite).
 */
export function shopTitle(name: string, siteName: string, lang: string | undefined, max = 60): string {
  const full = `${name} — ${lang === 'vi' ? 'tin đăng trên' : 'listings on'} ${siteName}`
  return fitsTitle(full, max) ? full : titleWithSite(name, siteName, max)
}

/**
 * The first of `candidates` (longest first: the whole title, then shorter forms of it) that fits `max`, else the last
 * (Seobility, 2026-11-23: "Apartments & Houses for Rent in Binh Thanh District, HCMC | eno.vn" measured 621 px against ~580).
 * Whole words dropped, never a word cut.
 */
export function firstThatFits(candidates: readonly string[], max = 60): string {
  return candidates.find((c) => fitsTitle(c, max)) ?? candidates[candidates.length - 1]
}
