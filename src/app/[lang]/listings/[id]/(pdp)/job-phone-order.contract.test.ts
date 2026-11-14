import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as JOB from '@/lib/job-sheet'
import { PAGE_TITLE } from '@/lib/rental-sheet'

/**
 * ⛔ A LINKED JOB'S PAGE ON A PHONE (owner-approved 2026-11-14, cook r06 jobs; src/lib/job-sheet.ts has the page). Server markup on
 * a page that needs a database, so it is pinned as a source contract: the phone order is the DOM order, every phone-only copy is
 * `md:hidden` while its original is `max-md:hidden` (one per width), the wrappers are `md:contents` (md+ is today's), and the page
 * keeps one <h1>, one ContactComposer and one AffiliateBooking (one [data-affiliate-cta]).
 */
const ROOT = process.cwd()
/** The page without comments, so a rule cannot be satisfied (or broken) by prose. */
const PAGE = readFileSync(join(ROOT, 'src/app/[lang]/listings/[id]/(pdp)/page.tsx'), 'utf8')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const at = (needle: string, from = 0) => { const i = PAGE.indexOf(needle, from); expect(i, needle).toBeGreaterThan(-1); return i }
const list = (s: string) => s.split(' ')

describe('the constants: phone-only, or exactly md+ today', () => {
  it('every class is max-md:, md:hidden, md:contents, or an md:/sm: reset of today\'s paint', () => {
    const allowed = /^(?:max-md:|md:|sm:)/
    const phoneOnlyBoxes = [JOB.JOB_EMPLOYER, JOB.JOB_TAGS, JOB.JOB_TITLE_ACTIONS, JOB.JOB_COUNSEL_INFO, JOB.JOB_LINES]
    for (const c of phoneOnlyBoxes) expect(list(c)).toContain('md:hidden')
    for (const c of [JOB.JOB_TITLE_LINE, JOB.JOB_TITLE_CELL, JOB.JOB_APPLY_ROW, JOB.JOB_APPLY_CELL]) expect(list(c)).toContain('md:contents')
    for (const c of [JOB.JOB_HEADER, JOB.JOB_PRICE_ROW, JOB.JOB_META, JOB.JOB_META_GLYPH, JOB.JOB_COUNSEL, JOB.JOB_COUNSEL_STRIP]) {
      for (const x of list(c)) expect(x).toMatch(allowed)
    }
  })
  it('the H1: the display role below sm, PAGE_TITLE\'s sm paint from sm (24px, leading-tight, no tracking)', () => {
    expect(list(JOB.JOB_TITLE)).toEqual(expect.arrayContaining(['text-t-display', 'font-bold', 'sm:text-2xl', 'sm:leading-tight', 'sm:tracking-normal', '[overflow-wrap:anywhere]']))
    expect(list(PAGE_TITLE)).toEqual(expect.arrayContaining(['sm:text-2xl', 'sm:leading-tight', 'font-bold']))
    expect(JOB.JOB_TITLE).not.toMatch(/truncate|line-clamp/)
  })
  it('the pay: the section role below md, today\'s 30px (and 24px for the posting\'s own words) from md', () => {
    expect(list(JOB.JOB_PRICE)).toEqual(['text-t-h2', 'md:text-3xl', 'md:tracking-tight'])
    expect(list(JOB.JOB_SALARY_TEXT)).toEqual(expect.arrayContaining(['text-t-h2', 'md:text-2xl', 'md:font-bold', 'md:tracking-tight']))
  })
})

