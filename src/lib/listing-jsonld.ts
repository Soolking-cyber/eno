import { priceUnitSuffix, UNIT_CODES } from '@/lib/price-unit'
import { isMonthlyRent } from '@/lib/rent-index'
import { plainSnippet } from '@/lib/strip-md'

/**
 * THE LISTING PAGE'S STRUCTURED DATA — one pure function from a listing's fields to the one JSON-LD
 * node that page publishes, or null for none (SEO wave B, S3).
 *
 * ⛔ IT REPLACES ONE Product+Offer BLOCK THAT EVERY INDEXABLE LISTING BUT A JOB PUBLISHED, which was
 * false in five ways (measured on live eno.vn, 2026-09-27):
 *   · 25,502 rentals said the flat was FOR SALE: a sell Offer, no monthly unit, and the portal
 *     (Nhatot, Batdongsan…) as the seller, which is not the landlord;
 *   · 78 services (the partner desks' listings and 63 eSIMs) were published as used products;
 *   · a listing with no condition was published as UsedCondition, a condition the page never shows;
 *   · every offer carried a `priceValidUntil` (posted + 90 days) nobody set;
 *   · own listings published free 0–2 day shipping and "no returns", which contradicts /returns
 *     (business storefronts give 7-day returns) and describes nothing this marketplace does.
 * Google: structured data must be "a true representation of the page content", use "the most
 * specific applicable type", and not mark up "content that is not visible to readers".
 *
 * ⚠️ PURE, AND THAT IS WHY IT IS HERE AND NOT IN THE PAGE. No Prisma, no clock, no environment and no
 * edition strings, so both editions build it and a unit test covers every kind
 * (listing-jsonld.test.ts). The page passes plain fields; it stays the one place that decides
 * whether the listing is indexable at all.
 *
 * WHAT EACH KIND PUBLISHES:
 *   rentals   → RealEstateListing, whose `mainEntity` is the Apartment, House, Room or Place, with a
 *               LeaseOut Offer priced per unit. Short stays and vehicle hire → null.
 *   goods     → Product with an Offer (a booking: an AggregateOffer with `lowPrice`).
 *   services  → Service, with an Offer only when there is a price.
 *   job, wanted, event, anything else → null. The page keeps its BreadcrumbList either way.
 *
 * ⛔ NONE OF THEM CARRIES RETURN OR SHIPPING TERMS. Both described how *eno* fulfils a sale, and eno
 * fulfils none: publishing "returns not permitted" for a product we do not sell is a claim we have
 * no standing to make, and Google reads structured data as the merchant's own statement of terms.
 * No listing page is eligible for merchant listings anyway ("only pages where a shopper can purchase
 * a product… not pages with links to other sites"), so those blocks bought nothing but the
 * contradiction. The account-level return policy in Merchant Center is what applies to the feed.
 * ⛔ NOR `aggregateRating`/`review`: the only ratings here are the SELLER's, and Google's policy is
 * explicit that seller ratings are not product ratings.
 */

/** Everything the builder reads, as plain values. The page assembles it from the listing row. */
export type ListingLdInput = {
  id: string
  /** The page's canonical URL. Every `url` below is this, and relative photos resolve against it. */
  url: string
  /** The SOURCE title, as posted — the same string the page's <title> uses. */
  title: string
  /** The raw description; flattened here with `plainSnippet`, as the meta description is. */
  description: string
  images: readonly string[]
  price: number
  /** ISO 4217 (`currencyCode` in lib/analytics.ts turns the stored symbol into it). */
  currency: string
  priceUnit: string | null
  listingType: string
  categorySlug: string
  /** The category's English name, the same the breadcrumb prints. */
  categoryName: string
  subcategorySlug: string | null
  condition: string | null
  status: string
  sellerId: string
  sellerName: string
  /** A storefront a person or business owns (`Seller.ownerId`); importer storefronts have none. */
  sellerHasOwner: boolean
  /** The owner's account is a business (`Profile.accountType`). */
  sellerIsBusiness: boolean
  sellerOfficialPartner: boolean
  /**
   * The row came from somewhere else: it stores an `affiliateUrl` (an import or a partner's item),
   * whether or not the page trusts that link enough to show it.
   */
  imported: boolean
  /** A partner BOOKING — a ticket whose price is a floor, printed "from" (isBookingCategory). */
  isBooking: boolean
  brandName: string | null
  /** `feedIdentifiers`, so the page and the Merchant feed state one GTIN and one MPN. */
  gtin?: string
  mpn?: string
  areaM2: number | null
  attributes: Record<string, unknown> | null
  district: string | null
  city: string | null
  /** When the listing appeared on eno, as the page's "Posted" line prints it (`listedAt`), ISO. */
  postedAt: string
}

