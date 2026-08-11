'use client'

import { useId, useState } from 'react'
import { BadgeCheck, Handshake, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/context/language-context'
import { formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { ICON_SIZE, STROKE_UI } from '@/lib/icon-tokens'
import { hapticConfirm, hapticTap } from '@/lib/haptics'
import { cn } from '@/lib/utils'

/**
 * ── <SaleConfirmPrompt> — the BUYER's half of the trade loop ─────────────────────────────────
 *
 * One question, two answers:
 *
 *   "Minh says you bought the Honda Vision for 11.200.000 đ. Confirm so it counts for both of you."
 *
 * ⚠️ PROPS ONLY. Nothing is fetched, nothing is stored, nothing is mounted here. The parent owns
 * `status` and flips it; this component renders the question or the settled answer. Do not invent
 * the persistence shape inside it.
 *
 * ## Why the copy is shaped exactly like this
 *
 * **The buyer has almost no reason to answer.** They already have the bike. The sale is the
 * seller's record to gain, and a bare "Did you buy this? Yes/No" reads as a survey — so it gets
 * ignored, and the whole loop degrades into a seller-only claim that nothing corroborates. The one
 * honest lever is MUTUALITY, and it has to be in the question rather than in a tooltip: confirming
 * is what makes the deal count on BOTH sides. That sentence is not decoration, it is the reason
 * the component works at all, and it is asserted in the tests so nobody trims it as verbose.
 *
 * **Declining is safe, and it says so before you tap.** Two failure modes were designed out:
 *   · IT MUST NOT ACCUSE. "No" here means "that is not what happened", not "this person is lying".
 *     A buyer who declines has not reported anybody, and the footnote says exactly that — otherwise
 *     the cautious answer becomes no answer, which is worse for everyone than an honest no.
 *   · IT MUST NOT BE A TRAP THAT RE-ASKS FOREVER. A prompt that reappears after every decline
 *     trains people to ignore it, and it is a small act of coercion. So "No" is a TERMINAL state:
 *     the question is replaced by an acknowledgement, and no buttons remain to press.
 *
 *     ⚠️ THAT IS A CONTRACT ON THE INTEGRATOR, NOT SOMETHING THIS FILE CAN ENFORCE. The copy
 *     promises we will not ask again, so `onDecline` MUST be persisted and the prompt must not be
 *     re-rendered with `status="asking"` for the same sale. If the persistence cannot be done,
 *     change the copy — do not ship the promise without the mechanism.
 *
 * **The settled states stay put rather than vanishing.** A card that deletes itself takes the
 * user's own answer off the screen and leaves them wondering whether the tap registered. It
 * becomes `role="status"` so the change is announced, not just painted.
 *
 * ## Shell
 * Deliberately NOT a dialog. This is an in-flow card (a chat thread, a notification list), so it
 * must not seize focus or dim the page — a modal for a question this small is a hijack, and the
 * buyer is mid-conversation with the very person the question is about. Money is rendered by
 * `src/lib/vnd.ts` in the viewer's own convention: "11,200,000 VND" for en, "11.200.000 đ" for vi.
 */

/** `asking` shows the question; the other two are terminal acknowledgements with NO buttons —
 *  which is the anti-re-prompt guarantee expressed in the type. */
export type SaleConfirmStatus = 'asking' | 'confirmed' | 'declined'

export type SaleConfirmPromptProps = {
  /** ⚠️ THE SALE'S OWN ID — REQUIRED, AND IT MAY NOT BE SYNTHESISED FROM THE DISPLAYED VALUES.
   *  It is what the answer lock is keyed to. The first version keyed on seller + title + price,
   *  which is an identity heuristic and not an identity: a seller with two identical listings
   *  (three phone cases at 500.000 đ) produces two prompts whose keys are byte-identical, so a
   *  buyer who answers one meets two permanently dead buttons on the other — the exact failure the
   *  key was added to prevent. Whatever stream A keys a confirmation on. */
  saleId: string
  /** The seller's display name, as the buyer already knows them from chat. */
  sellerName: string
  listingTitle: string
  /** The AGREED price the seller submitted, in whole VND — not the asking price. */
  price: number
  /** Defaults to '₫'; every eno listing is stored in đồng. */
  currency?: string
  /** Owned by the parent. Defaults to 'asking'. */
  status?: SaleConfirmStatus
  /** Which answer is in flight, so the tapped button spins and both lock. The component ALSO locks
   *  itself the moment either button is pressed (see `answeredUnder`), so a parent that forgets
   *  this prop still cannot receive a confirm and a decline from one fumbled double tap.
   *  ⚠️ THE PARENT MUST REFLECT THE ANSWER — a changed `status` OR a changed `pending`. That is
   *  what re-opens the lock, and it is the whole contract: a parent that takes an answer and
   *  re-renders IDENTICALLY leaves the buyer looking at two dead buttons with nothing explaining
   *  why. The cheapest correct implementation is to set `pending` synchronously in the handler and
   *  clear it when the write settles; that alone satisfies it in both directions. The alternative —
   *  no lock at all — was measured against this and is worse: it lets one fumbled double tap send a
   *  confirm AND a decline for the same sale, which is a contradiction in a public trust record. */
  pending?: 'confirm' | 'decline' | null
  onConfirm: () => void
  /** ⚠️ MUST be persisted — the declined copy promises we will not ask again. */
  onDecline: () => void
  /** A failed write, already translated. It is announced, AND it re-arms the answer lock so the
   *  buyer can try again — without it a parent that omits `pending` leaves them looking at two
   *  dead buttons with nothing saying why.
   *  ⚠️ IT MUST DESCRIBE THE LATEST ATTEMPT — CLEAR IT WHEN A RETRY STARTS. Same contract as
   *  <MarkSoldSheet>, and here it is what makes the lock's failure signal unambiguous. The card
   *  reads "the spinner came down while an error is showing" as a failure report (that is what
   *  keeps a caller who repeats an identical message from deadlocking it). Leave a STALE message up
   *  across a retry and that same evidence appears when the retry SUCCEEDED, so both buttons
   *  re-open on a sale that just landed and one fumbled tap can decline it. A props-only component
   *  cannot tell those apart from the outside; clearing the message is what tells it. */
  errorMessage?: string | null
  className?: string
}

export function SaleConfirmPrompt({
  saleId,
  sellerName,
  listingTitle,
  price,
  currency = '₫',
  status = 'asking',
  pending = null,
  onConfirm,
  onDecline,
  errorMessage,
  className,
}: SaleConfirmPromptProps) {
  const { lang, tr } = useLanguage()
  const locale = moneyLocale(lang)
  const questionId = useId()
  const money = formatMoneyFull(Math.max(0, Math.round(price || 0)), currency, locale)

  // ⚠️ ONE ANSWER PER ASKING, AND THE RELEASE IS "THE PARENT REPORTED A FAILURE" — nothing weaker.
  // `pending` is the parent's flag and arrives a render late at best, so before it lands a double
  // tap sends two confirms — or, worse, a confirm AND a decline, which is a contradiction written
  // into a public trust record and the one outcome this component exists to prevent.
  //
  // Three shapes were tried and are recorded because each looks sufficient:
  //   · Release on ANY change of the parent's state. A successful write that clears `pending` one
  //     frame before it settles `status` then re-lights both buttons at the exact moment the sale
  //     was confirmed.
  //   · Release while an error is DISPLAYED (a level). No deadlock, but it disables the lock for
  //     as long as the message is up: the buyer retries Yes, fumbles No a moment later, and both
  //     callbacks fire — the contradiction, reached through the door meant to prevent it.
  //   · Compare the error against the one showing when they answered. Sharper, until a caller
  //     repeats an identical string: React bails out, there is no change to observe, and the
  //     honest answer is welded shut forever on a card with no Cancel, no Escape and no swipe.
  //
  // What actually means "that did not land" is the parent REPORTING BACK without success, and it
  // says that two ways: an error appearing, or the spinner coming down while an error is up. Both
  // bump one counter. ⚠️ THE SECOND SIGNAL IS ONLY SOUND IF `errorMessage` DESCRIBES THE LATEST
  // ATTEMPT — a stale message left up across a retry makes a SUCCESS look identical to a failure.
  // That is a contract on the caller and it is stated in bold on the prop; it is also the only way
  // out, because from inside a props-only card the two states are the same bytes. An answer records the counter it was given under; the lock opens only when
  // the counter has moved past it. Success moves nothing (no error), so it never re-opens; a
  // repeated identical failure still moves it via the spinner, so it never deadlocks.
  const errorText = errorMessage ?? ''
  const [reportSeq, setReportSeq] = useState(0)
  const [prevError, setPrevError] = useState(errorText)
  const [prevPending, setPrevPending] = useState(pending)
  if (prevError !== errorText) {
    setPrevError(errorText)
    if (errorText) setReportSeq((n) => n + 1)
  }
  if (prevPending !== pending) {
    setPrevPending(pending)
    if (pending === null && errorText) setReportSeq((n) => n + 1)
  }

  const [answeredKind, setAnsweredKind] = useState<'confirm' | 'decline' | null>(null)
  const [seqAtAnswer, setSeqAtAnswer] = useState(0)
  const [prevSaleId, setPrevSaleId] = useState(saleId)
  if (prevSaleId !== saleId) {
    setPrevSaleId(saleId)
    setAnsweredKind(null)
  }
  const failedSinceAnswer = reportSeq > seqAtAnswer
  const locked = pending !== null || (answeredKind !== null && !failedSinceAnswer)
  // ⚠️ AND THE OPPOSITE ANSWER IS A ONE-WAY DOOR FOR THE LIFE OF THE SALE. `locked` re-opens on a
  // reported failure, which is right for RETRYING the same answer; "Yes" then "No" for one sale is
  // never a retry. It opens only where the failure proves nothing was written.
  const contradicts = (kind: 'confirm' | 'decline') =>
    answeredKind !== null && answeredKind !== kind && !failedSinceAnswer

  const answer = (kind: 'confirm' | 'decline') => {
    setAnsweredKind(kind)
    setSeqAtAnswer(reportSeq)
  }

  const settled = status !== 'asking'
  const confirmed = status === 'confirmed'
  const settledText = confirmed
    ? tr('Confirmed — this deal now counts for both of you.', 'Đã xác nhận — giao dịch này được tính cho cả hai bên.')
    : tr('Noted. Nobody was reported, and we will not ask about this one again.', 'Đã ghi nhận. Không ai bị báo cáo, và chúng tôi sẽ không hỏi lại về tin này.')

  // ⚠️ SPLIT ON THE TOKENS RATHER THAN .replace()-ing THEM IN.
  // Two reasons, both real: word order differs between en and vi, so the sentence has to stay one
  // translatable string; and a title or a name containing "$&" would be eaten by String.replace's
  // substitution patterns. Splitting keeps the translated order AND lets the two facts the buyer
  // must actually check — WHAT and HOW MUCH — carry weight in the type.
  const sentence = tr(
    '{seller} says you bought {title} for {price}.',
    '{seller} nói bạn đã mua {title} với giá {price}.',
  )
  const values: Record<string, string> = { '{seller}': sellerName, '{title}': listingTitle, '{price}': money }
  const parts = sentence.split(/(\{seller\}|\{title\}|\{price\})/)

  return (
    <div className={className}>
      {/* ⚠️ THE LIVE REGION IS ALWAYS MOUNTED, EVEN WHILE IT IS EMPTY — that is the whole point.
          A `role="status"` element inserted into the DOM together with its text is frequently not
          announced at all: screen readers watch a live region for CHANGES, and a region that did
          not exist a moment ago has nothing to change from. Rendering the (empty) region from the
          first paint and filling it when the answer lands is what makes the acknowledgement
          actually reach a blind buyer instead of only looking like it does. */}
      <div role="status">
        {settled ? (
          <div className="flex items-start gap-2.5 rounded-2xl bg-tint px-3.5 py-3">
            <BadgeCheck
              className={cn(ICON_SIZE.lg, 'mt-px shrink-0', confirmed ? 'text-success' : 'text-ink-3')}
              strokeWidth={STROKE_UI}
              aria-hidden
            />
            <p className="text-sm text-foreground">{settledText}</p>
          </div>
        ) : null}
      </div>

      {settled ? null : (
      <div
        role="group"
        aria-labelledby={questionId}
        className="rounded-2xl bg-accent px-3.5 py-3.5"
      >
      <div className="flex items-start gap-2.5">
        <Handshake
          className={cn(ICON_SIZE.lg, 'mt-px shrink-0 text-accent-foreground')}
          strokeWidth={STROKE_UI}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p id={questionId} className="text-sm text-foreground">
            {parts.map((part, i) =>
              // `Object.hasOwn`, not `part in values`: `in` walks the prototype chain, so a
              // sentence fragment that happened to read "toString" would resolve to a FUNCTION
              // and React would throw on rendering it.
              Object.hasOwn(values, part) ? (
                <span key={i} className={cn(part === '{seller}' ? 'font-semibold' : 'font-bold')}>
                  {values[part]}
                </span>
              ) : (
                <span key={i}>{part}</span>
              ),
            )}
          </p>
          {/* The load-bearing sentence — see the header. Do not trim it. */}
          <p className="mt-1 text-sm font-semibold text-accent-foreground">
            {tr('Confirm so it counts for both of you.', 'Xác nhận để giao dịch được tính cho cả hai bên.')}
          </p>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <Button
          variant="cta"
          size="none"
          type="button"
          onClick={() => {
            answer('confirm')
            hapticConfirm()
            onConfirm()
          }}
          disabled={locked || contradicts('confirm')}
          className="flex-1 py-2.5 disabled:opacity-40"
        >
          {pending === 'confirm' && <Loader2 className={cn(ICON_SIZE.md, 'animate-spin')} />}
          {tr('Yes, I bought it', 'Đúng, tôi đã mua')}
        </Button>
        <Button
          variant="outline"
          size="none"
          type="button"
          onClick={() => {
            answer('decline')
            hapticTap()
            onDecline()
          }}
          disabled={locked || contradicts('decline')}
          className="flex-1 py-2.5 font-semibold text-foreground disabled:opacity-40"
        >
          {pending === 'decline' && <Loader2 className={cn(ICON_SIZE.md, 'animate-spin')} />}
          {tr('No, I did not', 'Không, tôi không mua')}
        </Button>
      </div>

      {/* Said BEFORE the tap, not after it: the cost of a wrong "no" has to be visibly zero, or
          the cautious buyer simply says nothing at all. */}
      {errorMessage ? (
        <p role="alert" className="mt-2 text-xs font-semibold text-destructive">
          {errorMessage}
        </p>
      ) : null}

      <p className="mt-2 text-xs text-body">
        {tr('No is a normal answer. It reports nobody, and we will not ask about this one again.', 'Không cũng là câu trả lời bình thường. Nó không báo cáo ai, và chúng tôi sẽ không hỏi lại về tin này.')}
      </p>
      </div>
      )}
    </div>
  )
}
