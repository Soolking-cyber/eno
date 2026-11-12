'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Star } from '@/components/ui/icons'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { RadioGroup, Radio } from '@/components/ui/radio-group'
import { Input } from '@/components/ui/input'
import { useLanguage } from '@/context/language-context'
import { haptic } from '@/lib/haptics'
import { OBJECTIONABLE_CONTENT, objectionableCopy } from '@/lib/ugc-copy'
import type { ServiceDealKind } from '@/lib/service-deal'

/**
 * Post-transaction review prompt for the BUYER, shared by the full thread page
 * and the docked chat widget. A single quiet inline card (never a modal) shown
 * above the composer once the deal closed (listing sold / offer accepted) and
 * only until this conversation has a review: pick a star → an optional one-line
 * note appears → Submit POSTs to /api/sellers/[id]/reviews (which re-verifies
 * everything server-side). Success collapses to a one-line thanks. The ✕ hides
 * it for the session only (component state) — it quietly returns next visit
 * until reviewed.
 *
 * A SERVICE DEAL (`dealKind` — the seller confirmed a rental, lesson or service in the thread, src/lib/service-deal.ts)
 * asks ONE question first, in the card itself: "Did you rent from / have a lesson with / use the service of {seller}?"
 * Yes → the star form below, unchanged. "No, this didn't happen" → POST /api/conversations/[id]/deal {action:'decline'}:
 * the deal is marked declined on the server (no review is possible on it, and it counts toward a silent seller flag), and
 * the card closes for good. The buyer still writes the review; the seller never can. The card is offered only once the
 * seller's 10-minute undo has closed (spec v3 A2 — the server's `review_not_open` otherwise), and a refusal on a service
 * deal is worded for a rental / lesson / service, never with the goods sentence about "the buyer of this item".
 */
