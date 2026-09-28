import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ⛔ A PAGE THAT SEARCH AND AI CRAWLERS MUST READ HAS NO SUSPENSE BOUNDARY AROUND ITS CONTENT — not a
 * `loading.tsx`, not an in-page `<Suspense>`. Either one hides the content from anything that reads
 * the HTML without running JavaScript, even when the data is cached and nothing is slow.
 *
 * THE RULE (read in the React that Next 16.3.6 bundles, 19.3.0-canary-cbb046ab-20260731, in
 * `node_modules/next/dist/compiled/react-dom/cjs/react-dom-server.node.production.js`): a FINISHED
 * Suspense boundary over 500 B is moved out of place into `<div hidden id="S:…">` at the end of the
 * body whenever the shell's bytes plus that boundary's exceed 12,800 B. `isEligibleForOutlining`
 * (:4097-4104) is the 500 B floor, `progressiveChunkSize` defaults to 12800 (:4155), the size check is
 * at :6975-6979, and the count starts at the WHOLE shell's size, not at the bytes sent so far
 * (`flushedByteSize = request.byteSize`, :7142). The page shell alone is far past 12.8 KB, so on these
 * pages it is always true: cached HTML and bots included. The fallback stays in place and an inline
 * script swaps the real content in once it has all arrived.
 *
 * ⚠️ MEASURED ON THE LISTING PAGE BEFORE SEO WAVE B, H1a (2026-09-28), with the segment's
 * `loading.tsx` in place: Googlebot, OAI-SearchBot, PerplexityBot and bingbot, in English and
 * Vietnamese, all got the H1 under `[hidden]`, the header and `<main>` twice, and as visible text only
 * the skeleton's header and footer (a Nhatot rental: 249 words visible, 745 hidden). The skeleton
 * bought no earlier first byte either: a cold ISR render arrived complete 1-5 ms after its first
 * byte. H1a deleted `listings/[id]/(pdp)/loading.tsx`; this file keeps a `loading.*` from coming back
 * anywhere on the way down to the page (edition suffixes included), any `Suspense` from appearing in
 * the segment's own files, and one from wrapping `{children}` in the `[lang]` layout, template or
 * providers.
 * ⚠️ IT CANNOT SEE A BOUNDARY DEEPER DOWN, in a component the page renders. Only the served HTML shows
 * that: no `div[hidden][id^="S:"]` and no words under `[hidden]` on a listing page.
 *
 * ⚠️ NOT EVERY BOUNDARY IS OUTLINED. A `next/dynamic` import with `ssr: false` (the listing map) wraps
 * itself in its own `<Suspense>` that errors on the server, and an errored boundary is written in
 * place as `<!--$!--><template data-dgst=…>` with no `id="B:…"` (the same file, :6945-6962). It holds
 * nothing a crawler reads and is not what this test is about.
 */
const APP = join(process.cwd(), 'src/app/[lang]')

/** From `src/app` (`..`) down to the listing page's own folder: a `loading.tsx` at any of them wraps the page. */
const LISTING_ANCESTORS = ['..', '', 'listings', 'listings/[id]', 'listings/[id]/(pdp)']
/** The segment's own files: the page, the layout above it, and the loaders both share. */
const PDP_FILES = ['listings/[id]/(pdp)/page.tsx', 'listings/[id]/(pdp)/layout.tsx', 'listings/[id]/(pdp)/get-listing.ts']
/** Block and line comments out (a `//` right after `:` is a URL, not a comment). */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('the listing page renders its content inline, visible to crawlers', () => {
  /** Every `loading.*`, edition suffixes included: a `loading.svc.tsx` would hide the page on eno.forum only (opus review). */
  it.each(LISTING_ANCESTORS)('no loading boundary at src/app/[lang]/%s', (dir) => {
    const found = readdirSync(join(APP, dir)).filter((f) => /^loading\./.test(f))
    expect(found, `${dir}/${found[0]} would move the whole listing page into <div hidden> for every crawler`).toEqual([])
  })

  /** The wrappers above every page: a Suspense around `{children}` in any of them is the same boundary (opus review). */
  it.each(['layout.tsx', 'template.tsx', 'providers.tsx', 'route-fade.tsx'])('src/app/[lang]/%s wraps no Suspense around the page', (file) => {
    const src = code(readFileSync(join(APP, file), 'utf8'))
    expect(src).toMatch(/\{\s*children\s*\}/)
    expect(src).not.toMatch(/<(?:React\.)?Suspense\b[^>]*>(?:(?!<\/(?:React\.)?Suspense>)[\s\S])*\{\s*children\s*\}/)
  })

  it('the page and its layout are where they are asserted to be (a wrong path would pass vacuously)', () => {
    for (const file of PDP_FILES) expect(existsSync(join(APP, file)), file).toBe(true)
  })

  /**
   * Comments are stripped first, because these files explain the boundary they must not contain. What
   * is left may not name `Suspense` at all: `<Suspense>`, `<React.Suspense>` and a multi-line import
   * all do (opus review).
   */
  it.each(PDP_FILES)('%s uses no Suspense', (file) => {
    expect(code(readFileSync(join(APP, file), 'utf8'))).not.toMatch(/\bSuspense\b/)
  })

  it('the Suspense check can fail (a stripped comment must not hide real code)', () => {
    const src = "import { Suspense } from 'react' // Suspense note\n/* Suspense in a comment */ const x = <React.Suspense />"
    expect(code(src).match(/\bSuspense\b/g)).toHaveLength(2)
  })
})

