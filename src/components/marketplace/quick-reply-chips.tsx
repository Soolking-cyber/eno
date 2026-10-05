'use client'

import { useRef, useState } from 'react'
import { Check, Loader2, LocateFixed, PartyPopper } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { CloseButton } from '@/components/ui/close-button'
import { Chip } from '@/components/ui/chip'
import { toast } from 'sonner'
import { useLanguage } from '@/context/language-context'
import { haptic } from '@/lib/haptics'
import { timeAgo } from '@/lib/types'
import { openersFor, openerString, type OpenerListing } from '@/lib/openers'

/**
 * Who has said what so far — the two facts the chip set keys off (inbox-13). Messages are in the
 * VIEWER's frame (`mine`), so "the buyer" is `mine` for a buyer and `!mine` for a seller.
 *   · buyerHasSent — the buyer has written anything at all. Their "Is it still available?" is an
 *     OPENER: once they have opened, it is a chip asking a question they already asked.
 *   · sellerRepliedAfterBuyer — the seller has written after the buyer's first message, so the
 *     opening question has had its answer and "Yes, still available" would say it twice.
 * Pure, so it is pinned by a test rather than by rendering a thread.
 */
export function chipContext(messages: readonly { mine: boolean }[], isSeller: boolean): { buyerHasSent: boolean; sellerRepliedAfterBuyer: boolean } {
  const isBuyerMsg = (m: { mine: boolean }) => (isSeller ? !m.mine : m.mine)
  const firstBuyer = messages.findIndex(isBuyerMsg)
  if (firstBuyer < 0) return { buyerHasSent: false, sellerRepliedAfterBuyer: false }
  return { buyerHasSent: true, sellerRepliedAfterBuyer: messages.slice(firstBuyer + 1).some((m) => !isBuyerMsg(m)) }
}

