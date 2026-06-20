import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET one conversation + its messages (participant-only). Marks the caller's
// unread count to 0 (opening the thread = read).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  const convo = await db.conversation.findUnique({
    where: { id },
    select: {
      id: true, buyerProfileId: true, sellerProfileId: true,
      listing: { select: { id: true, title: true, images: true } },
      seller: { select: { id: true, name: true, avatarColor: true, avatarUrl: true } },
      buyer: { select: { displayName: true, email: true, avatarColor: true, avatarUrl: true } },
      messages: { orderBy: { createdAt: 'asc' }, select: { id: true, senderProfileId: true, body: true, createdAt: true } },
    },
  })
  if (!convo) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const iAmBuyer = convo.buyerProfileId === profile.id
  const iAmSeller = convo.sellerProfileId === profile.id
  if (!iAmBuyer && !iAmSeller) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  // Mark my side read.
  await db.conversation.update({
    where: { id },
    data: iAmBuyer ? { buyerUnread: 0 } : { sellerUnread: 0 },
  })

  const img = (() => { try { return (JSON.parse(convo.listing.images || '[]')[0] as string) ?? null } catch { return null } })()
  return NextResponse.json({
    id: convo.id,
    me: profile.id,
    listing: { id: convo.listing.id, title: convo.listing.title, image: img },
    counterpart: iAmBuyer
      ? { name: convo.seller.name, avatarColor: convo.seller.avatarColor, avatarUrl: convo.seller.avatarUrl }
      : { name: convo.buyer.displayName || convo.buyer.email || 'Buyer', avatarColor: convo.buyer.avatarColor, avatarUrl: convo.buyer.avatarUrl },
    messages: convo.messages.map((m) => ({ id: m.id, mine: m.senderProfileId === profile.id, body: m.body, createdAt: m.createdAt.toISOString() })),
  })
}
