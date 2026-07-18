// Client-safe shared types for the marketplace frontend.
// Mirrors the shapes returned by the API routes (see src/lib/serialize.ts).

export type CategoryColor = 'brand' | 'sky' | 'indigo' | 'violet' | 'cyan' | 'teal'

export type SerializedCategory = {
  id: string
  name: string
  nameVi: string
  slug: string
  icon: string
  color: CategoryColor
  description: string | null
  verifiedCount: number
}

// Card projection: exactly the fields the feed/rail/map cards render — the wire
// format for every list surface. SerializedListing (detail/dashboard) is a structural
// superset, so a full listing is always assignable where a card is expected.
export type SerializedListingCard = {
  id: string
  title: string
  titleVi: string | null
  titleI18n?: Record<string, string>
  price: number
  priceUnit: string
  currency: string
  negotiable: boolean
  // Active price-drop anchor (server-normalized): the struck-through "was" price
  // while the drop badge is live (7 days), else null. Server-computed 30-day-min
  // reference — never a seller-entered number.
  prevPrice: number | null
  // Urgent sale ("Bán gấp") — resolved read-time from urgentUntil.
  urgent: boolean
  location: string
  district: string | null
  city: string
  lat: number | null
  lng: number | null
  images: string[]
  // Optional listing video (public URL). Autoplays muted on card hover + powers the Video feed.
  // Optional so full-listing surfaces (PDP shelves, storefront) that render SerializedListing
  // as a card still satisfy the type; they populate it from SerializedListing.video below.
  video?: string | null
  brandSlug: string | null
  model: string | null
  // Below the market band for its brand+model+segment (< P25) → "Good price" card chip.
  // Denormalized nightly (Listing.marketPosition); the PDP shows the exact live band.
  goodPrice?: boolean
  verified: boolean
  postedAt: string
  savedCount: number
  // Demand proof for the card meta line ("Đã liên hệ N") — distinct authenticated
  // contact reveals, same counter the detail page uses. Cards render it only at ≥3.
  contactCount: number
  category: {
    id: string
    name: string
    nameVi: string
    slug: string
    icon: string
    color: CategoryColor
  }
  seller: {
    trustScore: number
    isBusiness: boolean
  }
}

export type SerializedListing = {
  id: string
  title: string
  titleVi: string | null
  // Pre-warmed title translations embedded for seamless rendering (en/vi omitted — source +
  // titleVi cover those). Populated by localizeListingTitles at card-producing fetch sites.
  titleI18n?: Record<string, string>
  description: string
  price: number
  priceUnit: string
  currency: string
  negotiable: boolean
  // Price-drop badge (see SerializedListingCard.prevPrice) + when the drop landed
  // (ISO, only while the badge is live — powers "dropped 3 days ago" on the detail page).
  prevPrice: number | null
  priceDropAt: string | null
  // When the drop badge lapses (priceDropAt + DROP.BADGE_MS, ISO) while the drop is
  // live, else null. WHY: the PDP counts down the badge ("còn N ngày") — cards keep
  // the bare "−12%" so this is intentionally NOT on SerializedListingCard.
  dropExpiresAt: string | null
  urgent: boolean
  location: string
  district: string | null
  city: string
  lat: number | null
  lng: number | null
  condition: string | null
  images: string[]
  // Optional listing video (public URL) — shown on the detail page + carried so full-listing
  // surfaces (PDP shelves, storefront, saved) render it as a card video too.
  video: string | null
  categoryId: string
  subcategorySlug: string | null
  brandSlug: string | null
  model: string | null
  listingType: string
  category: {
    id: string
    name: string
    nameVi: string
    slug: string
    icon: string
    color: CategoryColor
  }
  sellerId: string
  seller: {
    id: string
    name: string
    avatarColor: string
    rating: number
    reviewCount: number
    verifiedSeller: boolean
    trustTier: string
    trustScore: number
    responseRate: number
    responseTime: string
    // Seller join date (ISO) — powers the PDP SellerCard "Thành viên từ {year}".
    // Derive the year client-side; the raw responseRate/responseTime are for the
    // server-side responseBucket helper only (never render the number to buyers).
    memberSince: string
    phone: string | null
    isBusiness: boolean
  }
  verified: boolean
  status: string
  verificationMethod: string | null
  verifiedAt: string | null
  verifiedBy: string | null
  verificationNotes: string | null
  postedAt: string
  views: number
  savedCount: number
  contactCount: number
  availabilityConfirmedAt: string | null
  featured: boolean
  attributes: Record<string, unknown> | null
  // Structured numeric specs (vehicles) — null when not applicable.
  year: number | null
  mileageKm: number | null
  engineL: number | null
}

export type Stats = {
  totalListings: number
  verifiedListings: number
  pendingListings: number
  totalSellers: number
  verifiedSellers: number
  flaggedThisMonth: number
  verificationRate: number
  byCategory: { slug: string; name: string; count: number }[]
}

export type VerificationMethod = 'in-person' | 'video-call' | 'document-check' | 'agent-visit'

export function timeAgo(iso: string, lang: string = 'vi'): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  const h = Math.floor(m / 60), d = Math.floor(h / 24), mo = Math.floor(d / 30), y = Math.floor(mo / 12)
  // Hand-crafted compact forms for the two primary markets.
  if (lang === 'vi') {
    if (m < 1) return 'vừa xong'
    if (m < 60) return `${m} phút trước`
    if (h < 24) return `${h} giờ trước`
    if (d < 30) return `${d} ngày trước`
    if (mo < 12) return `${mo} tháng trước`
    return `${y} năm trước`
  }
  const en = () => m < 1 ? 'just now' : m < 60 ? `${m}m ago` : h < 24 ? `${h}h ago` : d < 30 ? `${d}d ago` : mo < 12 ? `${mo}mo ago` : `${y}y ago`
  if (lang === 'en') return en()
  // Every OTHER supported language → properly localized via Intl.RelativeTimeFormat
  // ("12 дн. назад", "12日前", …) so relative time is never stuck in English.
  try {
    const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto', style: 'short' })
    if (m < 1) return rtf.format(0, 'second')
    if (m < 60) return rtf.format(-m, 'minute')
    if (h < 24) return rtf.format(-h, 'hour')
    if (d < 30) return rtf.format(-d, 'day')
    if (mo < 12) return rtf.format(-mo, 'month')
    return rtf.format(-y, 'year')
  } catch { return en() }
}

// Single-accent palette: every category renders in the one brand blue.
// Keeping the per-category keys lets existing lookups resolve while the UI
// stays cohesive (the product photos carry the colour, not the chrome).
const BRAND_BLUE = {
  bg: 'bg-primary',
  text: 'text-brand',
  ring: 'ring-brand/20',
  soft: 'bg-brand-50 text-brand border-brand/15',
  grad: 'from-brand to-[#2f80c4]',
}

export const CATEGORY_COLOR_CLASSES: Record<CategoryColor, { bg: string; text: string; ring: string; soft: string; grad: string }> = {
  brand: BRAND_BLUE,
  sky: BRAND_BLUE,
  indigo: BRAND_BLUE,
  violet: BRAND_BLUE,
  cyan: BRAND_BLUE,
  teal: BRAND_BLUE,
}