describe('the head: role + Share → employer → pay → place → tags (DOM order = phone order)', () => {
  it('the job header row is kept (e2e counts it) and is md+ only on a linked job, first there', () => {
    expect(PAGE).toContain("<div data-job-header className={cn('flex items-center justify-between gap-2', isJob && JOB_HEADER)}>")
    expect(JOB.JOB_HEADER).toBe('max-md:hidden md:order-first')
  })
  it('one H1 (LocalizedTitleHeading), rendered once through `headH1`, inside the role\'s line on a job', () => {
    expect(PAGE.match(/<LocalizedTitleHeading className=/g)).toHaveLength(1)
    expect(PAGE).toMatch(/<div className=\{JOB_TITLE_LINE\}>\s*<div className=\{JOB_TITLE_CELL\}>\{headH1\}<\/div>\s*<div className=\{JOB_TITLE_ACTIONS\}>\s*<ShareButton url=\{canonicalUrl\} title=\{displayTitle\} shape="round" \/>\s*<OwnerEditButton /)
  })
  it('the header block\'s children in order: job header, the sheet\'s title, the role\'s line, the pay row (md:order-first), the facts, the tags', () => {
    const block = at("<div className={cn('order-3 flex flex-col gap-2', goodsSheet && GOODS_HEAD)}>")
    const order = [
      at('<div data-job-header ', block),
      at('{rentalSheet && headTitle}', block),
      at('{jobTitleLine}', block),
      at('{priceBlock && (', block),
      at('{!rentalSheet && !isJob && headTitle}', block),
      at('{isJob && headFacts}', block),
      at('{jobTags}', block),
    ]
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(PAGE).toContain("<div className={cn('flex flex-col gap-1.5', rentalSheet && SHEET_PRICE_ROW, goodsSheet && GOODS_PRICE_ROW, isJob && JOB_PRICE_ROW)}>")
  })
  it('the employer line: the storefront row\'s own call with `head`, md:hidden — and the phone band is not drawn for a job', () => {
    expect(PAGE).toMatch(/<PdpShopLink [^\n]* linked=\{linkedSeller\} [^\n]* head className=\{JOB_EMPLOYER\} \/>/)
    expect(PAGE).toMatch(/\{!isJob && \(\s*<div className=\{rentalSheet \? HOST_CARD_SLOT : goodsSheet \? GOODS_BAND : HOST_BAND\}>/)
    expect(PAGE).toMatch(/<div className="order-7 hidden md:block">\s*<PdpShopLink /)
  })
  it('the tags are the Details rows themselves (no second label or value logic), and the table steps down below md', () => {
    expect(PAGE).toMatch(/const jobTags = isJob && showDetails \? \(\s*<div className=\{JOB_TAGS\}>\s*<h2 className="sr-only"><Tr text="Details" \/><\/h2>\s*<dl className=\{JOB_TAG_ROWS\}>\{detailsRows\}<\/dl>/)
    expect(PAGE).toContain("<div className={cn('space-y-2', goodsSheet || isJob ? 'max-md:hidden' : sectionLine(rentalSheet), rentalSheet && SHEET_HEAD_GAP)}>")
    expect(JOB.JOB_TAG_ROWS).toContain("[&_dt]:after:content-[':']")
  })
})

describe('the action and the counsel', () => {
  it('Save beside Apply, OUTSIDE the guard (it stays beside the closed notice); one AffiliateBooking, one ContactComposer', () => {
    expect(PAGE).toMatch(/<JobApplyRow job=\{isJob\} save=\{<SaveListingButton id=\{listing\.id\} shape="square" className="md:hidden" \/>\}><JobApplyGuard applyBy=\{jobApplyBy\}>/)
    expect(PAGE).toContain('</JobApplyGuard></JobApplyRow>')
    expect(PAGE.match(/<AffiliateBooking\b/g)).toHaveLength(1)
    expect(PAGE.match(/<ContactComposer\b/g)).toHaveLength(1)
    const row = readFileSync(join(ROOT, 'src/components/marketplace/job-apply-row.tsx'), 'utf8')
    expect(row).toContain('if (!job) return <>{children}</>')
    expect(row).toMatch(/<div className=\{JOB_APPLY_ROW\}>\s*<div className=\{JOB_APPLY_CELL\}>\{children\}<\/div>\s*\{save\}\s*<\/div>/)
  })
  it('one counsel panel: the safety block, Seller information\'s phone copy first (its own id), the left-column copy max-md:hidden', () => {
    const open = at("<div data-safety-block=\"\" className={cn('order-9 md:order-7', goodsSheet && (sellerInfoShown ? COUNSEL_WELL_JOINED : COUNSEL_WELL_ALONE), isJob && JOB_COUNSEL)}>")
    const info = at('{isJob && sellerInfo && <SellerInfo info={sellerInfo} labelId="seller-info-job" panel className={JOB_COUNSEL_INFO} />}', open)
    expect(info).toBeLessThan(at('<SafetyStrip', open))
    expect(PAGE).toContain("{sellerInfo && <SellerInfo info={sellerInfo} className={cn('order-8', goodsSheet ? COUNSEL_INFO : sectionLine(rentalSheet), isJob && 'max-md:hidden')} sheet={rentalSheet} panel={goodsSheet} />}")
    expect(PAGE.split('data-safety-block=""').length - 1).toBe(1)
  })
  it('the slot-8 column below md: the repeat Apply after the panel (max-md:order-10), or nothing', () => {
    expect(PAGE).toContain("isJob && (repeatCta ? 'max-md:order-10' : 'max-md:hidden')")
  })
})

describe('the end of the page', () => {
  it('the rails 32px apart below md, the page\'s employer handed to the seller rail', () => {
    expect(PAGE).toContain("sectionClassName={goodsSheet ? cn(GOODS_SHELF_GAP, sellerShelfLast && 'max-sm:hidden') : isJob ? JOB_SHELF_GAP : undefined} hideEmployerNamed={isJob ? listing.seller.name : undefined} />")
    expect(PAGE).toMatch(/<RelatedListings\b[^]*?sectionClassName=\{isJob \? JOB_SHELF_GAP : undefined\}\s*\/>/)
  })
  it('the question lines: max-md:hidden in their slot on a job, an md:hidden copy after the rails, before </main>', () => {
    expect(PAGE).toContain("className={cn('order-12 flex items-start gap-2 text-sm', isJob && 'max-md:hidden')}")
    expect(PAGE).toContain("<div className={cn('order-12 space-y-3', isJob && 'max-md:hidden')}>")
    const twin = at('<div className={JOB_LINES}>')
    expect(twin).toBeGreaterThan(at('<RecentlyViewedRail '))
    expect(twin).toBeLessThan(at('</main>'))
    expect(PAGE.match(/<SchoolLinkForJob\b/g)).toHaveLength(2)
    const link = readFileSync(join(ROOT, 'src/components/schools/school-link-for-job.tsx'), 'utf8')
    expect(link).toMatch(/const schoolFor = cache\(\(employer: unknown, sellerId: string, city: string \| null\) => schoolForJob\(employer, sellerId, \{ city \}\)\)/)
  })
})

describe('the explorer keeps its ruled rows (not a judged surface)', () => {
  it('listings-explorer.tsx draws CompactListingRow in JOB_ROWS_RULED, never the job card', () => {
    const explorer = readFileSync(join(ROOT, 'src/components/marketplace/listings-explorer.tsx'), 'utf8')
    expect(explorer).toMatch(/JOB_ROWS_RULED/)
    expect(explorer).toMatch(/CompactListingRow/)
    expect(explorer).not.toMatch(/JobCardRow|job-card-row/)
  })
})
