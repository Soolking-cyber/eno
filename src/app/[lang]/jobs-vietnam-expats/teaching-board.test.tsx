// @vitest-environment jsdom
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { seoLandingWhere } from '@/components/marketplace/seo-landing-where'
import { TEACHING_JOB_WHERE } from '@/lib/teachers/match-io'
import { LANDING_TARGET } from './landing-target'
import type { BoardRow } from './board'

// The page's reads, captured: the board's rows (findMany) and /c/teachers' count (category-data.ts). The scope is
// wrapped, not applied, so a test can see the read went through it.
const h = vi.hoisted(() => ({ rows: [] as unknown[], fail: null as Error | null, findArgs: [] as unknown[], countArgs: [] as unknown[] }))
vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      findMany: async (args: unknown) => {
        h.findArgs.push(args)
        if (h.fail) throw h.fail
        return h.rows
      },
      count: async (args: unknown) => {
        h.countArgs.push(args)
        return 0
      },
    },
  },
}))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (where: unknown) => ({ scoped: where }) }))
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))

const { loadTeachingBoard, TeachingJobsBoard } = await import('./teaching-board')
const { TEACHING_JOBS, loadTeachingJobsCount } = await import('@/app/[lang]/c/[category]/category-data')

/**
 * THE TEACHING JOBS BOARD AS THE PAGE DRAWS IT (teacher visibility plan B2): the rows read with the page's own narrowing,
 * each a crawlable link to its listing page under its city's section, the summary linking those sections — and nothing
 * at all when there is nothing to list. What the words say is board.test.ts; this is the markup and the read.
 */

const NOW = Date.parse('2026-10-18T13:00:00Z') // 20:00 on 18 October in Vietnam

const row = (id: string, city: string, employer: string, title: string, salaryText: string, applyBy: string): BoardRow => ({
  id, city, title: `${title} — ${employer}`, price: 0, priceUnit: 'VND/month', currency: '₫',
  attributes: JSON.stringify({ employer, salaryText, applyBy, source: 'TEAST' }),
  affiliateUrl: `https://teast.co/job/${id}`, seller: { name: 'TEAST' },
})

// Newest first, as read: a Hanoi job, then a Ho Chi Minh City one.
const HANOI = row('hn-1', 'Hà Nội', 'Korea Global School', 'Psychology Teacher (Cambridge, AP), Hanoi', '60,000,000 VND / month', '2026-10-26')
const HCMC = row('hcm-1', 'Hồ Chí Minh', 'Power English', 'ESL Teacher at Public School in Ho Chi Minh City', '40,000,000 VND / month', '2026-10-21')
const CLOSED = row('closed', 'Hồ Chí Minh', 'Byan Teach', 'Part-time ESL Teachers', '470,000 VND / hour', '2026-10-17')

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html')

afterEach(() => {
  h.rows = []
  h.fail = null
  h.findArgs = []
  h.countArgs = []
  vi.unstubAllEnvs()
})

