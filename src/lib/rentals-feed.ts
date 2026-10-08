import { escapeCsv } from '@/lib/feed-csv'
import { feedExcluded, feedStock } from '@/lib/product-feed'
import { isListingImageUrl } from '@/lib/listing-image'
import { overlayMarkFromUrl } from '@/lib/image-mark-url'
import {
  isMonthlyRent, bedroomCount, assignDistrict, MIN_MONTHLY_VND, MAX_MONTHLY_VND,
  MIN_AREA_M2, MAX_AREA_M2, MIN_VND_PER_M2, MAX_VND_PER_M2,
} from '@/lib/rent-index'
import { districtLabel, unaccent } from '@/lib/district-canonical'
import { isHcmc } from '@/lib/city-short'
import { RENTAL_IMPORT_SELLERS } from '@/lib/import-sellers'
import { redactContact } from '@/lib/vehicle-rental-listing'
import { plainSnippet, stripMarkdown } from '@/lib/strip-md'
import { formatMoneyFull } from '@/lib/vnd'
import { SITE_NAME } from '@/lib/edition'
import type { SerializedRentalFeedListing } from '@/lib/serialize'

/**
 * THE APARTMENT-RENTALS CATALOGUE FEED (Meta products CSV) — owner, 2026-10-07: "fb product feed doesnt
 * have apartment rentals … we need to show them below the ad in carousel". Served by
 * /api/feeds/facebook-rentals into its OWN catalogue ("eno.vn — apartment rentals"), whose product set
 * fills the "Products" row under the rentals video ad. Pure: rows in, CSV cells out.
 *
 * ⛔ A SEPARATE FEED AND A SEPARATE CATALOGUE, NEVER A WIDER GOODS FEED. `feedCategories()` and
 * `feedListingTypes()` also feed Google Shopping, and on eno.forum they add the visa desk; widening
 * them would put flats in Merchant Center and goods under the rentals ad. The goods catalogue's
 * "All Products" set has no filter, so a shared catalogue would mix the two rows on Meta as well.
 *
 * ⚠️ EVERY DROPPED ROW IS COUNTED under its reason (the route logs the tally and sends it as
 * X-Feed-Excluded) — a feed that shrinks in silence looks exactly like a market that did.
 */

export const RENTAL_FEED_HEADERS = [
  'id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand',
  'product_type', 'additional_image_link',
  'custom_label_0', 'custom_label_1', 'custom_label_2', 'custom_label_3', 'custom_label_4',
] as const

/** A row's CSV cells, or the reason it is withheld: `currency`, `not_monthly`, `price_band`,
 *  `no_image`, or a `feedExcluded` policy reason. */
export type RentalFeedResult = { row: string[] } | { excluded: string }

/**
 * ⚠️ 500 px ON THE SHORTER EDGE, where the file name records the size (clean imports,
 * image-mark-url.ts). Meta's own floor is lower; a carousel card is square-cropped, so a thin strip
 * that passes its floor still shows as a blur. Files without a recorded size go to Meta's own check.
 */
export const MIN_IMAGE_EDGE = 500
/** Meta reads up to 20 extra images; the goods feed sends 10, and so does this one. */
const MAX_EXTRA_IMAGES = 10
const DESCRIPTION_MAX = 1000
const TITLE_MAX = 150
/**
 * ⚠️ THE PLACE IS CLIPPED SO THE RENT ALWAYS SURVIVES (commit-gate review, codex + opus). The other parts are
 * bounded — at most ~23 + 7 + 19 characters plus separators — so a place of 60 keeps the title under 150
 * and the "/month" at its end; a stored district can be any length.
 */
const PLACE_MAX = 60

/**
 * At most `max` UTF-16 units, never half an emoji (commit-gate review, opus): a surrogate pair cut in two
 * encodes as U+FFFD, a "�" at the end of a paid ad's text.
 */
function cut(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, /[\uD800-\uDBFF]/.test(s[max - 1]) ? max - 1 : max)
}

/** Cut at the last word boundary before `max`, with an ellipsis. */
function clip(s: string, max: number): string {
  if (s.length <= max) return s
  const head = cut(s, max - 1)
  const at = head.lastIndexOf(' ')
  return `${(at > max / 2 ? head.slice(0, at) : head).replace(/[\s,·]+$/, '')}…`
}

/**
 * The images a catalogue row may carry, in stored order (a curated cover stays first), each once.
 *
 * ⛔ FIRST-PARTY STORAGE ONLY (`isListingImageUrl`). A hotlinked source photo — photo.rever.vn is the
 * live case — is fetched by Meta's crawler from a host that refuses it, and a placeholder would put
 * a grey box in a paid ad. A row with nothing left is withheld as `no_image`, never sent without one.
 * ⛔ NOTHING IS GENERATED OR BURNED IN: these are the stored files (eno-watermark-never-burn).
 */