export type ListingLdKind = 'rental' | 'goods' | 'service'

const LEASE_OUT = 'http://purl.org/goodrelations/v1#LeaseOut'

/**
 * The rentals subcategory → the thing that is let. A Map, like UNIT_CODES, so a stored slug such as
 * 'toString' finds nothing.
 * ⚠️ office-rental IS A Place, NOT an Accommodation: schema.org's Accommodation is somewhere to live,
 * and floorSize/bedroom counts are Accommodation properties, so an office publishes none of them.
 * ⚠️ SHORT STAYS AND VEHICLE HIRE ARE ABSENT ON PURPOSE, and so return null: a hotel night is not a
 * lease and a car is not real estate. A subcategory not listed here is treated the same way, so a
 * new one publishes nothing until someone decides what it is.
 */
const RENTAL_ENTITY: ReadonlyMap<string, 'Apartment' | 'House' | 'Room' | 'Place'> = new Map([
  ['apartment-rental', 'Apartment'],
  ['house-rental', 'House'],
  ['room-rental', 'Room'],
  ['office-rental', 'Place'],
])

/** Which of the three shapes a listing takes, or null when it publishes no item at all. */
export function listingLdKind(l: Pick<ListingLdInput, 'listingType' | 'categorySlug'>): ListingLdKind | null {
  const t = l.listingType
  if (t === 'job' || t === 'wanted' || t === 'event') return null
  /**
   * ⚠️ THE CATEGORY COUNTS AS WELL AS THE TYPE. Every production rental is `rent`, but the CI fixture
   * `ci-l-4` is a `sell` row in rentals with the bare unit 'month' (scripts/ci-fixtures.ts), and the
   * rentals category takes only `rent` and `wanted` (taxonomy.ts), so a `sell` there is a rental too.
   */
  if (t === 'rent' || l.categorySlug === 'rentals') return 'rental'
  if (t === 'service') return 'service'
  if (t === 'sell' || t === 'wholesale' || t === 'free') return 'goods'
  return null
}

/**
 * The UN/CEFACT code of the unit the price is quoted per, '' for a bare price, or null when the unit
 * cannot be stated. Parsed by `priceUnitSuffix`, the function `<Price>` prints its "/ month" with, so
 * the markup and the page cannot name different units.
 */
function unitCodeOf(priceUnit: string | null): string | null {
  const suffix = priceUnitSuffix(priceUnit)
  if (suffix === null) return ''
  return UNIT_CODES.get(suffix) ?? null
}

/**
 * A rent's unit: the stored one, or MON for a bare 'VND' from the two sellers proven to store monthly
 * rent without the suffix (`isMonthlyRent`, the rent index's own rule — Batdongsan and Rever write
 * "Rent: <price>/month" into the description instead). Any other bare rent is a price with no known
 * period, so it gets no unit and, below, no Offer.
 */
function rentUnitCode(priceUnit: string | null, sellerId: string): string | null {
  const code = unitCodeOf(priceUnit)
  if (code) return code
  if (code === '' && isMonthlyRent(priceUnit, sellerId)) return 'MON'
  return null
}

/**
 * The price as an Offer states it. With a unit it goes ONLY inside a UnitPriceSpecification with a
 * `referenceQuantity`, never as a bare `price` too: Google reads `offers.price` first and ignores the
 * specification when both are present, so a bare price would drop the unit.
 */
function priceFields(price: number, currency: string, unitCode: string): Record<string, unknown> {
  if (!unitCode) return { price, priceCurrency: currency }
  return {
    priceCurrency: currency,
    priceSpecification: {
      '@type': 'UnitPriceSpecification',
      price,
      priceCurrency: currency,
      referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode },
    },
  }
}

/**
 * A person or a business. ⚠️ Every seller used to be published as an Organization, so a private
 * individual selling a sofa was a company. A storefront with no owner is an importer's or a partner's
 * shop, and a business account or an official partner is an organisation by definition.
 */
