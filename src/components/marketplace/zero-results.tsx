'use client'

import * as React from 'react'
import type { LucideIcon } from '@/components/ui/icons'
import { SearchX, Bookmark, BookmarkCheck, Bell, BellRing } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { useLanguage } from '@/context/language-context'
import { groupVnd, formatMoneyFull, moneyLocale } from '@/lib/vnd'
import { cn } from '@/lib/utils'

/**
 * A ZERO-RESULT SEARCH IS THE BEST MOMENT IN THE PRODUCT TO BE USEFUL. The intent is exact — the
 * buyer has just told us the brand, the year and the budget — and there is nothing to give them
 * today. Everything this surface offers is built from that: state the fact plainly, point at the
 * nearest thing that IS real, offer to loosen exactly one condition, and otherwise take the buyer's
 * address so the next matching listing finds THEM.
 *
 * ⚠️ EVERY RELAXATION CARRIES ITS OWN COUNT, AND A COUNT OF ZERO IS DROPPED ON THE FLOOR.
 * This is the one rule the component enforces rather than trusts, because the failure it prevents is
 * the whole reason the surface exists: offering "Any year" to someone who then lands on a SECOND
 * empty page is the same dead end again, with an extra tap and a promise broken. A caller cannot
 * accidentally ship that — a relaxation whose count is 0 (or negative, or NaN) is never rendered.
 * That is also why `count` is required rather than optional: an optional count would be omitted the
 * first time it was inconvenient to compute, and the guard would quietly stop guarding.
 *
 * PURE AND PROPS-DRIVEN. It fetches nothing, holds no state, and knows nothing about the explorer's
 * filter model — the caller (the listings explorer) owns what a relaxation MEANS and what running it
 * does. This file owns the copy, the layout and the zero-count rule.
 *
 * ⚠️ EVERY COUNT AND THE `nearest` SET MUST COME FROM AN EDITION-SCOPED QUERY, AND ONLY THE CALLER
 * CAN DO THAT. This component receives numbers; it cannot see what was counted. On eno.vn a count
 * taken over unfiltered `Listing` rows puts the visa/trip desk back in the feed — the exact leak
 * `scripts/edition-lint.mjs` rule A exists to stop, and one that no test in THIS file could ever
 * catch, because a number is a number. Count with the same predicate the feed itself uses. It is
 * listed here beside the caller's other duties (translate `label`, format money through vnd.ts)
 * because being unable to enforce something is a reason to state it, not a reason to leave it out.
 *
 * ⚠️ `label` IS A PLAIN STRING, NOT A ReactNode, ON PURPOSE. The caller authors it, so the caller
 * puts it through its own tr() call and formats any money in it through src/lib/vnd.ts. A string is
 * what lets this file compose "38 Honda Vision từ 11.500.000 đ" as ONE expression rather than a row
 * of JSX text nodes — which `react/jsx-no-literals` bans app-wide, and rightly, since a bare JSX
 * string is exactly how untranslated copy gets in.
 *
 * ⚠️ AND DO NOT WRITE A WORKED tr() EXAMPLE IN A COMMENT HERE. scripts/gen-ui-strings.mjs harvests
 * by REGEX over the file's raw text and does not strip comments, so an illustrative call adds its
 * fake English to the catalogue and ships a machine translation of it in ~11 languages. Measured on
 * the first draft of this header: a sample label was harvested alongside the eight real strings.
 * Describe the call in prose, exactly as the paragraph above now does.
 */

export type ZeroResultsRelaxation = {
  /** Stable identity for the caller's own bookkeeping; also the React key. */
  id: string
  /** Already translated by the caller. Money in here must come from src/lib/vnd.ts. */
  label: string
  /** How many listings exist AFTER this relaxation. Zero or less ⇒ the chip is not rendered. */
  count: number
  onSelect: () => void
}

