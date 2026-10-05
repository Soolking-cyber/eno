'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useLanguage } from '@/context/language-context'
import { timeAgo } from '@/lib/types'
import { fillTemplate } from '@/lib/i18n/placeholders'
import { isGoodsSale } from '@/lib/trade-loop'
import { MarkSoldSheet, type MarkSoldBuyer, type MarkSoldSubmission } from './mark-sold-sheet'

/**
 * ── <MarkSoldFlow> — <MarkSoldSheet> wired to the server (B6-SOLD-LOOP) ──────────────────────────
 *
 * The sheet is props-only on purpose (its header says so), so the three things it refuses to know live
 * here, once, for every entry point — the dashboard row, the chat's "Deal!" chip and the thread strip:
 *
 *   · WHO MESSAGED — GET /api/listings/[id]/buyers?scope=listing: the threads about THIS listing (anchored
 *     here, or carrying an offer about it from before a retarget — the route says how, and what it still
 *     misses). POST /sold accepts a buyer from exactly that scope and no other. ⚠️ `buyersLoaded` stays
 *     false until the answer is in, and a FAILED lookup closes the sheet rather than ever passing an empty
 *     list: "we could not look" must never read as an answer.
 *   · WHETHER TO PRE-SELECT ANYONE (B6 review) — only on what is KNOWN:
 *       · "someone not on eno" only when the route PROVES nobody ever messaged about the listing
 *         (`nobodyMessaged`), never merely because the list came back empty — the scope is lossy (a
 *         thread that moved to another listing), and a guess there files a false off-eno sale where the
 *         old path wrote an honest null;
 *       · the thread's buyer only when the thread has a DEAL that still stands for this listing
 *         (`threadHasDeal` — src/lib/thread-deal.ts, or the offer just accepted), not merely because the
 *         sheet was opened from their chat.
 *     Unsure → nothing is picked: one more tap, never a wrong answer pre-filled.
 *   · THE WRITE'S LIFECYCLE — `submitting` set synchronously in onConfirm, `errorMessage` cleared when a
 *     retry starts and set when one fails (both are contracts on the sheet's props), close on success.
 *   · THE REQUEST — POST /api/listings/[id]/sold (see `markSoldRequest`). Each entry point hands in its
 *     own `write`: the optimistic flip and the rollback are the caller's, because only the caller holds
 *     the state that flips (the dashboard row's status override, the thread's listing).
 *
 * WHAT IT RECORDS. /sold runs the same setStatusCore transition as the plain status POST — status, soldAt,
 * purge, de-index, webhook — and adds the attribution and the trade loop's columns through validateMarkSold
 * (src/lib/trade-loop.ts): who bought it, the agreed price, and — for a named eno buyer — the question.
 * That buyer is ASKED (a notification and push into their thread, where sale-questions.tsx shows them
 * sale-confirm-prompt.tsx), which is what turns the sheet's "{name} will be asked to confirm" on
 * (`asksBuyerToConfirm`) — from the route's own `asksBuyer`, so the footer promises exactly what the
 * server does.
 */

/** The body POST /api/listings/[id]/sold reads (see `markSoldRequest`). */
export type MarkSoldRequest =
  | { buyerProfileId: string; salePrice: number | null }
  | { channel: 'external'; salePrice: number | null }

/**
 * Does "Who bought it?" describe this listing? Only a SALE of goods — `isGoodsSale` in src/lib/trade-loop.ts,
 * the SAME rule POST /sold uses to decide whether the named buyer is asked to confirm, so the sheet and the
 * question can never disagree about which listings they cover.
 * ⚠️ Everything else keeps the plain sold action it had: "Who bought it?" and "Agreed price" do not
 * describe a tenancy, a hire, a teacher, a service or a buyer's own "wanted" post, and the trade loop
 * (buyer confirmation, sold-price guidance) is defined for sales.
 */
export function soldSheetApplies(l: { listingType?: string | null; categorySlug?: string | null }): boolean {
  return isGoodsSale(l)
}

