import { SEARCH_TOOLS_BY_NAME, SearchToolError } from '@/app/api/mcp/search/tools'
import { db } from '@/lib/db'
import { checkAdListing } from '@/lib/ads/book'
import { BANK_PERIOD, BANK_PERIODS, isBankPeriod, type BankPeriod } from '@/lib/ads/bank-periods'

/**
 * ── eno.vn's OWN PRODUCT IN UCP: AN AD ON A LISTING (owner 2026-11-27: "ads checkout") ──
 *
 * The one thing eno.vn itself sells. Product `ad:<listingId>`, one variant per period — `ad:<listingId>:week|month|quarter`
 * at the bank-transfer prices (bank-periods.ts, the table every surface quotes). Found by catalog lookup/product of that
 * id, never in search results (they are goods for sale); bought through the UCP checkout (checkout.ts).
 *
 * ⛔ A LISTING IS ADVERTISABLE HERE ONLY IF THE PUBLIC MAY SEE IT AND ADS MAY RUN ON IT (plan review 2026-11-28): first the
 * MCP detail read — the listing page's own rule: live, published, edition-scoped (eno's hidden desk never shows on eno.vn),
 * contact details stripped — then book.ts checkAdListing with the listing's own shop: not in an aisle ads exclude (e-Visa,
 * legal & permits…) and live in its category's feed. So no product title from a listing eno.vn may not show is ever
 * printed. Who may BUY is decided later, signed in, by createBankOrder (the listing's own shop only).
 */
export const AD_PREFIX = 'ad:'
const ID = /^ad:([A-Za-z0-9_-]{1,64})(?::(week|month|quarter))?$/

export function parseAdId(id: string): { listingId: string; period: BankPeriod | null } | null {
  const m = ID.exec(id)
  if (!m) return null
  return { listingId: m[1], period: m[2] && isBankPeriod(m[2]) ? m[2] : null }
}
export const adProductId = (listingId: string) => `${AD_PREFIX}${listingId}`
export const adVariantId = (listingId: string, period: BankPeriod) => `${AD_PREFIX}${listingId}:${period}`

export type AdTarget = { listingId: string; title: string; image: string | null; url: string }

/** The listing an ad would run on, when eno.vn may show it and advertise it; else null. */
export async function adTarget(listingId: string): Promise<AdTarget | null> {
  const tool = SEARCH_TOOLS_BY_NAME.get('get_listing_details')!
  let listing: { id: string; title: string; status: string; images?: string[]; url: string }
  try {
    ;({ listing } = (await tool.handler({ id: listingId })) as { listing: typeof listing })
  } catch (e) {
    if (e instanceof SearchToolError) return null
    throw e
  }
  if (listing.status !== 'active') return null
  // edition-lint-allow: the shop of a listing the public detail read above has just shown; its id only, used for the ad
  // checks and never returned.
  const row = await db.listing.findUnique({ where: { id: listing.id }, select: { sellerId: true } })
  if (!row) return null
  const check = await checkAdListing(listing.id, row.sellerId)
  if (!check.ok) return null
  return { listingId: listing.id, title: listing.title, image: listing.images?.[0] ?? null, url: listing.url }
}

const DAYS = (p: BankPeriod) => BANK_PERIOD[p].days
export const adTitle = (title: string, lang: 'en' | 'vi') => (lang === 'vi' ? `Quảng cáo trên eno.vn: ${title}` : `Ad on eno.vn: ${title}`)
export const periodTitle = (p: BankPeriod, lang: 'en' | 'vi') =>
  lang === 'vi' ? `${DAYS(p)} ngày` : p === 'week' ? '1 week' : `${DAYS(p)} days`

/**
 * The ad product (catalog: product.json, prices in whole đồng). `lookup` (catalog lookup): only the variants a request id
 * resolved to, each with its correlation — a lookup variant MUST carry `inputs` (catalog_lookup.json lookup_variant): a
 * variant id is `exact`; the product id resolves to the week as `featured`. Without it (catalog/product) all three.
 */
export function adProduct(t: AdTarget, lang: 'en' | 'vi', lookup?: Map<BankPeriod, { id: string; match: string }[]>) {
  const plain = lang === 'vi'
    ? `Đưa "${t.title}" vào các tin được tài trợ trên eno.vn trong 7, 30 hoặc 90 ngày. Thanh toán bằng chuyển khoản VietQR; quảng cáo chạy khi eno.vn xác nhận tiền đã đến. Chỉ cửa hàng sở hữu tin này mua được, khi đăng nhập trên eno.vn.`
    : `Puts "${t.title}" among eno.vn's sponsored listings for 7, 30 or 90 days. Paid by VietQR bank transfer; the ad starts when eno.vn confirms the transfer. Only the listing's own shop can buy it, signed in on eno.vn.`
  const prices = BANK_PERIODS.map((p) => BANK_PERIOD[p].priceVnd)
  const periods = lookup ? BANK_PERIODS.filter((p) => lookup.has(p)) : BANK_PERIODS
  return {
    id: adProductId(t.listingId),
    title: adTitle(t.title, lang),
    description: { plain },
    url: t.url,
    categories: [{ value: lang === 'vi' ? 'Quảng cáo trên eno.vn' : 'Advertising on eno.vn' }],
    price_range: { min: { amount: Math.min(...prices), currency: 'VND' }, max: { amount: Math.max(...prices), currency: 'VND' } },
    media: t.image ? [{ type: 'image', url: t.image }] : [],
    tags: ['eno-ad'],
    variants: periods.map((p) => ({
      id: adVariantId(t.listingId, p),
      title: periodTitle(p, lang),
      description: { plain },
      price: { amount: BANK_PERIOD[p].priceVnd, currency: 'VND' },
      availability: { available: true, status: 'in_stock' },
      ...(lookup ? { inputs: lookup.get(p)! } : {}),
    })),
  }
}
