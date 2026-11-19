import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ⛔ /c/rentals ON A PHONE: ONE CONTROL ROW (UI climb batch 93, owner decision 5, 2026-11-14). The area chips join the
 * Relevance + Filters row, "By area:" and "All" go, and the count moves to the end of the heading line — below sm, on
 * /c/rentals only, and only while the sort strip renders. Server markup on a page that needs a database to render, so it is
 * pinned as a source contract, like first-screen-contract.test.ts: each rule names the line that carries it.
 *
 * ⚠️ THE LAYOUT NOW LEANS ON THE PAGE. On rentals the layout's H1 is `max-sm:sr-only` and its check line `max-sm:hidden`;
 * (index)/page.tsx paints the phone's heading line (with the count) and its check line. That holds only while the page is
 * the ONE route this layout wraps and nothing renders in its place: the first rule fails the day another route, a nested
 * segment or a boundary file (error / not-found / loading / template…) lands in (index)/.
 */
const IDX = join(process.cwd(), 'src/app/[lang]/c/[category]/(index)')
/** The source without comments, so a rule cannot be satisfied (or broken) by prose. */
const code = (f: string) =>
  readFileSync(join(IDX, f), 'utf8').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const layout = code('layout.tsx')
const page = code('page.tsx')
const at = (s: string, needle: string) => { const i = s.indexOf(needle); expect(i, needle).toBeGreaterThan(-1); return i }

describe('(index)/ holds one route, so the layout may lean on it', () => {
  it('page.tsx and layout.tsx are its only route files, and it has no nested segment', () => {
    const entries = readdirSync(IDX, { withFileTypes: true })
    expect(entries.filter((e) => e.isDirectory()).map((e) => e.name)).toEqual([])
    const special = /^(?:page|layout|route|default|error|global-error|not-found|forbidden|unauthorized|loading|template)\.(?:tsx|ts|jsx|js|mdx)$/
    expect(entries.filter((e) => special.test(e.name)).map((e) => e.name).sort()).toEqual(['layout.tsx', 'page.tsx'])
  })
})

