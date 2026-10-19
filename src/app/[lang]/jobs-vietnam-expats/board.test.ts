import { describe, expect, it } from 'vitest'
import { jobCityOf } from '@/app/[lang]/c/[category]/job-cities'
import {
  BOARD_SECTIONS,
  boardJobs,
  boardSections,
  boardSummary,
  emptySectionLine,
  jobLine,
  sectionHeading,
  statesAmount,
  summarySegments,
  toBoardJob,
  type BoardRow,
} from './board'

/**
 * The teaching jobs board on /jobs-vietnam-expats (teacher visibility plan B2): which live rows it lists, in which city
 * section, the line under each title, and the summary paragraph counted over the same lines.
 */

const NOW = Date.parse('2026-10-18T13:00:00Z') // 20:00 on 18 October in Vietnam
/** The day the rows were read — teaching-board.tsx passes vnToday(now). */
const DAY = '2026-10-18'

type RowInput = Partial<Omit<BoardRow, 'attributes'>> & { attrs?: Record<string, unknown> | null }

/** A linked job as scripts/import-jobs.ts stores one (job-listing.ts mapStagedJob), unless told otherwise. */
function row(o: RowInput = {}): BoardRow {
  const attrs = o.attrs === undefined ? { employer: 'Dong Tay Education', salaryText: '500,000 VND / hour', applyBy: '2026-10-21', source: 'TEAST' } : o.attrs
  return {
    id: o.id ?? 'job-1',
    title: o.title ?? 'ESL Native English Teacher — Dong Tay Education',
    city: o.city ?? 'Hồ Chí Minh',
    attributes: attrs === null ? null : JSON.stringify(attrs),
    price: o.price ?? 0,
    priceUnit: o.priceUnit ?? 'VND/month',
    currency: o.currency ?? '₫',
    affiliateUrl: o.affiliateUrl === undefined ? 'https://teast.co/job/abc123' : o.affiliateUrl,
    seller: o.seller ?? { name: 'TEAST' },
  }
}

const linked = (id: string, city: string, site: string, employer: string, title: string, salaryText: string | null, applyBy: string, price = 0, priceUnit = 'VND/month') =>
  row({
    id, city, title: `${title} — ${employer}`, seller: { name: site }, price, priceUnit,
    attrs: { employer, ...(salaryText ? { salaryText } : {}), applyBy, source: site },
  })

/** A morning on the live board, 2026-10-18, cut down: real employers, boards and pay lines. */
const ROWS: BoardRow[] = [
  linked('hcm-1', 'Hồ Chí Minh', 'TEAST', 'Dong Tay Education', 'ESL Native English Teacher', '500,000 VND / hour', '2026-10-21', 500_000, 'VND/hour'),
  linked('hcm-2', 'Hồ Chí Minh', 'TEAST', 'Power English', 'ESL Teacher at Public School in Ho Chi Minh City', '40,000,000 VND / month', '2026-10-21', 40_000_000),
  linked('hn-1', 'Hà Nội', 'TEAST', 'Korea Global School', 'Psychology Teacher (Cambridge, AP), Hanoi', '60,000,000 VND / month', '2026-10-26', 60_000_000),
  // A monthly figure the importer could not read as one amount ("NET"): a stated pay, but not in the range.
  linked('hn-2', 'Hà Nội', 'Vietnam Teaching Jobs', 'VN Education', 'Secondary (ESL) - Full-time Native English Teacher in Hanoi.', '45,000,000 VND NET/Month', '2026-10-23'),
  linked('dn-1', 'Đà Nẵng', 'TEAST', 'Fisher’s SuperKids Academy', 'Part-time ESL Teacher Needed for Reputable English Center', '40,000,000 VND / month', '2026-10-30', 40_000_000),
  linked('hp-1', 'Hải Phòng', 'ESLGorilla', 'GrowGreen Vietnam', 'English Teacher – Haiphong, Vietnam', '35,000,000 VND / month', '2026-10-27', 35_000_000),
  // A school's own careers site: the site IS the employer. "Competitive" is no figure.
  linked('tn-1', 'Thái Nguyên', 'Language Link Vietnam', 'Language Link Vietnam', '[Thai Nguyen] Teacher Trainers – November 2026', 'Competitive', '2026-10-23'),
  // Closed yesterday; the 06:30 refresh has not hidden it yet.
  linked('hcm-closed', 'Hồ Chí Minh', 'TEAST', 'Byan Teach', 'Part-time ESL Teachers Private Kindergarten', '470,000 VND / hour', '2026-10-17', 470_000, 'VND/hour'),
  // Imported before 535c473a7 widened the screen — still live that day.
  linked('dn-trc', 'Đà Nẵng', 'Vietnam Teaching Jobs', 'Via English Academy', 'Part - Time Expat Teacher - Danang - Currently living in Viet Nam - Work Permit and TRC Sponsorship', '500,000 - 560,000 VND', '2026-10-20'),
]

