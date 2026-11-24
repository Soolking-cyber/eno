import { NextResponse } from 'next/server'
import { route } from '@/lib/api/handler'
import { db } from '@/lib/db'
import { getAdmin, isCurrentUserAdminByClaims } from '@/lib/admin'
import { scopedListingWhere } from '@/lib/edition-scope'
import { goplusRoomPageUrl } from '@/lib/goplus-listing'
import { isCommissionLink } from '@/lib/affiliate-commission'
import { isEnoRunPartner } from '@/lib/eno-run-partners'
import { partnerSourceUrlOk } from '@/lib/partner-source-link'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Every answer: an admin's never lands in a shared cache or a browser's (a browser cache is not keyed by who is in). */
const NO_STORE = { 'cache-control': 'private, no-store' }

/**
 * GET /api/listings/[id]/goplus-link — `{ url }`: a GoPlus room's own page on goplus.com.vn, for the GoPlus account and
 * eno's admins ONLY (owner, 2026-10-30: "available only for admins goplus email and suport email … user shouldnt see the
 * links"). Every other signed-in viewer gets `{ url: null }`, as does a listing that is no GoPlus room; a guest gets 401.
 *
 * ⛔ THE ONE PLACE THE URL LEAVES THE SERVER. The listing page is one cached render for every visitor (ISR, no session), so
 * it carries only "this is a GoPlus room" and its link asks here; the chat thread's link asks here too.
 * - The room: an official partner's storefront (a flag eno's staff set) with a `goplus:<24 hex>` externalId the importer
 *   writes. goplusRoomPageUrl builds the address, always on goplus.com.vn, never from text anyone can type.
 * - The viewer: the storefront's own account (Seller.ownerId — for the `goplus` shop, contact@goplus.com.vn, whose staff
 *   answer its chats), compared with the session's profile id as the listing view count does; or an admin (ADMIN_EMAILS:
 *   support@eno.forum in production) by getAdmin(), which revalidates with the auth server. The free claim check only
 *   spares an ordinary viewer that round trip (/api/dashboard's pattern; admin.ts: never an access gate by itself).
 * - findFirst on scopedListingWhere: a listing this edition does not carry never resolves.
 */
export const GET = route(
  { auth: 'userId', rateLimit: { bucket: 'goplus-link', limit: 60, window: '1 m' } },
  async ({ params, userId }) => {
    const id = String(params.id ?? '')
    const listing = id
      ? await db.listing.findFirst({
        where: await scopedListingWhere({ id }),
        select: { externalId: true, sellerId: true, seller: { select: { ownerId: true, officialPartner: true, handle: { select: { handle: true } } } }, purchaseLink: { select: { url: true } } },
      })
      : null
    const goplus = listing?.seller.officialPartner === true ? goplusRoomPageUrl(listing.externalId) : null
    /**
     * …OR an eno-run partner's PURCHASE LINK (owner 2026-11-14: "only admins should see the link to purchase devices for
     * users … and send in chat if needed"): the staff-only PartnerPurchaseLink of a listing in a storefront eno runs (a
     * PINNED pair — src/lib/eno-run-partners.ts), to the same two viewers. Only an AccessTrade link host is ever answered.
     */
    const purchase = !goplus && listing && isEnoRunPartner({ id: listing.sellerId, ownerId: listing.seller.ownerId, officialPartner: listing.seller.officialPartner })
      && isCommissionLink(listing.purchaseLink?.url) ? listing.purchaseLink!.url : null
    /**
     * …OR any other partner's ORIGINAL PAGE (owner 2026-11-24: "why all partner shop products dont have direct links to
     * original website for respective admins" → "build it" + "from now on all partner shops should have links for admins"):
     * the same staff-only row, on an official partner storefront, answered only when it is an https page on THAT partner's
     * own website (src/lib/partner-source-link.ts holds each partner's hosts). Never a "Buy now": partner-buy.ts answers
     * AccessTrade links only.
     */
    const source = !goplus && !purchase && listing?.seller.officialPartner === true
      && partnerSourceUrlOk(listing.seller.handle?.handle, listing.purchaseLink?.url) ? listing.purchaseLink!.url : null
    const url = goplus ?? purchase ?? source
    const entitled = !!url && (
      (listing!.seller.ownerId !== null && listing!.seller.ownerId === userId)
      || ((await isCurrentUserAdminByClaims()) && !!(await getAdmin()))
    )
    return NextResponse.json({ url: entitled ? url : null, kind: entitled && url ? (goplus ? 'goplus' : purchase ? 'purchase' : 'source') : null }, { headers: NO_STORE })
  },
)
