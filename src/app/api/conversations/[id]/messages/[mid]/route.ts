import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentProfileId } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Delete a message — only your OWN, only in a conversation you're part of.
// Recomputes the conversation's last-message preview if the deleted one was last.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; mid: string }> }) {
  const { id, mid } = await params
  const meId = await getCurrentProfileId()
  if (!meId) return NextResponse.json({ error: 'auth_required' }, { status: 401 })

  const msg = await db.message.findUnique({
    where: { id: mid },
    select: { id: true, conversationId: true, senderProfileId: true },
  })
  if (!msg || msg.conversationId !== id) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (msg.senderProfileId !== meId) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  await db.$transaction(async (tx) => {
    await tx.message.delete({ where: { id: mid } })
    const last = await tx.message.findFirst({
      where: { conversationId: id },
      orderBy: { createdAt: 'desc' },
      select: { body: true, createdAt: true },
    })
    await tx.conversation.update({
      where: { id },
      data: last
        ? { lastMessageText: last.body.slice(0, 140), lastMessageAt: last.createdAt }
        : { lastMessageText: null },
    })
  })

  return new NextResponse(null, { status: 204 })
}