const sentence = (rows: BoardRow[]) => summarySegments(boardSummary(boardJobs(rows, NOW)), 'eno.vn', DAY).map((s) => s.text).join('')

describe('which live rows the board lists', () => {
  it('a linked job: the role without the employer suffix, its employer, site, section, pay and apply-by', () => {
    expect(toBoardJob(ROWS[2], NOW)).toEqual({
      id: 'hn-1',
      title: 'Psychology Teacher (Cambridge, AP), Hanoi',
      employer: 'Korea Global School',
      linked: true,
      site: 'TEAST',
      poster: null,
      section: 'hanoi',
      place: 'Hanoi',
      pay: '60,000,000 VND / month',
      applyBy: '2026-10-26',
    })
  })

  it('⛔ leaves out a linked job past its apply-by date — and keeps one closing today', () => {
    expect(toBoardJob(ROWS[7], NOW)).toBeNull()
    expect(toBoardJob(linked('today', 'Hà Nội', 'TEAST', 'Sentia', 'Lead Teacher', null, '2026-10-18'), NOW)?.applyBy).toBe('2026-10-18')
    // The importer's own rule (isExpiredJob): a linked row with no readable apply-by has no date its Apply button closes on.
    expect(toBoardJob(row({ attrs: { employer: 'Sentia' } }), NOW)).toBeNull()
    expect(toBoardJob(row({ attrs: null }), NOW)).toBeNull()
  })

  it('⛔ leaves out a title or employer the licensing screen refuses today, whenever it was imported', () => {
    expect(toBoardJob(ROWS[8], NOW)).toBeNull()
    expect(toBoardJob(linked('emp', 'Hà Nội', 'TEAST', 'Visa Support Centre', 'English Teacher', null, '2026-10-26'), NOW)).toBeNull()
  })

  it('a pay line the screen refuses is dropped and the job kept, as at import', () => {
    const j = toBoardJob(linked('pay', 'Hà Nội', 'TEAST', 'Sentia', 'Lead Teacher', '52,000,000 VND / month + work permit and visa support', '2026-10-26', 52_000_000), NOW)!
    expect(j).not.toBeNull()
    // The stored figure is all that is left of it — no word of the line.
    expect(j.pay).toBe('52,000,000 đ / month')
    expect(toBoardJob(linked('pay0', 'Hà Nội', 'TEAST', 'Sentia', 'Lead Teacher', 'Competitive + visa', '2026-10-26'), NOW)!.pay).toBeNull()
  })

  it('a pay line with no figure in it is no stated pay', () => {
    expect(toBoardJob(ROWS[6], NOW)!.pay).toBeNull()
    expect(toBoardJob(linked('c', 'Hà Nội', 'TEAST', 'Sentia', 'Lead Teacher', 'Competitive salary and attractive benefits package', '2026-10-26'), NOW)!.pay).toBeNull()
    expect(toBoardJob(linked('u', 'Hà Nội', 'TEAST', 'Sentia', 'Lead Teacher', 'USD 1,900 – 2,350 per month (gross)', '2026-10-26'), NOW)!.pay).toBe('USD 1,900 – 2,350 per month (gross)')
  })

  it('⚠️ a digit is not a figure: a benefits line is neither printed as the pay nor counted as one', () => {
    const perk = linked('perk', 'Hà Nội', 'TEAST', 'Sentia', 'Lead Teacher', 'Competitive + 13th month bonus', '2026-10-26')
    const j = toBoardJob(perk, NOW)!
    expect(j.pay).toBeNull()
    expect(jobLine(j)).toBe('Sentia · Apply by 26 Oct 2026 · via TEAST')
    expect(sentence([ROWS[2], perk])).toContain('1 of the 2 postings states a figure for the pay.')
  })

  it('a direct post: its poster is named as the poster — never as the employer — with the stored salary, kept without a date', () => {
    const j = toBoardJob(row({ id: 'own', title: 'English teacher, Thao Dien', affiliateUrl: null, seller: { name: 'Sunrise English Centre' }, attrs: { english: 'required' }, price: 30_000_000 }), NOW)!
    expect(j).toMatchObject({ linked: false, employer: null, poster: 'Sunrise English Centre', site: null, pay: '30,000,000 đ / month', applyBy: null })
    expect(jobLine(j)).toBe('30,000,000 đ / month · posted directly by Sunrise English Centre')
    // A recruiter posting for a named school: the school is the employer, the recruiter the poster.
    const viaRecruiter = toBoardJob(row({ affiliateUrl: null, title: 'IELTS teacher', seller: { name: 'Saigon Teacher Recruitment' }, attrs: { employer: 'Riverside Academy' } }), NOW)!
    expect(jobLine(viaRecruiter)).toBe('Riverside Academy · posted directly by Saigon Teacher Recruitment')
    // …and one that does carry a past date is closed like any other.
    expect(toBoardJob(row({ affiliateUrl: null, attrs: { applyBy: '2026-10-01' } }), NOW)).toBeNull()
  })

  it('strips only the exact " — <employer>" suffix the importer appends', () => {
    expect(toBoardJob(row({ title: 'Lead Teacher — Somebody Else' }), NOW)!.title).toBe('Lead Teacher — Somebody Else')
    expect(toBoardJob(row({ title: '[Hanoi] English teacher - Sakura Schools' }), NOW)!.title).toBe('[Hanoi] English teacher - Sakura Schools')
  })
})

