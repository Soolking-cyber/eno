import { db } from '@/lib/db'
import { kv } from '@/lib/ratelimit'
import { logError } from '@/lib/log'
import { insertMessage } from '@/lib/messages'
import { isPartnerInboxSeller } from '@/lib/partner-inbox'
import { PARTNER_WELCOME_LINE } from '@/lib/partner-welcome-line'
import { FOREIGN_SUPPORT_SELLER_ID, SUPPORT_SELLER_ID } from '@/lib/support-thread'
import { RENTAL_DESK_SELLER_IDS } from '@/lib/rental-check/desk-ids'
import { TEACHER_LISTING_TYPE } from '@/lib/teachers/constants'
import { isBlockedBetween } from '@/lib/user-blocks'

/** A customer back after this long with no word from the shop gets the welcome again (plan review, 2026-11-18). */
export const PARTNER_WELCOME_QUIET_DAYS = 14

/**
 * ⛔ ONLY A SHOP ENO ANSWERS FROM A LOGIN IT HOLDS — its owner signs in as support+<shop>@eno.vn (register-partner-seller.mjs,
 * claim-partner-storefront.mjs). GoPlus, Blvck, Saigon Moving and VietKite are on the roster but answer from their OWN
 * accounts: eno never posts in their name, nor asks their customers for a phone their own staff would read (commit gate,
 * 2026-11-18). An @eno.vn address only reaches eno (Cloudflare Email Routing; the catch-all drops), so nobody else holds one.
 */
export const isEnoHeldLogin = (email: string | null | undefined): boolean => !!email && /@eno\.vn$/i.test(email.trim())

/**
 * THE PARTNER WELCOME (owner, 2026-11-18 — src/lib/partner-welcome-line.ts has the words). After a CUSTOMER's message has
 * been saved in a thread with a shop on the Admin › Partner inbox roster (src/lib/partner-inbox.ts) that eno answers from a
 * login it holds (isEnoHeldLogin), the shop posts the fixed welcome line once, which asks for the customer's phone; the
 * thread page puts "Send my number" / "Add my number" under it (PartnerPhoneChip).
 *
 * Called in `after()` by both buyer send paths (POST /api/conversations and POST /api/conversations/[id]/messages), so it
 * never delays or fails a send: every error is logged and swallowed.
 *
 * ⛔ ONLY WHEN THE SHOP HAS BEEN QUIET: no message from the shop's side, of any kind (an earlier welcome included), in the last
 * PARTNER_WELCOME_QUIET_DAYS. So a first contact gets it, a customer back weeks later gets it again, and a live conversation
 * with an admin never does.
 * ⛔ NEVER on the support desk, a rental desk, a visa thread or a teacher listing (none is a partner shop today; the guard
 * keeps a later roster entry from reaching them), never when either side blocked the other, never on a thread whose
 * seller side is not the shop's CURRENT login.
 * ⚠️ Two sends at the same instant both see a quiet shop: a kv NX claim (2 minutes) lets one through. The claim is released
 * when the insert fails, so the next message tries again; after a success the quiet check above takes over.
 * What the insert does (src/lib/messages.ts, kind 'partner_welcome'): the customer's unread +1, NOT the shop's (Admin › Partner
 * inbox still counts the customer's message as waiting), and the thread's preview stays the customer's own words. Plain
 * kind: no bell, no push; response-rate.ts counts only 'text'/'offer', so the welcome is never a reply.
 */
export async function maybeSendPartnerWelcome(conversationId: string, now: Date = new Date()): Promise<'sent' | 'skipped'> {
  try {
    const c = await db.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true, buyerProfileId: true, sellerProfileId: true, sellerId: true, listingId: true, visaApplicationId: true,
        listing: { select: { listingType: true } },
        seller: { select: { id: true, ownerId: true, officialPartner: true, handle: { select: { handle: true } }, owner: { select: { email: true } } } },
      },
    })
    if (!c?.sellerProfileId || c.sellerProfileId === c.buyerProfileId) return 'skipped'
    if (c.visaApplicationId || c.listing?.listingType === TEACHER_LISTING_TYPE) return 'skipped'
    if (c.sellerId === SUPPORT_SELLER_ID || c.sellerId === FOREIGN_SUPPORT_SELLER_ID || (RENTAL_DESK_SELLER_IDS as readonly string[]).includes(c.sellerId)) return 'skipped'
    if (!isPartnerInboxSeller(c.seller) || c.seller.ownerId !== c.sellerProfileId || !isEnoHeldLogin(c.seller.owner?.email)) return 'skipped'
    if (await isBlockedBetween(c.buyerProfileId, c.sellerProfileId)) return 'skipped'
    const since = new Date(now.getTime() - PARTNER_WELCOME_QUIET_DAYS * 86_400_000)
    const spoke = await db.message.findFirst({
      where: { conversationId, senderProfileId: { not: c.buyerProfileId }, createdAt: { gte: since } },
      select: { id: true },
    })
    if (spoke) return 'skipped'
    const claim = `partner-welcome:${conversationId}`
    if (!(await kv.set(claim, 1, { nx: true, ex: 120 }))) return 'skipped'
    try {
      await insertMessage(
        { id: c.id, buyerProfileId: c.buyerProfileId, sellerProfileId: c.sellerProfileId, listingId: c.listingId },
        c.sellerProfileId,
        PARTNER_WELCOME_LINE,
        { kind: 'partner_welcome' },
      )
    } catch (e) {
      await kv.del(claim).catch((d) => logError(d, { op: 'partnerWelcome.release', conversationId }))
      throw e
    }
    return 'sent'
  } catch (e) {
    logError(e, { op: 'partnerWelcome', conversationId })
    return 'skipped'
  }
}
