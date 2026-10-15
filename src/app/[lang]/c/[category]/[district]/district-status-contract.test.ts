import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * ⛔ THE DISTRICT PAGE'S 404 AND 308 ARE ONLY REAL STATUSES WHILE NO `loading.tsx` SITS ABOVE IT.
 *
 * A `loading.tsx` wraps its segment's page AND every child segment in a Suspense boundary, and Next
 * flushes the shell — status included — before anything inside the boundary can throw. With the
 * category skeleton at `c/[category]/loading.tsx`, every `/c/<cat>/<district>` that called
 * `notFound()` answered 200 + noindex (live 2026-09-27: /c/rentals/thao-dien, /tay-ho, /phu-my-hung,
 * /district-2, /thanh-pho-thu-duc), and a `permanentRedirect()` could only ever have been a client
 * redirect inside a 200. The skeleton now lives in the `(index)` route group beside the category page,
 * which it still serves; this file keeps anyone from moving it back, or adding one on the way down.
 * Same trap, same guard shape as src/app/[lang]/[handle]/not-found-contract.test.ts.
 */
const APP = join(process.cwd(), 'src/app/[lang]')
// '..' is src/app itself: a root loading.tsx above [lang] would wrap this route just the same (opus review).
const ANCESTORS = ['..', '', 'c', 'c/[category]', 'c/[category]/[district]']

