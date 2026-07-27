import { describe, expect, it } from 'vitest'
import { seoBrowseHref } from './seo-landing-href'

/**
 * The CTA on an SEO landing page must show the visitor the SAME set of listings the page just
 * described. Both possible destinations are real pages full of real listings, so getting this
 * wrong produces no error, no empty state and no visible symptom — the visitor simply lands on a
 * wider set than they were promised. That is why it is tested rather than eyeballed.
 *
 * Verified end to end against a local production build on 2026-07-27: the three URLs this function
 * produces for the live e-visa pages returned 14, 2 and 7 listings from /api/listings, matching the
 * counts the pages' own Prisma queries rendered.
 */
describe('seoBrowseHref', () => {
  it('sends an un-narrowed page to the real /c/<category> route', () => {
    // There is no /c/<cat>/<subcat> route, but /c/<cat> is server-rendered and crawlable, so a page
    // that narrows nothing should prefer it over a query-string equivalent.
    expect(seoBrowseHref({ categorySlug: 'services' })).toBe('/c/services')
  })

  it('sends a subcategory page to the explorer filtered to that subcategory', () => {
    expect(seoBrowseHref({ categorySlug: 'services', subcategorySlug: 'visa-legal' })).toBe(
      '/?category=services&subcategory=visa-legal',
    )
  })

  it('carries attributes through as the feed’s attr_ params', () => {
    expect(
      seoBrowseHref({ categorySlug: 'services', subcategorySlug: 'visa-legal', attributes: { visaSpeed: '1H' } }),
    ).toBe('/?category=services&subcategory=visa-legal&attr_visaSpeed=1H')
  })

  it('narrows on attributes even with NO subcategory — the case agy refuted', () => {
    // ⚠️ THE REGRESSION THIS FILE EXISTS FOR. The first implementation keyed the whole decision on
    // `subcategorySlug`, so a page filtering its rail by attributes alone rendered a narrow set of
    // products and then pointed its CTA at `/c/<category>` — the entire category, silently. No page
    // does this today, which is exactly why nothing would have caught it.
    expect(seoBrowseHref({ categorySlug: 'services', attributes: { visaSpeed: '1H' } })).toBe(
      '/?category=services&attr_visaSpeed=1H',
    )
  })

  it('treats an empty attributes object as no narrowing at all', () => {
    // `{}` is "the caller had nothing to add", not "filter by nothing" — it must not push the page
    // off the crawlable /c/ route for no gain.
    expect(seoBrowseHref({ categorySlug: 'services', attributes: {} })).toBe('/c/services')
  })

  it('percent-encodes values rather than emitting a broken URL', () => {
    expect(seoBrowseHref({ categorySlug: 'services', attributes: { note: 'a b&c' } })).toBe(
      '/?category=services&attr_note=a+b%26c',
    )
  })
})
