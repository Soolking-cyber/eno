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

/**
 * A listing's <title>: "<title> — <price> | <site>" within `max` characters (Seobility, 2026-11-23: imported titles measured
 * 953–1045 px against the ~580 px a result shows, ~60 characters). The site's name goes first, then the title is cut at a word;
 * the price is never cut. ⚠️ So a stated salary range long enough to leave the title under 24 characters (about 33
 * characters and up, "15.000.000 – 25.000.000 đ / tháng") runs past `max`: a title that says nothing is worse than a long one.
 */
export function titleWithPrice(title: string, price: string, siteName: string, max = 60): string {
  const tail = price ? ` — ${price}` : ''
  const withSite = `${title}${tail} | ${siteName}`
  if (withSite.length <= max) return withSite
  if (`${title}${tail}`.length <= max) return `${title}${tail}`
  return `${clip(title, Math.max(24, max - tail.length))}${tail}`
}

/**
 * A shop's <title>: "<name> — listings on <site>" (Seobility, 2026-11-23: "CellphoneS | eno.vn" measured under the ~200 px a title
 * needs to say what the page is). A name too long for the phrase keeps the old "<name> | <site>" rule (titleWithSite).
 */
export function shopTitle(name: string, siteName: string, lang: string | undefined, max = 60): string {
  const full = `${name} — ${lang === 'vi' ? 'tin đăng trên' : 'listings on'} ${siteName}`
  return full.length <= max ? full : titleWithSite(name, siteName, max)
}
