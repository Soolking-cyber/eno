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
