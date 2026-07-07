// Money formatting. Across the app we show the FULL grouped amount with comma
// thousands separators and a "VND" suffix — e.g. "12,000,000 VND" — everywhere
// (cards, detail, input, offers). Non-VND currencies (the rare '$' listing) keep
// their symbol prefix.

const EN = new Intl.NumberFormat('en-US') // comma thousands separator

/** Full grouped amount: "12,000,000 VND" for VND, "$1,200" for other currencies. */
export function formatMoneyFull(price: number, currency: string): string {
  if (currency === '₫') return `${EN.format(Math.round(price))} VND`
  return `${currency}${EN.format(Math.round(price))}`
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

/** Group raw digits for live input display: "12000000" → "12,000,000". */
export function groupVnd(input: string): string {
  const digits = (input || '').replace(/\D/g, '')
  return digits ? EN.format(parseInt(digits, 10)) : ''
}

// One decimal max, trailing ".0" dropped: 12 → "12", 12.5 → "12.5".
function short(n: number): string {
  const r = Math.round(n * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}

/**
 * Compact VND label for MAP PINS ONLY — the single sanctioned exception to the
 * full-grouped format. Explicit international suffixes in every language
 * ("850K", "51M", "1.2B"): the Vietnamese "51 tr" shorthand is opaque to the
 * expat audience, and pins are too narrow for "51,000,000 VND".
 */
export function compactPrice(n: number): string {
  if (n >= 1_000_000_000) return `${short(n / 1_000_000_000)}B`
  if (n >= 1_000_000) return `${short(n / 1_000_000)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return EN.format(n)
}

/** Readable helper under the price input: "12 million VND" / "12 triệu VND". */
export function vndWords(n: number, lang: string): string {
  if (!n) return ''
  const vi = lang === 'vi'
  let val: number
  let word: string
  if (n >= 1_000_000_000) { val = n / 1_000_000_000; word = vi ? 'tỷ' : 'billion' }
  else if (n >= 1_000_000) { val = n / 1_000_000; word = vi ? 'triệu' : 'million' }
  else if (n >= 1_000) { val = n / 1_000; word = vi ? 'nghìn' : 'thousand' }
  else return `${EN.format(n)} VND`
  return `${short(val)} ${word} VND`
}
