import { formatCalendarDay } from '@/lib/calendar-day'
import { fold } from '@/lib/fold'
import { hasVisaWord, isExpiredJob, jobProvinces, vnToday } from '@/lib/job-listing'
import { priceUnitSuffix } from '@/lib/price-unit'
import { formatInteger, formatMoneyFull } from '@/lib/vnd'
import { jobCityOf } from '@/app/[lang]/c/[category]/job-cities'

/**
 * THE TEACHING JOBS BOARD, ITS PURE HALF (teacher visibility plan B2, 2026-10-18): what /jobs-vietnam-expats says about
 * the live teaching jobs — one line per job, the city sections, and the summary paragraph over the same lines.
 * teaching-board.tsx reads the rows (the page's own narrowing, landing-target.ts, through scopedListingWhere like every
 * listing read) and draws them; every word and number a reader is shown is decided here, where a test can reach it
 * (the page imports Prisma, so it cannot be imported by one).
 *
 * ⛔ EVERY NUMBER IN THE SUMMARY IS COUNTED OVER THE LINES THE BOARD SHOWS, NEVER BY A SECOND QUERY. A total read on
 * its own would include the rows the board leaves out (below), and the paragraph would promise jobs nobody can find.
 *
 * ⛔ THE SUMMARY IS DATED, NEVER "RIGHT NOW". The page is ISR HTML served stale-while-revalidate (live on 2026-10-18:
 * `cache-control: s-maxage=3600, stale-while-revalidate=31532400`), so the first visitor after a quiet spell is handed
 * the previous render, however old. "On 18 Oct 2026, this page listed …" stays true in that copy; "listed right now"
 * does not. The day is the Vietnamese calendar day of the read (vnToday), printed by a server component — no browser
 * clock is involved, so nothing can mismatch at hydration. For the same reason an empty section says no job "is listed
 * on this page", which is true of whatever render it is read in.
 *
 * ⛔ IT COUNTS POSTINGS, NOT VACANCIES. The same job posted on two sites is two listings — on 2026-10-18 GrowGreen
 * Vietnam's Hai Phong job was on both TEAST and ESLGorilla, and Language Link's Thai Nguyen trainer job on its own site
 * and on Vietnam Teaching Jobs — so the summary says "teaching job postings".
 *
 * ⛔ PAY: HOW MANY POSTINGS STATE A FIGURE, AND NO RANGE. "The 7 that state one monthly amount in đồng range from
 * 35,000,000 đ to 80,000,000 đ" was taken from the stored price, which holds only what the importer's parseJobPay could
 * read — so it left out amounts the same render printed ("45,000,000 VND NET/Month", "550,000 VND / month", below its
 * own minimum) and a larger one would not have moved its maximum (review, 2026-10-18). A range has to be read from the
 * pay lines themselves, in every way a posting writes one, or not stated at all; the count is what the board can
 * stand behind, and a pay line counts only when it holds an amount (statesAmount below).
 *
 * ⛔ TWO KINDS OF LIVE ROW ARE LEFT OUT:
 *  · A CLOSED LINKED JOB — past its apply-by date by the importer's own rule (job-listing.ts isExpiredJob, the rows
 *    `--expire` hides). The daily refresh that runs it (the lead pipeline's jobs-daily, 06:30, on the owner's Mac) leaves
 *    those rows live from midnight until it runs — longer if it misses a day — while the listing page has already
 *    closed their Apply button (JobApplyGuard); a list of jobs to apply for drops them at render.
 *  · A TITLE OR EMPLOYER THE IMPORTER'S LICENSING SCREEN REFUSES TODAY (hasVisaWord, the same function). The importer
 *    screens a posting when it imports it, so a row imported before the screen was last widened stays live until it
 *    expires — on 2026-10-18 one live Da Nang title still carried the sponsorship wording 535c473a7 added to the screen.
 *    eno.vn carries none of that vocabulary, a teacher page least of all, so the board re-applies the screen. A pay
 *    line it refuses is dropped and the job kept — exactly what the importer does with one.
 *
 * ⚠️ PLAIN ENGLISH STRINGS, NOT tr(): the SeoLanding copy around the board is English on both language renders.
 */

