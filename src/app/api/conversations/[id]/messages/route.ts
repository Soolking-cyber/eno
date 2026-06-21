import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_LEN = 2000

// Send a message in a conversation. Authenticated, participant-only, Prisma
// insert (never a client-direct insert). One transaction inserts the Message and
// updates the denormalized last-message + the OTHER party's unread counter.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const meId = await getCurrentProfileId()
  if (!meId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  const rl = await rateLimit('msg:send', meId, 20, '1 m')
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  let body: { body?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }
  const text = String(body.body || '').trim().slice(0, MAX_LEN)
  if (!text) return NextResponse.json({ error: 'empty' }, { status: 400 })

  const convo = await db.conversation.findUnique({
    where: { id },
    select: { id: true, buyerProfileId: true, sellerProfileId: true, listing: { select: { id: true } } },
  })
  if (!convo) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const iAmBuyer = convo.buyerProfileId === meId
  const iAmSeller = convo.sellerProfileId === meId
  if (!iAmBuyer && !iAmSeller) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const [message] = await db.$transaction([
    db.message.create({
      data: { conversationId: id, senderProfileId: meId, body: text },
      select: { id: true, body: true, createdAt: true },
    }),
    db.conversation.update({
      where: { id },
      data: {
        lastMessageAt: new Date(),
        lastMessageText: text.slice(0, 140),
        // Bump the OTHER party's unread.
        ...(iAmBuyer ? { sellerUnread: { increment: 1 } } : { buyerUnread: { increment: 1 } }),
      },
    }),
  ])

  // Notify the recipient (best-effort — a notification failure must never fail the
  // send). An unclaimed seller (null profile) can't be notified, so skip.
  const recipientId = iAmBuyer ? convo.sellerProfileId : convo.buyerProfileId
  if (recipientId) {
    try {
      const sender = await db.profile.findUnique({ where: { id: meId }, select: { displayName: true, email: true } })
      const senderName = sender?.displayName || sender?.email?.split('@')[0] || 'Someone'
      await db.notification.create({
        data: {
          recipientId,
          type: text.startsWith('💰') ? 'offer' : 'message',
          title: senderName,
          body: text.slice(0, 140),
          actorName: senderName,
          conversationId: id,
          listingId: convo.listing.id,
        },
      })
    } catch (e) {
      console.error('[messages] notify', e)
    }
  }

  return NextResponse.json({ id: message.id, mine: true, body: message.body, createdAt: message.createdAt.toISOString() })
}
