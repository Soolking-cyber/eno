import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAdmin } from '@/lib/admin'
import { localizedMacro } from '@/lib/admin-macros'

export const dynamic = 'force-dynamic'

// Admin → user outreach from the moderation queue. The admin can ONLY send a PRE-PREPARED
// macro (no free text) — delivered to the recipient's notification bell IN THEIR LANGUAGE
// (Profile.locale, EN/VI). One-way (warnings / requests for detail), not a two-way thread.
export async function POST(req: NextRequest) {
  const admin = await getAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: { recipientId?: string; macroKey?: string; listingId?: string; conversationId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const recipientId = String(body.recipientId || '').trim()
  const macroKey = String(body.macroKey || '').trim()
  if (!recipientId || !macroKey) return NextResponse.json({ error: 'Missing recipient or message' }, { status: 400 })

  // A guest seller with no claimed account can't be notified.
  const recipient = await db.profile.findUnique({ where: { id: recipientId }, select: { id: true, locale: true } })
  if (!recipient) return NextResponse.json({ error: 'recipient_unreachable' }, { status: 404 })

  const text = localizedMacro(macroKey, recipient.locale)
  if (!text) return NextResponse.json({ error: 'unknown_macro' }, { status: 400 })

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
