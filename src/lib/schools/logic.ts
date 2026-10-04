/**
 * Pure logic for the schools ranking — no DB, no React. Tested in logic.test.ts.
 *
 * ⚠️ Everything that turns rows into a public number (score, % positive, pay) lives here, so the rule a
 * teacher reads on the methodology note and the rule the page applies are the same code.
 */
import { fold } from '@/lib/fold'
import { PAY_MAX_AGE_YEARS, PAY_MIN_REPORTS, TENURE_LABEL, ROLE_LABEL, type Tenure, type SchoolRole } from './constants'

// ── employer names ─────────────────────────────────────────────────────────────────────────────

/** Legal-form words that vary between a job board and a school's own name. Removed only as WHOLE words. */
const LEGAL_WORDS = new Set([
  'co', 'company', 'ltd', 'limited', 'jsc', 'llc', 'inc', 'corp', 'corporation', 'plc', 'group',
  'cong', 'ty', 'tnhh', 'co phan', 'mtv', 'vietnam', 'viet nam',
])

/**
 * Normalise an employer name for EXACT matching against `SchoolAlias.alias`.
 * fold() (accents, case, đ) → punctuation to spaces → drop whole legal-form words and a leading "the".
 * ⚠️ EXACT, NEVER SUBSTRING (plan review: "ILA" must not catch "VILA"). Ambiguity is handled by the alias
 * table's primary key, not here.
 */
export function normEmployer(name: string | null | undefined): string {
  if (!name) return ''
  let s = fold(name).replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  // two-word legal phrases first
  s = ` ${s} `.replace(/ co phan /g, ' ').replace(/ viet nam /g, ' ').trim()
  const words = s.split(' ').filter((w) => w && !LEGAL_WORDS.has(w))
  if (words[0] === 'the') words.shift()
  return words.join(' ')
}

// ── ranking ────────────────────────────────────────────────────────────────────────────────────

/**
 * Employer names too generic to identify ONE school — "International School", "English Center",
 * "Confidential". Job boards print exactly these when an ad hides its employer, so as an alias they would
 * pin every anonymous ad on whichever school happened to own the phrase. Never an alias (the importer
 * skips them), never matched (jobsBySchool / schoolForJob). Compared AFTER normEmployer.
 */
const GENERIC_EMPLOYERS = new Set([
  'school', 'schools', 'international school', 'international schools', 'bilingual school', 'international bilingual school',
  'private school', 'public school', 'public schools', 'kindergarten', 'preschool', 'primary school', 'high school',
  'english', 'english center', 'english centre', 'english school', 'english language center', 'english language centre',
  'language center', 'language centre', 'language school', 'foreign language center', 'foreign language centre',
  'academy', 'education', 'university', 'college', 'institute', 'center', 'centre', 'training center', 'training centre',
  'confidential', 'private', 'employer', 'recruiter', 'agency', 'client', 'our client', 'partner school', 'partner schools',
  'trung tam anh ngu', 'trung tam ngoai ngu', 'truong quoc te', 'anh ngu', 'ngoai ngu', 'truong hoc', 'giao duc',
])
export function isGenericEmployer(normalised: string): boolean {
  return normalised.length < 3 || GENERIC_EMPLOYERS.has(normalised)
}

/**
 * Wilson score lower bound (95 %) of the share of positive votes — Reddit's "best" sort. It ranks
 * 9 up / 1 down above 1 up / 0 down, so a school cannot top the list on a single friendly vote.
 */
