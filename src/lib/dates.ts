import { intlLocale, isMtLanguage } from '@/lib/i18n/langs'
import { realUtcDay } from '@/lib/calendar-day'
// Shared date-display helpers (client-safe, local timezone). These were copy-pasted
// per-file and had started to drift — one home, one behavior.

/** "9:23 PM" — per-message time in chat threads. */
export const fmtTime = (iso: string, lang?: string) =>
  // en / vi keep the device's clock style (unchanged); the nine machine-translated languages get their own.
  new Date(iso).toLocaleTimeString(isMtLanguage(lang) ? intlLocale(lang) : undefined, { hour: 'numeric', minute: '2-digit' })

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
export function formatArticleDate(iso: string, lang: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  const [, y, mo, d] = m
  const month = Number(mo)
  if (month < 1 || month > 12) return iso
  if (lang === 'vi') return `${Number(d)}/${month}/${y}`
  if (!isMtLanguage(lang)) return `${Number(d)} ${MONTHS_EN[month - 1]} ${y}`
  // The nine machine-translated languages: their own month names. Still zone-free — the calendar date
  // is pinned at UTC midnight and formatted in UTC, so it is the same date everywhere. (They only ever
  // render client-side; the server renders en or vi.)
  // A day that does not exist (31 February) comes back unchanged, like any other non-date.
  const t = realUtcDay({ y: Number(y), m: month, d: Number(d) })
  if (t == null) return iso
  try {
    return new Intl.DateTimeFormat(intlLocale(lang), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(t)
  } catch { return `${Number(d)} ${MONTHS_EN[month - 1]} ${y}` }
}
