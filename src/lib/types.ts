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
  location: string
  district: string | null
  city: string
  lat: number | null
  lng: number | null
  condition: string | null
  images: string[]
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

export function formatPrice(price: number, currency: string, priceUnit: string): string {
  const formatted = new Intl.NumberFormat('en-US').format(price)
  if (priceUnit === 'VND') return `${currency}${formatted}`
  const suffix = priceUnit.replace(/^VND\/?/, '').trim()
  return suffix ? `${currency}${formatted} / ${suffix}` : `${currency}${formatted}`
}

/**
 * Split a price into its numeric part (currency + amount — never translated) and
 * its unit suffix (e.g. "month", "visit (from)" — translatable). Used by the
 * <Price> component so the unit word renders in the active language.
 */
export function formatPriceParts(price: number, currency: string, priceUnit: string): { amount: string; unit: string | null } {
  const formatted = new Intl.NumberFormat('en-US').format(price)
  const amount = `${currency}${formatted}`
  if (!priceUnit || priceUnit === 'VND') return { amount, unit: null }
  const unit = priceUnit.replace(/^VND\/?/, '').trim()
  return { amount, unit: unit || null }
}

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