describe('<TeachingJobsBoard>', () => {
  it('draws each job as a link to its listing page, under its city’s section, in page order', async () => {
    h.rows = [HANOI, HCMC]
    const board = await loadTeachingBoard(NOW)
    expect(board).toMatchObject({ known: true, day: '2026-10-18' })
    const doc = parse(renderToString(<TeachingJobsBoard board={board} />))

    expect([...doc.querySelectorAll('section[id]')].map((s) => s.id)).toEqual(['ho-chi-minh-city', 'hanoi', 'da-nang', 'elsewhere-in-vietnam'])
    expect([...doc.querySelectorAll('section a[href^="/listings/"]')].map((a) => a.getAttribute('href'))).toEqual(['/listings/hcm-1', '/listings/hn-1'])
    const hanoi = doc.querySelector('section#hanoi a[href="/listings/hn-1"]')
    expect(hanoi?.textContent).toContain('Psychology Teacher (Cambridge, AP), Hanoi')
    expect(hanoi?.textContent).toContain('Korea Global School · 60,000,000 VND / month · Apply by 26 Oct 2026 · via TEAST')
    // Each section is labelled by its heading, which names the city.
    expect(doc.querySelector('section#hanoi')?.getAttribute('aria-labelledby')).toBe('hanoi-title')
    expect(doc.getElementById('hanoi-title')?.textContent).toBe('Teaching jobs in Hanoi')
    // A section with no job says so instead of dropping its heading.
    expect(doc.querySelector('section#da-nang')?.textContent).toContain('No teaching job in Da Nang is listed on this page.')
  })

  it('opens with the dated summary, whose places link to sections that exist on the page', async () => {
    h.rows = [HANOI, HCMC]
    const doc = parse(renderToString(<TeachingJobsBoard board={await loadTeachingBoard(NOW)} />))
    const summary = doc.querySelector('p')!
    expect(summary.textContent).toMatch(/^On 18 Oct 2026, this page listed 2 teaching job postings: 1 in Ho Chi Minh City and 1 in Hanoi\. /)
    const links = [...summary.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])
    expect(links).toEqual([['Ho Chi Minh City', '#ho-chi-minh-city'], ['Hanoi', '#hanoi']])
    for (const [, href] of links) expect(doc.getElementById(href!.slice(1))?.tagName).toBe('SECTION')
  })

  it('draws nothing when the read could not look, found nothing, or found only rows the board leaves out', async () => {
    for (const board of [{ known: false, jobs: [], day: '2026-10-18' }, { known: true, jobs: [], day: '2026-10-18' }]) {
      expect(TeachingJobsBoard({ board })).toBeNull()
      expect(renderToString(<TeachingJobsBoard board={board} />)).toBe('')
    }
    h.rows = [CLOSED]
    const closedOnly = await loadTeachingBoard(NOW)
    expect(closedOnly).toEqual({ known: true, jobs: [], day: '2026-10-18' })
    expect(TeachingJobsBoard({ board: closedOnly })).toBeNull()
  })
})

describe('loadTeachingBoard', () => {
  it('reads with the page’s own narrowing, through the edition scope, newest first', async () => {
    await loadTeachingBoard(NOW)
    expect(h.findArgs).toHaveLength(1)
    expect(h.findArgs[0]).toMatchObject({ where: { scoped: seoLandingWhere(LANDING_TARGET) }, orderBy: [{ postedAt: 'desc' }, { id: 'asc' }] })
  })

  it('dates the board by the Vietnamese calendar day of the read', async () => {
    // 01:30 on 19 October in Vietnam is still the 18th in UTC.
    expect((await loadTeachingBoard(Date.parse('2026-10-18T18:30:00Z'))).day).toBe('2026-10-19')
  })

  it('⛔ a failed read at runtime THROWS — the ISR regeneration fails and the last good page keeps being served', async () => {
    h.fail = new Error('connection refused')
    await expect(loadTeachingBoard(NOW)).rejects.toThrow('connection refused')
  })

  it('…and only while `next build` prerenders is it "could not look" — never "no jobs"', async () => {
    h.fail = new Error('no database at build time')
    vi.stubEnv('NEXT_PHASE', 'phase-production-build')
    await expect(loadTeachingBoard(NOW)).resolves.toEqual({ known: false, jobs: [], day: '2026-10-18' })
  })
})

/**
 * ⚠️ THREE READERS OF JOBS › TEACHING, TIED HERE RATHER THAN BY HAND (landing-target.ts explains the choice). The board
 * IS the teacher matcher's job set; /c/teachers' "Jobs › Teaching (N)" keeps every listing type, because its count is
 * what its link opens — the explorer's whole aisle — so the two differ by Wanted ads filed under Teaching and nothing
 * else. A change on any side fails one of these.
 */
describe('the board’s job set, against the other readers of Jobs › Teaching', () => {
  it('is the teacher matcher’s job set exactly (teachers/match-io.ts TEACHING_JOB_WHERE)', () => {
    expect(seoLandingWhere(LANDING_TARGET)).toEqual(TEACHING_JOB_WHERE)
  })

  it('is /c/teachers’ aisle (category-data.ts TEACHING_JOBS, loadTeachingJobsCount) less the listing type', async () => {
    expect(TEACHING_JOBS).toEqual({ category: LANDING_TARGET.categorySlug, subcategory: LANDING_TARGET.subcategorySlug })
    await loadTeachingJobsCount()
    const { listingType, ...aisle } = seoLandingWhere(LANDING_TARGET)
    expect(listingType).toBe('job')
    expect(h.countArgs).toEqual([{ where: { scoped: aisle } }])
  })
})
