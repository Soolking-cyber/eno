import type { Listing, Category, Seller, Prisma } from '@/generated/prisma/client'
import type { SerializedListing, SerializedListingCard, SerializedCategory, CategoryColor } from './types'

export function safeParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

// Price-drop badge normalization: the struck-through anchor is exposed ONLY while
// the badge is live — a qualifying drop within the last 3 days and an anchor still
// above the current price. Everything else serializes to null, so clients never
// have to reason about stale campaigns. Mirrors DROP.BADGE_MS in src/lib/price-drop.ts.
const DROP_BADGE_MS = 3 * 24 * 60 * 60 * 1000
function activeDropAnchor(previousPrice: number | null, priceDropAt: Date | null, price: number): number | null {
  if (previousPrice == null || !priceDropAt || previousPrice <= price) return null
  return Date.now() - priceDropAt.getTime() < DROP_BADGE_MS ? previousPrice : null
}

// MOCK DATA self-heal: older mock rows stored loremflickr image URLs, which now
// 502. Rewrite them to a stable picsum URL at serialize time so the catalog renders
// without a re-seed. No-op for real (Supabase) images. Remove with the mock data at launch.
function fixMockImage(u: string): string {
  if (typeof u !== 'string' || !u.includes('loremflickr.com')) return u
  const m = u.match(/lock=(\d+)/)
  const seed = m ? m[1] : String(Math.abs([...u].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)))
  return `https://picsum.photos/seed/eno${seed}/600/450`
}

export function serializeListing(
  l: Listing & { category: Category; seller: Seller & { owner?: { accountType: string | null } | null } },
): SerializedListing {
  return {
    id: l.id,
    title: l.title,
    titleVi: l.titleVi,
    description: l.description,
    price: l.price,
    priceUnit: l.priceUnit,
    currency: l.currency,
    negotiable: l.negotiable,
    prevPrice: activeDropAnchor(l.previousPrice, l.priceDropAt, l.price),
    priceDropAt: activeDropAnchor(l.previousPrice, l.priceDropAt, l.price) != null ? l.priceDropAt!.toISOString() : null,
    // When the drop badge expires (droppedAt + DROP.BADGE_MS) while a drop is live —
    // lets the PDP render "còn N ngày". Null once the anchor lapses or never dropped.
    dropExpiresAt:
      activeDropAnchor(l.previousPrice, l.priceDropAt, l.price) != null
        ? new Date(l.priceDropAt!.getTime() + DROP_BADGE_MS).toISOString()
        : null,
    urgent: !!l.urgentUntil && l.urgentUntil.getTime() > Date.now(),
    urgentUntil: l.urgentUntil ? l.urgentUntil.toISOString() : null,
    location: l.location,
    district: l.district,
    city: l.city,
    lat: l.lat,
    lng: l.lng,
    condition: l.condition,
    images: safeParse<string[]>(l.images, []).map(fixMockImage),
    video: l.video,
    categoryId: l.categoryId,
    subcategorySlug: l.subcategorySlug,
    brandSlug: l.brandSlug,
    model: l.model,
    listingType: l.listingType,
    category: {
      id: l.category.id,
      name: l.category.name,
      nameVi: l.category.nameVi,
      slug: l.category.slug,
      icon: l.category.icon,
      color: l.category.color as CategoryColor,
    },
    sellerId: l.sellerId,
    seller: {
      id: l.seller.id,
      name: l.seller.name,
      avatarColor: l.seller.avatarColor,
      // The shop's PHOTO. It was missing here, so every PDP fell back to initials-on-colour
      // while the storefront showed the real logo — the same shop looked like two different
      // sellers depending on which page you were on (owner 2026-07-24: "product page store
      // name image to be exact"). avatarColor alone is only the FALLBACK; without the url
      // beside it the fallback is all anyone ever saw.
      avatarUrl: l.seller.avatarUrl,
      rating: l.seller.rating,
      reviewCount: l.seller.reviewCount,
      verifiedSeller: l.seller.verifiedSeller,
      trustTier: l.seller.trustTier,
      trustScore: l.seller.trustScore,
      responseRate: l.seller.responseRate,
      responseTime: l.seller.responseTime,
      // Join year source for the PDP SellerCard ("Thành viên từ 2024"). ISO; derive the
      // year client-side. Raw responseRate/responseTime above are consumed ONLY by the
      // server-side responseBucket helper — never surface the number to buyers.
      memberSince: l.seller.memberSince.toISOString(),
      // Public-safe by default: phone is omitted from list/feed payloads to prevent
      // bulk PII harvesting. Use serializeListingWithContact for single-listing detail.
      phone: null,
      // True when the storefront is owned by a business account (false unless the
      // query included seller.owner — safe default).
      isBusiness: l.seller.owner?.accountType === 'business',
    },
    verified: l.verified,
    status: l.status,
    verificationMethod: l.verificationMethod,
    verifiedAt: l.verifiedAt ? l.verifiedAt.toISOString() : null,
    verifiedBy: l.verifiedBy,
    verificationNotes: l.verificationNotes,
    postedAt: l.postedAt.toISOString(),
    views: l.views,
    savedCount: l.savedCount,
    contactCount: l.contactCount,
    availabilityConfirmedAt: l.availabilityConfirmedAt ? l.availabilityConfirmedAt.toISOString() : null,
    featured: l.featured,
    attributes: safeParse<Record<string, unknown> | null>(l.attributes, null),
    year: l.year,
    mileageKm: l.mileageKm,
    engineL: l.engineL,
  }
}

