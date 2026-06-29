import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAdmin } from '@/lib/admin'

export const dynamic = 'force-dynamic'

// Admin → user outreach from the moderation queue ("message the seller / the buyer about
// this report"). Delivered as a notification (type 'system') so it lands in the recipient's
// bell. One-way by design — moderation messages (warnings, requests for more detail), not a
// two-way thread. getAdmin re-checks the session server-side; never trust the client gate.
export async function POST(req: NextRequest) {
  const admin = await getAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { recipientId?: string; text?: string; listingId?: string; conversationId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const recipientId = String(body.recipientId || '').trim()
  const text = String(body.text || '').trim().slice(0, 2000)
  if (!recipientId || !text) return NextResponse.json({ error: 'Missing recipient or message' }, { status: 400 })

  // Recipient must exist (a guest seller with no claimed account can't receive a message).
  const recipient = await db.profile.findUnique({ where: { id: recipientId }, select: { id: true } })
  if (!recipient) return NextResponse.json({ error: 'recipient_unreachable' }, { status: 404 })

  await db.notification.create({
    data: {
      recipientId,
      type: 'system',
      title: 'Message from eno.vn',
      body: text,
      actorName: 'eno.vn moderation',
      listingId: body.listingId ? String(body.listingId).trim() : null,
      conversationId: body.conversationId ? String(body.conversationId).trim() : null,
    },
  })
  return NextResponse.json({ ok: true })
}