describe('the layout: the H1 and the check line stand down on a rentals phone', () => {
  it('the H1 is sr-only below sm on rentals (the pinned first argument unchanged)', () => {
    expect(layout).toContain(
      // A goods category takes the teachers' wrapping display H1 (owner-approved 2026-11-14, cook r06 goods); rentals keeps the pin.
      "<h1 className={cn(cat.slug === TEACHERS_CATEGORY_SLUG || isGoodsCategory(cat.slug) ? 'h-display text-balance text-foreground' : 'h-display text-foreground max-sm:truncate max-sm:py-0.5 max-sm:[--text-display:var(--text-title)]', cat.slug === 'rentals' && 'max-sm:sr-only', cat.slug === 'jobs' && 'max-sm:sr-only')}>",
    )
  })

  it('it no longer paints the short phone line, and the rentals check line is max-sm:hidden in a box-less wrapper', () => {
    expect(layout).not.toMatch(/RentalsHeadingShort|rentalsHeadlineHasShortForm/)
    expect(layout).toContain(
      "{cat.slug === 'rentals' ? <div className=\"max-sm:hidden\"><CategoryLedeLinks slug={cat.slug} /></div> : <CategoryLedeLinks slug={cat.slug} />}",
    )
  })

  it('it still awaits no count (crawler contract) and knows nothing of the heading count', () => {
    expect(layout).not.toMatch(/\b(?:loadCategory|loadRentalsFacts|loadLinkedCount|loadDistrictChips)\s*\(|\.(?:count|groupBy|findMany|aggregate)\s*\(|\bdb\.|HeadingCount/)
  })
})

describe('the page: the phone heading line, the gates, the strip', () => {
  it('the two gates: the strip exactly when `sortable` draws it over a grid, the areas when there are some', () => {
    expect(page).toContain("const rentalsStrip = cat.slug === 'rentals' && listings.length > 0 && (homes?.total ?? total) > 1")
    expect(page).toContain('const rentalsAreas = rentalsStrip && districts.length > 0')
    // The same expression the grid's `sortable` reads, so the strip and the gate cannot part.
    expect(page).toContain('sortable={(homes?.total ?? total) > 1}')
  })

  // ⛔ ONE DISPLAY LINE since 2026-11-14 (owner-approved, cook r06 rentals-a): the heading at the display role, then the count
  // as a flex sibling on its baseline — DOM order = visual order (it was a float BEFORE the heading, at the title step).
  it('the phone block is the FIRST thing the page returns, inside the count provider only where the count moves', () => {
    expect(page).toContain('const CountScope = rentalsStrip ? HeadingCountProvider : Fragment')
    expect(page).toMatch(new RegExp([
      String.raw`return \(\s*<CountScope>\s*`,
      String.raw`\{cat\.slug === 'rentals' && \(\s*<div className="sm:hidden">\s*`,
      String.raw`<div className="flex items-baseline gap-3">\s*`,
      String.raw`<RentalsPhoneHeading headline=\{headline\} name=\{cat\.name\} nameVi=\{cat\.nameVi\} className="min-w-0 flex-1 truncate py-0\.5 text-t-display text-foreground" \/>\s*`,
      String.raw`\{rentalsStrip && <HeadingCount seed=\{\{ total: ([^}]+) \}\} \/>\}\s*`,
      String.raw`<\/div>\s*`,
      // ⛔ Build 7 (owner-approved 2026-11-15, cook r07 rentals): under the heading only with no row; with the row it is the
      // list's own header under it (`listHead`, below).
      String.raw`\{!rentalsStrip && <CategoryLedeLinks slug=\{cat\.slug\} \/>\}\s*<\/div>\s*\)\}\s*`,
      String.raw`\{LEDE_PLACEMENT === 'page' && `,
    ].join('')))
    expect(page).toMatch(/<\/CountScope>\s*\)\s*\}\s*$/)
  })

  it('/c/rentals asks SellerListings for the one-column phone grid, and only rentals does', () => {
    expect(page.match(/phoneWide=/g)).toHaveLength(1)
    expect(page).toContain("phoneWide={cat.slug === 'rentals'}")
    // `sortable` stays the LAST prop (teaching-links.test reads the call by it).
    expect(at(page, "phoneWide={cat.slug === 'rentals'}")).toBeLessThan(at(page, 'sortable={(homes?.total ?? total) > 1}'))
  })

  it('the seed total IS serverScope.total, the same expression (SSR = the first client render)', () => {
    // The seed is the total alone since build 7 (the heading line says "5,344 listings", heading-count.tsx headingCountText).
    const seed = page.match(/<HeadingCount seed=\{\{ total: ([^}]+) \}\} \/>/)?.[1]
    const scope = page.match(/serverScope=\{\{[\s\S]*?\n\s*total: ([^,\n]+),/)?.[1]
    expect(seed).toBe('homes?.total ?? rentals?.total ?? total')
    expect(scope).toBe(seed)
  })

  it('the headline is the cached loader the layout and the title read, beside the other reads', () => {
    expect(page).toMatch(/const \[raw, otherCatRows, chips, rentals, jobCities, teachingJobs, teacherRows, headline\] = await Promise\.all\(\[/)
    expect(page).toContain("cat.slug === 'rentals' ? loadRentalsHeadline(cat.id) : null,\n  ])")
  })

  it('below sm on rentals the "By area" row, its Map chip and the masthead hairline stand down; from sm they stay', () => {
    expect(page).toContain("<AreaChipsRow className={rentalsAreas ? 'max-sm:hidden' : undefined}>")
    expect(page).toContain('{!rentalsAreas && <CategoryMapChip slug={cat.slug} homesOnly={!!homes} lang={pageLang(lang)} />}')
    expect(page).toContain(
      // …and on /c/jobs over a grid (owner-approved 2026-11-14, cook r06 jobs: its heading line opens the list on a phone), and on
      // every goods category (owner-approved 2026-11-14, cook r06 goods: the wrapping H1 opens the list there).
      // …and on /c/teachers over a grid (owner-approved 2026-11-15, build 7 — cook r07 teachers).
      '{rentalsStrip || jobsPhoneHead || goods || (isTeachers && listings.length > 0) ? <div aria-hidden className="mt-4 border-t border-border max-sm:hidden sm:mt-5" /> : <div aria-hidden className="mt-4 border-t border-border sm:mt-5" />}',
    )
    // "By area:" and "All" stay in the row (from sm), and nowhere else.
    expect(page.match(/<Tr text="By area:" \/>/g)).toHaveLength(1)
    expect(page.match(/<Tr text="All" \/>/g)).toHaveLength(1)
  })

  it('the strip gets Map + every district as server <a> chips, only under rentalsStrip, before the last `sortable` prop', () => {
    const open = at(page, 'phoneOneRow={rentalsStrip ? {')
    expect(page.match(/phoneOneRow=/g)).toHaveLength(1)
    const sortable = at(page, 'sortable={(homes?.total ?? total) > 1}')
    expect(open).toBeLessThan(sortable)
    const block = page.slice(open, sortable)
    expect(block).toMatch(/chips: rentalsAreas \? \(/)
    // ⛔ Build 8 (owner-approved 2026-11-15, cook r08 rentals): the Map chip also carries the float look (map-float.ts MAP_FLOAT).
    expect(block).toContain('<CategoryMapChip slug={cat.slug} homesOnly={!!homes} lang={pageLang(lang)} className={STRIP_MAP_CHIP} glyphClassName="size-4.5" />')
    expect(block).toContain('{districts.map((d) => (')
    expect(block).toContain('<Badge key={d.slug} size="md" interactive render={<Link href={localizedHref(`/c/${cat.slug}/${d.slug}`, pageLang(lang))} prefetch={false} />} className={STRIP_CHIP}>')
    expect(block).toContain('<PlaceName en={d.label.en} vi={d.label.vi} />')
    // (/c/jobs' `phoneHead` sits between `phoneWide` and `sortable` since 2026-11-14, owner-approved, cook r06 jobs.)
    // …then the free-check line as the list's own header under the row (owner-approved 2026-11-15 (build 7), cook r07 rentals).
    expect(block).toMatch(/\) : null,\s*(?:\/\/[^\n]*\n\s*)*listHead: <CategoryLedeLinks slug=\{cat\.slug\} className="min-h-6" \/>,\s*\} : undefined\}\s*phoneWide=\{cat\.slug === 'rentals'\}\s*(?:\/\/[^\n]*\n\s*)*phoneHead=\{jobsPhoneHead \? \{[^]*?\} : undefined\}\s*$/)
    expect(page.match(/<CategoryLedeLinks /g)).toHaveLength(2)
    // The strip chip is the browse chip with Filters' resting look (one chip style, owner 2026-10-18).
    expect(page).toContain("const STRIP_CHIP = cn(PILL_BOX, PILL_REST, 'gap-1.5 py-0 hover:bg-accent hover:text-accent-foreground')")
    expect(page).toContain('const STRIP_MAP_CHIP = cn(STRIP_CHIP, MAP_FLOAT)')
    expect(page).toContain("import { MAP_FLOAT } from '@/components/marketplace/map-float'")
  })
})
