import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LANDING_TARGET } from '@/app/[lang]/jobs-vietnam-expats/landing-target'

/**
 * /jobs-vietnam-expats IS THE ENGLISH TEACHING JOBS BOARD (teacher visibility plan B2, 2026-10-18), at its old URL.
 *
 * ⚠️ A SOURCE SCAN, like seo-landing-related.test.ts: the page imports the database client through SeoLanding, so it
 * cannot be imported here. What the board SAYS is unit-tested in jobs-vietnam-expats/board.test.ts; this pins the
 * page around it — the title it is built for, what it must keep, and what it must never carry.
 */
const DIR = join(process.cwd(), 'src/app/[lang]/jobs-vietnam-expats')
const page = readFileSync(join(DIR, 'page.tsx'), 'utf8')
const board = readFileSync(join(DIR, 'teaching-board.tsx'), 'utf8')
const field = (name: string) => page.match(new RegExp(`\\n {2}${name}:\\s*'([^']*)'`))?.[1]

describe('/jobs-vietnam-expats — the English teaching jobs board', () => {
  it('is titled for the search it is built for: ≤ 60 characters on either site, and no number in it', () => {
    const title = page.match(/const TITLE = `([^`]*)`/)?.[1]
    expect(title).toBe('English Teaching Jobs in Vietnam | ${SITE_NAME}')
    for (const site of ['eno.vn', 'eno.forum']) expect(title!.replace('${SITE_NAME}', site).length).toBeLessThanOrEqual(60)
    // The <title> and the share title are that constant and nothing else (a live count would go stale in the cache).
    const metadata = page.slice(page.indexOf('const BASE_METADATA'), page.indexOf('\n}\n', page.indexOf('const BASE_METADATA')))
    expect(metadata.match(/\btitle: [^,\n]+/g)).toEqual(['title: TITLE', 'title: TITLE'])
  })

  it('says it in the H1 and the eyebrow', () => {
    expect(field('h1')).toBe('English teaching jobs in Vietnam')
    expect(field('eyebrow')).toBe('Teaching jobs · Vietnam')
  })

  it('lists every job on the board instead of an 8-card rail, read by the page’s own narrowing', () => {
    expect(page).toContain('inventory={{ known: board.known, count: board.jobs.length, node: <TeachingJobsBoard board={board} /> }}')
    expect(board).toContain('where: await scopedListingWhere(seoLandingWhere(LANDING_TARGET))')
    expect(LANDING_TARGET).toEqual({ categorySlug: 'jobs', subcategorySlug: 'teaching', listingType: 'job' })
    expect(page).not.toMatch(/railTitle/)
  })

  it('keeps the computed robots, the hourly ISR, the profile prompt, the guides (marketplace only) and the never-pay section', () => {
    expect(page).toContain('...(await seoLandingRobots(LANDING_TARGET))')
    expect(page).toMatch(/^export const revalidate = 3600$/m)
    expect(page).toContain(`lede={<TeacherProfileLink href={localizedHref('/teachers/join', lang)} className="mt-4" />}`)
    expect(page).toContain('content={IS_SERVICES ? CONTENT : { ...CONTENT, related: [...(CONTENT.related ?? []), ...teachLinks(TEACH_RELATED)] }}')
    expect(page).toContain("title: 'Never pay to get a job'")
  })

  // ⚠️ The page is ISR HTML served stale-while-revalidate, so its copy may promise no timing a stale copy breaks; and a
  // row opens the job's listing page, whose Apply button — not the row — opens the original posting (review, 2026-10-18).
  it('promises no timing a cached copy breaks, and sends the reader through the listing’s Apply button', () => {
    // The copy only (the comments above it quote the retired wording to say why it went).
    const copy = page.slice(page.indexOf('const CONTENT'), page.indexOf('\n}\n', page.indexOf('const CONTENT')))
    expect(copy).toContain('faqs: [')
    expect(copy).not.toMatch(/leaves this page once|is listed until|right now/)
    expect(copy).toContain('after that date, the job comes off this page the next time the page is updated.')
    expect(copy).toContain('and comes off the next time the page is updated after that.')
    expect(field('intro')).toMatch(/carries an apply-by date, and its Apply button opens the original posting, where you read the full ad and apply\.$/)
  })

  it('carries no JobPosting markup and no structured data beyond SeoLanding’s FAQ', () => {
    for (const src of [page, board]) expect(src).not.toMatch(/['"`]JobPosting['"`]|application\/ld\+json/)
    expect(page).not.toMatch(/\n {2}jsonLd:/)
  })

  it('⛔ carries none of the vocabulary eno.vn may not use — copy, comments, anything', () => {
    for (const src of [page, board]) expect(src).not.toMatch(/visa|\bTRC\b|residen|immigra|deport/i)
  })
})