export function ReviewPrompt({
  sellerId,
  sellerName,
  conversationId,
  dealKind,
  className,
}: {
  sellerId: string
  sellerName: string
  conversationId: string
  /** Set when the card is open on the strength of a seller-confirmed service deal: the "did you…?" question comes first. */
  dealKind?: ServiceDealKind | null
  className?: string
}) {
  const { tr } = useLanguage()
  const [state, setState] = useState<'question' | 'declining' | 'ask' | 'sending' | 'done' | 'dismissed'>(dealKind ? 'question' : 'ask')
  const [rating, setRating] = useState(0)
  const [text, setText] = useState('')
  /**
   * FOCUS FOLLOWS THE "YES". The "Yes, I did" button unmounts with the question, which would drop keyboard and screen-reader
   * focus to <body>; so the tap arms this, and the effect on the state change moves focus INTO the star group — its tab
   * stop (Base UI's roving tabindex), so the arrow keys work at once. Only after a "Yes": a goods card opening on its own
   * never takes focus from the composer. Programmatic focus checks no star (Base UI selects on focus only after an arrow
   * key), so nothing is rated by it.
   */
  const ratingRef = useRef<HTMLDivElement>(null)
  const focusStars = useRef(false)
  useEffect(() => {
    if (state !== 'ask' || !focusStars.current) return
    focusStars.current = false
    const group = ratingRef.current
    const stop = group?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]') ?? group?.querySelector<HTMLElement>('[role="radio"]')
    stop?.focus()
  }, [state])

  if (state === 'dismissed') return null

  if (state === 'done') {
    return (
      <div className={className}>
        <p className="rounded-2xl bg-success/10 px-3 py-2 text-xs font-medium text-success duration-200 ease-out animate-in fade-in">
          <span aria-hidden>{'★'.repeat(rating || 5)}</span>{' '}
          {tr("Thanks — your review is live on the seller's page", 'Cảm ơn — đánh giá của bạn đã hiển thị trên trang người bán')}
        </p>
      </div>
    )
  }

  /** spec v3 A2: the seller's undo has not closed yet — the card (and the "No") wait; a retry a few minutes on succeeds. */
  const notOpenYet = () => tr(
    '{name} can still undo the confirmation for a few minutes — please try again shortly.',
    '{name} vẫn có thể rút lại xác nhận trong vài phút — vui lòng thử lại sau ít phút.',
  ).replace('{name}', () => sellerName)

  // The buyer's "No, this didn't happen" — the server marks the deal declined; the card goes for good (the next read no
  // longer offers it).
  const decline = async () => {
    if (state !== 'question') return
    setState('declining')
    haptic()
    try {
      const res = await fetch(`/api/conversations/${conversationId}/deal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'decline' }),
      })
      const err = res.ok ? null : (await res.json().catch(() => null))?.error
      // Already answered, already reviewed, or the seller's undo landed first: nothing left to ask either way.
      // ⚠️ AND A STATE THAT CANNOT CHANGE BY ASKING AGAIN (opus, 2026-11-11): the listing was taken down ('not_reviewable'), the
      // conversation is closed by a block ('blocked'), the thread is gone ('not_found') — the card goes, it never sticks.
      if (res.ok || err === 'already_reviewed' || err === 'not_confirmed' || err === 'review_window_closed' || err === 'forbidden' || err === 'not_reviewable' || err === 'blocked' || err === 'not_found') {
        setState('dismissed')
        if (res.ok) toast.success(tr('Thanks — noted. No review will be asked for this.', 'Cảm ơn bạn — đã ghi nhận. Bạn sẽ không được hỏi đánh giá việc này.'))
        return
      }
      setState('question')
      toast.error(err === 'review_not_open' ? notOpenYet() : tr('Could not send your answer — please try again.', 'Chưa gửi được câu trả lời — vui lòng thử lại.'))
    } catch {
      setState('question')
      toast.error(tr('Could not send your answer — please try again.', 'Chưa gửi được câu trả lời — vui lòng thử lại.'))
    }
  }

  const submit = async () => {
    if (!rating || state === 'sending') return
    setState('sending')
    haptic()
    try {
      const res = await fetch(`/api/sellers/${sellerId}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId, rating, text: text.trim() || undefined }),
      })
      if (res.ok) { setState('done'); return }
      const err = (await res.json().catch(() => null))?.error
      if (err === 'already_reviewed') { setState('done'); return } // someone double-tapped — it's in
      // The server's sale record says this caller may not review this deal (sold to someone else, "No, I didn't buy it",
      // "someone not on eno", or it stopped counting since the card was shown — a "No" from another device, a takedown).
      // Retrying cannot help, so say why and put the card away rather than "try again".
      if (res.status === 403 && err === 'not_transacted') {
        setState('dismissed')
        toast.error(dealKind
          // A SERVICE deal: no "item", no "buyer" — the confirmation stopped counting (withdrawn by an admin, taken down).
          ? tr('This can no longer be reviewed from this chat.', 'Không thể đánh giá từ cuộc trò chuyện này nữa.')
          : tr('Only the buyer of this item can review the seller.', 'Chỉ người mua món hàng này mới có thể đánh giá người bán.'))
        return
      }
      // spec v3 A3: the buyer said "No, this didn't happen" (another device, another tab) — a review cannot follow it.
      if (res.status === 403 && err === 'deal_declined') {
        setState('dismissed')
        toast.error(tr('You said this didn’t happen, so it can’t be reviewed.', 'Bạn đã cho biết việc này không diễn ra nên không thể đánh giá.'))
        return
      }
      // spec v3 A2: too early — the seller's undo is still open. The card stays; the stars and the note are kept.
      if (res.status === 403 && err === 'review_not_open') {
        setState('ask')
        toast.error(notOpenYet())
        return
      }
      // The service deal stopped counting since the card was shown: the seller's undo (within its 10 minutes) or a
      // moderator's (Admin › Moderation, any time while unreviewed), or the 30-day window closed. Retrying cannot help
      // either — the card goes, with its own reason. ⛔ NEUTRAL, NAMING NOBODY: after a moderator's undo, "{seller} withdrew
      // it" would put eno's act in the seller's name.
      if (res.status === 403 && err === 'deal_withdrawn') {
        setState('dismissed')
        toast.error(tr("The confirmation was withdrawn, so a review can't be left now.", 'Xác nhận đã được rút lại nên hiện chưa thể đánh giá.'))
        return
      }
      if (res.status === 403 && err === 'review_window_closed') {
        setState('dismissed')
        toast.error(tr('The time to leave this review has passed.', 'Đã hết thời hạn đánh giá.'))
        return
      }
      setState('ask')
      toast.error(
        // App Store gate `ugc-safety` (R5): the word filter refused it; the text stays in the field to edit.
        err === OBJECTIONABLE_CONTENT
          ? objectionableCopy('review', tr)
          : err === 'rate_limited'
          ? tr('Too many requests — please try again shortly.', 'Quá nhiều yêu cầu — vui lòng thử lại sau.')
          : tr('Could not submit your review — please try again.', 'Chưa gửi được đánh giá — vui lòng thử lại.'),
      )
    } catch {
      setState('ask')
      toast.error(tr('Could not submit your review — please try again.', 'Chưa gửi được đánh giá — vui lòng thử lại.'))
    }
  }

  if (state === 'question' || state === 'declining') {
    const question = dealKind === 'lesson'
      ? tr('Did you have a lesson with {seller}?', 'Bạn đã học với {seller} chưa?')
      : dealKind === 'service'
        ? tr("Did you use {seller}'s service?", 'Bạn đã dùng dịch vụ của {seller} chưa?')
        : tr('Did you rent from {seller}?', 'Bạn đã thuê của {seller} chưa?')
    return (
      <div className={className}>
        <div className="rounded-2xl bg-tint px-3 py-2.5 duration-200 ease-out animate-in fade-in">
          <div className="flex items-start gap-1.5">
            {/* A replacer FUNCTION: a string replacement would read `$&` / `$$` in a shop's name as patterns. */}
            <p className="min-w-0 flex-1 text-xs font-medium text-foreground">{question.replace('{seller}', () => sellerName)}</p>
            <IconButton
              size="xs"
              onClick={() => setState('dismissed')}
              aria-label={tr('Dismiss', 'Đóng')}
              className="h-auto w-auto p-1 text-ink-4 transition-colors hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </IconButton>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <Button
              variant="cta"
              size="none"
              onClick={() => { focusStars.current = true; setState('ask') }}
              disabled={state === 'declining'}
              className="relative tap-44 rounded-full px-3 py-2 text-xs font-bold"
            >
              {tr('Yes, I did', 'Có, đúng vậy')}
            </Button>
            <Button
              variant="outline"
              size="none"
              onClick={() => { void decline() }}
              loading={state === 'declining'}
              className="relative tap-44 rounded-full px-3 py-2 text-xs font-bold"
            >
              {tr('No, this didn’t happen', 'Không, việc này không diễn ra')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={className}>
      <div className="rounded-2xl bg-tint px-3 py-2.5 duration-200 ease-out animate-in fade-in">
        <div className="flex items-start gap-1.5">
          <p className="min-w-0 flex-1 text-xs font-medium text-foreground">
            {tr('How was your experience with {seller}?', 'Trải nghiệm của bạn với {seller} thế nào?').replace('{seller}', sellerName)}
          </p>
          <IconButton
            size="xs"
            onClick={() => setState('dismissed')}
            aria-label={tr('Dismiss', 'Đóng')}
            className="h-auto w-auto p-1 text-ink-4 transition-colors hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </IconButton>
        </div>
        {/* A rating IS a radio group — one of five, mutually exclusive, and selecting is not
            destructive — so ui/radio-group announces it honestly: role="radiogroup" (named "Rating")
            wrapping role="radio" stars with aria-checked + posinset ("3 of 5") + arrow keys, in place
            of five unrelated icon <button>s with no group.
            ⚠️ GAP IS LOAD-BEARING, not decoration. Each star keeps a 44px tap target (tap-44) whose
            ::before OVERFLOWS its 36px box; the old row was `flex items-center` with NO gap, so two
            adjacent 44px targets overlapped and a tap near a boundary checked the WRONG star. gap-2.5
            spaces the 36px boxes to a 46px pitch so the 44px targets clear each other. (gap also
            sidesteps Base UI's hidden <input> siblings, which space-y-* would trip over.) */}
        <RadioGroup
          ref={ratingRef}
          value={rating ? String(rating) : undefined}
          onValueChange={(v) => setRating(Number(v))}
          aria-label={tr('Rating', 'Đánh giá')}
          className="mt-0.5 flex items-center gap-2.5"
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <Radio
              key={n}
              value={String(n)}
              aria-label={n === 1 ? tr('1 star', '1 sao') : tr('{n} stars', '{n} sao').replace('{n}', String(n))}
              className="relative tap-44 h-9 w-9"
            >
              <Star className={`h-5 w-5 transition-colors ${n <= rating ? 'fill-warning text-warning' : 'text-ink-4'}`} />
            </Radio>
          ))}
        </RadioGroup>
        {rating > 0 && (
          <div className="mt-1.5 flex items-center gap-2 duration-200 ease-out animate-in fade-in">
            <Input
              variant="outline"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
              maxLength={600}
              aria-label={tr('Your review (optional)', 'Đánh giá của bạn (không bắt buộc)')}
              placeholder={tr('Anything to add? (optional)', 'Bạn muốn chia sẻ thêm? (không bắt buộc)')}
              className="w-auto min-w-0 flex-1 px-3 py-2 text-xs focus:ring-brand/20"
            />
            <Button
              variant="cta"
              size="none"
              onClick={submit}
              // `loading` keeps "Submit" (invisible) under the spinner: swapping it out collapsed the
              // pill to the spinner's width and left the button with no accessible name while sending.
              loading={state === 'sending'}
              className="relative tap-44 rounded-full px-3 py-2 text-xs font-bold"
            >
              {tr('Submit', 'Gửi đánh giá')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
