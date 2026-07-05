import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfileId } from '@/lib/admin'
import { rateLimit } from '@/lib/ratelimit'
import { actOnOffer } from '@/lib/messages'
import { messagingGate } from '@/lib/enforcement'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Accept or decline a pending offer in a conversation. Participant-only; the
// actor must be the RECIPIENT of the offer (enforced in actOnOffer).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const meId = await getCurrentProfileId()
  if (!meId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  const rl = await rateLimit('offer:act', meId, 30, '1 m')
  if (!rl.success) return NextResponse.json({ error: 'rate_limited' }, { status: 429 })

  // Enforcement (trust Phase 2): a suspended account can't act on offers.
  const gate = await messagingGate(meId)
  if (gate) return NextResponse.json(gate, { status: 403 })

  let body: { messageId?: string; action?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }) }
  const messageId = String(body.messageId || '')
  const action = body.action === 'accept' ? 'accept' : body.action === 'decline' ? 'decline' : null
  if (!messageId || !action) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const convo = await db.conversation.findUnique({
    where: { id },
    select: { id: true, buyerProfileId: true, sellerProfileId: true, listing: { select: { id: true } } },
  })
  if (!convo) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (convo.buyerProfileId !== meId && convo.sellerProfileId !== meId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const ok = await actOnOffer(
    { id, buyerProfileId: convo.buyerProfileId, sellerProfileId: convo.sellerProfileId, listingId: convo.listing.id },
    meId,
    messageId,
    action,
  )
  if (!ok) return NextResponse.json({ error: 'not_actionable' }, { status: 409 })
  return NextResponse.json({ ok: true })
}