export function feedImages(images: readonly string[]): string[] {
  const kept = images.filter((u) => {
    if (!isListingImageUrl(u)) return false
    const size = overlayMarkFromUrl(u)
    return !size || Math.min(size.width, size.height) >= MIN_IMAGE_EDGE
  })
  return [...new Set(kept)]
}

export type CityLabel = 'hcmc' | 'hanoi' | 'danang' | 'other'

const foldCity = (s: string) =>
  unaccent(s.normalize('NFC')).toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^(?:thanh pho|tp)\s+/, '')

/** custom_label_1, from the stored province name ("Hồ Chí Minh", "Hà Nội", "Đà Nẵng"). */
export function cityLabel(city: string | null | undefined): CityLabel {
  if (isHcmc(city)) return 'hcmc'
  const c = foldCity(city ?? '')
  if (c === 'ha noi' || c === 'hanoi') return 'hanoi'
  if (c === 'da nang' || c === 'danang') return 'danang'
  return 'other'
}

const CITY_EN: Record<Exclude<CityLabel, 'other'>, string> = { hcmc: 'Ho Chi Minh City', hanoi: 'Hanoi', danang: 'Da Nang' }

/**
 * The place a card names, in English. An HCMC row the rent index can place gets the curated name
 * ("District 7", "Thu Duc City" — the parenthetical neighbourhood is dropped for width); anything
 * else keeps its stored district without diacritics, the way the curated English names are written,
 * followed by the city.
 */
export function placeLabel(city: string | null | undefined, district: string | null | undefined): string | null {
  const label = cityLabel(city)
  const slug = label === 'hcmc' ? assignDistrict(district ?? null) : null
  if (slug) return districtLabel(slug).en.replace(/\s*\([^)]*\)\s*$/, '')
  const d = district?.trim() ? unaccent(district.trim()) : ''
  const c = label === 'other' ? (city?.trim() ? unaccent(city.trim()) : '') : CITY_EN[label]
  return [d, c].filter(Boolean).join(', ') || null
}

export type PriceBand = 'lt10m' | '10-20m' | '20-40m' | '40m-plus'

/** custom_label_3: the monthly-rent band, for product sets and per-band ads. Lower bounds inclusive. */
export function priceBand(price: number): PriceBand {
  return price < 10_000_000 ? 'lt10m' : price < 20_000_000 ? '10-20m' : price < 40_000_000 ? '20-40m' : '40m-plus'
}

/**
 * custom_label_4: the importer a row came from, else `eno` (a member's own post). The owner allowed every
 * source's photos in paid ads (2026-10-07); the label is the lever if that changes — a product-set filter,
 * no deploy.
 * ⚠️ TYPED BY RENTAL_IMPORT_SELLERS, so a new rental importer fails tsc here until it is named.
 */
const SOURCE_LABEL: Record<(typeof RENTAL_IMPORT_SELLERS)[number], string> = {
  'bds-vn-import-seller-0001': 'batdongsan',
  'cmub0wead0000zrq418bqq27m': 'rever',
  'nhatot-import-seller-0001': 'nhatot',
  'muaban-net-import-seller-0001': 'muaban',
  'honeycomb-import-seller-0001': 'honeycomb',
}

export function sourceLabel(sellerId: string): string {
  return (SOURCE_LABEL as Record<string, string>)[sellerId] ?? 'eno'
}

/** A stored area that reads as a FLOOR area — the rent index's own rule (5–2,000 m², 10k–2M ₫ per m² per
 *  month); anything else is a land area or an import slip, and the title leaves it out. */
function floorArea(areaM2: number | null, price: number): number | null {
  if (areaM2 === null || !Number.isFinite(areaM2) || areaM2 < MIN_AREA_M2 || areaM2 > MAX_AREA_M2) return null
  const perM2 = price / areaM2
  return perM2 >= MIN_VND_PER_M2 && perM2 <= MAX_VND_PER_M2 ? areaM2 : null
}

/** `bedroomCount` is null when unknown and 0 for a studio — never print "0 bedrooms". */
function unitName(bedrooms: number | null): string {
  if (bedrooms === null) return 'Apartment'
  return bedrooms === 0 ? 'Studio' : `${bedrooms}BR apartment`
}

export function productType(bedrooms: number | null): string {
  const base = 'Rentals > Apartment'
  if (bedrooms === null) return base
  if (bedrooms === 0) return `${base} > Studio`
  return `${base} > ${bedrooms >= 6 ? '6+ bedrooms' : `${bedrooms} bedroom${bedrooms === 1 ? '' : 's'}`}`
}