/**
 * The sheet's answer as the /sold body.
 *  · A named person → `{ buyerProfileId }` — the route checks they really messaged this seller about THIS
 *    listing (the same scope /buyers?scope=listing lists), and asks them to confirm.
 *  · "Someone not on eno" → `{ channel: 'external' }` — a real sale, recorded off-platform.
 * `salePrice` is the agreed price, stored by the route. 0 — a giveaway — travels as null: normalizeSalePrice
 * reads null as "the seller did not say" and 0 as an implausible figure. The sheet lets a seller acknowledge
 * ANY figure, so the route stores an out-of-bounds one as null rather than refusing the sale.
 */
export function markSoldRequest({ buyerId, price }: MarkSoldSubmission): MarkSoldRequest {
  const salePrice = price > 0 ? price : null
  return buyerId ? { buyerProfileId: buyerId, salePrice } : { channel: 'external', salePrice }
}

/** GET /api/listings/[id]/buyers?scope=listing — the people, plus what the route can vouch for. */
type BuyersReply = {
  rows: BuyerRow[]
  /** PROVEN that nobody ever messaged about this listing (the off-eno default needs it — see the header). */
  nobodyMessaged: boolean
  /** POST /sold will ask the named buyer to confirm (a sale of goods, never the services desk). */
  asksBuyer: boolean
}

/** One row of GET /api/listings/[id]/buyers. */
type BuyerRow = {
  conversationId: string
  profileId: string
  name: string | null
  avatarUrl: string | null
  avatarColor: string | null
  lastMessageAt: string
}

export type MarkSoldFlowProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  listing: { id: string; title: string; price: number; currency?: string }
  /** Opened from a chat: that conversation's buyer is listed first. Matched on the /buyers row's
   *  conversationId, because the thread payload carries no counterpart profile id. */
  threadConversationId?: string | null
  /** ⚠️ AND PRE-SELECTED ONLY WHEN THE THREAD HAS A DEAL — an accepted offer that still stands for this
   *  listing (src/lib/thread-deal.ts), or the one just accepted. Opening the sheet from someone's chat
   *  is not evidence they bought it; without a deal the seller picks (B6 review). */
  threadHasDeal?: boolean
  /** The thread's accepted offer, in whole VND — the price that buyer agreed to, so it pre-fills the
   *  "Agreed price" when they are the one picked. Applies to the thread's buyer only. */
  threadAcceptedOffer?: number | null
  /**
   * The caller's write: flip optimistically, POST the body to /api/listings/[id]/sold, roll back on
   * failure. Resolves whether it landed. A rejection is treated as a failure — the spinner can never
   * stick on an exception.
   */
  write: (sale: MarkSoldRequest) => Promise<boolean>
}

