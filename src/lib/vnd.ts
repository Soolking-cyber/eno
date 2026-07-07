// Money formatting. Across the app we show the FULL grouped amount everywhere
// (cards, detail, input, offers) — but the SEPARATORS follow the viewer's
// language. Vietnamese convention is the exact reverse of English: DOT for
// thousands, COMMA for decimals, and the "đ" suffix (Shopee: "₫1.250.000",
// ratings "4,9") — comma-grouped "12,000,000 VND" reads foreign/untrustworthy
// to the home market. So every formatter takes a MoneyLocale that DEFAULTS to
// 'en' ("12,000,000 VND", unchanged for the expat audience and every untouched
// call site) and renders native Vietnamese for 'vi' ("12.000.000 đ").

export type MoneyLocale = 'en' | 'vi'

const EN = new Intl.NumberFormat('en-US') // comma thousands separator
const VI = new Intl.NumberFormat('vi-VN') // dot thousands separator

/** Narrow the active UI language (useLanguage().lang) to a money locale:
 *  Vietnamese gets native separators, every other language keeps the
 *  international 'en' style. */
export function moneyLocale(lang: string): MoneyLocale {
  return lang === 'vi' ? 'vi' : 'en'
}

// Grouping only differs by locale; decimal handling is done by callers (money
// amounts are always whole VND).
function group(n: number, locale: MoneyLocale): string {
  return (locale === 'vi' ? VI : EN).format(n)
}

/** Full grouped amount. en: "12,000,000 VND" / "$1,200". vi: "12.000.000 đ"
 *  (space before đ); the rare non-VND listing keeps its symbol prefix with
 *  vi grouping. */
export function formatMoneyFull(price: number, currency: string, locale: MoneyLocale = 'en'): string {
  const amount = group(Math.round(price), locale)
  if (currency === '₫') return locale === 'vi' ? `${amount} đ` : `${amount} VND`
  return `${currency}${amount}`
}


/** Price-drop badge label: "−12%", capped at "−50%+" (honest-display rule — beyond
 *  50% we stop advertising a bigger number). null when not a real drop. Shared by
 *  the server rules engine (notification copy) and the client badges so the % a
 *  buyer sees is ALWAYS the same figure everywhere. */
export function dropPercent(fromPrice: number, toPrice: number): string | null {
  if (!(fromPrice > 0) || toPrice >= fromPrice) return null
  const ratio = 1 - toPrice / fromPrice
  // Cap on the UNROUNDED ratio, not the rounded pct — otherwise a true 49.5–49.99%
  // drop rounds to 50 and shows "-50%+" ("at least 50% off"), overstating the deal.
  if (ratio >= 0.5) return '-50%+'
  const pct = Math.round(ratio * 100)
  return pct < 1 ? null : `-${pct}%`
}

/** Digits-only number from a typed string ("12,000,000" → 12000000). */
export function parseVnd(input: string): number {
  const digits = (input || '').replace(/\D/g, '')
  return digits ? parseInt(digits, 10) : 0
}

/** Group raw digits for live input display: "12000000" → "12,000,000" (en) /
 *  "12.000.000" (vi). parseVnd round-trips both (it strips all non-digits). */
export function groupVnd(input: string, locale: MoneyLocale = 'en'): string {
  const digits = (input || '').replace(/\D/g, '')
  return digits ? group(parseInt(digits, 10), locale) : ''
}

// One decimal max, trailing ".0" dropped: 12 → "12", 12.5 → "12.5" (en) /
// "12,5" (vi — comma decimal).
function short(n: number, locale: MoneyLocale = 'en'): string {
  const r = Math.round(n * 10) / 10
  const s = Number.isInteger(r) ? String(r) : r.toFixed(1)
  return locale === 'vi' ? s.replace('.', ',') : s
}

/**
 * Compact VND label for MAP PINS ONLY — the single sanctioned exception to the
 * full-grouped format (pins are too narrow for "51,000,000 VND"). en keeps the
 * explicit international suffixes ("850K", "51M", "1.2B") — the Vietnamese
 * shorthand is opaque to the expat audience — while vi uses the native
 * abbreviations every local reads instantly: "500k", "51tr", "1,2 tỷ".
 */
export function compactPrice(n: number, locale: MoneyLocale = 'en'): string {
  if (locale === 'vi') {
    if (n >= 1_000_000_000) return `${short(n / 1_000_000_000, 'vi')} tỷ`
    if (n >= 1_000_000) return `${short(n / 1_000_000, 'vi')}tr`
    if (n >= 1_000) return `${Math.round(n / 1_000)}k`
    return VI.format(n)
  }
  if (n >= 1_000_000_000) return `${short(n / 1_000_000_000)}B`
  if (n >= 1_000_000) return `${short(n / 1_000_000)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return EN.format(n)
}

/** Compact COUNT label (views, saves, followers…): 1200 → "1.2k" (en) /
 *  "1,2k" (vi); millions "3.4M" (en) / "3,4tr" (vi). Not for money — prices
 *  use formatMoneyFull/compactPrice. */
export function formatCount(n: number, locale: MoneyLocale = 'en'): string {
  if (n >= 1_000_000) return `${short(n / 1_000_000, locale)}${locale === 'vi' ? 'tr' : 'M'}`
  if (n >= 1_000) return `${short(n / 1_000, locale)}k`
  return group(n, locale)
}

/** Average-rating label, always one decimal: 4.8 → "4.8" (en) / "4,8" (vi). */
export function formatRating(n: number, locale: MoneyLocale = 'en'): string {
  const s = n.toFixed(1)
  return locale === 'vi' ? s.replace('.', ',') : s
}

/** Readable helper under the price input: "12 million VND" / "12 triệu VND".
 *  Accepts the full UI language (any non-vi value behaves as en). */
export function vndWords(n: number, lang: string): string {
  if (!n) return ''
  const locale = moneyLocale(lang)
  const vi = locale === 'vi'
  let val: number
  let word: string
  if (n >= 1_000_000_000) { val = n / 1_000_000_000; word = vi ? 'tỷ' : 'billion' }
  else if (n >= 1_000_000) { val = n / 1_000_000; word = vi ? 'triệu' : 'million' }
  else if (n >= 1_000) { val = n / 1_000; word = vi ? 'nghìn' : 'thousand' }
  else return `${group(n, locale)} VND`
  return `${short(val, locale)} ${word} VND`
}
