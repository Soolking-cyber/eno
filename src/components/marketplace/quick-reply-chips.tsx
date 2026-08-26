'use client'

import { useRef, useState } from 'react'
import { Check, Loader2, LocateFixed, PartyPopper, X } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { toast } from 'sonner'
import { useLanguage } from '@/context/language-context'
import { haptic } from '@/lib/haptics'
import { timeAgo } from '@/lib/types'

/**
 * The one chip look, shared by the quick-reply chips and the "Keep it live"
 * dismiss below. Module scope so both components use the same constant.
 * Paired with <Button variant="soft" size="none">: `soft` gives the muted hover
 * background and leaves the label colour (text-body) entirely to this class.
 */
const chipCls =
  'shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold text-body transition-colors hover:bg-muted hover:text-foreground cursor-pointer'

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
  composerText,
  className,
}: {
  isSeller: boolean
  hasPendingBuyerOffer: boolean
  availabilityConfirmedAt?: string | null
  /** Insert chip text into the composer (parent focuses it, cursor at the end). */
  onInsert: (text: string) => void
  /** Send a complete reply immediately (falls back to onInsert when absent). */
  onSend?: (text: string) => void
  /** Live composer value — lets the meet chip auto-complete the location ONLY while
   *  the composer still holds the untouched template (never clobbers typing). */
  composerText?: string
  className?: string
}) {
  const { tr, lang } = useLanguage()
  // Inline "seller already confirmed" note (buyer side) — dismissable, session-only.
  const [note, setNote] = useState<'hidden' | 'shown' | 'dismissed'>('hidden')
  const [locating, setLocating] = useState(false)
  // Latest composer value for the async geolocation callback — a stale closure would
  // compare against the value at tap time and overwrite what the seller typed since.
  const composerRef = useRef(composerText)
  composerRef.current = composerText

  // "Can meet in …" + the locate glyph: tap inserts the template SYNCHRONOUSLY (iOS only
  // opens the keyboard for focus inside the tap's call stack — same invariant as the
  // composer's insert()), then geolocation → /api/reverse-geocode fills the place in —
  // unless the seller already typed, in which case their words win. Failures stay
  // silent: the template is already in the composer, exactly the pre-icon behaviour.
  const meetTemplate = tr('Can meet in ', 'Có thể gặp ở ')
  const locateMeet = () => {
    onInsert(meetTemplate)
    if (locating || typeof navigator === 'undefined' || !navigator.geolocation) return
    setLocating(true)
    haptic()
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const r = await fetch(`/api/reverse-geocode?lat=${coords.latitude}&lng=${coords.longitude}&lang=${lang}`)
          const d = r.ok ? await r.json().catch(() => ({})) : {}
          const place = [d.ward || d.wardCandidates?.[0], d.district, d.province]
            .filter((p: unknown): p is string => typeof p === 'string' && p.length > 0)
            .slice(0, 2)
            .join(', ')
          if (place && composerRef.current === meetTemplate) onInsert(meetTemplate + place)
        } finally {
          setLocating(false)
        }
      },
      () => setLocating(false),
      { timeout: 8000, maximumAge: 60000 },
    )
  }

  const confirmedFresh =
    !!availabilityConfirmedAt && Date.now() - new Date(availabilityConfirmedAt).getTime() < 7 * 864e5

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
        <div className="mb-1 flex items-center gap-1.5 duration-200 ease-out animate-in fade-in">
          <p className="flex min-w-0 flex-1 items-center gap-1 text-xs font-medium text-success">
            {/* Line glyph, not the '✓' literal — one check mark per icon-language §1. */}
            <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{tr('Seller confirmed this is available {timeAgo}', 'Người bán đã xác nhận còn hàng {timeAgo}').replace('{timeAgo}', timeAgo(availabilityConfirmedAt, lang))}</span>
          </p>
          <IconButton
            tapTarget={false}
            size="xs"
            onClick={() => setNote('dismissed')}
            aria-label={tr('Dismiss', 'Đóng')}
            className="text-ink-4 transition-colors hover:text-foreground"
          >
            <X className="h-[29px] w-[29px] shrink-0" />
          </IconButton>
        </div>
      )}
      <div className="flex gap-1 overflow-x-auto scrollbar-none">
        {isSeller ? (
          sellerChips.map((c) => (
            <Button
              key={c.label}
              variant="soft"
              size="none"
              onClick={() => (c.text === meetTemplate ? locateMeet() : c.complete ? fire(c.text) : onInsert(c.text))}
              className={chipCls}
            >
              {c.label}
              {c.text === meetTemplate &&
                /* size-* class is REQUIRED: ui/button inflates unclassed svgs to size-4. */
                (locating
                  ? <Loader2 className="ml-1 size-3.5 animate-spin text-accent-foreground" />
                  : <LocateFixed className="ml-1 size-3.5 text-accent-foreground" />)}
            </Button>
          ))
        ) : (
          <Button variant="soft" size="none" onClick={askAvailability} className={chipCls}>
            {tr('Is it still available?', 'Còn hàng không?')}
          </Button>
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
      <p className="flex items-center gap-1.5 mt-2 text-xs font-medium text-success duration-200 ease-out animate-in fade-in">
        {/* Line glyph instead of the 🎉 emoji — celebration stays, raster ink goes (§1). */}
        <PartyPopper className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {tr('Marked as sold — congrats on the deal!', 'Đã đánh dấu là đã bán — chúc mừng bạn chốt đơn!')}
      </p>
    )
  }

  return (
    <div className="mt-2 duration-200 ease-out animate-in fade-in">
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
        <Button
          variant="soft"
          size="none"
          onClick={() => setState('dismissed')}
          className={chipCls}
        >
          {tr('Keep it live', 'Giữ tin đăng')}
        </Button>
      </div>
    </div>
  )
}
