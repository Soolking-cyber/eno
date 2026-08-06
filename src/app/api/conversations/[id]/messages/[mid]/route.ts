import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ApiError, route } from '@/lib/api/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Delete a message — only your OWN, only in a conversation you're part of.
// Recomputes the conversation's last-message preview if the deleted one was last.
//
// WS6 — on route(). `auth: 'userId'`, not 'profile': the old code called getCurrentProfileId() and
// the row is only ever compared against `senderProfileId`, so the Profile row is never read.
// Branches held: guest → 401 auth_required · unknown mid, or a mid belonging to another
// conversation → 404 not_found · someone else's message → 403 forbidden · success → 204 with an
// EMPTY body, returned as a Response so the wrapper does not JSON-wrap it.
//
// ⚠️ ONE ACCEPTED WIRE CHANGE, ON THE FAILURE PATH ONLY. The $transaction has no catch, so a DB
// rejection used to be Next's default 500; route() now answers {"error":"internal_error"} 500.
export const DELETE = route({ auth: 'userId' }, async ({ params, userId }) => {
  const { id, mid } = params

  const msg = await db.message.findUnique({
    where: { id: mid },
    select: { id: true, conversationId: true, senderProfileId: true },
  })
  if (!msg || msg.conversationId !== id) throw new ApiError('not_found', 404)
  if (msg.senderProfileId !== userId) throw new ApiError('forbidden', 403)

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
})