/**
 * "2BR apartment for rent · District 7 · 70 m² · 15,000,000 đ/month".
 *
 * ⚠️ COMPOSED, NOT THE STORED TITLE. Each portal titles its rows its own way (Batdongsan's carry no
 * "Apartment", Nhà Tốt's lead with it), and a carousel card shows a line or two of the name beside a bare
 * price — so the unit and the place come first and the rent period is said in words, never left for the
 * reader to infer from a number. The stored title goes into the description, where its building names
 * and wards still reach the reader.
 */
export function rentalTitle(l: Pick<SerializedRentalFeedListing, 'attributes' | 'city' | 'district' | 'areaM2'>, price: number): string {
  const area = floorArea(l.areaM2, price)
  const place = placeLabel(l.city, l.district)
  return cut([
    `${unitName(bedroomCount(l.attributes))} for rent`,
    place ? clip(place, PLACE_MAX) : null,
    area !== null ? `${Math.round(area)} m²` : null,
    `${formatMoneyFull(price, '₫', 'en')}/month`,
  ].filter(Boolean).join(' · '), TITLE_MAX)
}

/**
 * "Monthly rent: 15,000,000 đ. <stored title>. <description>", at most 1,000 characters.
 * ⛔ CONTACT DETAILS ARE TAKEN OUT (`redactContact`): a phone number or a portal URL in a paid catalogue
 * row sends the click past the listing page, and eno never publishes phone numbers.
 * ⛔ MARKDOWN GOES FIRST, THEN THE CONTACTS, THEN THE FLATTENING (commit-gate review, opus): redacting first
 * missed "0909 **123** 456" — the asterisks broke the number's pattern, and stripping them afterwards left a
 * clean phone number in the ad. `redactContact` still sees the lines, so its contact-line rule still applies.
 */
export function rentalDescription(l: Pick<SerializedRentalFeedListing, 'title' | 'description'>, price: number): string {
  const body = plainSnippet(redactContact(stripMarkdown(l.description)))
  const named = redactContact(stripMarkdown(l.title)).replace(/\s+/g, ' ').trim()
  const lead = named && !body.startsWith(named) ? (/[.!?]$/.test(named) ? named : `${named}.`) : ''
  return cut([`Monthly rent: ${formatMoneyFull(price, '₫', 'en')}.`, lead, body].filter(Boolean).join(' '), DESCRIPTION_MAX)
}

export function rentalLink(host: string, id: string): string {
  return `${host.replace(/\/+$/, '')}/listings/${id}?utm_source=facebook&utm_medium=catalog&utm_campaign=rentals`
}

/**
 * One listing → its catalogue row, or the reason it is withheld. Checked in this order, so each row is
 * counted once, under the first rule it fails.
 */
export function rentalFeedRow(l: SerializedRentalFeedListing, host: string): RentalFeedResult {
  if (l.currency !== '₫') return { excluded: 'currency' }
  // A per-night or per-day price in a monthly-rent row would advertise a price nobody pays.
  if (!isMonthlyRent(l.priceUnit, l.sellerId)) return { excluded: 'not_monthly' }
  const price = Number(l.price)
  if (!Number.isFinite(price) || price < MIN_MONTHLY_VND || price > MAX_MONTHLY_VND) return { excluded: 'price_band' }
  // Meta's commerce policy, as for goods; either language's title can carry the term.
  const refused = feedExcluded(l.title) ?? (l.titleVi ? feedExcluded(l.titleVi) : null)
  if (refused) return { excluded: refused }
  const images = feedImages(l.images)
  if (!images.length) return { excluded: 'no_image' }

  const bedrooms = bedroomCount(l.attributes)
  const city = cityLabel(l.city)
  return {
    row: [
      escapeCsv(l.id),
      escapeCsv(rentalTitle(l, price)),
      escapeCsv(rentalDescription(l, price)),
      // Meta spells it with spaces (the goods feed's note on feedStock).
      feedStock(l) === 'in_stock' ? 'in stock' : 'out of stock',
      // Required for a product and not shown on the cards; `used` claims nothing about the building.
      'used',
      escapeCsv(`${Math.round(price)} VND`),
      escapeCsv(rentalLink(host, l.id)),
      escapeCsv(images[0]),
      // The building's own site name: the route ships on both editions, and links use that edition's host.
      SITE_NAME,
      escapeCsv(productType(bedrooms)),
      escapeCsv(images.slice(1, 1 + MAX_EXTRA_IMAGES).join(',')),
      escapeCsv(l.subcategorySlug ?? ''),
      city,
      city === 'hcmc' ? escapeCsv(assignDistrict(l.district) ?? '') : '',
      priceBand(price),
      sourceLabel(l.sellerId),
    ],
  }
}