// ── Card projection ───────────────────────────────────────────────────────────
// The feed/rails/map only render ~20 fields; the full serializeListing payload
// (description, attributes, verification meta, full Seller row…) tripled feed JSON
// and dragged searchText/PII through Postgres for nothing. Query with
// LISTING_CARD_SELECT and serialize with serializeListingCard on every list surface.
export const LISTING_CARD_SELECT = {
  id: true, title: true, titleVi: true, price: true, priceUnit: true, currency: true, negotiable: true,
  previousPrice: true, priceDropAt: true, urgentUntil: true,
  location: true, district: true, city: true, lat: true, lng: true, images: true, video: true,
  brandSlug: true, model: true, condition: true, marketPosition: true, verified: true, postedAt: true, savedCount: true, contactCount: true,
  category: { select: { id: true, name: true, nameVi: true, slug: true, icon: true, color: true } },
  seller: { select: { trustScore: true, owner: { select: { accountType: true } } } },
} as const

type ListingCardRow = {
  id: string; title: string; titleVi: string | null; price: number; priceUnit: string
  currency: string; negotiable: boolean; location: string; district: string | null; city: string
  previousPrice: number | null; priceDropAt: Date | null; urgentUntil: Date | null
  lat: number | null; lng: number | null; images: string; video: string | null; brandSlug: string | null
  model: string | null; condition: string | null; marketPosition: string | null; verified: boolean; postedAt: Date; savedCount: number; contactCount: number
  category: { id: string; name: string; nameVi: string; slug: string; icon: string; color: string }
  seller: { trustScore: number; owner?: { accountType: string | null } | null }
}

export function serializeListingCard(l: ListingCardRow): SerializedListingCard {
  return {
    id: l.id,
    title: l.title,
    titleVi: l.titleVi,
    price: l.price,
    priceUnit: l.priceUnit,
    currency: l.currency,
    negotiable: l.negotiable,
    prevPrice: activeDropAnchor(l.previousPrice, l.priceDropAt, l.price),
    urgent: !!l.urgentUntil && l.urgentUntil.getTime() > Date.now(),
    urgentUntil: l.urgentUntil ? l.urgentUntil.toISOString() : null,
    location: l.location,
    district: l.district,
    city: l.city,
    lat: l.lat,
    lng: l.lng,
    images: safeParse<string[]>(l.images, []).map(fixMockImage),
    video: l.video,
    brandSlug: l.brandSlug,
    model: l.model,
    condition: l.condition,
    // "Good price" card badge = below the market band's P25. Only the deal-positive signal
    // reaches the card (never "above market" — that would just be hostile to sellers).
    goodPrice: l.marketPosition === 'low',
    verified: l.verified,
    postedAt: l.postedAt.toISOString(),
    savedCount: l.savedCount,
    contactCount: l.contactCount,
    category: {
      id: l.category.id,
      name: l.category.name,
      nameVi: l.category.nameVi,
      slug: l.category.slug,
      icon: l.category.icon,
      color: l.category.color as CategoryColor,
    },
    seller: {
      trustScore: l.seller.trustScore,
      isBusiness: l.seller.owner?.accountType === 'business',
    },
  }
}

