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

  /**
   * ⛔ THE SAME REGRESSION AS THE `attributes` CASE ABOVE, ONE DIMENSION LATER. `listingType` is
   * the third way a page can narrow its rail, and adding it to the query without adding it to the
   * "narrowed at all" test would have sent the wholesale coffee page's CTA to `/c/food-drink` —
   * per-tonne parcels described, home bakers delivered. Both destinations are full of listings,
   * so nothing would look broken.
   */
  it('narrows on listingType alone and leaves /c/', () => {
    expect(seoBrowseHref({ categorySlug: 'food-drink', listingType: 'wholesale' })).toBe(
      '/?category=food-drink&type=wholesale',
    )
  })

  it('combines listingType with a subcategory in the explorer’s own param names', () => {
    expect(seoBrowseHref({ categorySlug: 'food-drink', subcategorySlug: 'coffee-tea', listingType: 'wholesale' })).toBe(
      '/?category=food-drink&subcategory=coffee-tea&type=wholesale',
    )
  })

  it('still funnels to /c/ when listingType is absent', () => {
    expect(seoBrowseHref({ categorySlug: 'food-drink' })).toBe('/c/food-drink')
  })
})

/**
 * Brand/model narrowing, added for the iPhone 18 launch page (2026-09-17). The trap here is the
 * explorer's `model` param, which takes exactly ONE value: a family page that set both lines would
 * silently browse half of what it described.
 */
describe('seoBrowseHref — brand and model', () => {
  it('narrows on a brand alone', () => {
    expect(seoBrowseHref({ categorySlug: 'electronics', brandSlug: 'apple' })).toBe(
      '/?category=electronics&brand=apple',
    )
  })

  it('uses the model facet when the page covers exactly one line', () => {
    expect(seoBrowseHref({ categorySlug: 'electronics', subcategorySlug: 'phones-tablets', brandSlug: 'apple', models: ['iPhone 18 Pro'] })).toBe(
      '/?category=electronics&subcategory=phones-tablets&brand=apple&model=iPhone+18+Pro',
    )
  })

  it('falls back to the search term when the page covers a family', () => {
    expect(seoBrowseHref({
      categorySlug: 'electronics', subcategorySlug: 'phones-tablets', brandSlug: 'apple',
      models: ['iPhone 18 Pro', 'iPhone 18 Pro Max'], browseQuery: 'iPhone 18',
    })).toBe('/?category=electronics&subcategory=phones-tablets&brand=apple&q=iPhone+18')
  })

  // Without a term there is nothing honest to put in `model`, so the page browses its brand.
  it('drops the model filter for a family with no search term rather than picking one line', () => {
    expect(seoBrowseHref({ categorySlug: 'electronics', brandSlug: 'apple', models: ['iPhone 18 Pro', 'iPhone 18 Pro Max'] })).toBe(
      '/?category=electronics&brand=apple',
    )
  })
})
