import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfileId } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET one conversation + its messages (participant-only). Marks the caller's
// unread count to 0 (opening the thread = read).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const meId = await getCurrentProfileId()
  if (!meId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  const convo = await db.conversation.findUnique({
    where: { id },
    select: {
      id: true, buyerProfileId: true, sellerProfileId: true, buyerUnread: true, sellerUnread: true,
      listing: { select: { id: true, title: true, images: true, price: true, currency: true, priceUnit: true, availabilityConfirmedAt: true, status: true } },
      seller: { select: { id: true, name: true, avatarColor: true, avatarUrl: true } },
      buyer: { select: { displayName: true, email: true, avatarColor: true, avatarUrl: true } },
      messages: { orderBy: { createdAt: 'asc' }, select: { id: true, senderProfileId: true, body: true, createdAt: true, kind: true, offerAmount: true, offerStatus: true } },
    },
  })
  if (!convo) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const iAmBuyer = convo.buyerProfileId === meId
  const iAmSeller = convo.sellerProfileId === meId
  if (!iAmBuyer && !iAmSeller) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  // Mark my side read — but only WRITE when there's actually something to clear,
  // so the ~1.5s polling reads stay write-free.
  const myUnread = iAmBuyer ? convo.buyerUnread : convo.sellerUnread
  if (myUnread > 0) {
    await db.conversation.update({
      where: { id },
      data: iAmBuyer ? { buyerUnread: 0 } : { sellerUnread: 0 },
    })
  }

  // Counterpart's public storefront id (so the chat header name can deep-link to
  // their seller/business page). As a buyer that's the listing's seller directly;
  // as the seller it's the buyer's own storefront, if they have one.
  const counterpartSellerId = iAmBuyer
    ? convo.seller.id
    : (await db.seller.findUnique({ where: { ownerId: convo.buyerProfileId }, select: { id: true } }))?.id ?? null

  // Buyer side only: has this conversation already produced a review? One indexed
  // exists-check (unique on Review.conversationId) powers the post-transaction
  // review prompt. Pre-migration DB (scripts/add-review-cols.mjs not yet run) the
  // column is absent → treat as not-reviewed instead of 500ing the whole thread.
  let hasReviewed = false
  if (iAmBuyer) {
    try {
      hasReviewed = !!(await db.review.findUnique({ where: { conversationId: id }, select: { id: true } }))
    } catch { hasReviewed = false }
  }

  const img = (() => { try { return (JSON.parse(convo.listing.images || '[]')[0] as string) ?? null } catch { return null } })()
  return NextResponse.json({
    id: convo.id,
    me: meId,
    // The seller of the listing reveals nothing here (they ARE the contact) — the client
    // uses this to hide the "Request number / Zalo" action for the seller side.
    iAmSeller,
    // availabilityConfirmedAt powers the buyer's instant "still available?" answer
    // (fresh seller confirmation → answered inline, no message sent).
    listing: { id: convo.listing.id, title: convo.listing.title, image: img, price: convo.listing.price, currency: convo.listing.currency, priceUnit: convo.listing.priceUnit, availabilityConfirmedAt: convo.listing.availabilityConfirmedAt?.toISOString() ?? null, status: convo.listing.status },
    // Buyer already reviewed this conversation → the thread UIs hide the review prompt.
    hasReviewed,
    counterpart: iAmBuyer
      ? { name: convo.seller.name, avatarColor: convo.seller.avatarColor, avatarUrl: convo.seller.avatarUrl, sellerId: counterpartSellerId }
      : { name: convo.buyer.displayName || convo.buyer.email || 'Buyer', avatarColor: convo.buyer.avatarColor, avatarUrl: convo.buyer.avatarUrl, sellerId: counterpartSellerId },
    messages: convo.messages.map((m) => ({ id: m.id, mine: m.senderProfileId === meId, body: m.body, createdAt: m.createdAt.toISOString(), kind: m.kind, offerAmount: m.offerAmount, offerStatus: m.offerStatus })),
  })
}

// DELETE a conversation from MY inbox only (per-user hide, non-destructive).
// Stamps the caller's *DeletedAt = now(); the inbox query hides it until a newer
// message arrives, so it reappears if the other party replies. The conversation
// and its messages stay intact for the other participant.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const meId = await getCurrentProfileId()
  if (!meId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  const convo = await db.conversation.findUnique({
    where: { id },
    select: { buyerProfileId: true, sellerProfileId: true },
  })
  if (!convo) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const iAmBuyer = convo.buyerProfileId === meId
  const iAmSeller = convo.sellerProfileId === meId
  if (!iAmBuyer && !iAmSeller) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  await db.conversation.update({
    where: { id },
    data: iAmBuyer
      ? { buyerDeletedAt: new Date(), buyerUnread: 0 }
      : { sellerDeletedAt: new Date(), sellerUnread: 0 },
  })
  return new NextResponse(null, { status: 204 })
}