describe('city sections', () => {
  it('the three named sections are the vn-units provinces the chips use (post-2025 codes)', () => {
    const code = (city: string) => jobCityOf(city)?.geo.code
    expect(BOARD_SECTIONS.map((s) => s.code)).toEqual([code('Hồ Chí Minh'), code('Hà Nội'), code('Đà Nẵng'), null])
  })

  it('places a job by the chips’ lookup, then the importer’s place rule; anything else is elsewhere in Vietnam', () => {
    const at = (city: string) => toBoardJob(row({ city }), NOW)!
    expect(at('Hồ Chí Minh').section).toBe('hcmc')
    expect(at('Ha Noi').section).toBe('hanoi')
    expect(at('Đà Nẵng').section).toBe('danang')
    // Spellings no vn-units name matches: job-listing.ts jobProvinces reads them (and the merged provinces).
    expect(at('TP. HCM').section).toBe('hcmc')
    expect(at('Saigon').section).toBe('hcmc')
    expect(at('Bình Dương')).toMatchObject({ section: 'hcmc', place: 'Ho Chi Minh City' })
    expect(at('Hải Phòng')).toMatchObject({ section: 'other', place: 'Hai Phong' })
    expect(at('Atlantis')).toMatchObject({ section: 'other', place: 'Atlantis' })
    expect(at('')).toMatchObject({ section: 'other', place: null })
  })

  it('⛔ a stored place or a site name the licensing screen refuses is left off the line, the job kept', () => {
    expect(toBoardJob(row({ city: 'Visa Run Town' }), NOW)).toMatchObject({ section: 'other', place: null })
    expect(toBoardJob(row({ seller: { name: 'TRC Jobs Board' } }), NOW)).toMatchObject({ linked: true, site: null })
  })

  it('every section, in page order, empty ones included; the rest of Vietnam grouped by place', () => {
    const jobs = boardJobs([...ROWS, linked('qn-1', 'Quảng Ninh', 'The TEFL Academy', 'Sun Group', 'Teach English in Vietnam', null, '2026-10-26')], NOW)
    const sections = boardSections(jobs)
    expect(sections.map((s) => [s.id, s.jobs.map((j) => j.id)])).toEqual([
      ['ho-chi-minh-city', ['hcm-1', 'hcm-2']],
      ['hanoi', ['hn-1', 'hn-2']],
      ['da-nang', ['dn-1']],
      ['elsewhere-in-vietnam', ['hp-1', 'qn-1', 'tn-1']], // Hai Phong, Quang Ninh, Thai Nguyen
    ])
    expect(boardSections(jobs.filter((j) => j.section !== 'danang'))[2].jobs).toEqual([])
    expect(BOARD_SECTIONS.map(sectionHeading)).toEqual([
      'Teaching jobs in Ho Chi Minh City', 'Teaching jobs in Hanoi', 'Teaching jobs in Da Nang', 'Teaching jobs elsewhere in Vietnam',
    ])
    // About the list in the same render, so a stale ISR copy cannot make it false (board.ts header).
    expect(emptySectionLine(BOARD_SECTIONS[2])).toBe('No teaching job in Da Nang is listed on this page.')
    expect(emptySectionLine(BOARD_SECTIONS[3])).toBe('No teaching job outside these three cities is listed on this page.')
  })
})

