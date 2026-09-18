import type { Metadata } from 'next'
import { AdminDenied } from '@/components/admin/admin-denied'
import { AdminSectionShell } from '@/components/admin/section-shell'
import { SupportInbox, type SupportMsg, type SupportThreadRow } from '@/components/admin/sections/support-inbox'
import { db } from '@/lib/db'
import { getAdmin } from '@/lib/admin'
import { SUPPORT_SELLER_ID } from '@/lib/support-thread'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Support — eno.vn admin', robots: { index: false, follow: false } }

/**
 * THE SUPPORT DESK'S INBOX — the reader the WhatsApp bridge shipped without.
 *
 * ⛔ WITHOUT THIS PAGE THE BRIDGE IS WRITE-ONLY, AND THAT IS NOT A FIGURE OF SPEECH. Inbound
 * WhatsApp has worked since the webhook was registered: messages arrive, open a per-sender support
 * thread and sit there. But NOTHING listed those threads. `/admin/conversation/[id]` is read-only
 * and reachable only as a deep link from disputes/moderation, `/api/admin/message` sends
 * notification macros rather than conversation messages, and a customer's thread never appears in
 * an operator's own `/messages` because it is not their conversation. Measured 2026-09-09: six
 * messages from one customer were delivered correctly and were unreachable by any URL an operator
 * could have found.
 *
 * ⚠️ THE REPLY PATH IS THE EXISTING `/api/conversations/[id]/messages`, DELIBERATELY. A reviewer
 * argued for a dedicated admin endpoint on the grounds that the customer would see the admin's
 * `senderProfileId`. Measured against the wire type: `SerializedMessage` (src/lib/messages.ts:463)
 * carries `mine: boolean` and no sender identity at all, so nothing leaks. Duplicating that route
 * would fork insertMessage's offer guards, idempotency replay and — the point of the exercise —
 * the WhatsApp relay itself, which is the code most expensive to get wrong twice.
 *
 * ⚠️ `iAmSupport` (that route, :124) is what authorises the reply, and it is edition-scoped through
 * `SUPPORT_SELLER_ID`, so this page can only ever show and answer THIS edition's desk.
 *
 * ⛔ THE OPEN THREAD IS A URL (`?t=<id>`), NOT CLIENT STATE, AND THAT IS A CORRECTNESS DECISION.
 * The first version held `openId`, `msgs` and the draft in the client. All four reviewers found
 * the same defect independently: none of it was reset when the selection changed, so an operator
 * could type a reply to A, click B, press Enter — and A's words were delivered to B, over
 * WhatsApp, to a stranger. Two more followed from the same root: an unsequenced `load()` let a
 * slow response for A overwrite B's transcript, and mounting auto-opened the newest thread, which
 * silently marked it read without anyone reading it — regressing the exact "nobody saw it" failure
 * this page exists to end. Selection as a link makes all three unrepresentable rather than fixed.
 *
 * ⛔ AND ATTRIBUTION IS COMPUTED HERE, AGAINST THE BUYER, NEVER FROM THE WIRE'S `mine`. That flag
 * is "did the CURRENT session send this", so on a shared desk every earlier reply by a COLLEAGUE
 * reads as `mine: false` and renders as if the customer had said it. A support desk is not a
 * two-party chat; the only stable question is "is this the customer", and `senderProfileId ===
 * buyerProfileId` is it.
 */
