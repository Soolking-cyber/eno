import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile, getCurrentProfileId } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST: ensure a conversation exists for { listingId } with the current user as
// buyer (idempotent — one thread per buyer per listing). Returns { id }.
export async function POST(req: Request) {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  let body: { listingId?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }
  const listingId = String(body.listingId || '').trim()
  if (!listingId) return NextResponse.json({ error: 'missing_listing' }, { status: 400 })

  const listing = await db.listing.findUnique({
    where: { id: listingId },
    select: { id: true, verified: true, sellerId: true, seller: { select: { ownerId: true } } },
  })
  if (!listing || !listing.verified) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Can't message your own storefront.
  if (listing.seller.ownerId && listing.seller.ownerId === profile.id) {
    return NextResponse.json({ error: 'own_listing' }, { status: 400 })
  }

  const convo = await db.conversation.upsert({
    where: { listingId_buyerProfileId: { listingId, buyerProfileId: profile.id } },
    update: {},
    create: {
      listingId,
      buyerProfileId: profile.id,
      sellerId: listing.sellerId,
      sellerProfileId: listing.seller.ownerId ?? null,
    },
    select: { id: true },
  })
  return NextResponse.json({ id: convo.id })
}

// GET: the current user's inbox (conversations they're a participant in), newest first.
// Fast-path auth (getClaims, no network/DB) — read-only, the Profile already exists
// for any conversation. POST-create below keeps getCurrentProfile for provisioning.
export async function GET() {
  const meId = await getCurrentProfileId()
  if (!meId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  const rows = await db.conversation.findMany({
    where: { OR: [{ buyerProfileId: meId }, { sellerProfileId: meId }] },
    orderBy: { lastMessageAt: 'desc' },
    take: 100,
    select: {
      id: true, lastMessageAt: true, lastMessageText: true,
      buyerProfileId: true, buyerUnread: true, sellerUnread: true,
      listing: { select: { id: true, title: true, images: true } },
      seller: { select: { id: true, name: true, avatarColor: true, avatarUrl: true } },
      buyer: { select: { displayName: true, email: true, avatarColor: true, avatarUrl: true } },
    },
  })

  const conversations = rows.map((c) => {
    const iAmBuyer = c.buyerProfileId === meId
    const img = (() => { try { return (JSON.parse(c.listing.images || '[]')[0] as string) ?? null } catch { return null } })()
    return {
      id: c.id,
      listingId: c.listing.id,
      listingTitle: c.listing.title,
      listingImage: img,
      lastMessageAt: c.lastMessageAt.toISOString(),
      lastMessageText: c.lastMessageText,
      unread: iAmBuyer ? c.buyerUnread : c.sellerUnread,
      // The OTHER party's display identity.
      counterpart: iAmBuyer
        ? { name: c.seller.name, avatarColor: c.seller.avatarColor, avatarUrl: c.seller.avatarUrl }
        : { name: c.buyer.displayName || c.buyer.email || 'Buyer', avatarColor: c.buyer.avatarColor, avatarUrl: c.buyer.avatarUrl },
    }
  })
  return NextResponse.json({ conversations })
}