describe('the line under a title', () => {
  const jobs = Object.fromEntries(boardJobs(ROWS, NOW).map((j) => [j.id, j]))

  it('employer · pay · apply-by · the site — the place only in the last section', () => {
    expect(jobLine(jobs['hn-1'])).toBe('Korea Global School · 60,000,000 VND / month · Apply by 26 Oct 2026 · via TEAST')
    expect(jobLine(jobs['hp-1'])).toBe('GrowGreen Vietnam · Hai Phong · 35,000,000 VND / month · Apply by 27 Oct 2026 · via ESLGorilla')
  })

  it('a school’s own careers site is not repeated after its name', () => {
    expect(jobLine(jobs['tn-1'])).toBe('Language Link Vietnam · Thai Nguyen · Apply by 23 Oct 2026')
  })
})

describe('the summary paragraph', () => {
  it('counts the lines the board shows, dated by the read: postings and places, sites, stated pay with its n, the apply-by span', () => {
    expect(sentence(ROWS)).toBe(
      'On 18 Oct 2026, this page listed 7 teaching job postings: 2 in Ho Chi Minh City, 2 in Hanoi, 1 in Da Nang and 2 elsewhere in Vietnam. ' +
        'All 7 link to an original posting on one of 4 sites, most often TEAST (4). ' +
        '6 of the 7 postings state a figure for the pay. ' +
        'The apply-by dates run from 21 Oct to 30 Oct 2026.',
    )
  })

  it('⛔ is dated by the day it was read, never "right now" — the page is cached HTML served stale', () => {
    const words = summarySegments(boardSummary(boardJobs(ROWS, NOW)), 'eno.vn', '2026-10-19').map((s) => s.text).join('')
    expect(words).toMatch(/^On 19 Oct 2026, this page listed 7 teaching job postings: /)
    expect(words).not.toMatch(/right now|currently|today/i)
  })

  it('links each place to its section', () => {
    const links = summarySegments(boardSummary(boardJobs(ROWS, NOW)), 'eno.vn', DAY).filter((s) => s.href)
    expect(links).toEqual([
      { text: 'Ho Chi Minh City', href: '#ho-chi-minh-city' },
      { text: 'Hanoi', href: '#hanoi' },
      { text: 'Da Nang', href: '#da-nang' },
      { text: 'elsewhere in Vietnam', href: '#elsewhere-in-vietnam' },
    ])
    expect(links.map((l) => l.href)).toEqual(BOARD_SECTIONS.map((s) => `#${s.id}`))
  })

  it('says how many postings state a figure for the pay — "states" for one, "state" for more — and states no range', () => {
    const paid = (lines: (string | null)[]) =>
      lines.map((t, i) => linked(`p${i}`, 'Hà Nội', 'TEAST', `School ${i}`, 'Teacher', t, '2026-10-26'))
    expect(sentence(paid(['40,000,000 VND / month', null]))).toContain(' 1 of the 2 postings states a figure for the pay.')
    expect(sentence(paid(['40,000,000 VND / month', '35,000,000 VND / month', null]))).toContain(' 2 of the 3 postings state a figure for the pay.')
    expect(sentence(paid(['40,000,000 VND / month', '500,000 VND / hour']))).toContain(' Every one states a figure for the pay.')
    expect(sentence(paid([null, 'Competitive']))).toContain(' None states a figure for the pay.')
    // ⛔ No range, however many amounts are comparable: a range from the stored price left out amounts the same render
    // printed (board.ts header, the review of 2026-10-18).
    const monthly = [35_000_000, 40_000_000, 80_000_000].map((p, i) => linked(`m${i}`, 'Hà Nội', 'TEAST', `School ${i}`, 'Teacher', `${p} VND / month`, '2026-10-26', p))
    for (const rows of [ROWS, monthly]) expect(sentence(rows)).not.toMatch(/range from|monthly amount|hourly rate|80,000,000/)
  })

  it('one job, one city, one site, one date — in the singular', () => {
    expect(sentence([ROWS[2]])).toBe(
      'On 18 Oct 2026, this page listed 1 teaching job posting, in Hanoi. It links to the original posting on TEAST. It states a figure for the pay. The apply-by date is 26 Oct 2026.',
    )
    expect(sentence([ROWS[2], ROWS[3]])).toMatch(/^On 18 Oct 2026, this page listed 2 teaching job postings, all in Hanoi\. Both link to an original posting: 1 on TEAST and 1 on Vietnam Teaching Jobs\. /)
    expect(sentence([ROWS[5]])).toMatch(/^On 18 Oct 2026, this page listed 1 teaching job posting, elsewhere in Vietnam\. /)
    expect(sentence([ROWS[5], ROWS[6]])).toMatch(/^On 18 Oct 2026, this page listed 2 teaching job postings, all elsewhere in Vietnam\. /)
    expect(sentence([ROWS[6]])).toContain(' It states no figure for the pay.')
  })

  it('two or three sites are named outright, each with its count — never as one posting on several sites', () => {
    expect(sentence([ROWS[0], ROWS[1], ROWS[3], ROWS[5]])).toContain(
      ' All 4 link to an original posting: 2 on TEAST, 1 on ESLGorilla and 1 on Vietnam Teaching Jobs. ',
    )
    expect(sentence([ROWS[3], ROWS[5]])).toContain(' Both link to an original posting: 1 on ESLGorilla and 1 on Vietnam Teaching Jobs. ')
    // One linked job of three is "the original posting", in the singular.
    const own = (id: string) => row({ id, affiliateUrl: null, seller: { name: 'Sunrise English Centre' }, attrs: {}, price: 30_000_000 })
    expect(sentence([ROWS[2], own('a'), own('b')])).toContain(' 1 of them links to the original posting on TEAST. 2 were posted directly on eno.vn.')
  })

  it('"most often" names up to three sites with more than one job, never one of a tie the cut splits', () => {
    const at = (site: string, k: number) => Array.from({ length: k }, (_, i) => linked(`${site}-${i}`, 'Hà Nội', site, `${site} school ${i}`, 'Teacher', null, '2026-10-26'))
    // The 2026-10-18 board: Vietnam Teaching Jobs 10, TEAST 9, then TeslJobs and The TEFL Academy on 3 each.
    const tie = [...at('Vietnam Teaching Jobs', 10), ...at('TEAST', 9), ...at('TeslJobs', 3), ...at('The TEFL Academy', 3), ...at('ESLGorilla', 1)]
    expect(sentence(tie)).toContain('All 26 link to an original posting on one of 5 sites, most often Vietnam Teaching Jobs (10) and TEAST (9).')
    const clear = [...at('Vietnam Teaching Jobs', 10), ...at('TEAST', 9), ...at('TeslJobs', 3), ...at('The TEFL Academy', 2)]
    expect(sentence(clear)).toContain('most often Vietnam Teaching Jobs (10), TEAST (9) and TeslJobs (3).')
  })

  it('names no site at all when one linked job’s site was refused by the screen — it would be misplaced', () => {
    const refused = row({ id: 'r', city: 'Hà Nội', seller: { name: 'TRC Jobs Board' } })
    expect(sentence([ROWS[2], refused])).toContain('Both link to an original posting. ')
    expect(sentence([ROWS[2], ROWS[3], refused])).toContain('All 3 link to an original posting. ')
  })

  it('⛔ counts this render’s linked jobs, never "each" — a direct post makes it "N of them" (the one linked-jobs rule)', () => {
    const own = row({ id: 'own', affiliateUrl: null, seller: { name: 'Sunrise English Centre' }, attrs: {}, price: 30_000_000 })
    for (const rows of [ROWS, [ROWS[2], ROWS[3]], [ROWS[2]], [...ROWS, own]]) expect(sentence(rows)).not.toMatch(/\beach\b/i)
    expect(sentence([...ROWS, own])).toContain('7 of them link to an original posting on one of 4 sites, most often TEAST (4). 1 was posted directly on eno.vn.')
  })

  it('direct posts are counted apart from linked ones', () => {
    const own = row({ id: 'own', affiliateUrl: null, seller: { name: 'Sunrise English Centre' }, attrs: {}, price: 30_000_000 })
    expect(sentence([own])).toBe('On 18 Oct 2026, this page listed 1 teaching job posting, in Ho Chi Minh City. It was posted directly on eno.vn. It states a figure for the pay.')
    expect(sentence([ROWS[0], ROWS[2], own])).toContain('2 of them link to an original posting on TEAST. 1 was posted directly on eno.vn.')
  })

  it('nothing to say about no jobs', () => {
    expect(summarySegments(boardSummary([]), 'eno.vn', DAY)).toEqual([])
  })

  it('⛔ none of it carries the vocabulary eno.vn may not use', () => {
    const jobs = boardJobs(ROWS, NOW)
    const words = [sentence(ROWS), ...jobs.map(jobLine), ...jobs.map((j) => j.title)].join('\n')
    expect(words).not.toMatch(/visa|\bTRC\b|residen|immigra/i)
  })
})

