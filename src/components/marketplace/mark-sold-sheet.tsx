'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Loader2, UserRound } from 'lucide-react'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { RadioGroup, Radio, RadioDot } from '@/components/ui/radio-group'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { VndInput } from './vnd-input'
import { useLanguage } from '@/context/language-context'
import { formatMoneyFull, moneyLocale, parseVnd } from '@/lib/vnd'
import { ICON_SIZE, STROKE_UI } from '@/lib/icon-tokens'
import { hapticConfirm } from '@/lib/haptics'
import { cn } from '@/lib/utils'

/**
 * ── <MarkSoldSheet> — the SELLER's half of the trade loop ────────────────────────────────────
 *
 * "Who bought it, and for how much." Two answers, both of which the marketplace needs and
 * neither of which it can infer.
 *
 * ⚠️ PROPS ONLY. This component fetches nothing, mounts nothing and persists nothing. It is
 * handed the people, it hands back a {@link MarkSoldSubmission}. The persistence shape is the
 * integrator's (stream A) — do not grow a fetch in here, and do not let the sheet learn what a
 * conversation or an offer row looks like. `buyers` is a projection the caller builds.
 *
 * ## Four decisions worth defending, because each has an obvious wrong version
 *
 * 1. **THE LIST IS THE PEOPLE WHO ACTUALLY MESSAGED, AND THERE IS NO SEARCH BOX.** On a normal
 *    listing that list is two to five people. A search box over five rows is not a convenience,
 *    it is an admission that the list is too long — and it costs a keyboard, a focus trap and a
 *    layout that jumps on a surface the seller uses once per sale. If a seller ever genuinely has
 *    fifty conversations on one listing, the fix is to cut the list (recent + offered), not to add
 *    a field. The list arrives already ordered by the caller; this component never re-ranks it.
 *
 * 2. **"Someone not on eno" IS A ROW IN THE SAME LIST, THE SAME SIZE, WITH THE SAME TAP TARGET.**
 *    Not a link under the fold, not a checkbox, not "other". Most Vietnamese marketplace deals
 *    finish on Zalo, in a coffee shop, or through a friend — and if the only cheap answer is "one
 *    of these five people", sellers will pick one of these five people. That is how the completed
 *    -deal data becomes a lie, and every downstream number built on it (trust, price guidance,
 *    the price band on the PDP) inherits the lie. Making the honest answer free is the whole
 *    point. With NOBODY in the list it is also pre-selected, because it is then the only true
 *    answer available and asking for a tap to confirm the obvious is theatre — but that
 *    pre-selection is DERIVED from the list being empty, never latched at mount, so a list that
 *    arrives late un-picks it rather than filing a false off-eno sale (see `choiceValue`).
 *
 * 3. **THE AGREED PRICE IS ASKED FOR, NOT ASSUMED.** The asking price is a starting position; in
 *    this market the sale price usually is not it. Trust and price guidance want what the thing
 *    ACTUALLY sold for. So the field is pre-filled — with the accepted offer when the chosen
 *    person had one, otherwise the asking price — and it stays editable. Pre-filled beats blank:
 *    a blank field turns "confirm the number" into "compose a number", and a seller in a hurry
 *    will type 12 and mean 12 triệu.
 *
 *    ⚠️ The pre-fill FOLLOWS the selection only until the seller touches the field
 *    (`priceEdited`). A default that keeps overwriting a typed number is a data-loss bug wearing
 *    a helpful hat.
 *
 * 4. **MONEY GOES THROUGH <VndInput>, WHICH GOES THROUGH src/lib/vnd.ts.** A đồng price is eight
 *    or nine digits and a keypad slip is SILENT — 1.200.000 and 12.000.000 look alike at a
 *    glance and differ by an order of magnitude. VndInput is the repo's answer and it already
 *    carries every part of it: live grouping in the viewer's own convention (DOT thousands for
 *    vi), `inputMode="numeric"`, the ×1.000 / ×1.000.000 / ×1.000.000.000 unit ladder with the
 *    documented onMouseDown focus-hold, and the "= 12 triệu VND" read-back line. Re-rolling a
 *    money field here would have re-decided the vi/en separator question, which is exactly what
 *    the design-lint money gate exists to prevent. On top of that this sheet adds two things
 *    VndInput cannot know about: an "Asking price" snap-back chip, and a NON-BLOCKING order-of
 *    -magnitude check (see `needsPriceAck`) that asks ONCE, at the tap, with the figure spelled
 *    out on the button — never a block, because a 70%-off urgent sale is a real thing a seller is
 *    allowed to do, and never live-while-typing, because every prefix of a đồng price is small
 *    enough to trip it.
 *
 * ## Shell
 * `ui/drawer` (Base UI Drawer), not `ui/dialog`: this is a bottom-anchored mobile sheet with a
 * swipe-to-dismiss handle, and the drawer primitive already owns the keyboard geometry (`--kb-h`)
 * that a price field makes load-bearing — a centred dialog would put the confirm button under the
 * on-screen keyboard the moment the seller taps the amount.
 */