export function wilsonLower(up: number, down: number, z = 1.96): number {
  const n = up + down
  if (n <= 0) return 0
  const p = up / n
  const z2 = z * z
  return (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / (1 + z2 / n)
}

/** Whole-number share of positive votes, or null with no votes (never "0 %" for "nobody voted"). */
export function positivePct(up: number, down: number): number | null {
  const n = up + down
  return n > 0 ? Math.round((up / n) * 100) : null
}

export const SCHOOL_SORTS = ['top', 'net', 'reviews', 'hiring', 'name'] as const
export type SchoolSort = (typeof SCHOOL_SORTS)[number]
export const isSchoolSort = (v: unknown): v is SchoolSort => typeof v === 'string' && (SCHOOL_SORTS as readonly string[]).includes(v)

export type RankRow = { name: string; up: number; down: number; reviews: number; jobs: number }

/** Comparator for each sort. Ties fall through to more votes, then the name, so the order is stable. */
export function compareSchools(sort: SchoolSort) {
  const byName = (a: RankRow, b: RankRow) => a.name.localeCompare(b.name)
  const byVotes = (a: RankRow, b: RankRow) => (b.up + b.down) - (a.up + a.down)
  return (a: RankRow, b: RankRow): number => {
    switch (sort) {
      case 'top': return wilsonLower(b.up, b.down) - wilsonLower(a.up, a.down) || byVotes(a, b) || byName(a, b)
      case 'net': return (b.up - b.down) - (a.up - a.down) || byVotes(a, b) || byName(a, b)
      case 'reviews': return b.reviews - a.reviews || wilsonLower(b.up, b.down) - wilsonLower(a.up, a.down) || byName(a, b)
      case 'hiring': return b.jobs - a.jobs || wilsonLower(b.up, b.down) - wilsonLower(a.up, a.down) || byName(a, b)
      case 'name': return byName(a, b)
    }
  }
}

// ── pay ────────────────────────────────────────────────────────────────────────────────────────

export type PayReport = { payVnd: number; payPeriod: 'hour' | 'month'; createdAt: Date; profileId: string }
export type PaySummary =
  | { period: 'hour' | 'month'; n: number; shown: false }
  // ⚠️ No `n` once shown: the exact reporter count would ride to the browser in the list payload and
  // date each new report (Opus, diff review). Below the floor it is shown — "3 of 5" is a count, not pay.
  | { period: 'hour' | 'month'; shown: true; lo: number; hi: number }

/** The pay range's rounding, stated on the methodology note (schools-methodology.test.ts pins the copy). */
export const PAY_ROUND_STEP: Record<'hour' | 'month', number> = { hour: 50_000, month: 1_000_000 }
/** The range is the 20th–80th percentile (the middle 60%), interpolated — see summarisePay. */
export const PAY_BAND = { lo: 0.2, hi: 0.8 } as const

/** Linear-interpolated percentile of a SORTED array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0]
  const i = (sorted.length - 1) * p
  const lo = Math.floor(i), hi = Math.ceil(i)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)
}

/**
 * Pay per period, from the PUBLIC reviews (the caller applies the eligibility rule).
 * WHAT THIS PROTECTS, STATED EXACTLY — three review rounds each found a new way an over-claim failed:
 *   · pay is never shown with a review, a name or any per-review field (queries.ts never selects it);
 *   · a range appears only with ≥ PAY_MIN_REPORTS DISTINCT eligible reporters for that period;
 *   · its ends are the INTERPOLATED 20th/80th percentiles widened OUTWARD to a coarse step, so the
 *     plain 25th–75th percentile's flaw (with five reports it IS the 2nd and 4th pay) is gone;
 *   · the page does not print the exact number of reporters once a range shows.
 * ⚠️ WHAT IT DOES NOT CLAIM: any statistic of five values carries information about them. An end can
 * coincide with a reported figure after widening, five identical reports reveal that figure, and
 * someone who already knows four colleagues' exact pay learns something about the fifth. That is the
 * residual risk of publishing pay at all; the copy says "a range", never "anonymous".
 * Hourly and monthly are never pooled. Reports older than PAY_MAX_AGE_YEARS do not count.
 */
export function summarisePay(reports: PayReport[], now: Date = new Date()): PaySummary[] {
  const cutoff = new Date(now)
  cutoff.setFullYear(cutoff.getFullYear() - PAY_MAX_AGE_YEARS)
  const out: PaySummary[] = []
  for (const period of ['hour', 'month'] as const) {
    // one report per account (a review is unique per account per school, but be defensive)
    const byProfile = new Map<string, number>()
    for (const r of reports) if (r.payPeriod === period && r.createdAt >= cutoff && r.payVnd > 0) byProfile.set(r.profileId, r.payVnd)
    const vals = [...byProfile.values()].sort((a, b) => a - b)
    if (!vals.length) continue
    if (vals.length < PAY_MIN_REPORTS) { out.push({ period, n: vals.length, shown: false }); continue }
    const step = PAY_ROUND_STEP[period]
    const lo = Math.floor(percentile(vals, PAY_BAND.lo) / step) * step
    const hi = Math.max(lo + step, Math.ceil(percentile(vals, PAY_BAND.hi) / step) * step)
    out.push({ period, shown: true, lo, hi })
  }
  return out
}

/** USD → VND at a given rate (VND per 1 USD), whole đồng. */
export function toVnd(amount: number, currency: 'VND' | 'USD', vndPerUsd: number | null): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null
  if (currency === 'VND') return Math.round(amount)
  if (!vndPerUsd || !Number.isFinite(vndPerUsd) || vndPerUsd < 5_000 || vndPerUsd > 100_000) return null
  return Math.round(amount * vndPerUsd)
}