/**
 * ⛔ THE CATEGORY PAGE KEEPS ITS SKELETON FOR THE GRID, SO ITS HEADER, BREADCRUMB AND H1 RENDER ABOVE IT
 * (SEO wave B, H1b; the owner's hybrid). `(index)/loading.tsx` wraps only `(index)/page.tsx`, which React
 * outlines into `<div hidden id="S:0">` by the rule above; `(index)/layout.tsx` sits above that boundary
 * (a loading file never wraps the layout in its own folder), so what it renders is in place in the first
 * chunk. Before H1b, the four crawlers got the category H1 under `[hidden]`, and the header and `<main>`
 * twice. This block keeps the heading out of the boundary, keeps the skeleton from drawing a second
 * header, and keeps the layout from waiting on a COUNT: whatever it awaits delays the whole first chunk
 * and every category-to-category navigation (plan v4, round-2 review A4).
 * ⚠️ `../layout.tsx` (c/[category]/layout.tsx) also wraps every district page, which renders its own
 * header and H1, so the heading can only live one level down, in the `(index)` group.
 */
const IDX = 'c/[category]/(index)'
const src = (file: string) => code(readFileSync(join(APP, file), 'utf8'))

describe('the category page renders its header, breadcrumb and H1 above its loading boundary', () => {
  /** From `src/app` down to the `(index)` layout: a `loading.*` here would wrap the heading too. */
  it.each(['..', '', 'c', 'c/[category]'])('no loading boundary at src/app/[lang]/%s', (dir) => {
    const found = readdirSync(join(APP, dir)).filter((f) => /^loading\./.test(f))
    expect(found, `${dir}/${found[0]} would move the category H1 into <div hidden> for every crawler`).toEqual([])
  })

  it('the files are where they are asserted to be (a wrong path would pass vacuously)', () => {
    for (const f of ['layout.tsx', 'page.tsx', 'loading.tsx', 'category-lede-block.tsx', 'lede-placement.ts']) {
      expect(existsSync(join(APP, IDX, f)), f).toBe(true)
    }
  })

  it('(index)/layout.tsx renders the header, <main id="main">, the breadcrumb, the H1 and the footer', () => {
    const s = src(`${IDX}/layout.tsx`)
    for (const re of [/<Header\b/, /<main\b[^>]*\bid="main"/, /<Breadcrumb\b/, /<h1\b/, /<Footer\b/]) expect(s).toMatch(re)
    // `{children}` inside <main>, after the H1: the page's content continues the same column.
    expect(s).toMatch(/<\/h1>[\s\S]*\{\s*children\s*\}[\s\S]*<\/main>/)
  })

  /**
   * ⛔ ITS OWN CODE AWAITS THE PARAMS, THE CATEGORY ROW AND THE CACHED RENTALS HEADLINE, AND NOTHING ELSE.
   * A COUNT belongs in `category-lede-block.tsx`. ⚠️ This reads the layout's own source, so it cannot see
   * that child: under `LEDE_PLACEMENT = 'layout'` the shell DOES wait on the block's counts. That is
   * decision H-c, measured by the H-gate (lede-placement.ts); 'page' takes them out of the shell again.
   */
  it("(index)/layout.tsx's own code awaits only the params, the category row and the cached rentals headline", () => {
    const s = src(`${IDX}/layout.tsx`)
    const awaited = [...s.matchAll(/\bawait\s+([\w$.]+)/g)].map((m) => m[1])
    expect(awaited).toEqual(expect.arrayContaining(['params', 'getCategoryRow', 'loadRentalsHeadline']))
    for (const a of awaited) expect(['params', 'getCategoryRow', 'loadRentalsHeadline'], `layout awaits ${a}`).toContain(a)
    expect(s).not.toMatch(/\b(?:loadCategory|loadRentalsFacts|loadLinkedCount|loadDistrictChips)\s*\(|\.(?:count|groupBy|findMany|aggregate)\s*\(|\bdb\./)
  })

  /** The lede block is the one place the counts are read above the grid; it renders exactly once. */
  it('the lede renders in the layout only under placement "layout", and in the page only under "page"', () => {
    const at = (file: string) => src(file).match(/(?:LEDE_PLACEMENT === '(?:page|layout)' && )?<CategoryLedeBlock\b/g) ?? []
    expect(at(`${IDX}/layout.tsx`)).toEqual(["LEDE_PLACEMENT === 'layout' && <CategoryLedeBlock"])
    expect(at(`${IDX}/page.tsx`)).toEqual(["LEDE_PLACEMENT === 'page' && <CategoryLedeBlock"])
    expect(src(`${IDX}/loading.tsx`)).toMatch(/LEDE_PLACEMENT === 'page' && \(/)
    expect(src(`${IDX}/lede-placement.ts`)).toMatch(/^export const LEDE_PLACEMENT = '(?:page|layout)' as 'page' \| 'layout'$/m)
  })

  it.each([`${IDX}/page.tsx`, `${IDX}/loading.tsx`])('%s renders no second header, <main>, H1 or footer', (file) => {
    const s = src(file)
    for (const re of [/<Header\b/, /<Footer\b/, /<h1\b/, /<main\b/, /id="main"/]) expect(s).not.toMatch(re)
  })

  it('c/[category]/layout.tsx renders no header and no H1 (it also wraps the district pages)', () => {
    const s = src('c/[category]/layout.tsx')
    for (const re of [/<Header\b/, /<h1\b/, /<main\b/, /<Breadcrumb\b/]) expect(s).not.toMatch(re)
  })

  it.each([`${IDX}/layout.tsx`, `${IDX}/page.tsx`, `${IDX}/category-lede-block.tsx`, 'c/[category]/layout.tsx'])('%s uses no Suspense', (file) => {
    expect(src(file)).not.toMatch(/\bSuspense\b/)
  })

  /**
   * ⛔ THE HEADLINE CACHE MAY NOT BE SHORTER THAN THE PAGE'S OWN REVALIDATE. An `unstable_cache` read
   * during an ISR render lowers that render's revalidate to the entry's when the entry's is shorter
   * (next/dist/server/web/spec-extension/unstable-cache.js, the 'prerender-legacy' case), so a shorter
   * entry would make /c/rentals regenerate, and advertise its `s-maxage`, on the entry's clock.
   */
  it('the rentals headline is cached at least as long as the page revalidates', () => {
    const page = Number(src(`${IDX}/page.tsx`).match(/^export const revalidate = (\d+)/m)?.[1])
    const data = src('c/[category]/category-data.ts')
    const ttl = Number(data.match(/^export const RENTALS_HEADLINE_TTL = (\d+)/m)?.[1])
    expect(page).toBeGreaterThan(0)
    expect(ttl).toBeGreaterThanOrEqual(page)
    expect(data).toMatch(/unstable_cache\(computeRentalsHeadline, \['rentals-headline'\], \{ revalidate: RENTALS_HEADLINE_TTL \}\)/)
    expect(data).toMatch(/computeRentalsHeadline\.toString = \(\) => '[\w-]+'/)
  })
})
