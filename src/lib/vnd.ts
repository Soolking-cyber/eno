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
