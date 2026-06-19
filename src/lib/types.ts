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
    responseRate: number
    responseTime: string
    phone: string | null
  }
  verified: boolean
  verificationMethod: string | null
  verifiedAt: string | null
  verifiedBy: string | null
  verificationNotes: string | null
  postedAt: string
  views: number
  savedCount: number
  featured: boolean
  attributes: Record<string, unknown> | null
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

export function timeAgo(iso: string, lang: string = 'vi'): string {
  const then = new Date(iso).getTime()
  const diff = Date.now() - then
  const m = Math.floor(diff / 60000)
  if (lang === 'vi') {
    if (m < 1) return 'vừa xong'
    if (m < 60) return `${m} phút trước`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h} giờ trước`
    const d = Math.floor(h / 24)
    if (d < 30) return `${d} ngày trước`
    const mo = Math.floor(d / 30)
    if (mo < 12) return `${mo} tháng trước`
    return `${Math.floor(mo / 12)} năm trước`
  } else {
    if (m < 1) return 'just now'
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    const d = Math.floor(h / 24)
    if (d < 30) return `${d}d ago`
    const mo = Math.floor(d / 30)
    if (mo < 12) return `${mo}mo ago`
    return `${Math.floor(mo / 12)}y ago`
  }
}

export const VERIFICATION_METHOD_LABELS: Record<string, { label: string; vi: string; desc: string }> = {
  'in-person': { label: 'In-person check', vi: 'Kiểm tra tận nơi', desc: 'An ENO agent visited the item in person.' },
  'video-call': { label: 'Live video call', vi: 'Gọi video trực tiếp', desc: 'Seller showed the item live on a video call.' },
  'document-check': { label: 'Document check', vi: 'Kiểm tra giấy tờ', desc: 'Serial / registration documents validated against official records.' },
  'agent-visit': { label: 'Agent visit', vi: 'Nhân viên đến kiểm tra', desc: 'An agent visited the business / premises.' },
}

// Single-accent palette: every category renders in the one brand blue.
// Keeping the per-category keys lets existing lookups resolve while the UI
// stays cohesive (the product photos carry the colour, not the chrome).
const BRAND_BLUE = {
  bg: 'bg-[#0a66c2]',
  text: 'text-[#0a66c2]',
  ring: 'ring-[#0a66c2]/20',
  soft: 'bg-[#e8f1fb] text-[#0a66c2] border-[#0a66c2]/15',
  grad: 'from-[#0a66c2] to-[#2f80c4]',
}

export const CATEGORY_COLOR_CLASSES: Record<CategoryColor, { bg: string; text: string; ring: string; soft: string; grad: string }> = {
  brand: BRAND_BLUE,
  sky: BRAND_BLUE,
  indigo: BRAND_BLUE,
  violet: BRAND_BLUE,
  cyan: BRAND_BLUE,
  teal: BRAND_BLUE,
}
