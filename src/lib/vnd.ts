// VND-first money formatting. Vietnamese convention: '.' groups thousands and ','
// is the decimal separator (12.000.000 ₫). Compact shorthand uses tỷ (10^9),
// triệu/tr (10^6) and nghìn/k (10^3) — read instantly in Vietnam. Non-VND
// currencies (the rare '$' listing) fall back to en-US grouping.

const GROUP = new Intl.NumberFormat('vi-VN') // dot thousands separator
const EN = new Intl.NumberFormat('en-US') // comma — for non-VND currencies

/** Full grouped amount: "12.000.000 ₫" for VND, "$1,200" for other currencies. */
export function formatMoneyFull(price: number, currency: string): string {
  if (currency === '₫') return `${GROUP.format(Math.round(price))} ₫`
  return `${currency}${EN.format(Math.round(price))}`
}

// One decimal max, VN comma decimal separator, trailing ",0" dropped:
// 12 → "12", 12.5 → "12,5".
function short(n: number): string {
  const r = Math.round(n * 10) / 10
  return (Number.isInteger(r) ? String(r) : r.toFixed(1)).replace('.', ',')
}

/** Compact shorthand: "12 tr", "1,2 tỷ", "500 k". VND only; others fall back to full. */
export function formatMoneyCompact(price: number, currency: string): string {
  if (currency !== '₫') return formatMoneyFull(price, currency)
  const p = Math.round(price)
  if (p >= 1_000_000_000) return `${short(p / 1_000_000_000)} tỷ`
  if (p >= 1_000_000) return `${short(p / 1_000_000)} tr`
  if (p >= 1_000) return `${short(p / 1_000)} k`
  return GROUP.format(p)
}

/** Digits-only number from a typed string ("12.000.000" / "12,000,000" → 12000000). */
export function parseVnd(input: string): number {
  const digits = (input || '').replace(/\D/g, '')
  return digits ? parseInt(digits, 10) : 0
}

/** Group raw digits VN-style for live input display: "12000000" → "12.000.000". */
export function groupVnd(input: string): string {
  const digits = (input || '').replace(/\D/g, '')
  return digits ? GROUP.format(parseInt(digits, 10)) : ''
}

/** Readable helper under the input: "12 triệu đồng" (vi) / "12 million ₫" (else). */
export function vndWords(n: number, lang: string): string {
  if (!n) return ''
  const vi = lang === 'vi'
  let val: number
  let viWord: string
  let enWord: string
  if (n >= 1_000_000_000) { val = n / 1_000_000_000; viWord = 'tỷ'; enWord = 'billion' }
  else if (n >= 1_000_000) { val = n / 1_000_000; viWord = 'triệu'; enWord = 'million' }
  else if (n >= 1_000) { val = n / 1_000; viWord = 'nghìn'; enWord = 'thousand' }
  else return vi ? `${GROUP.format(n)} đồng` : `${n} ₫`
  const num = vi ? short(val) : String(Math.round(val * 10) / 10)
  return vi ? `${num} ${viWord} đồng` : `${num} ${enWord} ₫`
}
