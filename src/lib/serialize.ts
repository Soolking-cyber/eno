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
    images: safeParse<string[]>(l.images, []),
    categoryId: l.categoryId,
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

export function formatPrice(price: number, currency: string, priceUnit: string): string {
  const formatted = new Intl.NumberFormat('en-US').format(price)
  if (priceUnit === 'VND') return `${currency}${formatted}`
  // priceUnit like "VND/month", "VND/service (from)" -> show unit suffix
  const suffix = priceUnit.replace(/^VND\/?/, '').trim()
  return suffix ? `${currency}${formatted} / ${suffix}` : `${currency}${formatted}`
}