/**
 * Sanity band for a pay report (VND). Outside it the report is refused rather than averaged: a typo of
 * an extra zero would otherwise move a school's range. Hourly 50k–5M, monthly 3M–300M.
 */
export function payInBand(vnd: number, period: 'hour' | 'month'): boolean {
  return period === 'hour' ? vnd >= 50_000 && vnd <= 5_000_000 : vnd >= 3_000_000 && vnd <= 300_000_000
}

// ── the reviewer line ──────────────────────────────────────────────────────────────────────────

/**
 * The pseudonymous line above a review: "Former teacher · 2+ years · left 2024". COARSE ON PURPOSE —
 * exact years at a centre with four teachers name the person (plan review, Opus). "left <year>" only
 * when the reviewer chose to show it.
 */
export function stintParts(r: { current: boolean; tenure: Tenure; role: SchoolRole; leftYear: number | null; showLeftYear: boolean }) {
  const who = r.current
    ? { en: `Current ${ROLE_LABEL[r.role].en.toLowerCase()}`, vi: `${ROLE_LABEL[r.role].vi} hiện tại` }
    : { en: `Former ${ROLE_LABEL[r.role].en.toLowerCase()}`, vi: `${ROLE_LABEL[r.role].vi} cũ` }
  const parts = [who, TENURE_LABEL[r.tenure]]
  if (!r.current && r.showLeftYear && r.leftYear) parts.push({ en: `left ${r.leftYear}`, vi: `nghỉ năm ${r.leftYear}` })
  return parts
}

// ── review text screen ─────────────────────────────────────────────────────────────────────────

/**
 * Words that turn an experience into an ACCUSATION of a crime. Not refused (a teacher may have been
 * genuinely cheated) — FLAGGED, so the moderator reads it before it is published (pre-moderation) and can
 * ask for the facts. English + Vietnamese, folded.
 */
const ACCUSATION = [
  'scam', 'scammer', 'scammers', 'fraud', 'fraudulent', 'thief', 'thieves', 'steal', 'stole', 'stolen', 'criminal',
  'illegal', 'lua dao', 'lua gat', 'an cap', 'an cuop', 'tham nhung', 'phi phap', 'vi pham phap luat',
]
// A scheme or `www.` (any case), or a bare LOWER-CASE domain on a common TLD ("ila.edu.vn", "bit.ly/x").
// Case-sensitive on purpose (Opus, diff review): "ASP.NET", "late.Me and…" and "management.Co-workers"
// are prose a non-native writer types without a space after the full stop; typed addresses are lower-case.
const URL_RE = /(https?:\/\/|www\.)\S+/i
const BARE_DOMAIN_RE = /\b[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*\.(com|net|org|edu|gov|info|biz|io|co|me|ly|app|dev|xyz|asia|vn)(\/\S*)?(?![A-Za-z0-9-])/

export type ScreenResult = { ok: true; flags: string[] } | { ok: false; code: 'links_not_allowed' }

/** Links are refused outright (spam + doxxing vector); accusation words only flag for the moderator. */
export function screenReviewText(texts: (string | null | undefined)[]): ScreenResult {
  const all = texts.filter(Boolean).join('\n')
  if (URL_RE.test(all) || BARE_DOMAIN_RE.test(all)) return { ok: false, code: 'links_not_allowed' }
  const folded = ` ${fold(all).replace(/[^a-z0-9 ]+/g, ' ')} `
  const flags: string[] = []
  if (ACCUSATION.some((w) => folded.includes(` ${w} `))) flags.push('accusation')
  return { ok: true, flags }
}

/** schools.<base>/<path> → the canonical eno.vn/schools URL (path + query kept). */
export function schoolsRedirectPath(pathname: string, search: string): string {
  const clean = pathname.replace(/\/+$/, '')
  // ⚠️ CONCATENATED, NEVER new URL(path, base): `//evil.example` resolved against a base leaves our domain.
  const tail = clean === '' ? '' : `/${clean.replace(/^\/+/, '')}`
  return `/schools${tail}${search}`
}