describe('/c/<category>/<district> status contract', () => {
  it.each(ANCESTORS)('no loading boundary at src/app/[lang]/%s', (dir) => {
    for (const ext of ['tsx', 'jsx', 'ts', 'js']) {
      expect(existsSync(join(APP, dir, `loading.${ext}`)), `${dir}/loading.${ext} would turn every district 404/308 into a 200`).toBe(false)
    }
  })

  it('the category page renders inline (no skeleton since UX3 FAST-8), from the (index) group beside it', () => {
    expect(existsSync(join(APP, 'c/[category]/(index)/loading.tsx'))).toBe(false)
    expect(existsSync(join(APP, 'c/[category]/(index)/page.tsx'))).toBe(true)
    // Two pages for one route is a build error; a stray copy left behind would be one.
    expect(existsSync(join(APP, 'c/[category]/page.tsx'))).toBe(false)
  })

  /**
   * ⚠️ THE THROW HAS TO HAPPEN BEFORE THE PAGE RENDERS ANYTHING — in generateMetadata and at the top
   * of the page body, through the one resolver, so a later edit cannot answer 200 for one of them.
   */
  it('resolves the canonical place in both generateMetadata and the page body', () => {
    const src = readFileSync(join(APP, 'c/[category]/[district]/page.tsx'), 'utf8')
    const resolver = src.slice(src.indexOf('async function resolve('))
    expect(resolver).toMatch(/if \(!data\) notFound\(\)/)
    expect(resolver).toMatch(/permanentRedirect\(`\/c\/\$\{data\.cat\.slug\}\/\$\{canonical\}`\)/)
    expect(src).toMatch(/generateMetadata\(\{ params \}: Props\)[^{]*\{\s*const \{[^}]*\} = await resolve\(params\)/)
    expect(src).toMatch(/CategoryDistrictPage\(\{ params \}: Props\)[^{]*\{\s*const \{[^}]*\} = await resolve\(params\)/)
  })

  /**
   * ⛔ THE INDEXING FLOOR (SEO wave B, I1; src/lib/index-floor.ts). Below 10 listings the page answers
   * `noindex, follow`, decided in generateMetadata from the page's own full count — the number its
   * lede prints — and the ISR copy that carries that tag is at most a day old, the sitemap's own
   * revalidate, so the page never trails the sitemap by a week when it crosses the floor.
   * ⛔ ONCE 14 DAYS UNDER IT (I1b, decision I-g): load() folds the window in as `data.noindex`
   * (src/lib/stale-noindex.test.ts pins how).
   */
  /**
   * ⛔ EVERY LISTING READ HERE CARRIES `teachers: true` (2026-10-14). The window re-applies the scope itself
   * (feed-window.ts): without the flag it re-added the teacher exclusion, so /c/teachers/<district> counted its
   * teachers, listed none and 404ed (/c/teachers/d7 with three live teachers). Each read is pinned to one category,
   * so the flag hides nothing anywhere else.
   * ⛔ …AND THE WINDOW IS `fresh` ON THE TEACHERS CATEGORY ONLY (B2, 2026-10-15 — feed-window.ts WindowOptions.fresh).
   * The memo is process-local and no purge clears it, so a teacher district page regenerating right after a purge (an
   * identity decision, a hide) re-baked the old rows for its 24h. Keyed on the slug: dropped, the re-bake is back;
   * `fresh: true`, every category's district pages lose the memo. The category page's twin: feed-window.test.ts.
   */
  it('passes the teacher decision to every helper that re-scopes its where', () => {
    const src = readFileSync(join(APP, 'c/[category]/[district]/page.tsx'), 'utf8')
    // One line per call (this file has no semicolons to stop a wider match).
    const windows = [...src.matchAll(/await diverseFeedWindow\(([^\n]*)\)$/gm)].map((m) => m[1])
    expect(windows.length).toBeGreaterThan(0)
    for (const args of windows) expect(args).toMatch(/teachers: true/)
    for (const args of windows) expect(args).toMatch(/\bfresh: categorySlug === TEACHERS_CATEGORY_SLUG\b/)
    // Every scopedListingWhere call here carries the flag (one today: `base`, which every other read composes).
    const scoped = src.split('await scopedListingWhere(').slice(1).map((rest) => rest.slice(0, rest.indexOf('\n  const ')))
    expect(scoped.length).toBeGreaterThan(0)
    for (const call of scoped) expect(call).toMatch(/\{ teachers: true \}\)/)
    // The stale-noindex count re-scopes too: it lifts the exclusion on the teachers category only.
    expect(src).toMatch(/staleBelowFloor\(\{[\s\S]*?teachers: categorySlug === TEACHERS_CATEGORY_SLUG,[\s\S]*?\}\)/)
  })

  it('applies the indexing floor to its own count, in generateMetadata, and regenerates at least daily', () => {
    const src = readFileSync(join(APP, 'c/[category]/[district]/page.tsx'), 'utf8')
    const meta = src.slice(src.indexOf('export async function generateMetadata('), src.indexOf('export default async function'))
    // …and a retired shelf's district page whatever its count (second-hand focus, src/lib/retired-categories.ts).
    expect(meta).toMatch(/\.\.\.\(data\.noindex \|\| isRetiredNavCategory\(data\.cat\.slug\) \? \{ robots: \{ index: false, follow: true \} \} : \{\}\)/)
    expect(src).toMatch(/live: total,\s*floor: MIN_INDEXABLE_LISTINGS,/)
    const revalidate = Number(/^export const revalidate = (\d+)\b/m.exec(src)?.[1])
    expect(revalidate).toBeGreaterThan(0)
    expect(revalidate).toBeLessThanOrEqual(86400)
  })

  /**
   * ⛔ THE RENT BLOCK (SEO wave B, D2): rentals, in HCMC, on the marketplace only; a miss never throws
   * and retries within minutes (src/lib/rent-index-retry.ts); the cells are `publishableCells`, the
   * list D3's sitemap rule reads.
   */
  it('renders the rent block under its three conditions, and a miss retries instead of throwing', () => {
    const src = readFileSync(join(APP, 'c/[category]/[district]/page.tsx'), 'utf8')
    expect(src).toMatch(/const rentP = rentals && data\.inHcmc && !IS_SERVICES \? districtRent\(district\) : Promise\.resolve\(null\)/)
    const fn = src.slice(src.indexOf('async function districtRent('), src.indexOf('export default async function'))
    expect(fn).toMatch(/Promise\.race\(\[loadRentIndex\(\), timeout\]\)\.catch\(\(\) => null\)/)
    expect(fn).toMatch(/if \(!lookup \|\| !lookup\.known\) \{\s*await rentIndexRetrySoon\(\)\.catch\(\(\) => \{\}\)\s*return null/)
    expect(fn).toMatch(/publishableCells\(row\)/)
    expect(fn).not.toMatch(/\bthrow\b/)
    const retry = readFileSync(join(process.cwd(), 'src/lib/rent-index-retry.ts'), 'utf8')
    expect(retry).toMatch(/revalidate: 300, tags: \['hcmc-rent-index'\]/)
    expect(retry).not.toMatch(/revalidateTag\(/)
  })
})