export type ZeroResultsNearest = {
  /** How many listings the nearest true set holds. Zero or less ⇒ nothing is claimed. */
  count: number
  /** What that set IS, translated by the caller and phrased to read after a number ("Honda Vision"). */
  label: string
  /** Cheapest price in that set, in whole VND. Omit when there is no meaningful floor to quote. */
  fromPrice?: number
  /** Defaults to '₫'; pass the listing currency for the rare non-VND set. */
  currency?: string
  /** Omit to render the line as plain text instead of an action. */
  onSelect?: () => void
}

/**
 * `pending` marks the control busy but keeps it live; `done` is the confirmed, terminal state;
 * `error` returns it to actionable so the buyer can simply press again.
 *
 * ⚠️ `error` EXISTS BECAUSE THE FIRST VERSION HAD NOWHERE TO PUT A FAILURE, and this is the one
 * control on the page whose entire job is capturing a lead. Without it, a POST that 500s on flaky
 * mobile data leaves the caller two bad options: hold `pending` forever (a dimmed, handler-less
 * button with no way back) or snap to `idle`, which reverts in silence — the buyer believes they
 * are on the list and nobody will ever tell them otherwise. `error` keeps the button pressable —
 * pressing again IS the retry — and puts a named failure line ON SCREEN under the row, not only in
 * the status region: an `error` button is byte-for-byte an untouched one, so an announcement alone
 * would leave every sighted buyer with exactly the silence this state exists to break.
 *
 * The caller may set `pending` whenever it likes: ActionButton swallows a second press inside a
 * 600ms window itself, so an async handler that awaits its POST before flipping the prop cannot
 * produce two saved searches or two alert subscriptions from one double-tap.
 */
export type ZeroResultsActionState = 'idle' | 'pending' | 'done' | 'error'

/** Two presses closer together than this are one impatient tap, not two intents. */
const DOUBLE_TAP_MS = 600

/**
 * The two footer actions have identical state machinery, so it lives in one place — two copies of a
 * four-state control is two chances for them to drift.
 *
 * ⚠️ NO NATIVE `disabled` IN THE INERT STATES — `aria-disabled` INSTEAD. A native `disabled`
 * removes the element from the tab order, so the browser drops focus to <body>: the keyboard or
 * screen-reader user who just pressed the button loses their place on the page, and pressing Tab
 * restarts them at the top of the document. That is bad enough while a request is in flight, and it
 * is just as bad one transition later — an earlier draft kept `disabled` for `done` and simply moved
 * the focus loss from the press to the confirmation, which is the moment the user is most likely to
 * still be there. Both states stay focusable and inert: there is no handler to call, so activation
 * does nothing, and `aria-disabled` is what tells assistive tech so.
 *
 * `opacity-50` is applied by hand for `pending` because ui/button's own dimming is keyed on the
 * `disabled:` variant, which by design no longer matches. `done` is deliberately NOT dimmed — it is
 * a success state with a check glyph, not a dead control.
 */