function sellerNode(l: ListingLdInput): Record<string, unknown> {
  const org = !l.sellerHasOwner || l.sellerIsBusiness || l.sellerOfficialPartner
  return { '@type': org ? 'Organization' : 'Person', name: l.sellerName }
}

/**
 * The condition the page's chip shows, in schema.org terms, or null to state none.
 * ⚠️ NULL IS NOT "USED". An unset condition was published as UsedCondition, a claim the page never
 * makes (the chip renders only when a condition is set). The words follow the Google feed's mapping
 * (google-shopping/route.ts), so an own item's page and its feed row agree; a stored value the feed
 * would guess at ("used" for anything else) states nothing here.
 * ⛔ A PARTNER'S GOODS KEEP THEIR STORED CONDITION. Only a booking has none (goodsLd). This once read
 * `affiliateUrl ? NewCondition : …` from the days when the only partner was VinWonders, and the
 * CellphoneS import then published its 1,009 second-hand, openly scratched phones and laptops to
 * Google as new. A boxed thing has a condition; a date on a calendar does not.
 */
function conditionOf(condition: string | null): string | null {
  if (!condition) return null
  const c = condition.toLowerCase()
  if (c === 'new' || c.includes('mới')) return 'https://schema.org/NewCondition'
  if (c.includes('refurb')) return 'https://schema.org/RefurbishedCondition'
  if (c === 'used') return 'https://schema.org/UsedCondition'
  return null
}

/**
 * The stored photos as absolute URLs. Real rows are absolute; fixtures are `/…`, resolved against
 * the page's own origin. Anything else is dropped.
 * ⚠️ A PAGE URL THAT DOES NOT PARSE DROPS THE RELATIVE PHOTOS, IT DOES NOT THROW: this runs inside the
 * listing page's render, and markup is never worth a 500.
 */
function absoluteImages(images: readonly string[], pageUrl: string): string[] {
  let origin: string | null = null
  try { origin = new URL(pageUrl).origin } catch { origin = null }
  return images.flatMap((src) => {
    if (typeof src !== 'string') return []
    if (/^https?:\/\//i.test(src)) return [src]
    if (origin && src.startsWith('/') && !src.startsWith('//')) return [`${origin}${src}`]
    return []
  })
}

/** The fields every kind opens with: name, description and photos, each only when there is one. */
function common(l: ListingLdInput): Record<string, unknown> {
  const description = plainSnippet(l.description)
  const image = absoluteImages(l.images, l.url)
  return {
    name: l.title,
    ...(description ? { description } : {}),
    ...(image.length ? { image } : {}),
  }
}

/** A '0'–'5' room count as a number, '6' (the "6+" bucket) and up as ≥6, anything else as absent. */
function roomCount(v: unknown): number | 'six-plus' | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const s = String(v).trim()
  if (!/^\d{1,2}$/.test(s)) return null
  const n = Number(s)
  return n >= 6 ? 'six-plus' : n
}

