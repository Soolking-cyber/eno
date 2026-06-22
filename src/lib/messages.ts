import 'server-only'
import { after } from 'next/server'
import { db } from './db'
import { sendPushToProfile } from './push'

export type SerializedMessage = { id: string; mine: true; body: string; createdAt: string }

type ConvoForSend = {
  id: string
  buyerProfileId: string
  sellerProfileId: string | null
  listingId: string
}

/**
 * Insert a message into a conversation and keep the denormalized state consistent
 * (last-message + the other party's unread), then best-effort notify the
 * recipient. The AFTER-INSERT trigger on Message broadcasts realtime. Shared by
 * the send endpoint and the conversation-create endpoint (initial message) so the
 * side effects live in ONE place. Caller is responsible for the participant check.
 */
export async function insertMessage(convo: ConvoForSend, senderId: string, text: string): Promise<SerializedMessage> {
  const iAmBuyer = convo.buyerProfileId === senderId
  const [message] = await db.$transaction([
    db.message.create({
      data: { conversationId: convo.id, senderProfileId: senderId, body: text },
      select: { id: true, body: true, createdAt: true },
    }),
    db.conversation.update({
      where: { id: convo.id },
      data: {
        lastMessageAt: new Date(),
        lastMessageText: text.slice(0, 140),
        ...(iAmBuyer ? { sellerUnread: { increment: 1 } } : { buyerUnread: { increment: 1 } }),
      },
    }),
  ])

  // Plain chat messages do NOT create a bell notification or push — they already
  // surface on the Messages-icon unread badge (the conversation unread counter,
  // incremented above). Only OFFERS (and future notification types) notify, to
  // keep the bell + push meaningful instead of noisy.
  const isOffer = text.startsWith('💰')
  const recipientId = iAmBuyer ? convo.sellerProfileId : convo.buyerProfileId
  if (recipientId && isOffer) {
    try {
      const sender = await db.profile.findUnique({ where: { id: senderId }, select: { displayName: true, email: true } })
      const senderName = sender?.displayName || sender?.email?.split('@')[0] || 'Someone'
      await db.notification.create({
        data: {
          recipientId,
          type: 'offer',
          title: senderName,
          body: text.slice(0, 140),
          actorName: senderName,
          conversationId: convo.id,
          listingId: convo.listingId,
        },
      })
      // Web push so the recipient sees the offer even with eno.vn closed. Best-effort,
      // after the response flushes — never delays the send.
      after(() => sendPushToProfile(recipientId, {
        title: senderName,
        body: text.slice(0, 140),
        url: `/messages/${convo.id}`,
        tag: `convo-${convo.id}`,
      }))
    } catch (e) {
      console.error('[messages] notify', e)
    }
  }

  return { id: message.id, mine: true, body: message.body, createdAt: message.createdAt.toISOString() }
}
