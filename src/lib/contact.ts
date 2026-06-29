import 'server-only'
// Single source of truth for seller contact. SERVER-ONLY — the number must never
// reach the client bundle; only the auth-gated /api/listings/[id]/contact route
// may resolve it. Returns the seller's REAL stored phone (set in the post wizard)
// or null — never a synthetic/fallback number.
type SellerLike = { phone?: string | null }

export function phoneForSeller(seller: SellerLike): string | null {
  const p = seller.phone?.trim()
  return p || null
}

function digits(p: string): string {
  return p.replace(/\D/g, '')
}

/** A working tel: link, normalized to Vietnam international format. */
export function telHref(phone: string): string {
  const d = digits(phone)
  const intl = d.startsWith('0') ? `+84${d.slice(1)}` : d
  return `tel:${intl}`
}

/** A working Zalo deep link to the seller's number. Zalo resolves VN numbers in LOCAL
 *  format (leading 0), NOT the 84-prefixed international form — so `+84901234567` must
 *  become `zalo.me/0901234567`, otherwise the link opens to "user not found". */
export function zaloHref(phone: string): string {
  const d = digits(phone)
  const local = d.startsWith('84') ? `0${d.slice(2)}` : d
  return `https://zalo.me/${local}`
}
