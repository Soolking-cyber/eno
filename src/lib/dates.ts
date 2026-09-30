// Shared date-display helpers (client-safe, local timezone). These were copy-pasted
// per-file and had started to drift — one home, one behavior.

/** "9:23 PM" — per-message time in chat threads. */
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

/** Day-grouping key for chat separators ("Today" / "Jun 29"). */
export const dayKey = (iso: string) => new Date(iso).toDateString()

/** "5 Jul" — compact date for admin lists. */
export const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * "23 Sep 2026" (en) / "23/9/2026" (vi) — the visible date on a guide or a help answer (C-DATES).
 *
 * ⚠️ STRING SURGERY ON THE ISO DATE, NO `Date` AND NO TIMEZONE, ON PURPOSE. These dates render in ISR
 * HTML and again on hydration; `new Date(iso).toLocale…` answers in the server's zone at build and the
 * reader's zone in the browser, so the two could disagree by a day and throw a hydration mismatch
 * (memory: no Date.now()/zone-dependent output in ISR HTML). The calendar date written in the source —
 * or, for a timestamp, its UTC date — is the date, identically everywhere. Returns the input unchanged
 * if it does not start with YYYY-MM-DD, rather than printing "NaN".
 */
export function formatArticleDate(iso: string, lang: 'en' | 'vi'): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const [, y, mo, d] = m
  const month = Number(mo)
  if (month < 1 || month > 12) return iso
  return lang === 'vi' ? `${Number(d)}/${month}/${y}` : `${Number(d)} ${MONTHS_EN[month - 1]} ${y}`
}
