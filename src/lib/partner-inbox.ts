import { db } from '@/lib/db'
import { liveForSeller } from '@/lib/unread'
import { blockedConversationIds } from '@/lib/user-blocks'

/**
 * THE PARTNER SHOPS' UNREAD CHATS — COUNTED, NEVER READ (owner, 2026-11-12: "if customer messages any of the shops it gets
 * notified so admins can check inbox messages for all partner shops from one place"; asked whether eno's team may read those
 * chats, the owner chose "Counter only, no reading").
 *
 * Per partner shop: how many of its conversations hold messages the shop has not read, and how many messages that is — the
 * shop's own unread counters (Conversation.sellerUnread), exactly as its inbox shows them. ⛔ NO MESSAGE TEXT, NO CUSTOMER, NO
 * CONVERSATION ID, NO TIME ever leaves this module: the partner reads and answers in its own account; the team only sees that
 * a shop has chats to answer. A per-shop count identifies no customer and discloses no message, which is why it needed no
 * /privacy change (owner's choice; codex plan review 2026-11-12 asked, answered here).
 * ⚠️ "Unread", not "unanswered": opening a chat clears its count without a reply (conversations/[id] GET), and a recalled
 * message leaves the counter as it was (the inbox's own rule).
 *
 * ⛔ THE ROSTER IS THE OWNER'S FIVE SHOPS, BY HANDLE — the identity the partner strip (partner-strip.ts) and the import scripts
 * (import-blvck.ts, import-saigonmoving.ts) already use. Not `officialPartner`: that flag also covers other partners (CellphoneS
 * — scripts/set-official-partner.mjs), and the owner named these five. A handle that no longer resolves drops its row (the page
 * lists what it found, so a missing shop shows as missing).
 * ⛔ A HANDLE CAN BE RENAMED AND RE-CLAIMED (POST /api/handle; handle.ts claimHandle frees the old one — opus review 2026-11-12):
 * so a partner handle counts only on an `officialPartner` seller, a flag eno alone sets — an impostor that takes a freed "goplus"
 * is never counted. ENO Trading is eno's own account (its handle changes only if eno changes it).
 */
export const PARTNER_INBOX_HANDLES = ['goplus', 'blvck', 'saigonmoving', 'vietkite', 'eno-trading'] as const
const ENO_OWN_STORE = 'eno-trading'

export type PartnerInboxShop = {
  sellerId: string
  name: string
  handle: string
  /** Conversations holding at least one message the shop has not read. */
  unreadChats: number
  /** The shop's unread messages across them (the inbox's own counter). */
  unreadMessages: number
}

export type PartnerInbox = { shops: PartnerInboxShop[]; unreadChats: number; unreadMessages: number }

export async function partnerInboxCounts(): Promise<PartnerInbox> {
  // edition-lint-allow: the owner's five partner shops, their counts shown to admins only — never offered to anyone.
  const found = await db.seller.findMany({
    where: { handle: { handle: { in: [...PARTNER_INBOX_HANDLES] } } },
    select: { id: true, name: true, ownerId: true, officialPartner: true, handle: { select: { handle: true } } },
  })
  const sellers = found.filter((s) => s.officialPartner || s.handle?.handle === ENO_OWN_STORE)
  const shops = await Promise.all(sellers.map(async (s): Promise<PartnerInboxShop> => {
    // The shop's own inbox hides threads with people its owner blocked (unread.ts, App Store gate `ugc-safety`): so does this.
    const hiddenByBlock = s.ownerId ? await blockedConversationIds(s.ownerId) : []
    const where = { AND: [{ sellerId: s.id, sellerUnread: { gt: 0 } }, liveForSeller(), hiddenByBlock.length ? { id: { notIn: hiddenByBlock } } : {}] }
    const agg = await db.conversation.aggregate({ where, _count: { _all: true }, _sum: { sellerUnread: true } })
    return { sellerId: s.id, name: s.name, handle: s.handle?.handle ?? '', unreadChats: agg._count._all, unreadMessages: agg._sum.sellerUnread ?? 0 }
  }))
  // The owner's order (the roster's), so the page reads the same on every load; the counts carry the urgency.
  shops.sort((a, b) => PARTNER_INBOX_HANDLES.indexOf(a.handle as never) - PARTNER_INBOX_HANDLES.indexOf(b.handle as never))
  return {
    shops,
    unreadChats: shops.reduce((n, s) => n + s.unreadChats, 0),
    unreadMessages: shops.reduce((n, s) => n + s.unreadMessages, 0),
  }
}
