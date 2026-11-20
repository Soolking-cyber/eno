/**
 * A META DESCRIPTION LONG ENOUGH TO SAY WHAT THE PAGE IS (Bing Webmaster Tools, 2026-11-20: "Meta descriptions on many of
 * your pages are too short" — 21 pages, from a 28-character seller page to ~90-character category pages; owner "yes").
 * The page's own words come first; then the given facts, in order, only until the text reaches `min` — an extra that would
 * pass `max` (search engines show ~150–160 characters) is skipped whole, never cut mid-sentence; only a lead that is itself
 * too long is cut, at a word. Nothing is invented here: every extra is a fact the caller already shows on the page.
 */
export function fillDescription(lead: string, extras: readonly (string | null | undefined | false)[], opts: { min?: number; max?: number } = {}): string {
  const min = opts.min ?? 120
  const max = opts.max ?? 160
  let s = lead.replace(/\s+/g, ' ').trim()
  for (const raw of extras) {
    if (s.length >= min) break
    const e = (raw || '').replace(/\s+/g, ' ').trim()
    if (!e) continue
    const next = !s ? e : `${s}${/[.!?…:]$/.test(s) ? ' ' : '. '}${e}`
    if (next.length <= max || !s) s = next
  }
  return clip(s, max)
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
  return full.length <= max ? full : clip(title, max)
}
