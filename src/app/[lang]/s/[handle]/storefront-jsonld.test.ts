import { describe, it, expect } from 'vitest'
import { storefrontJsonLd, type StorefrontLdInput } from './storefront-jsonld'

const listing = (over: Partial<StorefrontLdInput['listings'][number]> = {}) => ({
  id: 'l1', images: ['https://sb.eno.vn/a.webp'], listingType: 'wholesale', ...over,
})

const base: StorefrontLdInput = {
  name: 'eno Trading',
  siteName: 'eno.vn',
  url: 'https://eno-trading.eno.vn',
  origin: 'https://eno.vn',
  bannerUrl: null,
  listings: [listing()],
}

const typeOf = (nodes: Record<string, unknown>[], t: string) => nodes.find((n) => n['@type'] === t)
type LdItem = { '@type': string; position: number; url: string }
const items = (i: StorefrontLdInput): LdItem[] =>
  (typeOf(storefrontJsonLd(i), 'ItemList') as { itemListElement: LdItem[] } | undefined)?.itemListElement ?? []

describe('storefrontJsonLd', () => {
  it('emits Store, ItemList and BreadcrumbList for a shop with stock', () => {
    expect(storefrontJsonLd(base).map((n) => n['@type'])).toEqual(['Store', 'ItemList', 'BreadcrumbList'])
  })

  /**
   * ⛔ AN ITEMLIST WITH NO ELEMENTS IS A WORSE SIGNAL THAN NO ITEMLIST. An empty shop still gets
   * its identity and its place in the site; it does not advertise an empty catalogue.
   */
  it('⛔ OMITS THE ITEMLIST ENTIRELY FOR AN EMPTY SHOP', () => {
    expect(storefrontJsonLd({ ...base, listings: [] }).map((n) => n['@type']))
      .toEqual(['Store', 'BreadcrumbList'])
  })

  /**
   * ⛔ THE SERVICES EDITION BUILDS THIS SAME CODE. The first version hardcoded 'eno.vn' as the
   * breadcrumb root while taking `origin` as a parameter, so an eno.forum storefront would have
   * published identity naming eno.vn at an eno.forum URL. All four reviewers found it
   * independently; nothing in the app would have failed.
   */
  it('⛔ CARRIES NO EDITION LITERAL — forum identity everywhere on a forum build', () => {
    const forum = storefrontJsonLd({
      ...base, siteName: 'eno.forum', origin: 'https://www.eno.forum', url: 'https://eno-trading.eno.forum',
      // ⚠️ A NEUTRAL IMAGE HOST, because the real one is `sb.eno.vn` on BOTH editions — one shared
      // Supabase bucket — and a blanket "no eno.vn anywhere" assertion fails on that legitimately.
      // The identity fields are what must not carry an edition literal, not the storage URLs.
      listings: [listing({ images: ['https://cdn.example/a.webp'] })],
    })
    expect(JSON.stringify(forum)).not.toContain('eno.vn')
    expect((typeOf(forum, 'BreadcrumbList') as { itemListElement: { name: string; item: string }[] }).itemListElement[0])
      .toEqual({ '@type': 'ListItem', position: 1, name: 'eno.forum', item: 'https://www.eno.forum' })
  })

  /**
   * ⛔ THE SUMMARY FORM. Google documents full `Product` markup for single-product pages and
   * `ListItem` + `url` for a list; the first two versions emitted a Product with an Offer, a price
   * and a currency per card. Beyond buying no rich result, the long form is what made the
   * `₫`→`USD` mapping trap possible at all — there is now no price or currency here to get wrong.
   */
  it('⛔ EMITS ListItem + url ONLY — NO Product, Offer, price OR currency', () => {
    const blob = JSON.stringify(storefrontJsonLd(base))
    for (const banned of ['Product', 'Offer', 'priceCurrency', '"price"', 'availability', 'numberOfItems']) {
      expect(blob, banned).not.toContain(banned)
    }
    expect(items(base)[0]).toEqual({ '@type': 'ListItem', position: 1, url: 'https://eno.vn/listings/l1' })
  })

  /**
   * ⛔ AN ALLOW-LIST, NOT A DENY-LIST. The first version rejected `wanted`/`rent` and admitted
   * everything else, so any intent added to `ListingType` later — a `job` whose price is a salary,
   * an `event` — would silently join the shop's advertised catalogue with nothing failing.
   */
  it('⛔ ADMITS ONLY sell, wholesale AND service — everything else stays out', () => {
    for (const t of ['sell', 'wholesale', 'service']) {
      expect(items({ ...base, listings: [listing({ listingType: t })] }), t).toHaveLength(1)
    }
    for (const t of ['wanted', 'rent', 'job', 'event', 'free', '']) {
      expect(items({ ...base, listings: [listing({ listingType: t })] }), t).toEqual([])
    }
  })

  it('drops the ItemList when every listing on the page is out of catalogue', () => {
    expect(storefrontJsonLd({ ...base, listings: [listing({ listingType: 'wanted' })] }).map((n) => n['@type']))
      .toEqual(['Store', 'BreadcrumbList'])
  })

  /**
   * ⚠️ ITEMS POINT AT THIS EDITION'S OWN LISTING URLS. Measured against production 2026-09-07: a
   * PDP self-canonicalises to `${NEXT_PUBLIC_APP_URL}/listings/<id>`, so eno.forum's listings
   * canonicalise to eno.forum. Hardcoding eno.vn is what would split the ranking, not this.
   */
  it('links items to the SERVING edition’s listing URLs', () => {
    expect(items(base)[0].url).toBe('https://eno.vn/listings/l1')
    expect(items({ ...base, origin: 'https://www.eno.forum' })[0].url)
      .toBe('https://www.eno.forum/listings/l1')
  })

  it('numbers positions from 1 in order', () => {
    const three = items({ ...base, listings: [listing({ id: 'a' }), listing({ id: 'b' }), listing({ id: 'c' })] })
    expect(three.map((i) => [i.position, i.url.split('/').pop()])).toEqual([[1, 'a'], [2, 'b'], [3, 'c']])
  })

  /**
   * ⛔ A MARKETPLACE SELLER IS NOT A SUBSIDIARY OF THE MARKETPLACE. `parentOrganization` means
   * subOrganization-of; the first version published it for every shop. The breadcrumb states the
   * relationship that is actually true.
   */
  it('⛔ MAKES NO CORPORATE-PARENT CLAIM ABOUT AN INDEPENDENT SELLER', () => {
    expect(JSON.stringify(storefrontJsonLd(base))).not.toContain('parentOrganization')
  })

  it('prefers the shop banner over a product photo, and omits image when it has neither', () => {
    expect((typeOf(storefrontJsonLd({ ...base, bannerUrl: 'https://sb.eno.vn/b.webp' }), 'Store') as { image: string }).image)
      .toBe('https://sb.eno.vn/b.webp')
    expect((typeOf(storefrontJsonLd(base), 'Store') as { image: string }).image).toBe('https://sb.eno.vn/a.webp')
    const bare = typeOf(storefrontJsonLd({ ...base, listings: [listing({ images: [] })] }), 'Store') as Record<string, unknown>
    expect('image' in bare).toBe(false)
  })

  /**
   * ⛔ COUNTRY ONLY. The first version read `addressLocality` off the first listing's city while
   * its own comment claimed the value came from the seller. Measured 2026-09-07: VinWonders has
   * listings in EIGHT cities and no seller location, so its declared business address would have
   * moved as inventory reordered. `Seller.location` is free text holding anything from "Đắk Lắk"
   * to a full street address, so it is not the fix either.
   */
  it('⛔ PUBLISHES COUNTRY ONLY — never a locality derived from inventory', () => {
    const store = typeOf(storefrontJsonLd(base), 'Store') as { address: Record<string, unknown> }
    expect(store.address).toEqual({ '@type': 'PostalAddress', addressCountry: 'VN' })
    expect(JSON.stringify(store)).not.toContain('addressLocality')
  })
})
