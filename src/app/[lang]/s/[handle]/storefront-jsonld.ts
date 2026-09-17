/**
 * STRUCTURED DATA FOR A SHOP'S OWN SUBDOMAIN.
 *
 * ⛔ BOTH STOREFRONT ROUTES SHIPPED WITH NO JSON-LD AT ALL, which is the gap this closes. A
 * listing page has emitted `Product` + `Offer` + `BreadcrumbList` since long before either
 * storefront existed, so search engines could read every individual lot and nothing at all about
 * the merchant selling them — no name, no country, no catalogue, no relationship between the
 * subdomain and the marketplace it belongs to. On a B2B query ("wholesale green coffee Vietnam")
 * that is the half that decides whether a shop reads as a supplier or as a URL.
 *
 * ⛔ EVERY IDENTITY STRING IS AN ARGUMENT, NOT A LITERAL, AND THE FIRST VERSION GOT THIS WRONG.
 * It hardcoded `'eno.vn'` as the breadcrumb root while taking `origin` as a parameter — so the
 * services build, which runs the same code with `NEXT_PUBLIC_APP_URL=https://www.eno.forum`, would
 * have published a breadcrumb *named* eno.vn whose *url* was eno.forum. All four reviewers caught
 * it independently. There is exactly one edition-varying constant in this file's inputs and it is
 * passed in; proven against a real services build, not reasoned about.
 *
 * ⚠️ A PURE FUNCTION IN ITS OWN MODULE, on purpose. `page.tsx` imports Prisma, so a rule written
 * there cannot be unit-tested without a database — the same reasoning `seo-landing-href.ts` and
 * `seo-landing-inventory.ts` are both split out for, and the same reasoning that applies here:
 * every branch below is a silent-wrong-output branch, not a crash.
 */

export type StorefrontLdListing = {
  id: string
  images: string[]
  listingType: string
}

export type StorefrontLdInput = {
  name: string
  /** The edition's own name — `SITE_NAME`. Never a literal; see the note above. */
  siteName: string
  /** The page's own canonical — `storefrontUrl(handle, origin)`, already resolved. */
  url: string
  /** This edition's origin (`https://eno.vn` / `https://www.eno.forum`). */
  origin: string
  bannerUrl: string | null
  /** The page-one slice, unfiltered — `inCatalogue` below decides what belongs in the list. */
  listings: StorefrontLdListing[]
}

/**
 * ⛔ AN ALLOW-LIST, NOT A DENY-LIST, AND THE FIRST VERSION WAS THE WRONG ONE. It rejected `wanted`
 * and `rent` and admitted everything else — so any intent added to `ListingType` later (a `job`,
 * whose `price` is a salary; an `event`; a future "looking for" variant) would silently join the
 * shop's advertised catalogue, and nothing would fail. "Measured: none exist today" is precisely
 * the argument the ItemList note below refuses to accept elsewhere, and it cannot be good enough
 * here either. Three intents describe something this shop is offering; that is the list.
 */
const IN_CATALOGUE = new Set(['sell', 'wholesale', 'service'])
const inCatalogue = (l: StorefrontLdListing) => IN_CATALOGUE.has(l.listingType)

