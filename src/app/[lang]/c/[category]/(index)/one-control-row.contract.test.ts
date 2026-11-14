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
      "<h1 className={cn('h-display text-foreground max-sm:truncate max-sm:py-0.5 max-sm:[--text-display:var(--text-title)]', cat.slug === 'rentals' && 'max-sm:sr-only')}>",
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

  it('the phone block is the FIRST thing the page returns, inside the count provider only where the count moves', () => {
    expect(page).toContain('const CountScope = rentalsStrip ? HeadingCountProvider : Fragment')
    expect(page).toMatch(new RegExp([
      String.raw`return \(\s*<CountScope>\s*`,
      String.raw`\{cat\.slug === 'rentals' && \(\s*<div className="sm:hidden">\s*`,
      String.raw`\{rentalsStrip && <HeadingCount seed=\{\{ shown: listings\.length, total: ([^}]+) \}\} \/>\}\s*`,
      String.raw`<RentalsPhoneHeading headline=\{headline\} name=\{cat\.name\} nameVi=\{cat\.nameVi\} className="h-display truncate py-0\.5 text-foreground \[--text-display:var\(--text-title\)\]" \/>\s*`,
      String.raw`<CategoryLedeLinks slug=\{cat\.slug\} \/>\s*<\/div>\s*\)\}\s*`,
      String.raw`\{LEDE_PLACEMENT === 'page' && `,
    ].join('')))
    expect(page).toMatch(/<\/CountScope>\s*\)\s*\}\s*$/)
  })

  it('the seed total IS serverScope.total, the same expression (SSR = the first client render)', () => {
    const seed = page.match(/<HeadingCount seed=\{\{ shown: listings\.length, total: ([^}]+) \}\} \/>/)?.[1]
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
      '{rentalsStrip ? <div aria-hidden className="mt-4 border-t border-border max-sm:hidden sm:mt-5" /> : <div aria-hidden className="mt-4 border-t border-border sm:mt-5" />}',
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
    expect(block).toContain('<CategoryMapChip slug={cat.slug} homesOnly={!!homes} lang={pageLang(lang)} className={STRIP_CHIP} />')
    expect(block).toContain('{districts.map((d) => (')
    expect(block).toContain('<Badge key={d.slug} size="md" interactive render={<Link href={`/c/${cat.slug}/${d.slug}`} prefetch={false} />} className={STRIP_CHIP}>')
    expect(block).toContain('<PlaceName en={d.label.en} vi={d.label.vi} />')
    expect(block).toMatch(/\) : null,\s*\} : undefined\}\s*$/)
    // The strip chip is the browse chip with Filters' resting look (one chip style, owner 2026-10-18).
    expect(page).toContain("const STRIP_CHIP = cn(PILL_BOX, PILL_REST, 'gap-1.5 py-0 hover:bg-accent hover:text-accent-foreground')")
  })
})
