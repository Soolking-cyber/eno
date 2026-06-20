import 'server-only'
// Single source of truth for seller contact. SERVER-ONLY — these numbers must
// never reach the client bundle; only the auth-gated /api/listings/[id]/contact
// route may resolve them.
const SELLER_PHONES: Record<string, string> = {
  'seller-minh': '0977 905 765',
  'seller-linh': '0912 211 488',
  'seller-david': '0857 717 777',
  'seller-huong': '0985 972 999',
  'seller-sarah': '0907 222 222',
  'seller-quang': '0929 560 555',
  'seller-tuan': '0927 009 999',
  'seller-mai': '0911 888 444',
}
const FALLBACK = '0988 088 380'

type SellerLike = { id: string; phone?: string | null }

// Prefer the seller's real stored phone (set by the post wizard); fall back to
// the seed map, then a generic number.
export function phoneForSeller(seller: SellerLike): string {
  return (seller.phone && seller.phone.trim()) || SELLER_PHONES[seller.id] || FALLBACK
}

function digits(p: string): string {
  return p.replace(/\D/g, '')
}

/** A working tel: link, normalized to Vietnam international format. */
export function telHref(seller: SellerLike): string {
  const d = digits(phoneForSeller(seller))
  const intl = d.startsWith('0') ? `+84${d.slice(1)}` : d
  return `tel:${intl}`
}

/** A working Zalo deep link to the seller's number. */
export function zaloHref(seller: SellerLike): string {
  return `https://zalo.me/${digits(phoneForSeller(seller))}`
}
