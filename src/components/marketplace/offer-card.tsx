'use client'

import * as React from 'react'
import { Check, Clock, Tag, Undo2, X } from '@/components/ui/icons'

import { Button } from '@/components/ui/button'
import { OfferAcceptedNote } from '@/components/marketplace/chat-safety-note'
import { MarkSoldPrompt } from '@/components/marketplace/quick-reply-chips'
import { useLanguage } from '@/context/language-context'
import { useMounted } from '@/hooks/use-mounted'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import {
  effectiveOfferStatus,
  formatOfferTimeLeft,
  isOfferExpiringSoon,
  isOfferReason,
  normalizeOfferStatus,
  offerActions,
  offerDeadline,
  offerTimeLeftMs,
  type OfferAction,
  type OfferFacts,
  type OfferReason,
} from '@/lib/offers'

/**
 * THE OFFER, AS A CARD IN THE THREAD.
 *
 * Props-driven and inert: it fetches nothing, owns no server state and decides nothing on its
 * own — every judgement is delegated to the pure machine in src/lib/offers.ts, so the button
 * that appears here and the 409 the route would return are two readings of one rule.
 *
 * ── WHY IT LOOKS LIKE THIS ──────────────────────────────────────────────────────
 * A bare number reads as a haggle and gets ignored, so the card carries three things a number
 * cannot: a REASON (why this price), a COUNTDOWN (why answer today), and three real controls
 * (an answer costs a tap, not a sentence). The 24h window is the mechanism — it is what turns
 * "I will think about it" into a decision.
 *
 * ⚠️ EVERYTHING THE CLOCK DECIDES IS MOUNT-GATED — WHICH IS MORE THAN THE COUNTDOWN. A thread
 * page can be served from cache, so a deadline resolved during render would be baked at
 * generation time and disagree with the reader's clock. Three renderings depend on the clock and
 * all three wait for mount: the countdown, the CONTROLS, and the pending/expired STATUS (the
 * amber pill, the filled brand Tag, "Waiting for a response…"). The last of those was missed
 * twice — suppressing the buttons while still shipping a "Pending" pill on a three-day-old offer
 * is the same lie in a smaller font. The pre-mount clock is pinned one millisecond INSIDE the
 * window so server HTML and the first client render produce identical markup, and the lapsed
 * state arrives a frame later — the same dance as LiveUntil, and for the same reason.
 * `accepted`/`declined`/`countered` are NOT clock-derived and render server-side as normal.
 *
 * ⚠️ COUNTER IS GATED ON `negotiable`, AND THAT PROP IS REQUIRED RATHER THAN OPTIONAL.
 * Countering SENDS an offer, and on a fixed-price listing the send route answers 409
 * not_negotiable AND docks the buyer's trust via recordFixedPriceOfferAttempt(). Showing that
 * button is not a cosmetic bug, it is a penalty we inflict on someone for tapping a control we
 * drew. The first draft took `negotiable?: boolean` and folded an ABSENT value to permissive,
 * mirroring `thread?.listing.negotiable !== false` in the thread page — two review families
 * refuted it independently and they were right: that fold hands out the one refusal that costs
 * the buyer something, for a fact we simply had not been told. `Listing.negotiable` is
 * `Boolean @default(true)` (measured in prisma/schema.prisma), so it is ALWAYS knowable at
 * every call site; making it required moves the question from a runtime guess to a compile
 * error. `listingActive` and `threadHasAcceptedOffer` are required for the same reason, one
 * notch quieter: their refusals are clean 409s with no penalty attached, but a permissive
 * default is still a control the server would refuse.
 */

/** How often the countdown re-reads the clock. Half a minute keeps the last hour honest without
 *  waking a long-open thread more than it deserves. */
const TICK_MS = 30_000

/** The pre-derived-line offer body: "💰 Offered 12,000,000 VND" (and its Vietnamese twin).
 *
 *  Anchored, word-bearing, AND requiring the digit that always followed: the generated string was
 *  always the word plus an amount. Without the trailing `\d` a buyer typing "💰 Offered cash,
 *  available tonight" still loses their whole note — a narrower version of the same bug the word
 *  requirement fixed, and worth closing at the cost of one character class. */
const LEGACY_BAKED_OFFER_BODY = /^💰\s*(Offered|Trả giá)\s+\d/