/** One person the seller can pick. Everything here is a PROJECTION the caller builds — this
 *  component never learns what a conversation, an offer or a user row looks like. */
export type MarkSoldBuyer = {
  /** Stable id of the person, echoed back as `buyerId`. Whatever stream A keys a confirmation
   *  on (a user id); this component only compares and returns it. */
  id: string
  /** Display name, already the name the seller sees in chat. */
  name: string
  avatarUrl?: string | null
  /** The account's `avatarColor`; falls back to brand blue inside `<Avatar>`. */
  avatarColor?: string | null
  /** One short line under the name — "Messaged 2 days ago", "Offered 11.000.000 đ".
   *  ⚠️ ALREADY TRANSLATED AND ALREADY FORMATTED by the caller: it is derived from data this
   *  component does not have (relative time, offer history), so composing it here would mean
   *  passing timestamps and re-implementing half of vnd.ts. */
  hint?: string | null
  /** Whole VND of an offer this person had ACCEPTED, when there is one. Selecting them defaults
   *  the price field to it — the single most likely correct answer. */
  acceptedOffer?: number | null
}

/** What the seller answered. `buyerId === null` IS the off-eno sale — the honest answer, not an
 *  error case, and the reason this is `string | null` rather than `string | undefined`. */
export type MarkSoldSubmission = {
  buyerId: string | null
  /** Whole VND, and ALWAYS ≥ 0. Zero is reachable only when the listing itself is priced at 0 (a
   *  giveaway); on any priced listing the sheet refuses to submit an empty field. */
  price: number
}

export type MarkSoldSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `id` is not rendered — it is the sale's IDENTITY, and the sheet resets everything when it
   *  changes. A dashboard that keeps ONE sheet and swaps the listing prop as the seller taps
   *  different rows would otherwise carry the previous row's buyer and price into the next sale.
   *  `currency` defaults to '₫' — every listing on eno is stored in đồng (see vnd-input.test.ts). */
  listing: { id: string; title: string; price: number; currency?: string }
  /** The people who messaged about THIS listing, in the order the caller wants them shown. */
  buyers: MarkSoldBuyer[]
  /** ⚠️ REQUIRED, AND PHRASED THIS WAY ROUND ON PURPOSE — the SAFE state is the default you get
   *  when you have not thought about it. An empty list means "this sale happened off eno": a real
   *  answer, pre-selected, with a live CTA. "We have not looked yet" must never be allowed to mean
   *  the same thing, because a sheet opened over a pending fetch would then offer a one-tap path to
   *  filing `buyerId: null` for a deal that had a real buyer — the exact way the completed-deal
   *  data becomes a lie. As an optional `buyersLoading?: boolean` that hazard was reachable by
   *  simply FORGETTING the prop, which is not a hazard anyone should be able to opt into by
   *  omission. Pass `false` until the projection resolves. */
  buyersLoaded: boolean
  onConfirm: (submission: MarkSoldSubmission) => void
  /** True while the caller's write is in flight — spins the CTA, freezes the answer, and disables
   *  Cancel (Escape and the swipe handle deliberately stay open, so a hung request can never trap
   *  the seller). Set it SYNCHRONOUSLY inside `onConfirm`. */
  submitting?: boolean
  /** A failed write, rendered as an announced alert above the CTA. Already translated.
   *  ⚠️ IT MUST DESCRIBE THE LATEST ATTEMPT — CLEAR IT WHEN A RETRY STARTS. It is also how the
   *  sheet learns a retry is wanted: the CTA latches after one dispatch so a double tap cannot file
   *  two sales, and an error APPEARING is what re-arms it. Leave a stale message set and a retry
   *  that succeeds is indistinguishable from one that failed again, which is why the sheet refuses
   *  to guess: it stays latched until the seller edits the answer. Never a trap — Cancel, Escape
   *  and the swipe handle all remain live. */
  errorMessage?: string | null
}

