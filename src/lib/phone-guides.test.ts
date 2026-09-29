import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { guideDates } from './expat-guides'
import { PHONE_GUIDES } from './phone-guides'

/**
 * The phone cluster's dates, from the page's side. src/lib/expat-guides.test.ts checks every
 * registry's dates are ISO, ordered and not in the future; this pins what a phone article's
 * Article JSON-LD will say, and that a pair is dated as a pair.
 */
describe('phone guide dates', () => {
  it.each(PHONE_GUIDES.map((g) => [g.slug, g]))('%s: the page declares exactly the registry dates', (slug, guide) => {
    const g = guide as (typeof PHONE_GUIDES)[number]
    const src = readFileSync(`src/app/[lang]/${slug}/page.tsx`, 'utf8')
    expect(src).toMatch(/\.\.\.guideDates\(SLUG\)/)
    expect(src).toMatch(new RegExp(`^const SLUG = '${slug}'`, 'm'))
    expect(guideDates(slug)).toEqual(g.updated ? { published: g.published, updated: g.updated } : { published: g.published })
  })

  it('the two languages of a subject went up the same day — they were written as a pair', () => {
    for (const g of PHONE_GUIDES) {
      const pair = PHONE_GUIDES.find((p) => p.slug === g.pair)!
      expect(pair.published, `${g.slug} and ${pair.slug}`).toBe(g.published)
    }
  })
})
