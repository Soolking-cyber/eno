import 'server-only'
import { after } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { db } from './db'
import { sendPushToProfile } from './push'
import { formatMoneyFull } from './vnd'

export type SerializedMessage = { id: string; mine: true; body: string; createdAt: string; kind: string; offerAmount: number | null; offerStatus: string | null }

type ConvoForSend = {
  id: string
  buyerProfileId: string
  sellerProfileId: string | null
  listingId: string
}

export type SendOpts = { kind?: 'text' | 'offer'; offerAmount?: number }

/**
 * Insert a message into a conversation and keep the denormalized state consistent
 * (last-message + the other party's unread), then best-effort notify the
 * recipient. The AFTER-INSERT trigger on Message broadcasts realtime. Shared by
 * the send endpoint and the conversation-create endpoint (initial message) so the
 * side effects live in ONE place. Caller is responsible for the participant check.
 */
export async function insertMessage(convo: ConvoForSend, senderId: string, text: string, opts?: SendOpts): Promise<SerializedMessage> {
  const iAmBuyer = convo.buyerProfileId === senderId
  const isOffer = opts?.kind === 'offer'
  // A new offer supersedes any still-pending offer in the thread (from either side)
  // so only the latest is actionable — that's the "counter" flow.
  const ops: Prisma.PrismaPromise<unknown>[] = []
  if (isOffer) {
    ops.push(db.message.updateMany({
      where: { conversationId: convo.id, kind: 'offer', offerStatus: 'pending' },
      data: { offerStatus: 'countered' },
    }))
  }
  ops.push(
    db.message.create({
      data: {
        conversationId: convo.id,
        senderProfileId: senderId,
        body: text,
        kind: isOffer ? 'offer' : 'text',
        offerAmount: isOffer ? opts?.offerAmount ?? null : null,
        offerStatus: isOffer ? 'pending' : null,
      },
      select: { id: true, body: true, createdAt: true, kind: true, offerAmount: true, offerStatus: true },
    }),
    db.conversation.update({
      where: { id: convo.id },
      data: {
        lastMessageAt: new Date(),
        lastMessageText: text.slice(0, 140),
        ...(iAmBuyer ? { sellerUnread: { increment: 1 } } : { buyerUnread: { increment: 1 } }),
      },
    }),
  )
  const result = (await db.$transaction(ops)) as unknown[]
  const message = result[isOffer ? 1 : 0] as { id: string; body: string; createdAt: Date; kind: string; offerAmount: number | null; offerStatus: string | null }

  // Plain chat messages do NOT create a bell notification or push — they already
  // surface on the Messages-icon unread badge (the conversation unread counter,
  // incremented above). Only OFFERS (and future notification types) notify, to
  // keep the bell + push meaningful instead of noisy.
  const recipientId = iAmBuyer ? convo.sellerProfileId : convo.buyerProfileId
  if (recipientId && isOffer) {
    try {
      const sender = await db.profile.findUnique({ where: { id: senderId }, select: { displayName: true, email: true } })
      const senderName = sender?.displayName || sender?.email?.split('@')[0] || 'Someone'
      // Offer bodies are empty (the offer line is derived from offerAmount at render
      // time) — build the notification text from the structured amount + any note.
      const notifText = opts?.offerAmount != null
        ? `Offered ${formatMoneyFull(opts.offerAmount, '₫')}${text ? ` — ${text}` : ''}`
        : text
      await db.notification.create({
        data: {
          recipientId,
          type: 'offer',
          title: senderName,
          body: notifText.slice(0, 140),
          actorName: senderName,
          conversationId: convo.id,
          listingId: convo.listingId,
        },
      })
      // Web push so the recipient sees the offer even with eno.vn closed. Best-effort,
      // after the response flushes — never delays the send.
      after(() => sendPushToProfile(recipientId, {
        title: senderName,
        body: notifText.slice(0, 140),
        url: `/messages/${convo.id}`,
        tag: `convo-${convo.id}`,
      }))
    } catch (e) {
      console.error('[messages] notify', e)
    }
  }

  return { id: message.id, mine: true, body: message.body, createdAt: message.createdAt.toISOString(), kind: message.kind, offerAmount: message.offerAmount, offerStatus: message.offerStatus }
}

/**
 * Accept or decline a pending offer. The actor must be the RECIPIENT of that offer
 * (not the one who made it). Updates the offer's status, drops a confirmation
 * message into the thread (broadcasts via the Message trigger), and notifies +
 * pushes the offerer. Returns false if the offer isn't actionable by this user.
 */
export async function actOnOffer(
  convo: ConvoForSend,
  actorId: string,
  messageId: string,
  action: 'accept' | 'decline',
): Promise<boolean> {
  const offer = await db.message.findFirst({
    where: { id: messageId, conversationId: convo.id, kind: 'offer', offerStatus: 'pending' },
    select: { id: true, senderProfileId: true, offerAmount: true },
  })
  // Only the OTHER party can accept/decline — never your own offer.
  if (!offer || offer.senderProfileId === actorId) return false

  const status = action === 'accept' ? 'accepted' : 'declined'
  // Atomic claim: only transition while STILL pending, so two concurrent
  // accept/decline (or double-clicks) can't both emit the confirmation message +
  // notification/push (TOCTOU). count===0 means another request already won.
  const claim = await db.message.updateMany({ where: { id: offer.id, offerStatus: 'pending' }, data: { offerStatus: status } })
  if (claim.count === 0) return false

  // Confirmation line in the timeline (plain text → broadcasts to both sides).
  const amt = offer.offerAmount != null ? formatMoneyFull(offer.offerAmount, '₫') : ''
  const text = action === 'accept' ? `✅ Offer accepted${amt ? ` — ${amt}` : ''}` : `❌ Offer declined${amt ? ` — ${amt}` : ''}`
  await insertMessage(convo, actorId, text)

  // Notify the offerer of the outcome (offers are high-signal → bell + push).
  try {
    const actor = await db.profile.findUnique({ where: { id: actorId }, select: { displayName: true, email: true } })
    const actorName = actor?.displayName || actor?.email?.split('@')[0] || 'Someone'
    await db.notification.create({
      data: { recipientId: offer.senderProfileId, type: 'offer', title: actorName, body: text, actorName, conversationId: convo.id, listingId: convo.listingId },
    })
    after(() => sendPushToProfile(offer.senderProfileId, { title: actorName, body: text, url: `/messages/${convo.id}`, tag: `convo-${convo.id}` }))
  } catch (e) {
    console.error('[messages] offer-action notify', e)
  }
  return true
}