/** The columns teaching-board.tsx reads for each row. */
export type BoardRow = {
  id: string
  title: string
  city: string
  attributes: string | null
  price: number
  priceUnit: string
  currency: string
  affiliateUrl: string | null
  seller: { name: string }
}

export type SectionKey = 'hcmc' | 'hanoi' | 'danang' | 'other'

/**
 * The sections, in page order. The three cities are matched by vn-units CODE — the post-2025 provinces, which already
 * hold the merged ones (Bình Dương and Vũng Tàu are Ho Chi Minh City, Quảng Nam is Da Nang: job-listing.ts PLACES).
 * `id` is the section's anchor, which the summary links; `lead` + `name` is how the heading and the summary place it.
 * ⚠️ THE REST IS "ELSEWHERE IN VIETNAM", NOT "OTHER CITIES": it also holds a job whose stored place names no province,
 * and of that one nothing is known but that it is not in the three cities. Every importer and the post wizard set a
 * place, so none such is live — the words must still not claim a city for one.
 */
export const BOARD_SECTIONS: readonly { key: SectionKey; code: string | null; id: string; lead: string; name: string }[] = [
  { key: 'hcmc', code: '79', id: 'ho-chi-minh-city', lead: 'in ', name: 'Ho Chi Minh City' },
  { key: 'hanoi', code: '01', id: 'hanoi', lead: 'in ', name: 'Hanoi' },
  { key: 'danang', code: '48', id: 'da-nang', lead: 'in ', name: 'Da Nang' },
  { key: 'other', code: null, id: 'elsewhere-in-vietnam', lead: '', name: 'elsewhere in Vietnam' },
]