function ActionButton({
  state,
  onPress,
  variant,
  idleLabel,
  doneLabel,
  idleIcon: IdleIcon,
  doneIcon: DoneIcon,
  errorId,
}: {
  state: ZeroResultsActionState
  onPress: () => void
  variant: 'outline' | 'cta'
  idleLabel: string
  doneLabel: string
  idleIcon: LucideIcon
  doneIcon: LucideIcon
  /**
   * ⚠️ POINTS AT THE VISIBLE ERROR LINE, and it is not redundant with the live region. The region
   * announces ONCE, at the moment of failure. A user who tabs away and comes back — or who arrives
   * on the control for the first time after the failure — hears only "Tell me when one appears,
   * button", with nothing to say the last press did not take. `aria-describedby` is what makes the
   * failure part of the control rather than a moment in time.
   */
  errorId?: string
}) {
  const done = state === 'done'
  const busy = state === 'pending'

  /**
   * ⚠️ A DOUBLE-TAP MUST NOT BUY TWO SUBSCRIPTIONS. While `state` still reads `idle` the handler is
   * live, so an impatient second tap over slow data fires `onPress` twice — two saved searches, or
   * two alert streams to one buyer. The obligation used to sit in a comment addressed to callers
   * ("leave `idle` synchronously"), which is not a guard: any handler that awaits its POST before
   * flipping the prop breaks it, and that is the natural way to write one.
   *
   * ⚠️ A CLOCK **AND** A STATE RESET, BECAUSE EITHER ALONE HAS A FAILURE THE OTHER DOES NOT.
   * "One press per `state` value" locks the control forever whenever the state legitimately does not
   * change — a handler that opens the sign-in sheet and waits, or one that dies before it can set
   * `error` — leaving a button that looks pressable and silently ignores every press. A bare time
   * window has the opposite hole: an offline `fetch` rejects in ~50ms, so a buyer who taps, reads
   * "That did not work" and taps again immediately is inside the window and their RETRY is
   * swallowed — by the guard, on the state that exists to make retrying possible.
   *
   * Together there is no such gap: any state transition reopens the control at once (retry works),
   * and inside one state a second press within 600ms is the same tap (~300ms for a real double-tap,
   * far under the time to read a failure). What deliberately remains is a caller that never signals
   * at all — press, wait a second, press again, two requests. That is the right residue: a control
   * that stays usable when the caller goes quiet beats one that bricks itself.
   */
  const lastPress = React.useRef(0)
  const pressedIn = React.useRef(state)
  if (pressedIn.current !== state) {
    pressedIn.current = state
    lastPress.current = 0
  }
  const press = () => {
    const now = Date.now()
    if (lastPress.current && now - lastPress.current < DOUBLE_TAP_MS) return
    lastPress.current = now
    onPress()
  }
  // `error` is actionable on purpose — pressing again IS the retry, so there is no second control to
  // find. What says a failure happened is the visible error line the parent renders below the row.
  const actionable = state === 'idle' || state === 'error'
  return (
    <Button
      variant={variant}
      size="sm"
      onClick={actionable ? press : undefined}
      aria-disabled={!actionable || undefined}
      aria-busy={busy}
      aria-describedby={state === 'error' ? errorId : undefined}
      className={cn(!actionable && 'cursor-default', busy && 'opacity-50')}
    >
      {done ? <DoneIcon /> : <IdleIcon />}
      {done ? doneLabel : idleLabel}
    </Button>
  )
}

