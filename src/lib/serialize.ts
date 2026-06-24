import type { Listing, Category, Seller } from '@prisma/client'
import type { SerializedListing, CategoryColor } from './types'

export function safeParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
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
    location: l.location,
    district: l.district,
    city: l.city,
    lat: l.lat,
    lng: l.lng,
    condition: l.condition,
    images: safeParse<string[]>(l.images, []).map(fixMockImage),
    categoryId: l.categoryId,
    subcategorySlug: l.subcategorySlug,
    brandSlug: l.brandSlug,
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
      rating: l.seller.rating,
      reviewCount: l.seller.reviewCount,
      verifiedSeller: l.seller.verifiedSeller,
      trustTier: l.seller.trustTier,
      trustScore: l.seller.trustScore,
      responseRate: l.seller.responseRate,
      responseTime: l.seller.responseTime,
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
  }
}