export function MarkSoldFlow({ open, onOpenChange, listing, threadConversationId, threadHasDeal = false, threadAcceptedOffer, write }: MarkSoldFlowProps) {
  const { lang, tr } = useLanguage()
  // null = not loaded yet. Reset on every open: the list can change between opens (a new message).
  const [reply, setReply] = useState<BuyersReply | null>(null)
  const rows = reply?.rows ?? null
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Adjust-state-during-render on the false→true edge (the sheet's own pattern): each open starts with
  // no list and no message. A failure reported while the sheet was closed belongs to that earlier
  // attempt — it was toasted then (see `confirm`) and must not greet the next one.
  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (open) {
      setReply(null)
      setErrorMessage(null)
    }
  }

  // Read from an async callback (`confirm`), so refs rather than stale closures.
  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  }, [open])
  // ⚠️ A WRITE CAN OUTLIVE THIS SHEET: a parent that keys one sheet per sale (the thread) remounts it for the
  // next one. The answer is then still told — as a toast — but must not reach into what the parent shows now
  // (closing, or erroring, a sheet that is about a different sale).
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!open) return
    let live = true
    fetch(`/api/listings/${encodeURIComponent(listing.id)}/buyers?scope=listing`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`buyers_${res.status}`))))
      .then((d: { buyers?: unknown; nobodyMessaged?: unknown; asksBuyer?: unknown }) => {
        if (!live) return
        setReply({
          rows: Array.isArray(d.buyers) ? (d.buyers as BuyerRow[]).filter((r) => r && typeof r.profileId === 'string' && r.profileId) : [],
          // `=== true`: a reply that does not say (an older server) is "unsure" — nothing pre-picked, no
          // promise made.
          nobodyMessaged: d.nobodyMessaged === true,
          asksBuyer: d.asksBuyer === true,
        })
      })
      .catch(() => {
        if (!live) return
        // Never an empty list (header): close, and say why. Nothing was sent, so closing loses nothing.
        onOpenChange(false)
        toast.error(tr('Could not load who messaged you — please try again.', 'Không tải được danh sách người đã nhắn tin — vui lòng thử lại.'))
      })
    return () => {
      live = false
    }
    // `onOpenChange` / `tr` are deliberately not dependencies: a new identity must not refetch.
  }, [open, listing.id])

  // The thread's buyer first — the person this chat is with is the likeliest answer — then the rest in
  // the route's order (most recent conversation first). The sheet never re-ranks what it is handed.
  // ONE ROW PER PERSON: a buyer can hold two threads with one seller (a pending offer forks a second one),
  // and two rows with one id would be two radios with one value.
  const threadRow = threadConversationId && rows ? rows.find((r) => r.conversationId === threadConversationId) : undefined
  const ordered: BuyerRow[] = []
  const seen = new Set<string>()
  for (const r of threadRow && rows ? [threadRow, ...rows.filter((x) => x !== threadRow)] : rows ?? []) {
    if (seen.has(r.profileId)) continue
    seen.add(r.profileId)
    ordered.push(r)
  }
  const buyers: MarkSoldBuyer[] = ordered.map((r) => ({
    id: r.profileId,
    name: r.name?.trim() || tr('Buyer', 'Người mua'),
    avatarUrl: r.avatarUrl,
    avatarColor: r.avatarColor,
    hint: fillTemplate(tr('Last message {time}', 'Nhắn lần cuối {time}'), 'Last message {time}', { time: timeAgo(r.lastMessageAt, lang) }),
    acceptedOffer: r === threadRow && threadAcceptedOffer && threadAcceptedOffer > 0 ? threadAcceptedOffer : null,
  }))

  const confirm = (submission: MarkSoldSubmission) => {
    // Both synchronously, in this handler (the sheet's prop contracts): the spinner up before the next
    // paint, and the old message gone so the next failure reads as a NEW report and re-arms the CTA.
    setErrorMessage(null)
    setSubmitting(true)
    Promise.resolve()
      .then(() => write(markSoldRequest(submission)))
      .catch(() => false)
      .then((ok) => {
        const here = mountedRef.current
        if (here) setSubmitting(false)
        if (ok) {
          if (here) onOpenChange(false)
          toast.success(tr('Marked as sold', 'Đã đánh dấu là đã bán'))
          return
        }
        const msg = tr('Could not mark as sold — please try again.', 'Chưa đánh dấu được — vui lòng thử lại.')
        // Open: said inside the sheet, which re-arms its CTA for the retry. Dismissed mid-write (Escape
        // and the swipe stay live by design) or replaced: there is no sheet to say it in, and the rollback
        // alone would be a silent undo — so it is a toast.
        if (here && openRef.current) setErrorMessage(msg)
        else toast.error(msg)
      })
  }

  return (
    <MarkSoldSheet
      open={open}
      onOpenChange={onOpenChange}
      listing={listing}
      buyers={buyers}
      buyersLoaded={rows !== null}
      nobodyMessaged={reply?.nobodyMessaged === true}
      asksBuyerToConfirm={reply?.asksBuyer === true}
      defaultBuyerId={threadHasDeal ? (threadRow?.profileId ?? null) : null}
      onConfirm={confirm}
      submitting={submitting}
      errorMessage={errorMessage}
    />
  )
}