/**
 * ⚠️ WHAT COUNTS AS A STATED FIGURE (board.ts statesAmount): an amount, not a digit. Every pay line live on 2026-10-18
 * that states one is read; a count of hours, a contract length or a 13th month is not.
 */
describe('statesAmount — a pay line counts only when it holds an amount', () => {
  it('reads every pay line live on 2026-10-18 that states one — the two-digit dollar rate included', () => {
    for (const t of [
      '40,000,000 VND / month', '500,000 VND / hour', '600,000 - 650,000 VND before tax/ hour', '45,000,000 VND NET/Month',
      'USD 1,900 – 2,350 per month (gross)', 'Negotiation (from 2000$)', '$1400-$1600',
      'Up to 60.000.000 VND/ month, based on experience and qualifications', '2,350 USD / month', '550,000 VND / month',
      '470,000 VND / hour', '18-22$/hour',
    ]) expect(statesAmount(t), t).toBe(true)
  })

  it('reads the other ways a posting writes one: currencies, magnitude words, rates, grouped thousands', () => {
    for (const t of [
      '35M VND/month', '450k/hour', '20 - 25 triệu/tháng', '15tr - 20tr', 'Up to 35M', 'US$25 per hour', '€18 an hour', '25/hour',
      '25 an hour', '800 per hour', '1,200/mo', '15.000.000/tháng', '500.000đ/giờ', '1.5 million VND', '35,000,000 - 45,000,000',
      'Lương 12.000.000',
    ]) expect(statesAmount(t), t).toBe(true)
  })

  it('a bare number is no amount — nor is a line with none', () => {
    for (const t of [
      'Competitive + 13th month bonus', '12 months contract', '40 hours/week', 'Up to 25 teaching hours per week', '1 month paid holiday',
      '100 teaching hours per month', '365 days of insurance', 'Start date: August 2026', 'Class size 15-20', '2 flights a year',
      'Competitive', 'Competitive guaranteed salary', 'Thương lượng', 'Negotiable', 'Thỏa thuận VND / month',
      // Ungrouped, with no currency, magnitude word or rate: dollars or something else — a year has four digits too.
      'Salary 1200-1500',
    ]) expect(statesAmount(t), t).toBe(false)
  })

  it('reads the magnitude words mil, mln and million(s) — and nghìn — with a currency or without', () => {
    for (const t of [
      '30-40 mil VND/month', '12-15 mil/month', '35 Mil', '25 mln VND', '25 millions VND', '1.5 million VND', '2 million', '150 nghìn đồng/giờ',
      '500 ngàn/giờ', '15 trieu/thang', '20-25 trieu', '500 nghin/gio', '450 ngan/gio',
    ]) {
      expect(statesAmount(t), t).toBe(true)
    }
    // A bare m or k before a digit or a ² is a floor area, not millions (review, 2026-10-19).
    for (const t of ['Apartment 45m² near the school', 'Room 50m2 provided']) expect(statesAmount(t), t).toBe(false)
  })

  it('⛔ a đồng figure counts only from four digits, grouped or not, or with a magnitude word — a TEAST "1 VND / month" is no pay', () => {
    // Below four digits, before or after the sign, as a rate too: the first two were TEAST pay lines (board.ts).
    for (const t of ['1 VND / month', '50 VND / month', '500 VND', '999 vnđ', '₫50', 'VND 500', 'VND 50/hour', '₫50/giờ', '50đ/giờ', '50 đồng/giờ', '450 dong']) {
      expect(statesAmount(t), t).toBe(false)
    }
    // ⚠️ The LINE's currency decides (review, 2026-10-18): a range's second figure, a colon or a dash after the sign, a
    // sign after the rate or in brackets, extra spaces — none lets a short figure through as a bare rate.
    for (const t of [
      'VND 50-60/hour', '₫500-800/giờ', 'VND: 50/hour', 'VND - 50/month', 'VND — 50/month', 'đ50/giờ', 'VND  50/hour', '₫  50/giờ', '50/hour VND',
      '500/giờ VNĐ', 'Lương (VNĐ): 500/giờ', 'VNÐ 50/hour',
    ]) {
      expect(statesAmount(t), t).toBe(false)
    }
    // A year in a đồng line is no đồng figure: four ungrouped digits count only against the sign or as a rate.
    for (const t of ['Salary negotiable in VND for the 2026 intake', 'VND, 2026/27 intake']) expect(statesAmount(t), t).toBe(false)
    for (const t of [
      '1,500 VND', '1500 VND', 'VND 1500', '5000đ', '₫1.200', '500.000 đồng', '9000 dong', '50k VND', '1,5 triệu', '30 mil VND',
      '15 000 000 VND', '1 500 000 đ', '1  500 VND', 'VND 15 000 000', 'VND 5000/hour', '500,000 - 560,000 VND', 'VNÐ 15.000.000',
      'VND: 15000000', 'Lương (VNĐ): 15000000', 'Lương (VNĐ/tháng): 15000000', '15000000 (VNĐ)', '15000000 đồng', '15000000/tháng VND',
      'Từ 15000000 đến 20000000 VND', 'VND 5000', '5000/giờ VND',
    ]) {
      expect(statesAmount(t), t).toBe(true)
    }
    // "Đồng" alone is no đồng sign — it is also hợp đồng (a contract) and Đồng Nai — nor is a place named Dong: a bare
    // rate beside either still counts, as anywhere else.
    for (const t of ['Hợp đồng 12 tháng, 25/hour', 'Dong Nai: 25/hour']) expect(statesAmount(t), t).toBe(true)
  })

  it('keeps the two-digit dollar and euro figures, written as hourly rates or not', () => {
    for (const t of [
      '18-22$/hour', '$25/hour', 'US$25 per hour', '25 USD/hour', 'USD 20 an hour', '€18 an hour', '20 EUR per hour', '£15/hr', '25 euros/hour',
      '25 dollars an hour', '25 pounds/hour', '20 đô/giờ',
    ]) {
      expect(statesAmount(t), t).toBe(true)
    }
  })

  it('a pay line in đồng below four digits is neither printed nor counted — and one in "mil" is both', () => {
    const placeholder = linked('einstein', 'Hồ Chí Minh', 'TEAST', 'Einstein School HCM', 'ESL Teacher', '1 VND / month', '2026-10-26')
    const mil = linked('mil', 'Hà Nội', 'TEAST', 'Sentia', 'Lead Teacher', '30-40 mil VND/month', '2026-10-26')
    expect(jobLine(toBoardJob(placeholder, NOW)!)).toBe('Einstein School HCM · Apply by 26 Oct 2026 · via TEAST')
    expect(toBoardJob(mil, NOW)!.pay).toBe('30-40 mil VND/month')
    const competitive = linked('c', 'Hà Nội', 'TEAST', 'Dong Tay Education', 'ESL Teacher', 'Competitive', '2026-10-26')
    expect(sentence([placeholder, mil, competitive])).toContain(' 1 of the 3 postings states a figure for the pay.')
    expect(sentence([placeholder, competitive])).toContain(' None states a figure for the pay.')
  })
})
