/**
 * THE META DESCRIPTION OF A SELLER'S STOREFRONT — one composition for both routes that serve one:
 * `eno.vn/<handle>` (src/app/[lang]/[handle]/page.tsx) and `eno.vn/sellers/<id>`
 * (src/app/[lang]/sellers/[id]/page.tsx). Pure, so every rule below is pinned by
 * storefront-description.test.ts without a database.
 *
 * ⛔ WHAT IT REPLACED, MEASURED ON PRODUCTION (SEO wave B, I2):
 *   · `/sellers/<id>` said "Nhatot.com — 0 reviews · 5.0★": a star rating nobody gave, because
 *     `Seller.rating` defaults to 5. The rating is shown ONLY when `reviewCount > 0`.
 *   · `/<handle>` counted `shop.listings.length`, which is the storefront's 60-row first page
 *     (seller-storefront.tsx, STOREFRONT_LISTINGS), so a shop of 9,726 said "60 listings". The total
 *     is `_count.listings`, the same scoped count the page's own heading prints.
 *   · Both said "on eno.vn" as a literal, so eno.forum described its storefronts as eno.vn's.
 *     `siteName` is `SITE_NAME`, passed in.
 *   · A storefront whose every listing links out to another site (an importer, a retailer's feed, a
 *     partner whose tickets are booked on its own site) carried "Trusted seller" — a trust claim about
 *     stock eno does not hold. That shape gets the linked wording, and the tier word now needs at
 *     least one live listing of the seller's own.
 *   · (ST-META, UX program 2026-09-29) The seller's free-text `location` was printed verbatim, so a
 *     shop whose address line starts with a house number put its street in the search snippet. The
 *     location now goes through `storefrontPlace`: district and city, never a street.
 */

export type StorefrontDescriptionInput = {
  name: string
  /** Live listings in THIS edition's scope — `_count.listings`, never the length of a loaded page. */
  total: number
  /** Category names of the listings shown, most relevant first; the first three are used. */
  categories: string[]
  /** The seller's free-text location; only its district and city are printed (`storefrontPlace`). */
  location?: string | null
  /** `Seller.trustTier`: restricted | standard | trusted | exceptional. */
  trustTier?: string | null
  reviewCount: number
  rating: number
  /**
   * True when at least one live listing is the seller's OWN — no `affiliateUrl`, so it is held here
   * rather than linking to another site. With live listings and none of its own, every card links
   * out: the linked wording. Without one of its own, no seller-tier word either — a tier describes
   * stock sold here, and an empty or borrowed storefront has none (agy, review of this change: an
   * importer with 0 live listings and a `trusted` row would otherwise say "Trusted seller").
   */
  ownListing: boolean
  /**
   * True when the storefront page itself shows the seller's trust chip — an OWNED storefront that is not
   * an official partner (src/lib/linked-seller.ts: a partner shows its partner badge INSTEAD of a score,
   * and an ownerless storefront is unrated). ⛔ The tier word is a trust claim, so it needs this
   * (owner, 2026-10-04): an official partner's meta said "Trusted seller" over a page that shows a
   * partner badge and no score, and an ownerless guest storefront left at the v1 default of 100 read as
   * "Trusted seller" over a page that shows no trust at all.
   */
  trustShown: boolean
  /** `SITE_NAME` of the edition rendering the page. */
  siteName: string
}

/**
 * The last two comma-separated parts of a seller's free-text location — "District 1, Ho Chi Minh City"
 * out of "12 Nguyen Hue, District 1, Ho Chi Minh City". ⚠️ NEVER THE STREET: a shop's address line is
 * not something a search snippet should repeat, and the district and city are what a reader filters by.
 */
export function storefrontPlace(location: string | null | undefined): string | null {
  // ⛔ NEVER A STREET (codex, gate 2026-09-29): a two-part "12 Nguyen Hue, Ho Chi Minh City" used to print the
  // street verbatim. Any part carrying a digit (house number, lane, "Số 5", "Hẻm 12") is dropped before the
  // last two — district and city names in VN carry numbers only as "District 1"/"Quận 1", which are kept.
  const parts = (location ?? '').split(',').map((p) => p.trim()).filter(Boolean)
    .filter((p) => !/\d/.test(p) || /^(district|quận|q\.?)\s*\d+$/i.test(p))
  return parts.length ? parts.slice(-2).join(', ') : null
}

const fmt = (n: number) => n.toLocaleString('en-US')

/** "4.7★ from 3 reviews", or '' when nobody has reviewed the seller. */
export function ratingPhrase(reviewCount: number, rating: number): string {
  if (!(reviewCount > 0) || !Number.isFinite(rating)) return ''
  return `${rating.toFixed(1)}★ from ${fmt(reviewCount)} review${reviewCount === 1 ? '' : 's'}`
}

export function storefrontDescription(input: StorefrontDescriptionInput): string {
  const { name, total, siteName } = input
  const cats = [...new Set(input.categories.filter(Boolean))].slice(0, 3)
  const count = total > 0 ? `${fmt(total)} listing${total === 1 ? '' : 's'}${cats.length ? ` in ${cats.join(', ')}` : ''}` : ''
  const rating = ratingPhrase(input.reviewCount, input.rating)

  if (total > 0 && !input.ownListing) {
    const linked = total === 1 ? 'which links to its original page on another site' : 'each linking to its original page on another site'
    return [`${name} on ${siteName}: ${count}, ${linked}`, rating].filter(Boolean).join(' · ')
  }

  const tier = !input.ownListing || !input.trustShown ? '' : input.trustTier === 'exceptional' ? 'Top-rated seller' : input.trustTier === 'trusted' ? 'Trusted seller' : ''
  const bits = [count, storefrontPlace(input.location) || '', tier, rating].filter(Boolean)
  return bits.length ? `${name} — ${bits.join(' · ')} on ${siteName}` : `${name} on ${siteName}`
}