export function ZeroResults({
  reason = 'filters',
  nearest,
  relaxations = [],
  onSaveSearch,
  saveState = 'idle',
  onNotify,
  notifyState = 'idle',
  className,
}: {
  /**
   * WHICH condition emptied the page, because the honest sentence differs. 'price' when a budget
   * ceiling/floor was the binding filter; 'filters' for everything else (the default — it is also
   * the correct thing to say when the caller does not know).
   */
  reason?: 'price' | 'filters'
  nearest?: ZeroResultsNearest
  relaxations?: ZeroResultsRelaxation[]
  onSaveSearch?: () => void
  saveState?: ZeroResultsActionState
  onNotify?: () => void
  notifyState?: ZeroResultsActionState
  className?: string
}) {
  const { tr, lang } = useLanguage()
  const ml = moneyLocale(lang)
  const relaxLabelId = React.useId()
  const errorId = React.useId()

  /**
   * ⚠️ THE ZERO-COUNT RULE, enforced here and nowhere else.
   *
   * `Number.isInteger`, not `> 0` alone and not `Number.isFinite` — a count of listings IS a whole
   * number, so anything else (NaN from a failed aggregate, a 0.5 from an averaged one, an Infinity)
   * is a bug upstream and must not be advertised as a promise. `isInteger` rejects all three in one
   * predicate: it is false for NaN and Infinity by definition. A chip reading "Any year · NaN" or
   * "Any year · 0.5" is worse than a missing chip, because the missing chip does not lie.
   */
  const isWholePositive = (n: number) => Number.isInteger(n) && n > 0
  const live = relaxations.filter((r) => isWholePositive(r.count))
  const hasNearest = !!nearest && isWholePositive(nearest.count)

  /**
   * The count that turns a suggestion into a promise the next page can keep — so it is stated
   * EXACTLY, never abbreviated.
   *
   * ⚠️ `groupVnd`, NOT `formatCount`. formatCount abbreviates past a thousand (measured:
   * formatCount(1150) is "1.2k" / "1,2k"), which rounds 1.150 listings UP to a claim of 1.200 — an
   * inflated inventory number on a surface whose whole argument is that everything it says is true.
   * It is the same objection that makes an unstateable price get dropped a few lines below. groupVnd
   * gives the exact figure with the viewer's separators ("1,150" en / "1.150" vi), and it keeps every
   * number in this file inside src/lib/vnd.ts, which is where the design canon requires them.
   */
  const exactCount = (n: number) => groupVnd(String(n), ml)
  const chipCount = (n: number) => `· ${exactCount(n)}`

  // The two terminal labels are hoisted because they are rendered TWICE — on the button and in the
  // live region below it — and a divergence between those two would be an announcement that does not
  // match what is on screen.
  const savedLabel = tr('Search saved', 'Đã lưu tìm kiếm')
  const notifiedLabel = tr('We will tell you', 'Chúng tôi sẽ báo bạn')
  const saveLabel = tr('Save this search', 'Lưu tìm kiếm này')
  const notifyLabel = tr('Tell me when one appears', 'Báo tôi khi có hàng')

  /**
   * ⚠️ A FAILURE MUST BE VISIBLE, NOT ONLY ANNOUNCED — and the first version of `error` was sr-only,
   * which reproduced the exact outcome the state was added to prevent. In `error` the button is
   * pressable again, so its DOM is byte-for-byte a button that was never pressed: with the message
   * hidden from sighted users, a buyer on flaky data taps "Tell me when one appears", the POST 500s,
   * and they walk away certain they are on the list. The line below is rendered on screen AND
   * carried into the status region.
   *
   * ⚠️ IT NAMES THE ACTION. With both controls wired, an unattributed "That did not work" leaves the
   * buyer guessing which of the two to press again — so the failing control's own label leads.
   */
  const failedActions = [
    onSaveSearch && saveState === 'error' ? saveLabel : null,
    onNotify && notifyState === 'error' ? notifyLabel : null,
  ].filter(Boolean)
  const errorLine = failedActions.length
    ? `${failedActions.join(' · ')}: ${tr('That did not work. Try again.', 'Chưa được. Hãy thử lại.')}`
    : ''

  // Announced once, covering both the confirmations (already visible on the buttons) and the error
  // (also visible below them) — one region, so nothing is read out twice.
  const statusLine = [
    onSaveSearch && saveState === 'done' ? savedLabel : null,
    onNotify && notifyState === 'done' ? notifiedLabel : null,
    errorLine || null,
  ]
    .filter(Boolean)
    .join(' ')

  const title =
    reason === 'price'
      ? tr('Nothing at that price yet', 'Chưa có món nào ở mức giá đó')
      : tr('Nothing matches that yet', 'Chưa có kết quả nào khớp')

  // "38 Honda Vision from 11,500,000 VND" / "38 Honda Vision từ 11.500.000 đ". The word order is the
  // same in both languages, so the only translated fragment is the preposition — which keeps it a
  // single-quoted literal that the ui-strings generator can actually harvest.
  //
  // ⚠️ THE PRICE IS RANGE-CHECKED LIKE THE COUNTS ARE, and the first draft checked only for null.
  // `formatMoneyFull` is Intl.NumberFormat underneath, which renders NaN as "NaN" and Infinity as
  // "∞" rather than throwing — so a failed MIN() aggregate upstream would have printed "from NaN
  // VND" to a buyer, on the one line of this surface whose whole job is to be a true claim. A price
  // we cannot state honestly is simply not stated; the count and the label still are.
  // ⚠️ THE SAME `isWholePositive` PREDICATE, DELIBERATELY: a whole positive number, so NaN, Infinity,
  // negatives, 0 and fractions are all refused in one test. `> 0` rather than `>= 0` because
  // "from 0 VND" is a failed aggregate far more often than a real floor, and whole rather than
  // finite because the prop is documented as whole VND — a 0.5 is broken data, not a cheap listing.
  const floorPrice = nearest && nearest.fromPrice != null && isWholePositive(nearest.fromPrice) ? nearest.fromPrice : null
  const nearestLine = hasNearest
    ? [
        exactCount(nearest.count),
        nearest.label,
        floorPrice != null ? tr('from', 'từ') : null,
        floorPrice != null ? formatMoneyFull(floorPrice, nearest.currency ?? '₫', ml) : null,
      ]
        .filter(Boolean)
        .join(' ')
    : ''

  return (
    <EmptyState
      tone="bare"
      size="lg"
      icon={SearchX}
      className={cn('w-full', className)}
      title={title}
      subtitle={
        hasNearest ? (
          nearest.onSelect ? (
            // The nearest true thing is the most valuable tap on this page, so it is a real control
            // rather than a sentence with a link buried in it.
            <Button variant="link" size="none" className="font-medium" onClick={nearest.onSelect}>
              {nearestLine}
            </Button>
          ) : (
            nearestLine
          )
        ) : undefined
      }
      action={
        live.length || onSaveSearch || onNotify ? (
          <div className="flex w-full flex-col items-center gap-5">
            {live.length > 0 && (
              <div className="flex w-full flex-col items-center gap-2">
                {/* Sentence case, not an uppercase eyebrow: pure-label kickers are banned by the
                    craft floor, and this line is a real instruction — loosen ONE thing, not all of
                    them, which is what keeps the next page from being empty for a new reason. */}
                <p id={relaxLabelId} className="text-xs font-medium text-body">
                  {tr('Relax one thing', 'Nới một điều kiện')}
                </p>
                <div role="group" aria-labelledby={relaxLabelId} className="flex flex-wrap justify-center gap-2">
                  {live.map((r) => (
                    <Button key={r.id} variant="outline" size="sm" className="rounded-full" onClick={r.onSelect}>
                      {r.label}
                      {/* opacity rather than a colour token: `outline` recolours its label on hover,
                          and an explicit text-* on the child would refuse to follow it. The label is
                          built in `chipCount` above rather than inline — `react/jsx-no-literals`
                          rejects a TEMPLATE literal in JSX just as firmly as a bare string, which is
                          how it stops interpolated copy sneaking past the translation layer. */}
                      <span className="tabular-nums opacity-70">{chipCount(r.count)}</span>
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {(onSaveSearch || onNotify) && (
              <div className="flex flex-wrap items-center justify-center gap-2">
                {onSaveSearch && (
                  <ActionButton
                    state={saveState}
                    onPress={onSaveSearch}
                    variant="outline"
                    idleIcon={Bookmark}
                    doneIcon={BookmarkCheck}
                    errorId={errorId}
                    idleLabel={saveLabel}
                    doneLabel={savedLabel}
                  />
                )}
                {onNotify && (
                  // THE brand CTA (design-language §5): on a page with nothing to show, the one
                  // action that turns a dead end into a return visit is the primary one.
                  <ActionButton
                    state={notifyState}
                    onPress={onNotify}
                    variant="cta"
                    idleIcon={Bell}
                    doneIcon={BellRing}
                    errorId={errorId}
                    idleLabel={notifyLabel}
                    doneLabel={notifiedLabel}
                  />
                )}
              </div>
            )}

            {/* ⚠️ THE LIVE REGION IS A SEPARATE, EMPTY-UNTIL-CONFIRMED NODE — IT MUST NOT WRAP THE
                CONTROLS. Confirming by relabelling a button is silent: nothing moves focus, and
                `aria-busy` flipping is not itself an announcement, so the person who just pressed it
                is the one told nothing. But putting `aria-live` on the button ROW makes every
                subtree mutation an announcement — entering `pending` re-read "Save this search Tell
                me when one appears", which is a list of controls, not a status. Rendering only the
                confirmations, in a node that is empty until there is something to say, means the one
                thing it ever announces is the one thing worth announcing. */}
            {errorLine && (
              <p id={errorId} className="text-xs font-medium text-destructive">
                {errorLine}
              </p>
            )}

            <span role="status" aria-live="polite" className="sr-only">
              {statusLine}
            </span>
          </div>
        ) : undefined
      }
    />
  )
}
