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

/** '8 Oct 2026' (en and every machine-translated language) · '8/10/2026' (vi). Without a year:
 *  '8 Oct' / '8/10'. A value that is not a date comes back unchanged. */
export function formatCalendarDay(v: string, lang: string, o: { year?: boolean } = {}): string {
  const p = vnCalendarDay(v)
  if (!p) return v
  const withYear = o.year ?? true
  return lang === 'vi'
    ? (withYear ? `${p.d}/${p.m}/${p.y}` : `${p.d}/${p.m}`)
    : (withYear ? `${p.d} ${EN_MONTHS[p.m - 1]} ${p.y}` : `${p.d} ${EN_MONTHS[p.m - 1]}`)
}