export type OfferCardProps = {
  /** VND. Rendered through vnd.ts — Vietnamese gets DOT thousands separators. */
  amount: number
  /** Is this offer MINE (I sent it)? Decides the role the machine judges against. */
  mine: boolean
  /** The RAW persisted `Message.offerStatus`, passed through untouched — including null. */
  status: string | null | undefined
  /** `Message.createdAt`. Anchors the 24h window; no expiry column is required. */
  createdAt: string | number | Date
  /** Optional explicit deadline, for the day a real column exists. */
  expiresAt?: string | number | Date | null
  /** The listing's asking price, for the "% of asking" line. */
  askingPrice?: number | null
  /** An OfferReason code. Anything unrecognised is ignored rather than rendered raw. */
  reason?: string | null
  /** The sender's own words, if they typed any (`Message.body`). */
  note?: string | null
  /** `Listing.negotiable` — REQUIRED, see the header. A guess here costs the buyer trust points. */
  negotiable: boolean
  /** `Listing.status === 'active'` — REQUIRED. */
  listingActive: boolean
  /** Does the thread already hold an accepted offer? One deal per thread. REQUIRED. */
  threadHasAcceptedOffer: boolean
  /** Suppress the controls while a tap is in flight. */
  busy?: boolean
  onAccept?: () => void
  onDecline?: () => void
  onCounter?: () => void
  /** Seller-side hand-off after agreement: both are needed to render Mark-as-sold. */
  iAmSeller?: boolean
  listingId?: string
  listingTitle?: string
}