export function storefrontJsonLd(input: StorefrontLdInput): Record<string, unknown>[] {
  const { name, siteName, url, origin, bannerUrl } = input
  const listings = input.listings.filter(inCatalogue)

  /**
   * ⚠️ `Store`, NOT `Organization`. Both are valid, but `Store` is a `LocalBusiness` and carries
   * the retail semantics a shopping surface reads — while inheriting everything `Organization`
   * offers.
   *
   * ⛔ NO `parentOrganization`, THOUGH THE FIRST VERSION HAD ONE. It read well — it tied
   * `<shop>.eno.vn` back to the marketplace so a subdomain full of products would not look like an
   * unrelated site. But `parentOrganization` means the shop is a *subOrganization* of eno, i.e. a
   * subsidiary, and a marketplace seller is an independent business that merely lists here. A
   * reviewer named it as an unsupported corporate claim and was right. The BreadcrumbList below
   * already places the shop under the site, which is the relationship that is actually true.
   *
   * ⚠️ KNOWINGLY APPLIED TO INDIVIDUAL SELLERS TOO. A reviewer objected that a private person
   * clearing a flat becomes "a retail business" in structured data. Measured 2026-09-07: two of
   * the six handled shops (`sky`, `SDC_store`) are `accountType: 'individual'`. The call is that a
   * storefront is a storefront — this page exists only because its owner claimed a handle, set a
   * banner and listed stock under a shop name on a subdomain they hand out. Gating on
   * `Seller.taxCode` was the alternative and it fails the case it was meant to serve: eno's own
   * trading arm has no tax code on its row either, so the shop this feature was built for would
   * have lost its merchant node. Recorded as a judgment, not an oversight.
   */
  const store: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Store',
    name,
    url,
    // The banner is the shop's own art; the first product photo is the fallback that always exists
    // on a storefront with stock. A shop with neither gets no `image` key rather than a broken one.
    ...(bannerUrl || listings[0]?.images[0] ? { image: bannerUrl || listings[0].images[0] } : {}),
    /**
     * ⛔ COUNTRY ONLY, AND THE FIRST VERSION'S COMMENT WAS THE PART THAT WAS WRONG. It read the
     * locality off `listings[0].city` while claiming the value came from the seller — so a shop's
     * declared business address was whichever of its products happened to sort first. Measured
     * 2026-09-07: VinWonders has listings in EIGHT cities and no seller location at all, so its
     * address would have moved between Phú Quốc and Hà Nội as inventory reordered. `Seller.location`
     * is not the fix either — it is a free-text field holding anything from "Đắk Lắk" to a full
     * street address ("193/25 Nguyen Dinh Chinh Street - Ward 11 - Phu Nhuan District…"), which is
     * not an `addressLocality`. A country we can state truthfully beats a city we cannot.
     */
    address: { '@type': 'PostalAddress', addressCountry: 'VN' },
  }

  /**
   * ⛔ THE SUMMARY FORM — `ListItem` + `url`, AND NOTHING ELSE. The first two versions published a
   * full `Product` with an `Offer`, a price and a currency for each of the 24 cards, which is the
   * shape Google documents for a SINGLE-product page and explicitly not for a list: a list page is
   * meant to carry `ListItem`s whose `url` points at the page holding the real Product markup,
   * which our PDPs already do. The long form here buys no rich result and invites a Search Console
   * flag. It also deletes three of this file's own hazards outright — no currency to map (the
   * `₫`→`USD` trap two reviewers found), no price to misstate, no per-item image to normalise.
   *
   * ⚠️ THE URLS ARE THIS EDITION'S OWN, which is correct rather than sloppy: measured against
   * production 2026-09-07, a PDP self-canonicalises to `${NEXT_PUBLIC_APP_URL}/listings/<id>`, so
   * eno.forum's listings canonicalise to eno.forum. Hardcoding eno.vn is what would split a shop's
   * ranking across two hosts.
   *
   * ⚠️ NO `numberOfItems`. An earlier version passed the shop's full live `total` while the list
   * held the newest 24 filtered rows, announcing a 100-item catalogue containing 22 entries. The
   * property is optional; a list that does not claim a size cannot misstate one.
   */
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `${name} — listings`,
    itemListElement: listings.map((l, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${origin}/listings/${l.id}`,
    })),
  }

  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: siteName, item: origin },
      { '@type': 'ListItem', position: 2, name, item: url },
    ],
  }

  // An empty shop — or one whose whole first page is out of catalogue — gets the Store and the
  // breadcrumb but no list. An ItemList with no elements is a worse signal than saying nothing
  // about the catalogue at all.
  return listings.length > 0 ? [store, itemList, breadcrumb] : [store, breadcrumb]
}
