import { describe, expect, it, vi } from 'vitest'
import { seoBrowseHref } from './seo-landing-href'

/**
 * vitest runs as the SERVICES edition (vitest.config.ts), where the `/vi` pilot is off and `localizedHref` is
 * the identity — so the marketplace's lists (lang-pinned.ts VI_PREFIX_PATHS) are put in front of it here.
 */
vi.mock('@/lib/lang-pinned', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/lang-pinned')>()
  const ON = { live: m.VI_PREFIX_PATHS, retired: [] }
  return {
    ...m,
    localizedHref: (href: string, variant: string) => m.localizedHref(href, variant, ON),
    stripViPrefix: (p: string | null | undefined) => m.stripViPrefix(p, ON),
  }
})


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
  it('⛔ a Vietnamese article links the /vi twin of a pilot path, never its English-pinned plain URL (A1-LANG)', () => {
    expect(seoBrowseHref({ categorySlug: 'furniture-appliances' }, 'vi')).toBe('/vi/c/furniture-appliances')
    expect(seoBrowseHref({ categorySlug: 'furniture-appliances', condition: 'used' }, 'vi')).toBe(
      '/vi?category=furniture-appliances&condition=used',
    )
    // A /c page outside the pilot has no /vi twin (it would 404): unchanged. English is unchanged.
    expect(seoBrowseHref({ categorySlug: 'rentals' }, 'vi')).toBe('/c/rentals')
    expect(seoBrowseHref({ categorySlug: 'furniture-appliances' }, 'en')).toBe('/c/furniture-appliances')
  })

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

  it('narrows on condition alone, and does NOT fall through to the whole category', () => {
    // ⛔ THE /moving-sales-vietnam REGRESSION, IN THE FORM IT WOULD ACTUALLY TAKE. That page rails
    // USED furniture out of a category that is 6,391 listings, roughly half of them brand new. If
    // `condition` did not widen the "narrowed at all" test, its CTA would read /c/furniture-appliances
    // and send a visitor who just read secondhand prices into new-goods retail — a valid, full page,
    // so nothing would look broken.
    expect(seoBrowseHref({ categorySlug: 'furniture-appliances', condition: 'used' })).toBe(
      '/?category=furniture-appliances&condition=used',
    )
  })

  it('uses the feed’s own `condition` param name so the rail and the CTA select the same rows', () => {
    // `feed-query.ts` reads `searchParams.get('condition')` and applies the SAME predicate the rail
    // used, via @/lib/listing-condition. One definition, two callers — see that file's header.
    expect(
      seoBrowseHref({ categorySlug: 'furniture-appliances', subcategorySlug: 'sofas', condition: 'used' }),
    ).toBe('/?category=furniture-appliances&subcategory=sofas&condition=used')
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

/**
 * `subcategoryIn` — the housing pages' homes (apartments, houses, rooms) out of `rentals` (C1-HOUSING).
 * The rail narrowed by it while this function did not know the field, so the CTA fell through to
 * `/c/rentals` by accident (review, 2026-09-29). It still goes there for a set of several — the feed
 * has no param for a set — but as a pinned decision, and a set of one is now exact.
 */
describe('seoBrowseHref — subcategoryIn', () => {
  const HOMES = ['apartment-rental', 'house-rental', 'room-rental'] as const

  it('sends a one-kind set to that subcategory, exactly', () => {
    expect(seoBrowseHref({ categorySlug: 'rentals', subcategoryIn: ['room-rental'] })).toBe('/?category=rentals&subcategory=room-rental')
  })

  it('⛔ sends a set of several to the category hub — a superset — never to ONE member of it', () => {
    const href = seoBrowseHref({ categorySlug: 'rentals', subcategoryIn: HOMES })
    expect(href).toBe('/c/rentals')
    expect(href).not.toContain('subcategory=')
  })

  it('keeps every other narrowing beside a set it cannot express', () => {
    expect(seoBrowseHref({ categorySlug: 'rentals', subcategoryIn: HOMES, condition: 'used' })).toBe('/?category=rentals&condition=used')
  })

  it('lets a single subcategorySlug win over the set, as seoLandingWhere does', () => {
    expect(seoBrowseHref({ categorySlug: 'rentals', subcategorySlug: 'house-rental', subcategoryIn: HOMES })).toBe(
      '/?category=rentals&subcategory=house-rental',
    )
  })

  it('treats an empty set as no narrowing', () => {
    expect(seoBrowseHref({ categorySlug: 'rentals', subcategoryIn: [] })).toBe('/c/rentals')
  })
})
