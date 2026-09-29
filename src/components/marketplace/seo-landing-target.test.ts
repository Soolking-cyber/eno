import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SeoLandingTarget } from './seo-landing-where'
import { LANDING_TARGET as HOUSING } from '@/app/[lang]/housing-vietnam-expats/landing-target'
import { LANDING_TARGET as JOBS } from '@/app/[lang]/jobs-vietnam-expats/landing-target'
import { LANDING_TARGET as MOTORBIKES } from '@/app/[lang]/motorbikes-for-sale-vietnam/landing-target'
import { LANDING_TARGET as MOVING_SALES } from '@/app/[lang]/moving-sales-vietnam/landing-target'
import { LANDING_TARGET as COFFEE } from '@/app/[lang]/wholesale-green-coffee-vietnam/landing-target'

/**
 * ⛔ A LANDING'S `landing-target.ts` AND ITS PAGE'S `CONTENT` MUST NARROW THE SAME WAY.
 *
 * The sitemap reads each landing's target — to date the page by its rail's newest listing (SEO
 * wave B, I3c) and, for jobs and motorbikes, to decide whether to submit it at all — while the page's
 * rail selects by the fields its `CONTENT` spells out. The target lives in its own file so the sitemap
 * need not import a React page; this is what stops the two copies drifting: a typo in either would
 * date (or drop) the URL by a rail the page does not show, and fail nothing else.
 */
const FIELDS = ['categorySlug', 'subcategorySlug', 'listingType', 'condition', 'brandSlug'] as const

function contentNarrowing(dir: string): Partial<SeoLandingTarget> {
  const src = readFileSync(join(process.cwd(), 'src/app/[lang]', dir, 'page.tsx'), 'utf8')
  const start = src.indexOf('const CONTENT')
  if (start < 0) throw new Error(`${dir}/page.tsx has no CONTENT`)
  // The narrowing fields sit at the top level of CONTENT, before `sections` (checked below).
  const body = src.slice(start, src.indexOf('sections:', start))
  // `models` and `attributes` narrow a rail too (SeoLandingTarget), but they are not strings this
  // comparison can read; none of the five pages uses them, and one that starts to must fail here
  // rather than be compared on the other fields alone (review of I3c).
  if (/\n {2}(models|attributes):/.test(body)) throw new Error(`${dir}/page.tsx narrows by models/attributes; extend FIELDS`)
  const out: Partial<Record<(typeof FIELDS)[number], string>> = {}
  for (const f of FIELDS) {
    const m = body.match(new RegExp(`\\n  ${f}: '([^']+)'`))
    if (m) out[f] = m[1]
  }
  return out
}

describe('landing targets', () => {
  it.each([
    ['housing-vietnam-expats', HOUSING],
    ['jobs-vietnam-expats', JOBS],
    ['motorbikes-for-sale-vietnam', MOTORBIKES],
    ['moving-sales-vietnam', MOVING_SALES],
    ['wholesale-green-coffee-vietnam', COFFEE],
  ])('%s: the page rails by exactly its landing-target.ts', (dir, target) => {
    expect(contentNarrowing(dir)).toEqual(target)
  })
})
