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

  it('the category page keeps its skeleton, in the (index) group beside it', () => {
    expect(existsSync(join(APP, 'c/[category]/(index)/loading.tsx'))).toBe(true)
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
   */
  it('applies the indexing floor to its own count, in generateMetadata, and regenerates at least daily', () => {
    const src = readFileSync(join(APP, 'c/[category]/[district]/page.tsx'), 'utf8')
    const meta = src.slice(src.indexOf('export async function generateMetadata('), src.indexOf('export default async function'))
    expect(meta).toMatch(/\.\.\.\(isIndexableCount\(data\.total\) \? \{\} : \{ robots: \{ index: false, follow: true \} \}\)/)
    const revalidate = Number(/^export const revalidate = (\d+)\b/m.exec(src)?.[1])
    expect(revalidate).toBeGreaterThan(0)
    expect(revalidate).toBeLessThanOrEqual(86400)
  })
})
