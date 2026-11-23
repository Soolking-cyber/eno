import { db } from '@/lib/db'
import { isCommissionLink } from '@/lib/affiliate-commission'
import { isEnoRunPartner } from '@/lib/eno-run-partners'
import { scopedListingWhere } from '@/lib/edition-scope'

/**
 * THE "BUY NOW" LINK (owner, 2026-11-23: "if they want to purchase right away they can do so in our official storefront … the
 * link non suspicious looking official looking … or just click here to buy" + "the admin can resurface buy now button which will
 * take into affiliate link").
 *
 * The listing's staff-only PartnerPurchaseLink (the AccessTrade deep link — goplus-link/route.ts serves it to staff as "Purchase
 * link (staff only)"), now ALSO handed to the customer of a thread about that listing, behind a "Buy now" button — never as raw
 * text, never on the public listing page or any cached payload. Answered only when ALL hold:
 *   · the listing's storefront is an eno-run partner (a PINNED seller/owner pair — src/lib/eno-run-partners.ts);
 *   · the link is an AccessTrade link host over https (isCommissionLink) — whatever the table holds;
 *   · the listing is live: verified and 'active' (a sold or hidden unit gets no button: the shop has no such unit to sell).
 * The customer's own click is what earns the commission (memory: AccessTrade pays on the customer's click → order).
 */
export type PartnerBuyRow = {
  status: string
  verified: boolean
  sellerId: string
  seller: { ownerId: string | null; officialPartner: boolean }
  purchaseLink: { url: string } | null
}

export const PARTNER_BUY_SELECT = {
  status: true, verified: true, sellerId: true,
  seller: { select: { ownerId: true, officialPartner: true } },
  purchaseLink: { select: { url: true } },
} as const

export function partnerBuyUrlOf(row: PartnerBuyRow | null | undefined): string | null {
  if (!row || !row.verified || row.status !== 'active') return null
  if (!isEnoRunPartner({ id: row.sellerId, ownerId: row.seller.ownerId, officialPartner: row.seller.officialPartner })) return null
  const url = row.purchaseLink?.url
  return url && url.startsWith('https://') && isCommissionLink(url) ? url : null
}

/** The listing's "Buy now" link, or null. One read; the caller decides who may see it. */
export async function partnerBuyUrl(listingId: string | null | undefined): Promise<string | null> {
  if (!listingId) return null
  // Edition-scoped like the staff link's own read (goplus-link/route.ts): a listing this edition does not carry never resolves.
  const row = await db.listing.findFirst({ where: await scopedListingWhere({ id: listingId }), select: PARTNER_BUY_SELECT })
  return partnerBuyUrlOf(row)
}
