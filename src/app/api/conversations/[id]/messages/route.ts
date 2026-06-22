import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { insertMessage } from '@/lib/messages'

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

  const message = await insertMessage(
    { id, buyerProfileId: convo.buyerProfileId, sellerProfileId: convo.sellerProfileId, listingId: convo.listing.id },
    meId,
    text,
  )
  return NextResponse.json(message)
}