export function OfferCard({
  amount,
  mine,
  status,
  createdAt,
  expiresAt,
  askingPrice,
  reason,
  note,
  negotiable,
  listingActive,
  threadHasAcceptedOffer,
  busy = false,
  onAccept,
  onDecline,
  onCounter,
  iAmSeller = false,
  listingId,
  listingTitle,
}: OfferCardProps) {
  const { tr, lang } = useLanguage()
  const locale = moneyLocale(lang)
  const mounted = useMounted()

  const facts: OfferFacts = { status, createdAt, expiresAt, negotiable, listingActive, threadHasAcceptedOffer }
  const deadline = offerDeadline(facts)
  // Only a PENDING offer has anything left to observe; everything else is settled forever.
  const pending = normalizeOfferStatus(status) === 'pending'

  /**
   * ⚠️ THE CLOCK IS SCOPED TO A LIVE OFFER, READ ONCE PER WAKE, AND LANDS ON THE DEADLINE.
   *
   * Three separate defects were found here by review, and one self-rescheduling timeout closes
   * all three. Do not turn it back into a bare interval.
   *
   *  1. A PERMANENT TIMER IN EVERY CARD. The first draft started an unconditional 30s interval.
   *     A thread that has been haggled in holds dozens of resolved offers, so opening it spawned
   *     dozens of timers waking forever to re-render components that can never change again.
   *     `pending` gates the whole effect, so a resolved offer starts nothing at all.
   *
   *  2. READING THE CLOCK TWICE. The second draft called Date.now() for the state and again for
   *     the lapsed check. If the deadline fell between those two statements the card committed a
   *     pre-deadline `now` and then returned WITHOUT scheduling anything — frozen as pending,
   *     with live controls, forever. One `n` per wake makes that unrepresentable.
   *
   *  3. RETRACTING UP TO 30 SECONDS LATE. A fixed tick notices expiry only on the next wake, so
   *     Accept stayed live for most of a minute past the deadline — on a window whose entire
   *     purpose is that it closes. The next wake is `min(TICK_MS, time remaining)`, so the last
   *     one lands ON the deadline and the controls go with it.
   */
  const [now, setNow] = React.useState<number | null>(null)
  React.useEffect(() => {
    if (!pending) return
    let t: ReturnType<typeof setTimeout> | undefined
    const wake = () => {
      const n = Date.now()
      setNow(n)
      if (deadline == null) return // unmeasurable window — one read is all there is to do
      if (n >= deadline) return // lapsed; nothing further can change
      t = setTimeout(wake, Math.min(TICK_MS, deadline - n))
    }
    wake()
    return () => {
      if (t) clearTimeout(t)
    }
  }, [pending, deadline])

  // Pre-mount clock: one ms inside the window, so the server and the first client render agree
  // on every element. `now` replaces it in the commit right after mount.
  const clock = now ?? (deadline != null ? deadline - 1 : 0)

  const state = effectiveOfferStatus(facts, clock)
  const timeLeft = formatOfferTimeLeft(offerTimeLeftMs(facts, clock), locale)
  const soon = isOfferExpiringSoon(facts, clock)

  const money = formatMoneyFull(amount, '₫', locale)
  // ⚠️ THE DIVISOR IS WHAT NEEDS GUARDING, NOT THE AMOUNT. `askingPrice && amount` suppressed the
  // whole line for a zero offer instead of printing "0%" — the numerator being zero is a fact
  // worth stating, the denominator being zero or absent is the one that has no answer.
  const askPct = askingPrice && askingPrice > 0 ? Math.round((amount / askingPrice) * 100) : null
  const reasonCode: OfferReason | null = isOfferReason(reason) ? reason : null

  // The reason, in the sender's voice. Codes, not prose, live in the machine; the two renderings
  // live here where tr() can reach them — and each half is a single-quoted literal so the
  // harvester actually finds it (scripts/gen-ui-strings.mjs reads string literals, not variables).
  const reasonLabel = (code: OfferReason): string => {
    switch (code) {
      case 'cash':
        return tr('Paying cash today', 'Trả tiền mặt hôm nay')
      case 'timing':
        return tr('Can collect today', 'Có thể đến lấy hôm nay')
      case 'bundle':
        return tr('Buying more than one', 'Mua nhiều món')
      case 'condition':
        return tr('Based on the condition', 'Dựa trên tình trạng món hàng')
      case 'budget':
        return tr('This is my budget', 'Đây là ngân sách của tôi')
    }
  }

  const actionLabel = (a: OfferAction): string =>
    a === 'accept'
      ? tr('Accept', 'Chấp nhận')
      : a === 'decline'
        ? tr('Decline', 'Từ chối')
        : tr('Counter', 'Trả giá')

  /**
   * ⚠️ THE ACCESSIBLE NAME CARRIES THE AMOUNT, THE VISIBLE LABEL DOES NOT. A thread can hold
   * several offer cards, and three buttons all announced as "Accept" give a screen-reader user
   * no way to tell which price they are agreeing to — on the one control in the app that closes
   * a deal. Sighted readers get the amount from the line above; everyone else gets it here.
   */
  const actionAria = (a: OfferAction): string => `${actionLabel(a)} — ${money}`

  const onAction = (a: OfferAction) => (a === 'accept' ? onAccept : a === 'decline' ? onDecline : onCounter)

  /**
   * THE CONTROLS, THREE FILTERS DEEP.
   *
   * 1. The MACHINE decides which actions are legal at all — that is the whole point of offers.ts.
   * 2. ⚠️ MOUNT-GATED, so no control is ever baked into server HTML. Two things follow, and both
   *    are improvements on the first draft: a cached page can no longer ship live-looking
   *    Accept/Decline on a three-day-old offer that hydration then retracts, and a reader with no
   *    JavaScript is no longer shown three buttons whose entire behaviour is an onClick handler.
   * 3. NO HANDLER, NO BUTTON. The callbacks are optional so the card can be read read-only (the
   *    admin conversation view), and an enabled control wired to `undefined` is a dead button
   *    that looks alive — the one thing worse than a missing one.
   */
  const actions = mounted
    ? offerActions(facts, mine ? 'sender' : 'recipient', clock).filter((a) => onAction(a))
    : []

  /**
   * ⚠️ THE STATUS CHIP IS THE CLOCK TOO, AND THAT TOOK A THIRD REVIEW ROUND TO SEE.
   *
   * The header used to claim the server markup carried "no clock at all". It was not true: the
   * pre-mount clock pins `state` to 'pending', so a three-day-old offer shipped the amber Pending
   * pill, the filled brand Tag and "Waiting for a response…" into cached HTML — a lapsed offer
   * looking live indefinitely for a reader on a slow connection or with JS off. Suppressing the
   * buttons and the countdown was only two thirds of the job.
   *
   * So the PENDING/EXPIRED pair is mount-gated, because only that distinction is clock-derived.
   * `accepted`/`declined`/`countered` are NOT — they are read straight off the column and are the
   * same answer on both sides of hydration, so they render server-side as they should.
   */
  const live = mounted && state === 'pending'
  const resolved = state === 'accepted' || state === 'declined' || state === 'countered'

  // Countdown wording. `soon` earns the warning tint; everything above three hours stays quiet
  // ink, because a red clock on a 22-hour window is the fake urgency this app refuses to ship.
  const countdown =
    live && timeLeft ? (
      <span className={`mt-1 flex items-center gap-1 text-xs font-medium ${soon ? 'text-warning' : 'text-ink-4'}`}>
        <Clock className="h-3.5 w-3.5" aria-hidden /> {tr('Expires in', 'Hết hạn sau')} {timeLeft}
      </span>
    ) : null

  return (
    <div
      className={`allow-select max-w-[80%] rounded-2xl border px-3 py-2.5 ${mine ? 'border-brand/30 bg-primary/5' : 'border-border bg-tint'}`}
    >
      {/* §5: a PENDING offer is live user-state, so its Tag wears the solid fill-brand + text-brand
          pair (the same law as the saved heart). Resolved and expired offers return to line. */}
      <div className="flex items-center gap-1 text-2xs font-bold uppercase tracking-wide text-accent-foreground">
        <Tag className={`h-3 w-3 ${live ? 'fill-brand text-brand' : ''}`} aria-hidden />{' '}
        {tr('Offer', 'Đề nghị')}
      </div>

      {/* Money ONLY through vnd.ts — Vietnamese reads 12.000.000 đ, never 12,000,000. */}
      {/* ⚠️ THE AMOUNT WEARS text-price, THE LABEL DOES NOT. An offer IS a price, and the composer
          that produced this bubble renders its amount in the same red — leaving the bubble on
          text-foreground meant a buyer saw one colour while typing an offer and another the instant
          it sent. ⚠️ THE TWO THEMES ARE TWO DIFFERENT TOKENS, so quote both: on this bg-tint the
          dark --price #e58ba1 is 6.15:1 on #262626, and the light --price #ab395b is 5.55:1 on
          #f5f5f5. Neither value is legible on the other theme's surface. */}
      <div className="mt-0.5 text-base font-bold text-foreground">
        {tr('Offered', 'Đã trả giá')} <span className="text-price">{money}</span>
      </div>

      {askPct != null && askingPrice ? (
        <div className="text-2xs font-medium text-ink-4">
          {askPct}% {tr('of asking', 'của giá rao')} ({formatMoneyFull(askingPrice, '₫', locale)})
        </div>
      ) : null}

      {/* THE REASON. This is the difference between an offer and a haggle: it tells the seller
          what they are actually being offered — cash today, a collection today — so there is
          something to say yes to beyond a smaller number. */}
      {reasonCode ? <div className="mt-1 text-xs font-medium text-body">{reasonLabel(reasonCode)}</div> : null}

      {/* The sender's own words. Legacy rows carry a baked "💰 Offered …₫" body that the amount
          line above already says — skipping it is what stops the card saying it twice.
          ⚠️ THE MATCH REQUIRES THE WORD, NOT JUST THE EMOJI. The thread page and the admin view
          both test `body.startsWith('💰')`, which also swallows a real note: a buyer typing
          "💰 Cash in hand, can meet at 6" has their entire message dropped and the seller sees a
          bare number. A prefix heuristic aimed at OUR generated string must be narrow enough to
          miss the user's — hence the required "Offered"/"Trả giá" that the baked body always
          carried. (The send path has written an EMPTY body for offers since the line became
          derived, so this only ever fires on legacy rows.) */}
      {note && !LEGACY_BAKED_OFFER_BODY.test(note) ? (
        <div className="mt-1 text-sm leading-relaxed text-foreground">{note}</div>
      ) : null}

      {live ? (
        <div className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-warning">
          <span className="h-1.5 w-1.5 rounded-full bg-warning" /> {tr('Pending', 'Đang chờ')}
        </div>
      ) : null}

      {resolved ? (
        // Resolved states carry the shared offer-status glyphs (Check / X / Undo2) — the same
        // trio the conversation list's preview labels use, one vocabulary across the app.
        <div
          className={`mt-1 flex items-center gap-1 text-xs font-semibold ${state === 'accepted' ? 'text-success' : state === 'declined' ? 'text-destructive' : 'text-ink-4'}`}
        >
          {state === 'accepted' ? (
            <Check className="h-3.5 w-3.5" aria-hidden />
          ) : state === 'declined' ? (
            <X className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Undo2 className="h-3.5 w-3.5" aria-hidden />
          )}
          {state === 'accepted'
            ? tr('Accepted', 'Đã chấp nhận')
            : state === 'declined'
              ? tr('Declined', 'Đã từ chối')
              : tr('Countered', 'Đã trả giá khác')}
        </div>
      ) : null}

      {/* ⚠️ MOUNT-GATED. Absent from the server HTML and from the first client render, present
          from the commit after — which is what makes a cached page safe to put a clock on. */}
      {countdown}

      {/* ⚠️ THE LIVE REGION EXISTS BEFORE IT HAS ANYTHING TO SAY, AND THAT IS THE WHOLE TRICK.
          A `role="status"` inserted into the DOM at the same instant as its text is routinely
          missed by NVDA and VoiceOver — the region has to be there first for the mutation to be
          announced. So the wrapper is rendered from mount and stays EMPTY through the whole live
          window; the expiry line dropping into it is the mutation that gets read. display:contents
          keeps it out of the layout entirely, so an empty announcer costs no box.
          It also cannot announce the ticking countdown, which lives outside it — an assistive
          technology reading the remaining time twice a minute is noise, not information. */}
      {mounted ? (
        <span role="status" className="contents">
          {state === 'expired' ? (
            <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-ink-4">
              <Clock className="h-3.5 w-3.5" aria-hidden /> {tr('Offer expired', 'Đề nghị đã hết hạn')}
            </span>
          ) : null}
        </span>
      ) : null}

      {/* THREE TAPS, NO TYPING. The list comes from the machine, so a control that the server
          would refuse is never drawn — Counter disappears on a fixed-price listing, Accept
          disappears once the thread has closed at a price, and Decline survives both so a stale
          card is always clearable. */}
      {actions.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {actions.map((a) =>
            a === 'accept' ? (
              <Button
                key={a}
                variant="cta"
                size="none"
                disabled={busy}
                aria-label={actionAria(a)}
                onClick={onAccept}
                className="rounded-lg px-3 py-1 text-xs transition-colors"
              >
                {actionLabel(a)}
              </Button>
            ) : (
              <Button
                key={a}
                variant="ghost"
                size="none"
                disabled={busy}
                aria-label={actionAria(a)}
                onClick={onAction(a)}
                // hover:text-body is LOAD-BEARING on the decline button: ghost injects
                // hover:text-accent-foreground, and text-body is a COLOUR utility — without the
                // re-assert the label changes colour on hover for no reason.
                className={
                  a === 'decline'
                    ? 'rounded-lg px-3 py-1 text-xs font-bold text-body transition-colors hover:bg-muted hover:text-body'
                    : 'rounded-lg px-3 py-1 text-xs font-bold text-accent-foreground transition-colors hover:bg-muted'
                }
              >
                {actionLabel(a)}
              </Button>
            ),
          )}
        </div>
      ) : null}

      {mine && live ? (
        <div className="mt-1 text-xs text-ink-4">{tr('Waiting for a response…', 'Đang chờ phản hồi…')}</div>
      ) : null}

      {/* §10.2 — THE SAFETY LINE AT THE MOMENT OF AGREEMENT, to BOTH parties, immediately above
          the seller's Mark-as-sold action. Imported, never re-written: the sentence exists once,
          bilingually, in chat-safety-note.tsx, and two wordings of one safety rule is how a
          marketplace ends up telling the same buyer two slightly different things.
          ⚠️ GATED ON THE ACCEPTED STATE AND NOTHING ELSE — not on who tapped, not on the listing
          still being active. It has to survive a reload and be there for the party who did NOT
          tap Accept; a safety line with an off switch goes missing at the moment it exists for.
          Pending / countered / declined / expired never match. */}
      {state === 'accepted' ? <OfferAcceptedNote /> : null}

      {/* The hand-off: the seller who just closed a deal is one tap from marking it sold.
          ⚠️ `listingActive` IS PART OF THE GATE, AND LEAVING IT OUT MADE THE PROMPT IMMORTAL.
          MarkSoldPrompt's "Marked as sold" confirmation is component state, so it survives exactly
          one session: reload the thread and a prompt gated only on `accepted && iAmSeller` comes
          back asking the seller to mark an already-sold listing as sold, forever. The card refuses
          to draw Accept on an inactive listing for the same reason; the follow-through has to
          obey the same fact. (The thread page's own copy dodges this by gating on an in-session
          `justAcceptedId`, which is why the bug is new here rather than inherited — this version
          deliberately survives a reload so the party who did not tap Accept still sees it.) */}
      {state === 'accepted' && iAmSeller && listingActive && listingId && listingTitle ? (
        <MarkSoldPrompt listingId={listingId} listingTitle={listingTitle} />
      ) : null}
    </div>
  )
}