// Radio values live in one namespace, so a buyer whose id happened to be the off-platform
// sentinel could otherwise silently BECOME the off-platform option. Prefixing removes the
// collision instead of assuming ids never look like that.
const BUYER_PREFIX = 'buyer:'
const OFF_PLATFORM_VALUE = 'off-eno'
const buyerValue = (id: string) => `${BUYER_PREFIX}${id}`

// An order-of-magnitude slip is ×10 or ÷10; ×5 catches it with margin while leaving a genuinely
// deep discount (or a haggle upward) alone. It never blocks and never fires while typing — it asks
// once, at the tap (see `needsPriceAck`, and header point 4).
const MAGNITUDE_FACTOR = 5

const ROW = 'flex w-full items-center justify-start gap-3 whitespace-normal rounded-xl border px-3 py-2.5 text-left transition-colors'

export function MarkSoldSheet({
  open,
  onOpenChange,
  listing,
  buyers,
  buyersLoaded,
  onConfirm,
  submitting,
  errorMessage,
}: MarkSoldSheetProps) {
  const { tr } = useLanguage()

  // ⚠️ EVERY OPEN STARTS CLEAN, AND THE PORTAL DOES NOT DO THIS FOR US — MEASURED.
  // With `open={false}` the popup is still in the document (it is mid exit-transition), so the
  // form keeps its state: re-opening the sheet for a DIFFERENT sale would show the previous
  // buyer already selected at the previous price. That is a wrong-data bug, not a cosmetic one.
  // The assertion is pinned in mark-sold-sheet.test.tsx ("RE-OPENING STARTS CLEAN"), which counts
  // the still-mounted radios after close so nobody deletes this as redundant.
  // Bumping the key on the false→true edge makes the reset ours. Deliberately NOT on the
  // true→false edge: remounting mid-exit would blank the sheet while it animates away.
  //
  // ⚠️ THE PREVIOUS `open` IS HELD IN STATE, NOT IN A REF, and that is not a style choice. A ref
  // written during render is NOT rolled back when React discards a render attempt (Strict Mode,
  // an interrupted concurrent render): the ref would already read `true`, the `setGeneration` that
  // never committed would never be retried, and the sheet would re-open holding the LAST sale —
  // exactly the bug this block exists to prevent, in the rarer form that is impossible to
  // reproduce. State-during-render is React's documented "adjust state when a prop changes"
  // escape hatch and re-renders immediately, discarding nothing.
  //
  // The listing's identity rides in the key too: a caller that swaps `listing` on an OPEN sheet
  // (one shared sheet behind a dashboard grid) gets a clean form rather than the previous row's
  // answer.
  const [generation, setGeneration] = useState(0)
  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (open) setGeneration((n) => n + 1)
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} showSwipeHandle>
      <DrawerContent>
        <DrawerHeader className="text-left">
          <DrawerTitle>{tr('Who bought it?', 'Ai đã mua?')}</DrawerTitle>
          <DrawerDescription className="truncate">{listing.title}</DrawerDescription>
        </DrawerHeader>
        <MarkSoldForm
          key={`${generation}:${listing.id}`}
          listing={listing}
          buyers={buyers}
          buyersLoaded={buyersLoaded}
          onConfirm={onConfirm}
          onCancel={() => onOpenChange(false)}
          submitting={submitting}
          errorMessage={errorMessage}
        />
      </DrawerContent>
    </Drawer>
  )
}