function rentalLd(l: ListingLdInput): Record<string, unknown> | null {
  // No subcategory: 569 rentals, mostly Batdongsan warehouses, land and "other" — a Place, nothing more.
  const entity = !l.subcategorySlug ? 'Place' : RENTAL_ENTITY.get(l.subcategorySlug)
  if (!entity) return null
  const isAccommodation = entity !== 'Place'
  const beds = isAccommodation ? roomCount(l.attributes?.bedrooms) : null
  const baths = isAccommodation ? roomCount(l.attributes?.bathrooms) : null
  const mainEntity: Record<string, unknown> = {
    '@type': entity,
    ...(isAccommodation && typeof l.areaM2 === 'number' && Number.isFinite(l.areaM2) && l.areaM2 > 0
      ? { floorSize: { '@type': 'QuantitativeValue', value: l.areaM2, unitCode: 'MTK' } }
      : {}),
    // The stored '6' is the "6+" bucket (taxonomy.ts ROOM_COUNT_TOP), so it states a minimum.
    ...(beds === 'six-plus' ? { numberOfBedrooms: { '@type': 'QuantitativeValue', minValue: 6 } } : beds !== null ? { numberOfBedrooms: beds } : {}),
    // ⚠️ schema.org types numberOfBathroomsTotal as an Integer only, so "6 or more" cannot be stated.
    ...(typeof baths === 'number' ? { numberOfBathroomsTotal: baths } : {}),
    address: {
      '@type': 'PostalAddress',
      ...(l.district ? { addressLocality: l.district } : {}),
      ...(l.city ? { addressRegion: l.city } : {}),
      addressCountry: 'VN',
    },
    // ⛔ NO `geo` (owner decision S-b): Batdongsan stores six decimals, which can pinpoint a house.
  }
  /**
   * ⚠️ NO seller, availability, itemCondition or priceValidUntil. The portal an import comes from is
   * not the landlord, whether a flat is still free cannot be checked (Batdongsan cannot be re-read at
   * all), and a lease has no condition. An Offer whose period is unknown is dropped entirely: a rent
   * with no unit is not a statement anyone can check.
   */
  const unitCode = rentUnitCode(l.priceUnit, l.sellerId)
  const offers = unitCode && Number.isFinite(l.price) && l.price > 0
    ? { '@type': 'Offer', businessFunction: LEASE_OUT, url: l.url, ...priceFields(l.price, l.currency, unitCode) }
    : null
  return {
    '@context': 'https://schema.org',
    '@type': 'RealEstateListing',
    url: l.url,
    ...common(l),
    /**
     * ⚠️ ONLY ON AN OWN RENTAL (owner decision S-c). An import's "Posted" date is the day eno imported
     * the ad, not the day its landlord posted it, so it would state a date nobody posted on.
     */
    ...(l.imported ? {} : { datePosted: l.postedAt }),
    mainEntity,
    ...(offers ? { offers } : {}),
  }
}

function goodsLd(l: ListingLdInput): Record<string, unknown> | null {
  const unitCode = unitCodeOf(l.priceUnit)
  // A unit with no UN/CEFACT code ('VND/bag') cannot be stated, and a price without it would be false.
  if (unitCode === null) return null
  if (!Number.isFinite(l.price) || l.price < 0) return null
  // "Free" is a price only on a giveaway; a `sell` at 0 is a price nobody set.
  if (l.price === 0 && l.listingType !== 'free') return null
  const condition = conditionOf(l.condition)
  /**
   * ⚠️ A BOOKING'S PRICE IS A FLOOR. The page prints "from": the partner sets the real amount at
   * checkout by date, so the markup states the lowest price, not an offer at it, and no condition (a
   * date on a calendar has none). A booking priced per unit is not a shape anything stores; it
   * publishes nothing rather than a floor without its unit.
   */
  if (l.isBooking && unitCode) return null
  const offers = l.isBooking
    ? { '@type': 'AggregateOffer', url: l.url, lowPrice: l.price, priceCurrency: l.currency }
    : {
        '@type': 'Offer',
        url: l.url,
        ...priceFields(l.price, l.currency, unitCode),
        availability: l.status === 'sold' ? 'https://schema.org/SoldOut' : 'https://schema.org/InStock',
        ...(condition ? { itemCondition: condition } : {}),
        seller: sellerNode(l),
      }
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    ...common(l),
    sku: l.id,
    ...(l.brandName ? { brand: { '@type': 'Brand', name: l.brandName } } : {}),
    ...(l.gtin ? { gtin: l.gtin } : {}),
    ...(l.mpn ? { mpn: l.mpn } : {}),
    category: l.categoryName,
    offers,
  }
}

function serviceLd(l: ListingLdInput): Record<string, unknown> {
  /**
   * ⚠️ A SERVICE AT PRICE 0 HAS NO Offer, NOT AN OFFER AT 0: the free eSIMs and the trip desk's
   * planning cost nothing up front, and "0 VND" is not a price anyone quoted. A unit with no code
   * drops the Offer the same way.
   */
  const unitCode = unitCodeOf(l.priceUnit)
  const offers = unitCode !== null && Number.isFinite(l.price) && l.price > 0
    ? { '@type': 'Offer', url: l.url, ...priceFields(l.price, l.currency, unitCode) }
    : null
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    url: l.url,
    ...common(l),
    provider: sellerNode(l),
    category: l.categoryName,
    ...(offers ? { offers } : {}),
  }
}

/** The one JSON-LD item a listing page publishes, or null for none. */
export function listingJsonLd(l: ListingLdInput): Record<string, unknown> | null {
  switch (listingLdKind(l)) {
    case 'rental': return rentalLd(l)
    case 'goods': return goodsLd(l)
    case 'service': return serviceLd(l)
    default: return null
  }
}
