import { intlLocale, isMtLanguage } from '@/lib/i18n/langs'
/**
 * A CALENDAR DAY, WRITTEN THE WAY A READER IN THAT LANGUAGE WRITES IT — '8 Oct 2026' / '8/10/2026'.
 *
 * ⛔ NO `Intl` AND NO CLOCK, ON PURPOSE. This runs in the FIRST render of client components on
 * ISR-cached pages (the listing page is cached for 30 days), where the server's HTML and the
 * browser's first render must be byte-identical. `toLocaleDateString` answers differently in the
 * Node build and in the visitor's browser (ICU data, time zone), and anything that reads `Date.now()`
 * disagrees with itself across the cache — both have been React #418s here before. A month table and
 * string arithmetic answer the same everywhere.
 *
 * ⚠️ THE DAY IS VIETNAM'S (UTC+7, no DST). Every listing, job and posting on this marketplace is in
 * Vietnam, and a UTC slice of an ISO timestamp is YESTERDAY in Hanoi for anything stamped before
 * 07:00 local — which is what RelativeTime's pre-mount fallback used to print. A bare 'YYYY-MM-DD'
 * (a job's apply-by date) is already a calendar day and is taken as written, never shifted.
 */
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
const VN_OFFSET_MS = 7 * 3600_000

export function vnCalendarDay(v: string): { y: number; m: number; d: number } | null {
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (ymd) {
    const y = +ymd[1], m = +ymd[2], d = +ymd[3]
    return m >= 1 && m <= 12 && d >= 1 && d <= 31 ? { y, m, d } : null
  }
  const t = Date.parse(v)
  if (!Number.isFinite(t)) return null
  const x = new Date(t + VN_OFFSET_MS)
  return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() }
}

/** The UTC-midnight instant of a calendar day, or null for a day that does not exist (31 February):
 *  Date.UTC would quietly roll it into March, and an Intl branch must never print a different day than
 *  the en / vi forms of the same value. */
export function realUtcDay(p: { y: number; m: number; d: number }): number | null {
  // setUTCFullYear, not Date.UTC: Date.UTC reads a year 0–99 as 1900–1999. The day must round-trip whole.
  const x = new Date(0)
  x.setUTCFullYear(p.y, p.m - 1, p.d)
  return x.getUTCFullYear() === p.y && x.getUTCMonth() === p.m - 1 && x.getUTCDate() === p.d ? x.getTime() : null
}

/** '8 Oct 2026' (en) · '8/10/2026' (vi) · the reader's own month names in the nine machine-translated
 *  languages ('8 окт. 2026 г.', '2026年10月8日'), which printed the English abbreviation until 2026-10-04.
 *  Without a year: '8 Oct' / '8/10'. A value that is not a date comes back unchanged.
 *  ⚠️ Still clock-free and zone-free: the Vietnam calendar day is pinned at UTC midnight and formatted in
 *  UTC, so server and browser print the same characters (and those languages only render client-side). */
export function formatCalendarDay(v: string, lang: string, o: { year?: boolean } = {}): string {
  const p = vnCalendarDay(v)
  if (!p) return v
  const withYear = o.year ?? true
  const mt = isMtLanguage(lang)
  const t = mt ? realUtcDay(p) : null
  // A day that does not exist (31 February) comes back unchanged, like any other value that is not a
  // date — never re-dated by Intl, never dressed up as a real English date for a French reader.
  if (mt && t == null) return v
  if (t != null) {
    try {
      return new Intl.DateTimeFormat(intlLocale(lang), withYear
        ? { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }
        : { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(t)
    } catch { /* fall through to the English form */ }
  }
  return lang === 'vi'
    ? (withYear ? `${p.d}/${p.m}/${p.y}` : `${p.d}/${p.m}`)
    : (withYear ? `${p.d} ${EN_MONTHS[p.m - 1]} ${p.y}` : `${p.d} ${EN_MONTHS[p.m - 1]}`)
}

/**
 * A plain calendar date ('2026-10-01') with the month spelled out in a machine-translated language
 * ('1 октября 2026 г.', '2026年10月1日'). Zone-free like formatCalendarDay. en / vi callers keep their own
 * hand-written forms; this is for the nine others, and falls back to the ISO string if Intl refuses.
 */
export function longCalendarDate(iso: string, lang: string): string {
  const p = vnCalendarDay(iso)
  const t = p ? realUtcDay(p) : null
  if (t == null) return iso
  try {
    return new Intl.DateTimeFormat(intlLocale(lang), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(t)
  } catch { return iso }
}