function MarkSoldForm({
  listing,
  buyers,
  buyersLoaded,
  onConfirm,
  onCancel,
  submitting,
  errorMessage,
}: {
  listing: MarkSoldSheetProps['listing']
  buyers: MarkSoldBuyer[]
  buyersLoaded: boolean
  onConfirm: (submission: MarkSoldSubmission) => void
  onCancel: () => void
  submitting?: boolean
  errorMessage?: string | null
}) {
  const { lang, tr } = useLanguage()
  const locale = moneyLocale(lang)
  const currency = listing.currency ?? '₫'
  const emptyErrorId = useId()
  const magnitudeWarningId = useId()

  const asking = Math.max(0, Math.round(listing.price || 0))
  const [choice, setChoice] = useState('')
  const [priceDigits, setPriceDigits] = useState(asking ? String(asking) : '')
  const [priceEdited, setPriceEdited] = useState(false)
  const [priceQueried, setPriceQueried] = useState(false)
  const [priceAcknowledged, setPriceAcknowledged] = useState(false)
  // Declared up here because the anchor rule below has to know an answer has already left; the
  // latch it feeds is assembled further down, where the answer's key can be computed.
  const [dispatchedAnswer, setDispatchedAnswer] = useState<string | null>(null)

  // ⚠️ THE EMPTY-LIST PRE-SELECTION IS DERIVED, NOT LATCHED AT MOUNT — and the difference is a
  // false sale. `useState(buyers.length === 0 ? OFF : '')` reads the list ONCE: a caller that
  // opens the sheet while its conversation projection is still loading passes `[]`, off-eno gets
  // pre-selected with the CTA already live, and when the real buyers arrive a moment later the
  // selection stays. A seller tapping straight through files `buyerId: null` for a deal that had a
  // real buyer — the exact "the data becomes a lie" failure the header is about, arriving through
  // the door built to prevent it. Deriving it means the pre-selection lasts exactly as long as the
  // list is empty, and an explicit tap (which sets `choice`) always wins.
  const choiceValue = choice === '' && buyers.length === 0 && buyersLoaded ? OFF_PLATFORM_VALUE : choice
  // ⚠️ THE LOADING GATE APPLIES ONLY UNTIL THE SELLER HAS ANSWERED. Its whole job is to stop an
  // UNINFORMED off-eno answer over a list that has not arrived; once a person has been named
  // explicitly, a caller that re-enters its loading state (a `router.refresh()` on a failed write —
  // the obvious retry shape) must not revoke that answer, grey out the list and swap the footer
  // for "Loading…" while the seller watches.
  const awaitingList = !buyersLoaded && choice === ''
  const chosenBuyer = buyers.find((b) => buyerValue(b.id) === choiceValue)
  const isOffPlatform = choiceValue === OFF_PLATFORM_VALUE
  // ⚠️ A CHOICE THAT IS NO LONGER IN THE LIST IS NOT A CHOICE. If `buyers` refreshes and drops the
  // selected person, their row disappears — but `choice` still holds their id, so the footer copy
  // (which has no such row to describe) would fall through to the off-eno sentence while `submit`
  // still sent the stale buyerId: the seller reads "nobody is asked to confirm" and a real person
  // is pinged. Both the copy and the CTA hang off this one predicate instead.
  const hasValidChoice = isOffPlatform || !!chosenBuyer

  // ⚠️ ONE ANCHOR RULE, DERIVED — and it must read the CHOSEN BUYER, not just the asking price.
  // The anchor is "the number the system believes this sale was for": the accepted offer when the
  // selected person had one, the asking price otherwise. An untouched field follows it; a typed
  // field never does.
  //
  // Writing it once, here, closes three holes that three separate hand-written branches had:
  //   · re-anchoring to `asking` alone silently CLOBBERED a selected buyer's accepted offer when
  //     the listing price refreshed (seller taps Lan → 11.000.000; a price edit lands in another
  //     tab → the field becomes 13.000.000 while the footer still says "Lan will be asked to
  //     confirm", and the sale files 18% above what Lan agreed);
  //   · an `acceptedOffer` that arrives AFTER the seller picked that person never applied at all;
  //   · `pick()` had to duplicate the anchor logic to set the price itself.
  // Adjust-state-during-render, not an effect: the corrected figure has to be on screen in the
  // same paint as the thing that moved it.
  const anchor =
    chosenBuyer?.acceptedOffer && chosenBuyer.acceptedOffer > 0 ? Math.round(chosenBuyer.acceptedOffer) : asking
  // ⚠️ AND IT STOPS THE MOMENT THE ANSWER LEAVES. Once dispatched (or in flight), a prop-driven
  // price change must not rewrite the field: the amount on screen would stop being the amount
  // being recorded, and — because the submit latch is keyed on the ANSWER — moving the price would
  // also re-arm the CTA, so a second tap files the same sale again at a different figure. The
  // `onChange` handler carries the same guard for the same reason.
  // ⚠️ THE SENTINEL ONLY ADVANCES WHEN THE WORK ACTUALLY HAPPENS. Bumping it inside the outer
  // `if` and then skipping the write meant a change that arrived DURING a dispatch was consumed
  // and lost: the price moved to 13.000.000 while the write was out, the guard skipped it, and
  // because `prevAnchor` already read 13.000.000 the field never caught up — a failed write then
  // retried the old figure, with the sheet's own rule saying it should not have.
  const canReanchor = !priceEdited && !submitting && dispatchedAnswer === null
  const [prevAnchor, setPrevAnchor] = useState(anchor)
  if (prevAnchor !== anchor && canReanchor) {
    setPrevAnchor(anchor)
    setPriceDigits(anchor ? String(anchor) : '')
  }

  const price = parseVnd(priceDigits)
  // ⚠️ A LISTING PRICED AT 0 MAY BE SOLD AT 0. Requiring a positive figure unconditionally left a
  // giveaway with no completable path at all: the seller has no truthful number to type, so the
  // CTA stayed dead until they invented one — which then fed price guidance. A zero is only
  // accepted where the listing itself carries one; on a priced listing an empty field is still a
  // missing answer.
  const priceMissing = price <= 0 && asking > 0
  // ⚠️ `priceEdited` IS PART OF THE PREDICATE, NOT AN OPTIMISATION. The check exists to catch a
  // KEYPAD SLIP, so it may only judge a figure the seller typed. Without this the sheet accuses
  // itself: a seller who accepted 2.000.000 đ on a 12.000.000 đ listing taps that buyer, the sheet
  // pre-fills the accepted offer it already has on record, and then warns them about the zeros in
  // a number they never entered.
  const farFromAsking =
    priceEdited &&
    !priceMissing &&
    asking > 0 &&
    (price >= asking * MAGNITUDE_FACTOR || price * MAGNITUDE_FACTOR <= asking)
  // ⚠️ THE LATCH IS ON THE ANSWER, AND ONLY A REPORTED FAILURE RE-ARMS IT.
  // `submitting` is the CALLER's flag and arrives a render late at best, so two taps 200ms apart
  // would otherwise file two sales — on a public trust record, from one bike.
  //
  // Two earlier shapes were wrong, and both are worth naming because each looks right:
  //   · `dispatched && !errorMessage` is a LEVEL test: with a failure on screen it reads "open"
  //     for the whole retry, so the second tap of a double tap dispatched again — failing on
  //     exactly the tap it existed for.
  //   · Snapshotting the caller's whole state and releasing on ANY change releases on SUCCESS too:
  //     a caller that sets `submitting` true then false and closes the sheet a tick later (an
  //     `await refresh()`, a router transition) re-opens the CTA with the same answer still in it,
  //     and a second tap files the same sale twice. The sheet cannot tell "finished, succeeded"
  //     from "finished" — so it must not treat quiet as permission.
  // What DOES mean "try again" is the caller saying so. An error APPEARING (an edge, not a level)
  // re-arms; a changed answer re-arms; silence does not.
  const answerKey = `${choiceValue}|${price}`
  if (dispatchedAnswer !== null && dispatchedAnswer !== answerKey) setDispatchedAnswer(null)
  // ⚠️ ONLY AN ERROR *APPEARING* RE-ARMS IT, AND THAT IS WHY `errorMessage` MUST DESCRIBE THE
  // LATEST ATTEMPT. A version of this also re-armed when the spinner came down while an error was
  // still on screen — meant to help a caller that never clears the message. It cannot: with a
  // stale error still set, a retry that SUCCEEDS looks exactly like a retry that failed again, so
  // that rule handed back a live CTA after a successful write and one more tap filed the sale
  // twice. The sheet has no way to tell those apart, so it does not guess.
  // Clear `errorMessage` when a retry starts (see its prop doc). A caller that does not simply
  // leaves the CTA latched — the safe direction, and never a trap: Cancel, Escape and the swipe
  // handle all stay live, and editing the answer re-arms.
  const errorText = errorMessage ?? ''
  const [prevError, setPrevError] = useState(errorText)
  if (prevError !== errorText) {
    setPrevError(errorText)
    if (errorText) setDispatchedAnswer(null)
  }
  const latched = dispatchedAnswer !== null

  // Picking somebody only changes WHO. The price follows through the anchor rule above — there is
  // exactly one place that decides what an untouched field says.
  const pick = (next: string) => {
    setChoice(next)
    setPriceQueried(false)
    setPriceAcknowledged(false)
  }

  // ⚠️ THE ORDER-OF-MAGNITUDE CHECK RUNS AT THE TAP, NOT WHILE TYPING. Every PREFIX of a đồng price
  // is small, so clearing the field and typing 12000000 passes through 1, 12, 120 … each of which
  // is "far from asking". A live warning therefore flashed on nearly every keystroke of a NORMAL
  // edit — and as `role="alert"` it interrupted a screen reader every time, which is how a real
  // warning gets tuned out. Asking at the moment of submission costs one extra step on a rare
  // event and is announced exactly once.
  //
  // ⚠️ AND THE ANSWER IS A DIFFERENT CONTROL, NOT A SECOND TAP ON THE SAME BUTTON. That was the
  // first design and a reviewer broke it in one line: tap 1 acknowledges, tap 2 files — so the
  // hurried seller on a laggy phone, who is precisely who this exists for, double-taps straight
  // through a warning their eyes never met. Now the first tap only ASKS (`priceQueried`) and
  // immediately disables the CTA; the answer is a checkbox beside the price, up where the number
  // they must re-read actually is. It still never BLOCKS — ticking the box costs one tap, and a
  // 70%-off urgent sale is a real thing a seller may do.
  const needsPriceAck = farFromAsking && !priceAcknowledged
  const canSubmit =
    hasValidChoice && !awaitingList && !priceMissing && !submitting && !latched && !(priceQueried && needsPriceAck)

  const submit = () => {
    if (!canSubmit) return
    if (needsPriceAck) {
      setPriceQueried(true)
      return
    }
    // ⚠️ PIN THE DERIVED CHOICE. The off-eno pre-selection lives in `choiceValue`, not in `choice`,
    // so until this line the submitted answer was still a function of `buyers` — a late arrival
    // during the write flipped it back to "nothing selected", which changed `answerKey`, RELEASED
    // the latch, and silently swapped the footer's "nobody is asked to confirm" for "pick who
    // bought it" mid-write. Committing it makes the answer that left the building immutable.
    setChoice(choiceValue)
    setDispatchedAnswer(answerKey)
    hapticConfirm()
    onConfirm({
      buyerId: isOffPlatform ? null : choiceValue.slice(BUYER_PREFIX.length),
      price,
    })
  }

  // ⚠️ AN EMPTY PRICE IS ONLY AN ERROR ONCE IT IS IN THE WAY. A listing priced at 0 (a giveaway)
  // starts the field blank, and flagging that on the FIRST paint opens the sheet with a red alert
  // and a dead button before the seller has done anything — the app telling them off for its own
  // data. It becomes an error once they have touched the field, or once they have named a buyer
  // and the price is the only thing left standing between them and the CTA.
  // ⚠️ `choice`, NOT `hasValidChoice` — an EXPLICIT answer, never the derived off-eno one. With a
  // 0 đ listing and nobody in the list the derived selection is true on the first paint, so the
  // sheet opened with a red alert and an invalid field before the seller had done anything. The
  // footer says what is missing in that state instead (see below); the red is for a field they
  // have actually engaged with.
  const showPriceError = priceMissing && (priceEdited || choice !== '')

  const showMagnitudeWarning = farFromAsking && priceQueried
  // ⚠️ THE PRESS THAT RAISES THE QUESTION ALSO DISABLES THE BUTTON THAT WAS FOCUSED, so a keyboard
  // or switch user is left with focus on <body> and has to tab from the top of the document to
  // reach the one control that lets them continue. Moving focus onto that control is a direct
  // response to their own action, which is exactly when moving focus is correct.
  // Queried through the DOM rather than by threading a ref through ui/checkbox: the primitive
  // renders a `<span role="checkbox">` plus a hidden input, so the focusable node is not the one a
  // forwarded ref would necessarily land on.
  const ackRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!showMagnitudeWarning || priceAcknowledged) return
    ackRef.current?.querySelector<HTMLElement>('[role="checkbox"]')?.focus()
  }, [showMagnitudeWarning, priceAcknowledged])

  const describedBy = [showPriceError ? emptyErrorId : null, showMagnitudeWarning ? magnitudeWarningId : null]
    .filter(Boolean)
    .join(' ')

  const priceLabel = tr('Agreed price', 'Giá đã chốt')

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3">
        {buyers.length === 0 && (
          <p className="mb-2 text-xs text-body">
            {awaitingList
              ? tr('Looking up who messaged you…', 'Đang tìm những người đã nhắn tin…')
              : tr('Nobody has messaged about this listing yet.', 'Chưa có ai nhắn tin về tin đăng này.')}
          </p>
        )}

        {/* ⚠️ `flex flex-col gap-1.5`, NOT space-y-*: Base UI's Radio.Root renders the
            <span role="radio"> AND a hidden <input> as SIBLINGS, so a `> :not(:last-child)`
            selector lands on the wrong row (the full explanation lives in report-button.tsx). */}
        <RadioGroup
          value={choiceValue}
          onValueChange={pick}
          aria-label={tr('Who bought it?', 'Ai đã mua?')}
          // ⚠️ THE WHOLE GROUP IS INERT WHILE THE LOOKUP IS OUT, not merely un-pre-selected.
          // Suppressing the default alone still leaves "Someone not on eno" tappable over an empty
          // list — so a seller looking at a list that has not arrived can answer "nobody messaged
          // me" and be wrong, which is the same false record by a slower route. Nothing here is an
          // answer until we know what the answers are.
          // It is inert WHILE WRITING for the mirror-image reason: an answer changed after the
          // request left is not the answer being recorded, and a sheet that closes on success
          // would leave the seller believing their last edit was what landed.
          disabled={awaitingList || !!submitting}
          className="flex flex-col gap-1.5"
        >
          {buyers.map((b) => {
            const value = buyerValue(b.id)
            return (
              <Radio
                key={b.id}
                value={value}
                className={cn(
                  ROW,
                  choiceValue === value ? 'border-brand bg-accent' : 'border-border hover:bg-muted',
                )}
              >
                <RadioDot />
                {/* Decorative: the initials inside <Avatar> are real text, so without this the
                    row would announce as "MI Minh …". The name is already in the label below. */}
                <span aria-hidden="true">
                  <Avatar name={b.name} url={b.avatarUrl} color={b.avatarColor} size="sm" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">{b.name}</span>
                  {b.hint ? <span className="block truncate text-xs text-body">{b.hint}</span> : null}
                </span>
              </Radio>
            )
          })}

          {/* First-class, same row shape, same tap target — never a footnote (header, point 2). */}
          <Radio
            value={OFF_PLATFORM_VALUE}
            className={cn(
              ROW,
              isOffPlatform ? 'border-brand bg-accent' : 'border-border hover:bg-muted',
            )}
          >
            <RadioDot />
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-tint text-ink-3"
            >
              <UserRound className={ICON_SIZE.lg} strokeWidth={STROKE_UI} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-foreground">
                {tr('Someone not on eno', 'Người không dùng eno')}
              </span>
              <span className="block text-xs text-body">
                {tr('Sold off the app — it still counts', 'Bán ngoài ứng dụng — vẫn được tính')}
              </span>
            </span>
          </Radio>
        </RadioGroup>

        <div className="mt-5">
          <div className="flex items-baseline justify-between gap-2">
            {/* VndInput renders a <div>, so it is not labelable and cannot sit in a <FieldControl>
                — its own header says so. The visible caption is therefore plain text and the name
                is handed to the inner <input> by hand, as aria-label + aria-describedby. */}
            <span className="text-sm font-medium text-foreground">{priceLabel}</span>
            {asking > 0 ? (
              <span className="text-xs text-body">
                {tr('Asking {price}', 'Rao {price}').replace('{price}', () =>
                  formatMoneyFull(asking, currency, locale),
                )}
              </span>
            ) : null}
          </div>

          <VndInput
            className="mt-1.5"
            value={priceDigits}
            onChange={(digits) => {
              // Frozen mid-write, same reason as the radio group above: what is on screen must
              // stay what is being recorded.
              if (submitting) return
              setPriceEdited(true)
              setPriceDigits(digits)
              // A new number is a new claim: it withdraws the magnitude question AND its answer
              // (so blessing 1.200.000 never blesses 120.000) and re-arms the submit latch.
              setPriceQueried(false)
              setPriceAcknowledged(false)
            }}
            invalid={showPriceError}
            aria-label={priceLabel}
            aria-describedby={describedBy || undefined}
            presets={
              asking > 0
                ? [{ label: tr('Asking price', 'Giá rao'), value: asking }]
                : undefined
            }
          />

          {showPriceError && (
            // role="alert" as well as being the field's description: a message that appears while
            // typing is otherwise announced to nobody (the pattern ui/field bakes in).
            <p id={emptyErrorId} role="alert" className="mt-1 text-xs text-destructive">
              {tr('Enter what it sold for.', 'Nhập số tiền đã bán.')}
            </p>
          )}
        </div>
      </div>

      <DrawerFooter>
        {showMagnitudeWarning && (
          // ⚠️ IT LIVES IN THE FOOTER, WHICH IS THE ONLY PART OF THIS SHEET THAT CANNOT SCROLL AWAY.
          // It was under the price field — beside the number, which reads better — until a reviewer
          // pointed out the consequence: with five buyers and the keyboard up, the first press
          // disables the CTA and the footer says "confirm the price above" while "above" is off
          // screen. A guard the seller cannot find is a dead button, not a guard. The block quotes
          // the figure itself, so the number is here too.
          // It appears ONCE, in response to a press (see `needsPriceAck`) — which is what makes
          // role="alert" right here instead of a per-keystroke interruption — and the checkbox is
          // a DIFFERENT control from the button that was just pressed, so a double tap cannot
          // answer it. A second tap landing here at worst ticks the box; it never files the sale.
          <div ref={ackRef} id={magnitudeWarningId} role="alert" className="rounded-xl bg-warning/10 p-3">
            <p className="text-xs font-semibold text-warning">
              {tr('That is very different from your asking price — check the zeros.', 'Số này khác xa giá rao — kiểm tra lại số 0.')}
            </p>
            <label className="mt-2 flex cursor-pointer items-start gap-2.5 text-xs font-medium leading-relaxed text-foreground">
              <Checkbox
                checked={priceAcknowledged}
                onChange={setPriceAcknowledged}
                disabled={!!submitting}
                className="mt-0.5 h-5 w-5"
              />
              <span>
                {tr('Yes, it sold for {price}', 'Đúng, đã bán với giá {price}').replace('{price}', () =>
                  formatMoneyFull(price, currency, locale),
                )}
              </span>
            </label>
          </div>
        )}

        {errorMessage ? (
          <p role="alert" className="text-xs font-semibold text-destructive">
            {errorMessage}
          </p>
        ) : null}

        {/* What happens next, stated before the tap — the buyer-confirmation loop is the reason
            picking a real person is worth more than picking "someone not on eno".
            ⚠️ Branches on `hasValidChoice`/`isOffPlatform`, never on "did we find a buyer object":
            a selected person who vanished from a refreshed list would otherwise be DESCRIBED as an
            off-eno sale while still being SUBMITTED as themselves. */}
        <p className="text-xs text-body">
          {!hasValidChoice
            ? awaitingList
              ? tr('Loading…', 'Đang tải…')
              : tr('Pick who bought it.', 'Chọn người đã mua.')
            : priceMissing
              ? // Same sentence as the field's own error, calmly, for the state where the field is
                // blank because the LISTING is (a 0 đ giveaway) rather than because anyone erased it.
                tr('Enter what it sold for.', 'Nhập số tiền đã bán.')
              : priceQueried && needsPriceAck
                ? tr('Confirm the price first.', 'Xác nhận giá trước đã.')
                : isOffPlatform
                  ? tr('Recorded as sold off eno. Nobody is asked to confirm.', 'Ghi nhận là bán ngoài eno. Không ai cần xác nhận.')
                  : tr('{name} will be asked to confirm — that is what makes it count for both of you.', '{name} sẽ được hỏi để xác nhận — đó là điều làm giao dịch được tính cho cả hai bên.').replace('{name}', () => chosenBuyer?.name ?? '')}
        </p>

        <Button
          variant="cta"
          size="none"
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className="h-12 w-full rounded-2xl text-base font-semibold disabled:opacity-40"
        >
          {submitting && <Loader2 className={cn(ICON_SIZE.md, 'animate-spin')} />}
          {showMagnitudeWarning && priceAcknowledged
            ? // Once the unusual figure has been ticked, the button carries it — so the press that
              // finally files the sale names the number it is filing.
              tr('Yes, sold at {price}', 'Đúng, đã bán {price}').replace('{price}', () =>
                formatMoneyFull(price, currency, locale),
              )
            : tr('Mark as sold', 'Đánh dấu đã bán')}
        </Button>
        <Button
          variant="soft"
          size="none"
          type="button"
          onClick={onCancel}
          // ⚠️ LOCKED ON `submitting` ONLY — NOT ON THE SUBMIT LATCH, and that asymmetry is the
          // decision, not an oversight. A button labelled "Cancel" that closes the sheet mid-write
          // reads as "aborted" and is not (the write lands anyway), so it goes dark while the
          // caller is visibly writing. Extending that to `latched` was tried and reverted: the
          // latch can legitimately stay engaged when a caller reports nothing, and a Cancel tied to
          // it leaves a seller under a full-viewport drawer with a dead CTA and a dead Cancel.
          // A control that can be permanently dead is worse than one that is briefly optimistic —
          // and the residual window (a tap landing between "Mark as sold" and the caller's next
          // render) requires deliberately pressing Cancel one frame after pressing the CTA.
          // Escape and the swipe handle stay open at all times for the same anti-trap reason.
          disabled={!!submitting}
          className="w-full py-2 text-sm font-semibold text-body"
        >
          {tr('Cancel', 'Hủy')}
        </Button>
      </DrawerFooter>
    </>
  )
}