export type BoardJob = {
  id: string
  /** The role, as the listing is titled — less the " — <employer>" the importer appends, since the line names the employer. */
  title: string
  /** The employer the posting names; null when it names none. */
  employer: string | null
  /** True for a job linked from another site (the listing's Apply button opens the original posting). */
  linked: boolean
  /** The site a linked job opens: its storefront's name, which is the board's (job-listing.ts JOB_BOARDS). */
  site: string | null
  /**
   * Who posted a job directly on the site: its storefront's name. ⚠️ NOT `employer` — a direct post may come from a
   * recruiter, so the line says "posted directly by", never puts the poster where the employer goes.
   */
  poster: string | null
  section: SectionKey
  /** The province in English ('Hai Phong'), or the stored text when it names none; null when there is none to print. */
  place: string | null
  /** The pay as stated — only a line that holds an amount (statesAmount), else the stored figure; null when neither. */
  pay: string | null
  /** YYYY-MM-DD, a Vietnamese calendar day. */
  applyBy: string | null
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * ⚠️ DOES A PAY LINE HOLD AN AMOUNT? Only then is it printed as the pay and counted as a stated figure. A digit is not
 * enough: "Competitive + 13th month bonus" has two and states no pay. A line holds an amount when it has:
 *  · a dollar, euro or pound figure, of any size, the sign before or after it (USD 1,900 · 2000$ · 18-22$/hour · €18 an
 *    hour · 25 euros · 20 đô) — boards print two-digit hourly dollar rates: "18-22$/hour" was live on 2026-10-18; or
 *  · a figure with a magnitude word, in any currency or none (450k · 35M · 30-40 mil · 25 mln · 1.5 million ·
 *    25 millions · 20 tr · 20 triệu · 500 nghìn); or
 *  · IN A LINE WRITTEN IN ĐỒNG, a đồng figure of FOUR DIGITS OR MORE: grouped in thousands by dots, commas or spaces
 *    anywhere in the line (40,000,000 VND · 500.000đ · 15 000 000 VND), ungrouped from five digits anywhere ("Lương
 *    (VNĐ/tháng): 15000000"), or four ungrouped against the sign or as a rate (VND 5000 · 5000/giờ) — so a year in the
 *    line ("VND, 2026 intake") is no figure. The line is in đồng when it carries a đồng sign ANYWHERE (₫ · VND · VNĐ · a
 *    lone đ), or "đồng"/"dong" right after a figure — never that word alone, which is also hợp đồng (a contract) and
 *    Đồng Nai. ⛔ NOTHING SHORTER, wherever the sign sits ("VND 50/hour" · "VND 50-60/hour" · "50/hour VND" · "Lương
 *    (VNĐ): 500/giờ"): "1 VND / month" (Einstein School HCM, staged 25–28 Sep 2026) and "50 VND / month" (EMG Education,
 *    6–12 Oct 2026) were TEAST pay lines, placeholders. Under 1,000 đ is no wage at all; the importer's own pay reader
 *    (job-listing.ts parseJobPay) takes no hourly figure under 20,000 đ and no monthly one under 1,000,000 đ;
 *  · in any other line, a figure written as a rate (25/hour · 25 an hour · 800 per hour · 15.000.000/tháng) or in grouped
 *    thousands (35,000,000 · 60.000.000) — in a pay field, a figure that size is the pay.
 * A bare number is not: "100 teaching hours per month", "365 days of insurance", "40 hours/week", "12 months", a 13th
 * month — nor an ungrouped one of any length ("Salary 1200-1500": dollars or something else; a year has four digits).
 * ⚠️ NOT "ANY THREE DIGITS" (review, 2026-10-18): that read "100 teaching hours" as a pay.
 * ⚠️ THE LINE'S CURRENCY, NOT THE SIGN NEXT TO EACH FIGURE (review, 2026-10-18, two rounds): reading the sign beside a
 * figure let the second figure of "VND 50-60/hour", "VND: 50/hour" and "50/hour VND" through as bare rates.
 * Whitespace is folded first, as toBoardJob's text() folds every pay line, so no spacing changes the answer. "VNÐ" with
 * the look-alike Ð (U+00D0) is read as VNĐ.
 * `(?!\p{L})`, not `\b`: JavaScript's \b is ASCII-only, so it never matches after "đ" or "giờ" (parseJobPay records the
 * same trap).
 */
const FOREIGN = /(?:[$€£]|(?<!\p{L})(?:usd|eur|gbp))\s?\d|\d\s?(?:[$€£]|(?:usd|eur|euros?|gbp|pounds?|dollars?|đô)(?!\p{L}))/iu
// A bare k or m is no magnitude before a digit or a ² ("45m²", "50m2": a floor area); unaccented triệu, nghìn and ngàn
// are read too ("15 trieu/thang" — review, 2026-10-19).
const MAGNITUDE = /\d\s?(?:k(?![\p{L}\d])|m(?![\p{L}\d²])|mil|mln|millions?|tr|triệu|trieu|nghìn|nghin|ngàn|ngan)(?!\p{L})/iu
/** "/hour", " per month", " an hour", " mỗi giờ" … after a figure. */
const PER_UNIT = String.raw`\s?(?:\/|per\s|an?\s|mỗi\s)\s?(?:hour|hr|h|month|mo|giờ|tháng)(?!\p{L})`
const DONG_SIGN = String.raw`(?:₫|(?<!\p{L})(?:vn[dđð]|đ)(?!\p{L}))`
const IN_DONG = new RegExp(String.raw`${DONG_SIGN}|\d\s?(?:đồng|dong)(?!\p{L})`, 'iu')
const DONG_FIGURE = new RegExp(
  [
    String.raw`(?<![\d.,])\d{1,3}(?:[., ]\d{3})+(?!\d)`,
    String.raw`(?<![\d.,])\d{5,}`,
    String.raw`${DONG_SIGN}[\s:)–-]{0,3}\d{4,}`,
    String.raw`(?<![\d.,])\d{4,}(?:\s?(?:${DONG_SIGN}|đồng(?!\p{L})|dong(?!\p{L}))|${PER_UNIT})`,
  ].join('|'),
  'iu',
)
const PLAIN_AMOUNT = new RegExp(String.raw`\d${PER_UNIT}|(?<![\d.,])\d{1,3}(?:[.,]\d{3})+(?![\d.,]*\d)`, 'iu')
export function statesAmount(line: string): boolean {
  const t = line.replace(/\s+/g, ' ')
  if (FOREIGN.test(t) || MAGNITUDE.test(t)) return true
  return IN_DONG.test(t) ? DONG_FIGURE.test(t) : PLAIN_AMOUNT.test(t)
}

function attrsOf(raw: string | null): Record<string, unknown> {
  try {
    const a: unknown = JSON.parse(raw ?? 'null')
    return a && typeof a === 'object' && !Array.isArray(a) ? (a as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim() : null)
/** The text, unless the licensing screen refuses it. */
const screened = (t: string | null): string | null => (t && !hasVisaWord(t) ? t : null)

/** One row → its line on the board, or null when the board leaves it out (closed, or refused by the screen — see the header). */
export function toBoardJob(r: BoardRow, now: number): BoardJob | null {
  const a = attrsOf(r.attributes)
  const linked = !!r.affiliateUrl
  // The employer is what the posting named — never the storefront: a linked job's is the board it was posted on, and a
  // direct post's may be a recruiter's.
  const employer = text(a.employer)
  if (hasVisaWord([r.title, employer].filter(Boolean).join(' '))) return null
  const applyBy = typeof a.applyBy === 'string' && ISO_DAY.test(a.applyBy) ? a.applyBy : null
  // ⚠️ THE IMPORTER'S CUTOFF IS FOR THE IMPORTER'S ROWS: `--expire` reads only the job boards' storefronts, and a
  // direct post has no apply-by at all — it stays until its poster takes it down. A date it does carry still closes it.
  if (linked ? isExpiredJob(r.attributes, now) : applyBy !== null && applyBy < vnToday(now)) return null

  // ⚠️ THE CHIPS' OWN LOOKUP FIRST (job-cities.ts), so a job sits in the same province here as on /c/jobs' "By city"
  // row; the importer's place rule second, for a stored spelling no vn-units name matches ("TP. HCM").
  const province = jobCityOf(r.city) ?? jobCityOf(jobProvinces(r.city)[0])
  const section = BOARD_SECTIONS.find((s) => s.code !== null && s.code === province?.geo.code)?.key ?? 'other'

  const stated = text(a.salaryText)
  // The importer appends " — <employer>" to a title that does not already name its employer (job-listing.ts
  // mapStagedJob); the line prints the employer beside the role, so the suffix would say it twice.
  const suffix = employer ? ` — ${employer}` : ''
  return {
    id: r.id,
    title: suffix && r.title.endsWith(suffix) && r.title.length > suffix.length ? r.title.slice(0, -suffix.length) : r.title,
    employer,
    linked,
    // The other texts a line prints, through the same screen (a storefront's name and a stored place are not posting
    // copy, but nothing printed on this page skips it): a refused one is left off, the job kept.
    site: linked ? screened(text(r.seller.name)) : null,
    poster: linked ? null : screened(text(r.seller.name)),
    section,
    place: province ? province.label.en : screened(text(r.city)),
    pay: stated && statesAmount(stated) && !hasVisaWord(stated)
      ? stated
      // No usable pay line: the stored price is the one figure the posting (or a direct post's salary field) gave — a
      // job's unit is per month unless stored otherwise, as on the listing page.
      : r.price > 0 ? `${formatMoneyFull(r.price, r.currency, 'en')} / ${priceUnitSuffix(r.priceUnit) ?? 'month'}` : null,
    applyBy,
  }
}

/** The rows the board shows, in the order read (newest first). */
export function boardJobs(rows: readonly BoardRow[], now: number): BoardJob[] {
  return rows.flatMap((r) => {
    const j = toBoardJob(r, now)
    return j ? [j] : []
  })
}

export type BoardSection = (typeof BOARD_SECTIONS)[number] & { jobs: BoardJob[] }

/**
 * Every section, in page order, each with its jobs — an empty one included (the page says so rather than dropping the
 * heading). The rest of Vietnam is ordered by place, so one city's jobs sit together; within a place the read order holds.
 */
export function boardSections(jobs: readonly BoardJob[]): BoardSection[] {
  return BOARD_SECTIONS.map((s) => {
    const mine = jobs.filter((j) => j.section === s.key)
    // A job with no place to print goes last.
    if (s.key === 'other') mine.sort((a, b) => Number(a.place === null) - Number(b.place === null) || (a.place ?? '').localeCompare(b.place ?? '', 'en'))
    return { ...s, jobs: mine }
  })
}

/** A section's heading — the search it answers ("teaching jobs in Hanoi"), so the city is in the words, not only the anchor. */
export function sectionHeading(s: { lead: string; name: string }): string {
  return `Teaching jobs ${s.lead}${s.name}`
}

/** The sentence an empty section carries instead of a list — about this render's list, so a stale copy cannot make it false. */
export function emptySectionLine(s: { key: SectionKey; name: string }): string {
  return s.key === 'other' ? 'No teaching job outside these three cities is listed on this page.' : `No teaching job in ${s.name} is listed on this page.`
}

const sameName = (a: string, b: string | null) => {
  if (!b) return false
  const x = fold(a)
  const y = fold(b)
  return x.includes(y) || y.includes(x)
}

/**
 * The line under a job's title: employer · place (in the last section only — the three cities' headings name theirs) ·
 * pay · apply-by · where it came from: the site a linked job was posted on (left out when the site IS the employer, a
 * school's own careers page), or who posted a direct one.
 */
export function jobLine(j: BoardJob): string {
  return [
    j.employer,
    j.section === 'other' ? j.place : null,
    j.pay,
    j.applyBy ? `Apply by ${formatCalendarDay(j.applyBy, 'en')}` : null,
    j.site && !sameName(j.site, j.employer) ? `via ${j.site}` : null,
    j.poster ? `posted directly by ${j.poster}` : null,
  ].filter(Boolean).join(' · ')
}

export type BoardSummary = {
  total: number
  /** The sections that hold jobs, in page order. */
  sections: { id: string; lead: string; name: string; count: number }[]
  linked: number
  /** The sites linked jobs come from, most jobs first. */
  sites: { name: string; count: number }[]
  direct: number
  withPay: number
  applyBy: { first: string; last: string; n: number } | null
}

export function boardSummary(jobs: readonly BoardJob[]): BoardSummary {
  const bySite = new Map<string, number>()
  for (const j of jobs) if (j.site) bySite.set(j.site, (bySite.get(j.site) ?? 0) + 1)
  const dates = jobs.flatMap((j) => (j.applyBy ? [j.applyBy] : [])).sort()
  const linked = jobs.filter((j) => j.linked).length
  return {
    total: jobs.length,
    sections: boardSections(jobs).filter((s) => s.jobs.length).map((s) => ({ id: s.id, lead: s.lead, name: s.name, count: s.jobs.length })),
    linked,
    sites: [...bySite].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'en')),
    direct: jobs.length - linked,
    withPay: jobs.filter((j) => j.pay).length,
    applyBy: dates.length ? { first: dates[0], last: dates[dates.length - 1], n: dates.length } : null,
  }
}

/** A run of the summary: plain text, or the name of a section linked to its anchor. */
export type Segment = { text: string; href?: string }

const n = (x: number) => formatInteger(x, 'en')
const listJoin = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

function placesRun(s: BoardSummary): Segment[] {
  const parts = s.sections
  if (parts.length === 1) return [{ text: `, ${s.total === 1 ? '' : 'all '}${parts[0].lead}` }, { text: parts[0].name, href: `#${parts[0].id}` }, { text: '.' }]
  const out: Segment[] = [{ text: ': ' }]
  parts.forEach((p, i) => {
    if (i > 0) out.push({ text: i === parts.length - 1 ? ' and ' : ', ' })
    out.push({ text: `${n(p.count)} ${p.lead}` }, { text: p.name, href: `#${p.id}` })
  })
  out.push({ text: '.' })
  return out
}

function sitesSentence(s: BoardSummary, siteName: string): string {
  const out: string[] = []
  if (s.linked) {
    // ⚠️ A COUNT OF THIS RENDER'S LINKED JOBS, NEVER "EACH" (the one linked-jobs rule, 2026-10-18: a school can post
    // directly, and its job has no original elsewhere). "All 37" is said only when every job listed is linked; a direct
    // post makes it "36 of them" and is counted in the next sentence.
    const who = s.linked === s.total
      ? s.total === 1 ? 'It links' : s.total === 2 ? 'Both link' : `All ${n(s.total)} link`
      : `${n(s.linked)} of them ${s.linked === 1 ? 'links' : 'link'}`
    // "An original posting" after a plural subject: every job has its own, on one site — "All 37 link to the original
    // posting" read as one posting (review, 2026-10-18).
    const to = s.linked === 1 ? 'to the original posting' : 'to an original posting'
    // ⚠️ Sites are named only when EVERY linked job's is printable — a name the screen refused (toBoardJob) leaves that
    // job's site unknown, and "on TEAST" or "one of 4 sites" would then misplace it.
    const named = s.sites.reduce((k, x) => k + x.count, 0) === s.linked
    if (!named || s.sites.length <= 1) out.push(`${who} ${to}${named && s.sites[0] ? ` on ${s.sites[0].name}` : ''}.`)
    // Two or three sites are named outright, each with its count — "on one of 2 sites" read oddly and said less.
    else if (s.sites.length <= 3) out.push(`${who} ${to}: ${listJoin(s.sites.map((x) => `${n(x.count)} on ${x.name}`))}.`)
    else {
      // "Most often": up to three sites, each with more than one job (with one each, nothing is most often) — and never
      // one of a tie the cut splits: 10, 9, 3, 3 names the first two, not whichever 3 sorts first by name.
      const ranked = s.sites.filter((x) => x.count >= 2)
      const cut = ranked[3]?.count
      const top = ranked.slice(0, 3).filter((x) => cut === undefined || x.count > cut).map((x) => `${x.name} (${n(x.count)})`)
      // ⚠️ "SITES", NOT "JOB SITES" (review, 2026-10-18): a source is a job board or a school's own careers site
      // (job-listing.ts JOB_BOARDS — Language Link Vietnam, RMIT, Nord Anglia, FPT Education among them).
      out.push(`${who} ${to} on one of ${n(s.sites.length)} sites${top.length ? `, most often ${listJoin(top)}` : ''}.`)
    }
  }
  if (s.direct) {
    out.push(s.direct === s.total
      ? `${s.total === 1 ? 'It was' : 'All of them were'} posted directly on ${siteName}.`
      : `${n(s.direct)} ${s.direct === 1 ? 'was' : 'were'} posted directly on ${siteName}.`)
  }
  return out.join(' ')
}

/** How many postings state a figure for the pay — the count alone (the header says why there is no range). */
function paySentence(s: BoardSummary): string {
  if (s.total === 1) return s.withPay ? 'It states a figure for the pay.' : 'It states no figure for the pay.'
  if (s.withPay === s.total) return 'Every one states a figure for the pay.'
  if (s.withPay === 0) return 'None states a figure for the pay.'
  return `${n(s.withPay)} of the ${n(s.total)} postings ${s.withPay === 1 ? 'states' : 'state'} a figure for the pay.`
}

function applyBySentence(s: BoardSummary): string | null {
  if (!s.applyBy) return null
  const { first, last, n: dated } = s.applyBy
  if (first === last) return `${dated === 1 ? 'The apply-by date is' : 'Every apply-by date is'} ${formatCalendarDay(last, 'en')}.`
  return `The apply-by dates run from ${formatCalendarDay(first, 'en', { year: first.slice(0, 4) !== last.slice(0, 4) })} to ${formatCalendarDay(last, 'en')}.`
}

/**
 * The summary paragraph, as runs: the day of the read and how many postings it listed, where; which sites they link
 * to; how many state a figure for the pay; and the span of the apply-by dates. Empty for no jobs — the board then draws
 * nothing. `day` is the Vietnamese calendar day the rows were read (YYYY-MM-DD — teaching-board.tsx, vnToday).
 * ⚠️ NO NUMBER HERE MAY REACH A <title>: the page's HTML is cached, and a title is quoted by search results long after.
 */
export function summarySegments(s: BoardSummary, siteName: string, day: string): Segment[] {
  if (!s.total) return []
  const rest = [sitesSentence(s, siteName), paySentence(s), applyBySentence(s)].filter(Boolean).join(' ')
  return [
    { text: `On ${formatCalendarDay(day, 'en')}, this page listed ${n(s.total)} ${s.total === 1 ? 'teaching job posting' : 'teaching job postings'}` },
    ...placesRun(s),
    { text: ` ${rest}` },
  ]
}
