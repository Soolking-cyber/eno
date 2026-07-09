'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useLanguage } from '@/context/language-context'
import { haptic } from '@/lib/haptics'
import { timeAgo } from '@/lib/types'

/**
 * One-tap quick replies above the chat composer — shared by the full thread page
 * and the docked chat widget so both surfaces behave identically.
 *
 * Seller side: the 3 questions every seller answers endlessly (+ a "let me think"
 * reply when the buyer's latest message is a pending offer).
 *
 * COMPLETE replies ("Yes, still available", "Price is firm", "Is it still
 * available?"…) AUTO-SEND on tap (user decision 2026-07-05 — one tap, done).
 * Chips that need completing ("Can meet in …") still INSERT into the composer.
 *
 * Buyer side: if the seller confirmed availability within the last 7 days, the
 * availability chip answers INLINE (no message sent) — data beats a round-trip.
 */
export function QuickReplyChips({
  isSeller,
  hasPendingBuyerOffer,
  availabilityConfirmedAt,
  onInsert,
  onSend,
  className,
}: {
  isSeller: boolean
  hasPendingBuyerOffer: boolean
  availabilityConfirmedAt?: string | null
  /** Insert chip text into the composer (parent focuses it, cursor at the end). */
  onInsert: (text: string) => void
  /** Send a complete reply immediately (falls back to onInsert when absent). */
  onSend?: (text: string) => void
  className?: string
}) {
  const { tr, lang } = useLanguage()
  // Inline "seller already confirmed" note (buyer side) — dismissable, session-only.
  const [note, setNote] = useState<'hidden' | 'shown' | 'dismissed'>('hidden')

  const confirmedFresh =
    !!availabilityConfirmedAt && Date.now() - new Date(availabilityConfirmedAt).getTime() < 7 * 864e5

  const chipCls =
    'shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold text-body transition-colors hover:bg-muted hover:text-foreground cursor-pointer'

  // Fire a COMPLETE reply straight away; chips that need words still insert.
  const fire = (text: string) => {
    if (onSend) { haptic(); onSend(text) } else onInsert(text)
  }

  const sellerChips: { label: string; text: string; complete: boolean }[] = [
    { label: tr('Yes, still available', 'Vẫn còn hàng nhé'), text: tr('Yes, still available', 'Vẫn còn hàng nhé'), complete: true },
    { label: tr('Price is firm', 'Giá cố định ạ'), text: tr('Price is firm', 'Giá cố định ạ'), complete: true },
    // Trailing space (no ellipsis) so the seller completes the location right away.
    { label: tr('Can meet in …', 'Có thể gặp ở …'), text: tr('Can meet in ', 'Có thể gặp ở '), complete: false },
    ...(hasPendingBuyerOffer
      ? [{ label: tr('Let me think about it', 'Để mình cân nhắc nhé'), text: tr('Let me think about it', 'Để mình cân nhắc nhé'), complete: true }]
      : []),
  ]

  const askAvailability = () => {
    if (confirmedFresh && availabilityConfirmedAt) {
      // The listing data already answers — save both sides a round-trip.
      if (note !== 'dismissed') setNote('shown')
      return
    }
    fire(tr('Is it still available?', 'Còn hàng không?'))
  }

  return (
    <div className={className}>
      {!isSeller && note === 'shown' && availabilityConfirmedAt && (
        <div className="mb-1 flex items-center gap-1.5 duration-200 animate-in fade-in">
          <p className="min-w-0 flex-1 truncate text-xs font-medium text-success">
            ✓ {tr('Seller confirmed this is available {timeAgo}', 'Người bán đã xác nhận còn hàng {timeAgo}').replace('{timeAgo}', timeAgo(availabilityConfirmedAt, lang))}
          </p>
          <button
            onClick={() => setNote('dismissed')}
            aria-label={tr('Dismiss', 'Đóng')}
            className="shrink-0 rounded-full p-1 text-ink-4 transition-colors hover:text-foreground cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="flex gap-1 overflow-x-auto scrollbar-none">
        {isSeller ? (
          sellerChips.map((c) => (
            <button key={c.label} onClick={() => (c.complete ? fire(c.text) : onInsert(c.text))} className={chipCls}>
              {c.label}
            </button>
          ))
        ) : (
          <button onClick={askAvailability} className={chipCls}>
            {tr('Is it still available?', 'Còn hàng không?')}
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Post-accept follow-through for the SELLER, attached to the accepted offer card:
 * "Deal! Mark X as sold?" → one tap closes the loop (or "Keep it live" dismisses).
 * Shown only right after the seller's own successful accept — never to the buyer,
 * never auto-marks. Dismissal lives in component state only.
 */
export function MarkSoldPrompt({ listingId, listingTitle }: { listingId: string; listingTitle: string }) {
  const { tr } = useLanguage()
  const [state, setState] = useState<'ask' | 'done' | 'dismissed'>('ask')

  if (state === 'dismissed') return null

  const markSold = async () => {
    setState('done') // optimistic — the revert below undoes a refused POST
    haptic(18)
    try {
      const res = await fetch(`/api/listings/${listingId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'sold' }),
      })
      if (!res.ok) throw new Error('status_failed')
    } catch {
      setState('ask')
      toast.error(tr('Could not mark as sold — please try again.', 'Chưa đánh dấu được — vui lòng thử lại.'))
    }
  }

  if (state === 'done') {
    return (
      <p className="mt-2 text-xs font-medium text-success duration-200 animate-in fade-in">
        {tr('Marked as sold — congrats on the deal! 🎉', 'Đã đánh dấu là đã bán — chúc mừng bạn chốt đơn! 🎉')}
      </p>
    )
  }

  return (
    <div className="mt-2 duration-200 animate-in fade-in">
      <p className="text-xs font-medium text-foreground">
        {tr('Deal! Mark "{title}" as sold?', 'Chốt đơn! Đánh dấu "{title}" là đã bán?').replace('{title}', listingTitle)}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <Button
          variant="cta"
          size="none"
          onClick={markSold}
          className="rounded-full px-3 py-1.5 text-xs cursor-pointer"
        >
          {tr('Mark as sold', 'Đánh dấu đã bán')}
        </Button>
        <button
          onClick={() => setState('dismissed')}
          className="rounded-full px-3 py-1.5 text-xs font-semibold text-body transition-colors hover:bg-muted cursor-pointer"
        >
          {tr('Keep it live', 'Giữ tin đăng')}
        </button>
      </div>
    </div>
  )
}