// The one chip look, shared by the quick-reply chips, the "Keep it live" dismiss below and the
// buyer's opener picker: ui/chip's `xs` `ghost` (a 28px pill, transparent at rest, muted on hover).
// It was a module constant restated in opener-picker.tsx; the primitive is the shared copy.
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
  job = false,
  hasPendingBuyerOffer,
  availabilityConfirmedAt,
  onInsert,
  onSend,
  composerText,
  negotiable,
  buyerHasSent = false,
  sellerRepliedAfterBuyer = false,
  openerListing,
  className,
}: {
  isSeller: boolean
  /** A JOB thread (listingType 'job'): the "seller" is an employer and the "buyer" a candidate, so the
   *  chips are hiring replies — "Still hiring", "Send your CV" — never "Price is firm" or "Is it still
   *  available?" (a job takes no offers and has no price to be firm about; review, 2026-10-01). */
  job?: boolean
  hasPendingBuyerOffer: boolean
  availabilityConfirmedAt?: string | null
  /** Insert chip text into the composer (parent focuses it, cursor at the end). */
  onInsert: (text: string) => void
  /** Send a complete reply immediately (falls back to onInsert when absent). */
  onSend?: (text: string) => void
  /** Live composer value — lets the meet chip auto-complete the location ONLY while
   *  the composer still holds the untouched template (never clobbers typing). */
  composerText?: string
  /** The listing takes offers. "Price is firm" is then a contradiction of the listing itself. */
  negotiable?: boolean
  /** See `chipContext`. */
  buyerHasSent?: boolean
  /** See `chipContext`. */
  sellerRepliedAfterBuyer?: boolean
  /**
   * The listing facts `openersFor` needs — passed only for a buyer whose payload carries a category
   * (an older cached thread does not, and then simply gets no openers). A FRESH buyer thread shows the
   * category openers (the PDP opener picker's commitment + question) beside the availability chip.
   * ⚠️ NEVER THE OFFER OPENER: it is a structured offer, and in a thread that belongs to the item
   * strip's "Make an offer", which goes through the offer composer and its gates.
   */
  openerListing?: OpenerListing | null
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

  const sellerChips: { label: string; text: string; complete: boolean }[] = job
    ? [
        { label: tr('Yes, still hiring', 'Vẫn đang tuyển nhé'), text: tr('Yes, still hiring', 'Vẫn đang tuyển nhé'), complete: true },
        { label: tr('Please send your CV', 'Bạn gửi CV giúp mình nhé'), text: tr('Please send your CV', 'Bạn gửi CV giúp mình nhé'), complete: true },
        // The interview place — same meet template (and locate glyph) as a sale's "Can meet in …".
        { label: tr('Can meet in …', 'Có thể gặp ở …'), text: tr('Can meet in ', 'Có thể gặp ở '), complete: false },
      ]
    : [
        // Answered already once the seller has written after the buyer's opener.
        ...(sellerRepliedAfterBuyer
          ? []
          : [{ label: tr('Yes, still available', 'Vẫn còn hàng nhé'), text: tr('Yes, still available', 'Vẫn còn hàng nhé'), complete: true }]),
        // Not on a listing that takes offers, and never while the buyer's offer is waiting — "Price is
        // firm" as the reply to a pending offer contradicts the Accept/Decline card right above it.
        ...(negotiable || hasPendingBuyerOffer
          ? []
          : [{ label: tr('Price is firm', 'Giá cố định ạ'), text: tr('Price is firm', 'Giá cố định ạ'), complete: true }]),
        // Trailing space (no ellipsis) so the seller completes the location right away.
        { label: tr('Can meet in …', 'Có thể gặp ở …'), text: tr('Can meet in ', 'Có thể gặp ở '), complete: false },
        ...(hasPendingBuyerOffer
          ? [{ label: tr('Let me think about it', 'Để mình cân nhắc nhé'), text: tr('Let me think about it', 'Để mình cân nhắc nhé'), complete: true }]
          : []),
      ]

  // Fresh buyer thread only (see `openerListing`). The clock is read at render: this component is
  // client-only data (the thread is fetched in the browser), so there is no server HTML to mismatch.
  const openers = !isSeller && !buyerHasSent && openerListing
    ? openersFor(openerListing, Date.now()).filter((o) => o.kind !== 'offer')
    : []

  const askAvailability = () => {
    if (confirmedFresh && availabilityConfirmedAt) {
      // The listing data already answers — save both sides a round-trip.
      if (note !== 'dismissed') setNote('shown')
      return
    }
    fire(job ? tr('Is this job still open?', 'Vị trí này còn tuyển không ạ?') : tr('Is it still available?', 'Còn hàng không?'))
  }

  // A buyer who has already written has no chips left — render nothing rather than an empty padded row.
  if (!isSeller && buyerHasSent && note !== 'shown') return null

  return (
    <div className={className}>
      {!isSeller && note === 'shown' && availabilityConfirmedAt && (
        <div className="mb-1 flex items-center gap-1.5 duration-200 ease-out animate-in fade-in">
          <p className="flex min-w-0 flex-1 items-center gap-1 text-xs font-medium text-success">
            {/* Line glyph, not the '✓' literal — one check mark per icon-language §1. */}
            <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{(job ? tr('The employer confirmed this job is open {timeAgo}', 'Nhà tuyển dụng đã xác nhận vẫn đang tuyển {timeAgo}') : tr('Seller confirmed this is available {timeAgo}', 'Người bán đã xác nhận còn hàng {timeAgo}')).replace('{timeAgo}', timeAgo(availabilityConfirmedAt, lang))}</span>
          </p>
          <CloseButton
            tapTarget={false}
            size="xs"
            onClick={() => setNote('dismissed')}
            label={tr('Dismiss', 'Đóng')}
            className="transition-colors"
          />
        </div>
      )}
      <div className="flex gap-1 overflow-x-auto scrollbar-none">
        {isSeller ? (
          sellerChips.map((c) => (
            <Chip
              key={c.label}
              size="xs"
              tone="ghost"
              onClick={() => (c.text === meetTemplate ? locateMeet() : c.complete ? fire(c.text) : onInsert(c.text))}
            >
              {c.label}
              {c.text === meetTemplate &&
                /* size-* class is REQUIRED: ui/button inflates unclassed svgs to size-4.
                   `ml-1.5` + the chip's 6px gap = the 12px this glyph always sat at (gap-2 + ml-1). */
                (locating
                  ? <Loader2 className="ml-1.5 size-3.5 animate-spin text-accent-foreground" />
                  : <LocateFixed className="ml-1.5 size-3.5 text-accent-foreground" />)}
            </Chip>
          ))
        ) : buyerHasSent ? null : (
          <>
            <Chip size="xs" tone="ghost" onClick={askAvailability}>
              {job ? tr('Is this job still open?', 'Vị trí này còn tuyển không ạ?') : tr('Is it still available?', 'Còn hàng không?')}
            </Chip>
            {openers.map((o) => (
              <Chip key={o.id} size="xs" tone="ghost" onClick={() => fire(openerString(o, o.text, tr, lang))}>
                {openerString(o, o.label, tr, lang)}
              </Chip>
            ))}
          </>
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
      <p className="text-xs font-medium text-foreground [overflow-wrap:anywhere]">
        {/* A replacer FUNCTION: a string replacement would read `$&` / `$$` in a seller's title as patterns. */}
        {tr('Deal! Mark "{title}" as sold?', 'Chốt đơn! Đánh dấu "{title}" là đã bán?').replace('{title}', () => listingTitle)}
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
        <Chip size="xs" tone="ghost" onClick={() => setState('dismissed')}>
          {tr('Keep it live', 'Giữ tin đăng')}
        </Chip>
      </div>
    </div>
  )
}
