import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { messagingGate } from '@/lib/enforcement'
import { ApiError, route } from '@/lib/api/handler'
import { insertMessage } from '@/lib/messages'
import { isSellerHiddenHere } from '@/lib/edition-scope'
import { isBlockedBetween } from '@/lib/user-blocks'
import { isEnoRunPartner } from '@/lib/eno-run-partners'
import { partnerBuyUrl } from '@/lib/partner-buy'
import { PARTNER_BUY_LINE } from '@/lib/partner-welcome-line'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/conversations/[id]/buy-now — THE SHOP POSTS ITS "BUY NOW" BUTTON AGAIN (owner, 2026-11-23: "the admin can resurface
 * buy now button which will take into affiliate link"). No body. Writes the fixed 'partner_buy' line (PARTNER_BUY_LINE); the
 * thread page draws the "Buy now" button under it from the thread payload's `buyUrl` (src/lib/partner-buy.ts). The URL is
 * never written into the thread.
 *
 * Checks, identity before outcome: auth → limiter → messagingGate → 404 unknown thread or a seller this edition hides →
 * 403 forbidden unless the caller is the thread's seller side AND the storefront's current login AND the storefront is an
 * eno-run partner (a pinned pair — eno's staff answer these shops' chats from the shop's own login) → 403 blocked → 409
 * listing_unavailable when the thread's listing has no live buy link (sold, hidden, no link) → the insert.
 */
export const POST = route({ auth: 'userId', rateLimit: { bucket: 'buy-now', limit: 20, window: '1 m' } }, async ({ params, userId: meId }) => {
  const id = String(params.id ?? '')
  const gate = await messagingGate(meId)
  if (gate) return NextResponse.json(gate, { status: 403 })

  const convo = id
    ? await db.conversation.findUnique({
      where: { id },
      select: {
        id: true, buyerProfileId: true, sellerProfileId: true, listingId: true,
        seller: { select: { id: true, ownerId: true, officialPartner: true } },
      },
    })
    : null
  if (!convo) throw new ApiError('not_found', 404)
  if (await isSellerHiddenHere(convo.seller.id)) throw new ApiError('not_found', 404)
  if (
    !convo.sellerProfileId || convo.sellerProfileId !== meId || convo.seller.ownerId !== meId
    || convo.buyerProfileId === meId || !isEnoRunPartner(convo.seller)
  ) throw new ApiError('forbidden', 403)
  if (await isBlockedBetween(convo.buyerProfileId, convo.sellerProfileId)) throw new ApiError('blocked', 403)
  if (!(await partnerBuyUrl(convo.listingId))) throw new ApiError('listing_unavailable', 409)

  const message = await insertMessage(
    { id: convo.id, buyerProfileId: convo.buyerProfileId, sellerProfileId: convo.sellerProfileId, listingId: convo.listingId },
    meId,
    PARTNER_BUY_LINE,
    { kind: 'partner_buy' },
  )
  return { message }
})