export default async function AdminSupportPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const admin = await getAdmin()
  if (!admin) return <AdminDenied />
  const { t: openId } = await searchParams

  const convos = await db.conversation.findMany({
    where: { sellerId: SUPPORT_SELLER_ID },
    orderBy: { lastMessageAt: 'desc' },
    take: 100,
    select: {
      id: true, lastMessageText: true, lastMessageAt: true, sellerUnread: true,
      buyer: { select: { displayName: true, phone: true } },
    },
  })

  /**
   * ⚠️ THE NUMBER COMES FROM `whatsapp_inbound`, NEVER FROM `Profile.phone` — the same rule
   * `whatsappRecipientFor` follows. A phone on a profile is not evidence that person opened a
   * WhatsApp channel with us, and showing it here would invite an operator to expect a relay that
   * will not happen. No row = the thread began in-app, and a reply stays in-app.
   */
  const inbound = await db.whatsAppInbound.findMany({
    where: { conversationId: { in: convos.map((c) => c.id) } },
    orderBy: { createdAt: 'desc' },
    select: { conversationId: true, waId: true, createdAt: true },
  })
  const latest = new Map<string, { waId: string; at: Date }>()
  for (const r of inbound) if (!latest.has(r.conversationId)) latest.set(r.conversationId, { waId: r.waId, at: r.createdAt })

  const rows: SupportThreadRow[] = convos.map((c) => {
    const wa = latest.get(c.id)
    return {
      id: c.id,
      who: c.buyer?.displayName || 'Someone',
      waId: wa?.waId ?? null,
      // ⚠️ ADVISORY, NOT AUTHORITATIVE. Meta's 24-hour customer-service window is measured on
      // Meta's clock against the customer's last message; this is ours, against the last delivery
      // we recorded. It is here so an operator understands a rejected relay, never as a gate — the
      // in-app message stands either way, and only Meta can actually decide.
      lastInboundAt: wa ? wa.at.toISOString() : null,
      preview: c.lastMessageText ?? '',
      lastAt: c.lastMessageAt ? c.lastMessageAt.toISOString() : null,
      unread: c.sellerUnread,
    }
  })

  /**
   * ⚠️ THE THREAD IS LOADED ONLY WHEN ONE IS ASKED FOR, and reading it is what clears the desk's
   * unread — an explicit consequence of opening, not of the page existing.
   */
  let messages: SupportMsg[] = []
  /**
   * ⛔ A THREAD OLDER THAN THE NEWEST 100 MUST STILL OPEN. `rows` is a window for the LIST; deriving
   * the open thread from it too meant a link, a bookmark or the queue tile could point at a thread
   * the page then refused to render — the console counting work it could not reach, which is the
   * failure this page exists to end wearing different clothes. The window bounds the list only.
   */
  let open = rows.find((r) => r.id === openId) ?? null
  if (!open && openId) {
    const extra = await db.conversation.findUnique({
      where: { id: openId, sellerId: SUPPORT_SELLER_ID },
      select: { id: true, lastMessageText: true, lastMessageAt: true, sellerUnread: true, buyer: { select: { displayName: true } } },
    })
    if (extra) {
      const wa = await db.whatsAppInbound.findFirst({ where: { conversationId: extra.id }, orderBy: { createdAt: 'desc' }, select: { waId: true, createdAt: true } })
      open = {
        id: extra.id,
        who: extra.buyer?.displayName || 'Someone',
        waId: wa?.waId ?? null,
        lastInboundAt: wa ? wa.createdAt.toISOString() : null,
        preview: extra.lastMessageText ?? '',
        lastAt: extra.lastMessageAt ? extra.lastMessageAt.toISOString() : null,
        unread: extra.sellerUnread,
      }
    }
  }
  if (open) {
    const convo = await db.conversation.findUnique({
      // ⛔ SCOPED BY THE DESK IN THE QUERY, NOT BY THE 100-ROW WINDOW. `belongs` used to test
      // membership of `rows`, which meant a thread older than the newest 100 could not be opened at
      // all — the queue tile counts every one of them, so the console would show work it could not
      // reach. Asking the database "is this conversation on MY desk" is both correct for a bigger
      // desk and the same guard against `?t=` naming a private buyer↔seller thread.
      where: { id: open.id, sellerId: SUPPORT_SELLER_ID },
      select: {
        buyerProfileId: true, sellerUnread: true,
        /**
         * ⚠️ NEWEST 200, THEN REVERSED — `asc` + `take` returns the OLDEST 200, so a long-running
         * thread would show its opening and hide the message actually waiting for an answer, while
         * the reply box stayed live above an obsolete transcript. Same shape the thread route uses
         * (conversations/[id]/route.ts:147).
         */
        messages: { orderBy: { createdAt: 'desc' }, take: 200, select: { id: true, body: true, createdAt: true, senderProfileId: true, deletedAt: true } },
      },
    })
    if (convo) {
      messages = [...convo.messages].reverse().map((m) => ({
        id: m.id,
        fromCustomer: m.senderProfileId === convo.buyerProfileId,
        body: m.deletedAt ? '' : m.body,
        deleted: !!m.deletedAt,
        createdAt: m.createdAt.toISOString(),
      }))
      /**
       * ⛔ DECREMENT BY WHAT WAS READ, NEVER `set: 0`. The read and the write are separate
       * statements, so a message arriving between them had its increment erased by a blanket zero
       * — a real customer message marked read that nobody ever saw, which is the precise failure
       * this whole page exists to end. Decrementing by the count we actually rendered leaves a
       * concurrent arrival still unread.
       */
      /**
       * ⛔ THE CLEAR IS A LOCKED READ-MODIFY-WRITE, AND IT TOOK THREE WRONG ANSWERS TO GET HERE.
       * Every lock-free shape leaks, because the count is read in one statement and written in
       * another:
       *   · `set: 0`        — erased a message that arrived between the two.
       *   · `decrement: n`  — two operators each decrement, the count goes NEGATIVE, and the next
       *                       real message only lifts it back to zero, so it is never counted.
       *   · `where lte: n`  — A clears, a message arrives (1), B's `1 <= n` still holds and zeroes
       *                       it. Narrower, same silent loss.
       * `SELECT … FOR UPDATE` serialises the two operators, so the second reads the value the first
       * actually left and a concurrent arrival survives. The cost is one short row lock on a page a
       * handful of operators open; the alternative is the queue quietly under-reporting the work,
       * which is the failure this whole page exists to end.
       */
      if (convo.sellerUnread > 0) {
        await db.$transaction(async (tx) => {
          const [locked] = await tx.$queryRaw<{ sellerUnread: number }[]>`
            select "sellerUnread" from "Conversation" where id = ${open!.id} for update`
          if (!locked || locked.sellerUnread <= 0) return
          // Only what THIS render displayed is cleared; anything newer stays unread.
          const clear = Math.min(locked.sellerUnread, convo.sellerUnread)
          await tx.conversation.update({ where: { id: open!.id }, data: { sellerUnread: { decrement: clear } } })
        })
      }
    }
  }

  return (
    <AdminSectionShell
      title="Support"
      description="Threads people opened with the desk — in the app, or over WhatsApp. A reply here goes back to WhatsApp when they arrived that way."
    >
      {/**
        * ⛔ THE `key` IS THE FIX, AND ITS ABSENCE WAS A REAL WRONG-RECIPIENT BUG. An earlier
        * version argued that moving selection into `?t=` made a leaked draft unrepresentable
        * because navigating unmounts the component. That is false, and all four reviewers said so
        * independently: `?t=A → ?t=B` is a SOFT navigation inside the SAME route segment, so React
        * reconciles `SupportInbox` — same type, same position, no key — and `useState` SURVIVES.
        * The operator could still type to A, click B and send A's words to B over WhatsApp.
        * Keying on the thread id gives React a different element identity, which is what actually
        * discards the draft. A comment asserting a property the code lacks is worse than the bug.
        */}
      <SupportInbox key={open?.id ?? 'none'} rows={rows} open={open} messages={messages} />
    </AdminSectionShell>
  )
}