// Wizard/dashboard category picker shape — was copy-pasted at 3 call sites.
// verifiedCount is 0 here on purpose: only the homepage feed computes real counts.
export function serializeCategoryBasic(c: { id: string; name: string; nameVi: string; slug: string; icon: string; color: string; description: string | null }): SerializedCategory {
  return {
    id: c.id, name: c.name, nameVi: c.nameVi, slug: c.slug, icon: c.icon,
    color: c.color as SerializedCategory['color'], description: c.description, verifiedCount: 0,
  }
}

/**
 * THE PRODUCT-FEED PROJECTION — the narrowest row the Google Merchant / Meta catalog feeds need.
 *
 * ⚠️ IT EXISTS BECAUSE `serializeListing` REQUIRES A WHOLE `Listing`, and satisfying that meant the
 * feeds fetching every scalar plus `include: { seller: true }` — which joined the seller's phone and
 * email into a response that reads NOT ONE seller field. Narrowing the query is what surfaced the
 * dependency: tsc rejected the narrow row against `serializeListing`'s wide parameter, which is the
 * type system correctly refusing to pretend.
 *
 * Adding a third serializer is the smaller cost. The alternative — widening the feed's select back
 * to satisfy a function whose output it 90% discards — is how the PII got there in the first place.
 *
 * ⚠️ IMAGE HANDLING STAYS SHARED. `images` is a JSON string column, and mock rows need
 * `fixMockImage`; duplicating either into the route would be the real duplication. That is the whole
 * reason this lives here rather than in the feed handlers.
 */
/**
 * ⚠️ THERE IS DELIBERATELY NO `take` HERE, AND THAT IS A REVERSAL WORTH RECORDING.
 * An earlier version of this change added `take: 45000` to both product feeds to bound a query that
 * had none. All THREE reviewers independently refused it, and they were right: Google Merchant and
 * Meta treat a full-catalog feed as AUTHORITATIVE, so an item missing from a fetch is DELISTED, not
 * ignored. With `orderBy: postedAt desc`, crossing the cap would silently pull the oldest live
 * listings out of Shopping and the Meta catalog — trading a hypothetical out-of-memory for a certain
 * business regression. The cap also did not fix what it was written for: the whole result set is
 * still concatenated into one string, so the response ceiling is hit long before the item count
 * matters.
 *
 * The unbounded query is a REAL risk and it is still open. The fix is to stream rows into the
 * response rather than to truncate the catalogue; it is genuine work and it does not belong in the
 * same commit as a PII removal. Tracked, not silently "handled".
 */

export const LISTING_FEED_SELECT = {
  id: true, title: true, titleVi: true, description: true, price: true, currency: true,
  condition: true, images: true, brandSlug: true,
  category: { select: { slug: true, name: true } },
} as const

/**
 * ⚠️ DERIVED FROM THE SELECT, NOT RETYPED BESIDE IT. A hand-written row type is bound to the query
 * by nothing at all: widen LISTING_FEED_SELECT and the two drift apart in silence. Deriving makes
 * the select the single source of truth, so the type follows it automatically — verified by adding
 * `seller: { select: { phone: true } }` and watching `SerializedFeedListing` gain `seller.phone`.
 *
 * ⚠️ IT SURFACES A LEAK, IT DOES NOT BLOCK ONE — an earlier version of this comment claimed more
 * than that, and codex was right to call it. `serializeFeedListing` spreads `{ ...l }`, so anything
 * added to the select still flows into the output; what changes is that it now appears in the TYPE,
 * where a reader and every consumer can see it, instead of being invisible behind a stale hand-
 * written shape. That is a meaningful difference and it is not a guarantee. The guarantee, if this
 * ever needs one, is an explicit field-by-field return rather than a spread.
 */
type ListingFeedRow = Prisma.ListingGetPayload<{ select: typeof LISTING_FEED_SELECT }>

export type SerializedFeedListing = Omit<ListingFeedRow, 'images'> & { images: string[] }

export function serializeFeedListing(l: ListingFeedRow): SerializedFeedListing {
  return { ...l, images: safeParse<string[]>(l.images, []).map(fixMockImage) }
}
