'use client'

import * as React from 'react'

import { useLanguage } from '@/context/language-context'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Copy, Trash2, Flag, Undo2, Heart } from '@/components/ui/icons'
import { LottieEmoji } from '@/components/marketplace/lottie-emoji'
import { hapticTap } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import { PRIMARY_REACTION, REACTIONS, reactionFor, topReactions } from '@/lib/reactions'

/**
 * CHAT MESSAGE REACTIONS — the Zalo tap-back, on eno.vn's terms.
 *
 * Owner's brief: "by default only heart on hover top 5 most used emojis and when clicked more icon
 * how all available … and mobile version on long press open up 5 most used".
 *
 * ⛔ THE TWO INPUT MODES ARE NOT THE SAME INTERACTION WEARING DIFFERENT CSS, and building them as
 * one is how this feature goes wrong. Hover is CHEAP and REVERSIBLE — it costs nothing to reveal a
 * bar the user can ignore by moving the pointer. Long-press is EXPENSIVE and COMMITTING — it
 * interrupts scrolling, competes with text selection and the browser's own callout menu, and the
 * user cannot "un-press" to dismiss. So hover reveals eagerly and dismisses on leave, while
 * long-press demands a deliberate hold, fires a haptic to confirm it registered, and stays open
 * until something explicitly closes it.
 *
 * ⚠️ THE PRESS MUST NOT STEAL TEXT SELECTION. Message bubbles carry `allow-select` precisely so
 * people can copy a price or an address out of a thread, and a long-press handler that
 * preventDefaults on touchstart would silently kill that. This one lets the gesture proceed and
 * simply cancels its own timer the moment the finger moves — selection wins ties, because losing
 * the ability to copy a message is a worse regression than a reaction bar that did not open.
 *
 * ⚠️ THE COUNT PILLS ARE PLAIN UNICODE, NOT ANIMATIONS. A busy thread can show dozens at once, and
 * dozens of concurrent Lottie players is a dropped-frames machine on the mid-range Androids most of
 * this audience uses. Animation is reserved for the picker — the one place the user is actively
 * looking at emoji and there are at most a handful on screen.
 */

export type MessageReaction = { emoji: string; count: number; mine: boolean }

/**
 * BARE "＋" AND "✕" MARKS — TWO STROKES EACH, NO RING.
 *
 * ⛔ NOT `ui/icons`, AND THE REASON IS THE ICON SET ITSELF. Owner, 2026-08-16: "too many circles
 * around like x has circle + has circle remove those". The app's `Plus` and `X` map to Solar's
 * `add-circle` and `close-circle` (scripts/lucide-solar-map.mjs) — the ring is drawn INTO the
 * glyph — and each sat inside a `rounded-full` button that drew a second one. Solar v2 ships no
 * circle-free variant of either (only `-circle` and `-square`), so there is nothing in the sprite
 * to swap to: measured against the package, not assumed.
 *
 * ⚠️ THIS IS THE DOCUMENTED EXCEPTION, NOT A PRECEDENT. Two line segments are not an icon worth a
 * sprite entry, and every other glyph in this file still comes from `ui/icons`. If Solar ever adds
 * a bare `add`/`close`, delete these and use it.
 */
function BareMark({ kind, className }: { kind: 'plus' | 'cross'; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden className={className}>
      {kind === 'plus' ? <path d="M8 3.5v9M3.5 8h9" /> : <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />}
    </svg>
  )
}

/** Long enough not to fire while scrolling, short enough not to feel broken. Matches iOS. */
const LONG_PRESS_MS = 450
/** A finger that travels this far was scrolling, not pressing. */
const PRESS_SLOP_PX = 10
/**
 * How long a pointer must SETTLE on something before its layer opens. Owner: "after short delay
 * like 500 milli seconds … meaningful delays".
 * ⚠️ Without it, dragging down a conversation fires a bar at every message it crosses.
 */
const OPEN_DELAY_MS = 500

/**
 * IS THIS A TOUCH POINTER? Answered AFTER hydration, on purpose.
 *
 * ⛔ THE COARSE/FINE SPLIT IS CSS EVERYWHERE ELSE IN THIS FILE, AND HERE IT CANNOT BE. The touch bar
 * is positioned by Base UI, which needs a real element and real measurements — that is a rendering
 * decision, not a paint one, and no media query can make a component mount.
 *
 * ⚠️ SO WHY THIS IS NOT A HYDRATION BUG: the server has no pointer type, so it renders the FINE
 * branch, and the fine branch's bar is `opacity-0 pointer-events-none` until something opens it.
 * Nothing can open it before hydration — the triggers are a hover and a long press, both of which
 * require JS. By the time either fires, this state has settled. The first paint is identical either
 * way because both branches paint nothing.
 *
 * ⚠️ `change` IS SUBSCRIBED, not just read once. A tablet with a trackpad attached, or a phone in a
 * desktop-mode webview, flips this at runtime; reading `matchMedia` a single time on mount leaves
 * such a device on whichever branch it happened to boot with.
 */
function usePointerCoarse(): boolean {
  const [coarse, setCoarse] = React.useState(false)
  React.useEffect(() => {
    const mq = window.matchMedia('(pointer: coarse)')
    const sync = () => setCoarse(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return coarse
}

/**
 * The row of tallies under a bubble. Renders nothing at all when there are no reactions — an empty
 * element here would add a gap to every message in the thread.
 */
export function ReactionPills({
  reactions,
  onToggle,
  className,
  burstEmoji = null,
}: {
  reactions: MessageReaction[]
  onToggle: (emoji: string) => void
  className?: string
  /**
   * An emoji whose tally should play RIGHT NOW, set by whoever caused the reaction from outside
   * this component — the bar and the one-tap heart both do.
   *
   * ⛔ THE ANIMATION BELONGS TO THE TALLY, NOT THE BUTTON THAT SENT IT. Owner, 2026-08-16, pointing
   * at a tally: "this should be animation not the grey button animation". The grey one-tap mark is
   * meant to recede; the thing worth animating is the reaction that actually landed on the message.
   */
  burstEmoji?: string | null
}) {
  const { tr } = useLanguage()
  /**
   * WHICH TALLY IS MID-ANIMATION. Owner, 2026-08-16: "play animation when emoji pressed thats whole
   * purpose why we got dotlottie files make it super interactive fun to use".
   *
   * ⛔ ONE AT A TIME, AND ONLY ON PRESS — the perf rule at the top of this file has not changed. A
   * busy thread shows dozens of tallies, and dozens of concurrent Lottie players drops frames on the
   * mid-range Androids most of this audience uses. So a tally is a static glyph until someone taps
   * it, plays once, and goes back to being static.
   */
  const [playing, setPlaying] = React.useState<string | null>(null)
  const playTimer = React.useRef<number | null>(null)
  React.useEffect(() => () => { if (playTimer.current !== null) window.clearTimeout(playTimer.current) }, [])
  const burst = React.useCallback((emoji: string) => {
    if (playTimer.current !== null) window.clearTimeout(playTimer.current)
    setPlaying(emoji)
    // Long enough for the longest animation in the pack, short enough that a player is never left
    // running behind a thread the reader has scrolled away from.
    playTimer.current = window.setTimeout(() => { playTimer.current = null; setPlaying(null) }, 2000)
  }, [])

  // A reaction sent from the bar or the one-tap mark plays here, on the tally it produced.
  React.useEffect(() => { if (burstEmoji) burst(burstEmoji) }, [burstEmoji, burst])

  if (!reactions.length) return null

  return (
    <div className={cn('mt-1 flex flex-wrap gap-1', className)}>
      {reactions.map((r) => {
        const entry = reactionFor(r.emoji)
        const name = entry ? tr(entry.label, entry.labelVi) : r.emoji
        return (
          <button
            key={r.emoji}
            type="button"
            onClick={() => { burst(r.emoji); onToggle(r.emoji) }}
            aria-pressed={r.mine}
            aria-label={tr(`${name}, ${r.count}`, `${name}, ${r.count}`)}
            className={cn(
              // ⛔ NO PILL, NO BORDER, NO FILL. Owner, 2026-08-16: "around gray default emoji leave
              // the circle but when pressed activated emojis to the left of it no circles". A
              // reacted emoji is already the loud thing on the line — it is in full colour beside a
              // desaturated glyph — so a ring around it only competed with the one circle that is
              // meant to read as a control.
              // ⚠️ The COUNT still needs to be legible, and `mine` still needs to be visible at a
              // glance; that now comes from the ink alone (§5's brand pair without its container).
              // ⚠️ SIZED TO THE BAR, NOT TO THE TEXT AROUND IT. Owner, 2026-08-17: "make emojis
              // and default selector larger like 30-50% larger same size like in the bar". A tally
              // that renders smaller than the glyph you pressed to create it reads as a different,
              // lesser object; matching the bar's 22px makes the two obviously the same thing.
              'press flex items-center gap-0.5 rounded-full px-0.5 text-sm tabular-nums transition-transform hover:scale-110',
              r.mine ? 'text-brand' : 'text-body',
            )}
          >
            {/* Renders the plain glyph until this one is pressed, then plays the animation once —
                LottieEmoji paints the Unicode character first and always, so there is no blank
                frame and no fetch on a thread nobody has interacted with. */}
            <LottieEmoji emoji={r.emoji} play={playing === r.emoji} size={22} />
            {/* One reaction needs no "1" beside it — the glyph already says it. */}
            {r.count > 1 && <span aria-hidden="true">{r.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** What a message lets you do, decided per message by the thread — see the page for the gates. */
export type MessageActionSet = {
  /** Quote it in the composer. Absent for a message with no text to quote (every card kind). */
  onReply?: () => void
  /** Absent when there is no body to put on the clipboard. */
  onCopy?: () => void
  /** Yours, and text — an offer or a wizard card cannot be recalled. See the recall route. */
  onDelete?: () => void
  /** Theirs. Reporting your own message is not a thing. */
  onReport?: () => void
}

/**
 * EVERYTHING THAT FLOATS AROUND A MESSAGE BUBBLE, BUILT TO THE ZALO MODEL THE OWNER SENT.
 *
 * Owner, 2026-08-16, with two annotated Zalo screenshots: "faded frequent user emoji when hover on
 * it after short delay like 500 milli seconds the more emoji pops up above it with x added if there
 * is already pressed emoji to quick delete it … and quick actions appear with same slight delay to
 * the right of the bubble box if bubble is on the left and to the left of the bubble box if it is
 * on the right side of the conversation all popups open smoothly with subtle roll anumation and
 * meaningful delays".
 *
 * ⛔ TWO TRIGGERS, TWO ANCHORS, TWO STATES — AND THAT IS THE WHOLE DESIGN. An earlier pass hung
 * both layers off one "is this message hovered" boolean, and it was wrong in a way that only a
 * stepped mouse traverse showed: the bar floated 10px above the bubble with nothing in between, so
 * a pointer reaching for it left the bubble mid-flight and the bar closed before the click landed.
 * Anchoring the bar to the GLYPH removes the gap instead of bridging it — the pointer is already on
 * the thing the bar belongs to.
 *
 *   · REACTION BAR  ← hovering the faded glyph, after ~500ms. Opens directly above the glyph, at
 *                     the bubble's bottom-right corner. Carries the top five, the "＋" grid, and an
 *                     "✕" when the viewer already reacted.
 *   · QUICK ACTIONS ← hovering the bubble, after ~500ms. Opens BESIDE the bubble, on the inner
 *                     side: right of an incoming message, left of an outgoing one.
 *
 * ⛔ THE ROOT TAKES NO POINTER EVENTS. It covers the bubble (`inset-0`), which is the only way to
 * position against the bubble's box — and a full cover that accepted clicks would swallow every
 * drag across the message text, silently breaking select-to-copy for the whole thread. Each child
 * opts back in.
 *
 * ⚠️ `measuredTop` IS THE GLOBAL TALLY and may be empty for weeks — `topReactions()` tops it up
 * from the fallback set so the bar is always five wide. See src/lib/reactions.ts.
 */
export function BubbleChrome({
  onPick,
  onRemove,
  reactions,
  onToggle,
  myReaction = null,
  measuredTop = [],
  barOpen,
  onBarOpenChange,
  actionsOpen,
  onActionsOpenChange,
  align = 'start',
  actions,
  onLockChange,
}: {
  onPick: (emoji: string) => void
  /** Clear the viewer's own reaction — the "✕" the owner asked for. */
  onRemove: (emoji: string) => void
  /** The tallies, rendered on the glyph's line. */
  reactions: MessageReaction[]
  onToggle: (emoji: string) => void
  /** The emoji this viewer already left on this message, if any. Drives the "✕". */
  myReaction?: string | null
  measuredTop?: readonly string[]
  /** Controlled so a long-press can open the same bar a hover does. */
  barOpen: boolean
  onBarOpenChange: (open: boolean) => void
  actionsOpen: boolean
  onActionsOpenChange: (open: boolean) => void
  /** Which side of the thread this bubble sits on: 'start' = theirs, 'end' = mine. */
  align?: 'start' | 'end'
  actions?: MessageActionSet
  /**
   * Fired when the "＋" grid opens or closes.
   *
   * ⛔ IT EXISTS SO THE THREAD KNOWS WHEN NOT TO CLOSE ON POINTER-LEAVE. The grid is a Popover and
   * renders through a PORTAL, so moving the cursor into it fires `pointerleave` on the message —
   * which would dismiss the bar before a single emoji in the grid could be clicked.
   */
  onLockChange?: (locked: boolean) => void
}) {
  const { tr } = useLanguage()
  const [allOpen, setAllOpen] = React.useState(false)
  const [hovered, setHovered] = React.useState<string | null>(null)
  const coarse = usePointerCoarse()
  const root = React.useRef<HTMLDivElement | null>(null)
  /**
   * The react mark itself, so the touch bar can hang off IT rather than off the bubble.
   * See `usePointerCoarse` and the popover branch below for why that matters.
   */
  const markAnchor = React.useRef<HTMLDivElement | null>(null)
  const top = React.useMemo(() => topReactions(measuredTop), [measuredTop])
  /** The reaction just sent from this chrome, so its TALLY can play — see ReactionPills.burstEmoji. */
  const [sent, setSent] = React.useState<string | null>(null)

  /**
   * THE OPEN DELAY. Owner: "after short delay like 500 milli seconds … meaningful delays".
   *
   * ⛔ IT IS NOT DECORATION, IT IS WHAT MAKES THE THREAD READABLE. Without it, dragging the pointer
   * down a conversation fires a bar and an action row at every message it crosses — a strobe of
   * floating chrome over the text someone is trying to read. The delay means only a pointer that
   * SETTLES on something opens anything.
   */
  const openTimer = React.useRef<number | null>(null)
  const clearOpenTimer = () => {
    if (openTimer.current !== null) { window.clearTimeout(openTimer.current); openTimer.current = null }
  }
  const openAfterDelay = (fn: () => void) => {
    clearOpenTimer()
    openTimer.current = window.setTimeout(() => { openTimer.current = null; fn() }, OPEN_DELAY_MS)
  }
  React.useEffect(() => clearOpenTimer, [])

  /**
   * ⛔ A TOUCH USER COULD NOT CLOSE THE BAR. Reviewer-caught: long-press opens it, but every
   * dismissal path was gated on `pointerType === 'mouse'`, and there is no backdrop — so on a phone
   * the bar stayed open over the thread until an emoji was tapped. The only way out was to react,
   * which is precisely the trap a reaction picker must not be.
   *
   * ⚠️ Listens in the CAPTURE phase, so a tap on a message bubble underneath dismisses it rather
   * than being swallowed by it, and `pointerdown` rather than `click` so it is gone before the
   * underlying element acts on the same gesture.
   */
  React.useEffect(() => {
    if ((!barOpen && !actionsOpen) || allOpen) return
    function onOutside(event: PointerEvent) {
      if (root.current?.contains(event.target as Node | null)) return
      onBarOpenChange(false)
      onActionsOpenChange(false)
    }
    document.addEventListener('pointerdown', onOutside, true)
    return () => document.removeEventListener('pointerdown', onOutside, true)
  }, [barOpen, actionsOpen, allOpen, onBarOpenChange, onActionsOpenChange])

  function pick(emoji: string) {
    hapticTap()
    // Re-set through null so pressing the same emoji twice in a row still re-triggers the play.
    setSent(null)
    window.setTimeout(() => setSent(emoji), 0)
    onPick(emoji)
    setAllOpen(false)
    onLockChange?.(false)
    onBarOpenChange(false)
  }

  React.useEffect(() => () => onLockChange?.(false), [onLockChange])

  const actionList = React.useMemo(() => {
    if (!actions) return []
    return [
      // ⚠️ REPLY FIRST, REPORT LAST, ALWAYS. The order is fixed rather than derived from which
      // actions happen to exist, so the same gesture lands on the same button on every message — a
      // row that reshuffles because one message is yours and the next is theirs is a row people
      // mis-tap. Report sits furthest from the thumb for the same reason Delete does not sit first.
      actions.onReply && { key: 'reply', icon: Undo2, label: tr('Reply', 'Trả lời'), run: actions.onReply, danger: false },
      actions.onCopy && { key: 'copy', icon: Copy, label: tr('Copy', 'Sao chép'), run: actions.onCopy, danger: false },
      actions.onDelete && { key: 'delete', icon: Trash2, label: tr('Delete', 'Xóa'), run: actions.onDelete, danger: true },
      actions.onReport && { key: 'report', icon: Flag, label: tr('Report', 'Báo cáo'), run: actions.onReport, danger: true },
    ].filter(Boolean) as { key: string; icon: typeof Copy; label: string; run: () => void; danger: boolean }[]
  }, [actions, tr])

  // ⚠️ ONE DEFINITION, RENDERED INTO TWO PILLS — the desktop one beside the bubble and the phone
  // one stacked under the reaction bar. They are genuinely different POSITIONS of the same
  // toolbar, not two toolbars, and the alternative (one element re-positioned by breakpoint) does
  // not work here: the two live in different anchors, because "beside the bubble" is measured from
  // the bubble and "under the bar" is measured from the glyph. Only one is ever in the layout —
  // the other is `display:none`, so it is not tabbable and not clickable.
  const actionButtons = actionList.map((a) => (
    <button
      key={a.key}
      type="button"
      tabIndex={actionsOpen ? 0 : -1}
      onClick={() => { hapticTap(); onActionsOpenChange(false); a.run() }}
      aria-label={a.label}
      title={a.label}
      className={cn(
        'press flex size-7 items-center justify-center rounded-xl transition-colors',
        a.danger ? 'text-destructive hover:bg-destructive/10' : 'text-body hover:bg-tint hover:text-foreground',
      )}
    >
      <a.icon className="size-3.5" aria-hidden />
    </button>
  ))


  /**
   * THE BAR'S CONTENTS — the top five, the door to the rest, and the ✕ when there is one to clear.
   *
   * ⚠️ EXTRACTED SO ONE DEFINITION SERVES BOTH POINTERS. With a mouse it goes inside a pill that is
   * a DOM DESCENDANT of the react mark (the only thing that keeps it reachable — see the anchor's
   * note). With a finger it goes inside a Base UI popup that is PORTALLED to the body, because that
   * is what can be kept on screen. Same buttons, two very different homes; duplicating them would
   * guarantee they drift.
   */
  const barContent = (
    <>
      {top.map((emoji) => {
        const entry = reactionFor(emoji)
        return (
          <button
            key={emoji}
            type="button"
            tabIndex={barOpen ? 0 : -1}
            onClick={() => pick(emoji)}
            onPointerEnter={() => setHovered(emoji)}
            onPointerLeave={() => setHovered((h) => (h === emoji ? null : h))}
            onFocus={() => setHovered(emoji)}
            onBlur={() => setHovered((h) => (h === emoji ? null : h))}
            aria-label={entry ? tr(entry.label, entry.labelVi) : emoji}
            aria-pressed={myReaction === emoji}
            className={cn(
              'press flex size-8 items-center justify-center rounded-full transition-[scale,background-color] duration-150 hover:scale-[1.35] hover:bg-tint focus-visible:scale-[1.35]',
              myReaction === emoji && 'bg-primary/10',
            )}
            // ⛔ NO transitionDelay HERE, THOUGH A STAGGER WAS TRIED. An inline delay keyed on
            // the open state stays applied for as long as the bar is open, so it does not only
            // stagger the entrance — it delays every subsequent hover scale by up to 80ms on the
            // last glyph, making the bar feel laggy exactly while being used.
          >
            {/* Animates only while pointed at: at most one player runs at a time. */}
            <LottieEmoji emoji={emoji} play={barOpen && hovered === emoji} size={22} />
          </button>
        )
      })}

      {/**
        * ⚠️ CLOSING THE GRID MUST ALSO RETIRE THE BAR. The pointer-leave guard deliberately
        * ignores a leave while `allOpen` is true (so moving from the bar INTO the popover does
        * not dismiss both) — which means dismissing the popover with an outside click, once the
        * pointer has already wandered off, would leave the bar stranded open with no pointer
        * over it and no event coming to close it.
        */}
      <Popover
        open={allOpen}
        onOpenChange={(next) => {
          setAllOpen(next)
          onLockChange?.(next)
          if (!next) onBarOpenChange(false)
        }}
      >
        <PopoverTrigger
          render={
            <button
              type="button"
              tabIndex={barOpen ? 0 : -1}
              aria-label={tr('More reactions', 'Thêm biểu cảm')}
              // ⚠️ NO `rounded-full` FILL. The ring was the second of the two circles the owner
              // asked to remove; the mark carries no ring of its own now either.
              className="press flex size-8 items-center justify-center text-ink-4 transition-colors hover:text-foreground"
            >
              <BareMark kind="plus" className="size-4" />
            </button>
          }
        />
        {/* ⚠️ THE GRID FOLLOWS THE BAR. Hardcoded `align="end"`, the 280px panel ran off the same
            edge as the bar did, for the same reason — reviewer-caught alongside it. */}
        <PopoverContent align={align === 'end' ? 'end' : 'start'} side="top" className="w-[17.5rem] p-2">
          <div className="grid max-h-64 grid-cols-7 gap-0.5 overflow-y-auto">
            {REACTIONS.map((r) => (
              <button
                key={r.emoji}
                type="button"
                onClick={() => pick(r.emoji)}
                onPointerEnter={() => setHovered(r.emoji)}
                onPointerLeave={() => setHovered((h) => (h === r.emoji ? null : h))}
                aria-label={tr(r.label, r.labelVi)}
                className="press flex size-9 items-center justify-center rounded-lg transition-colors hover:bg-tint"
              >
                {/* ⚠️ Static in the grid. 47 simultaneous players would jank the scroll; only the
                    one under the pointer is upgraded, which is also the only one being looked at. */}
                <LottieEmoji emoji={r.emoji} play={hovered === r.emoji} size={24} />
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/**
        * THE "✕". Owner: "with x added if there is already pressed emoji to quick delete it".
        *
        * ⚠️ IT ONLY EXISTS WHEN THERE IS SOMETHING TO CLEAR, which is also why it cannot simply
        * be a sixth permanent button: an ✕ on a message you never reacted to reads as "dismiss
        * this bar", and dismissing is what moving the pointer away already does.
        */}
      {myReaction && (
        <>
          <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border" />
          <button
            type="button"
            tabIndex={barOpen ? 0 : -1}
            onClick={() => { hapticTap(); onRemove(myReaction); onBarOpenChange(false) }}
            aria-label={tr('Remove my reaction', 'Bỏ biểu cảm của tôi')}
            title={tr('Remove my reaction', 'Bỏ biểu cảm của tôi')}
            className="press flex size-8 items-center justify-center text-ink-4 transition-colors hover:text-destructive"
          >
            <BareMark kind="cross" className="size-4" />
          </button>
        </>
      )}
    </>
  )

  return (
    <div ref={root} className="pointer-events-none absolute inset-0 z-20">

      {/**
        * QUICK ACTIONS — BESIDE THE BUBBLE, NOT UNDER IT. Owner: "to the right of the bubble box if
        * bubble is on the left and to the left of the bubble box if it is on the right side of the
        * conversation". That is the INNER side in both cases, which is also the only safe one: a row
        * hung off the outer edge would sit in the viewport margin, and on a narrow phone it would be
        * clipped.
        *
        * ⚠️ THE STRIP BETWEEN THE BUBBLE AND THE ROW IS PART OF THE HOVER TARGET. `ml-2`/`mr-2` is
        * 8px of nothing, and the bubble owns the hover — a pointer crossing it fires `pointerleave`
        * and the row would vanish mid-reach. The `before:` pseudo-element spans that gap so the
        * pointer never leaves this message's subtree. Measured, not assumed: an earlier version put
        * the bridge inside the row and it inherited the row's width, which a pointer approaching
        * from the bubble's centre missed entirely.
        */}
      {actionList.length > 0 && !coarse && (
        <div
          aria-hidden={!actionsOpen}
          onPointerEnter={() => clearOpenTimer()}
          className={cn(
            // ⛔ ONE PILL, NOT THREE COINS. Owner, 2026-08-16: "remove circles around these make them
            // one pill have squircle outline around similar to bubble box". Three bordered circles
            // read as three unrelated controls floating beside the message; one container with the
            // bubble's own `rounded-2xl` reads as the message's own toolbar. The border, fill and
            // shadow live here now — the buttons inside carry only their hover.
            //
            // ⛔ DESKTOP ONLY — `max-sm:hidden`. Beside the bubble is a POINTER placement: it needs a
            // gutter to sit in, and the hover bridge either side of it only means anything to a
            // mouse. On a phone there is no gutter, so this pill and the reaction bar were drawn on
            // top of each other (owner, 2026-08-17, with a screenshot). The phone gets the stacked
            // copy inside the glyph's anchor instead — see MOBILE ACTIONS below.
            'absolute top-1/2 z-30 flex -translate-y-1/2 items-center gap-0.5 rounded-2xl border border-border bg-popover p-0.5 shadow-pop transition-[opacity,scale,translate] duration-200',
            'before:absolute before:inset-y-0 before:w-3 before:content-[""]',
            align === 'end'
              ? 'right-full mr-2 origin-right before:left-full'
              : 'left-full ml-2 origin-left before:right-full',
            actionsOpen
              ? 'pointer-events-auto translate-x-0 scale-100 opacity-100'
              : cn('pointer-events-none scale-90 opacity-0', align === 'end' ? 'translate-x-1' : '-translate-x-1'),
          )}
          style={{ transitionTimingFunction: 'var(--ease-spring)' }}
        >
          {actionButtons}
        </div>
      )}

      {/**
        * THE GLYPH AND ITS BAR, IN ONE ANCHOR AT THE BUBBLE'S BOTTOM-RIGHT CORNER.
        *
        * ⛔ THE BAR IS A DESCENDANT OF THE ANCHOR, WHICH IS WHY IT CAN BE REACHED. Anchored to the
        * bubble instead, a pointer moving from the glyph to the bar left the hovered element and the
        * bar closed under it. As a descendant, `pointerleave` on the anchor never fires for that
        * move at all — and the `before:` strip covers the 6px the two are apart.
        *
        * ⚠️ 30% SUNK. `translate-y-[70%]` leaves 70% of the glyph below the bubble's bottom edge,
        * which is what the row's `pb-1.5` and the pills' `mt-3.5` are sized against.
        */}
      <div
        ref={markAnchor}
        className="pointer-events-auto absolute bottom-0 right-2 flex translate-y-[70%] items-center gap-1"
        onPointerEnter={(e) => {
          if (e.pointerType !== 'mouse') return
          // Hovering the glyph is a bid for the BAR only — the actions row belongs to the bubble.
          onActionsOpenChange(false)
          openAfterDelay(() => onBarOpenChange(true))
        }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') clearOpenTimer() }}
      >
        {/**
          * THE TALLIES SHARE THE GLYPH'S LINE. Owner: "emojis themselves land in the same row of the
          * default emoji line the 30% onto bubble if have more emojis selected the previous moves to
          * the left and new emoji added to the right of it" — which is the Zalo screenshot exactly:
          * the counts straddle the bubble's bottom edge, right-aligned, with the faded glyph as the
          * last item on the line.
          *
          * ⚠️ THE ORDER FALLS OUT OF THE EXISTING SORT AND NEEDS NO SERVER CHANGE. Reactions come
          * back sorted count-descending, so an emoji someone just added (count 1) lands LAST — i.e.
          * furthest right, nearest the glyph — and an established one sits left of it. That is the
          * "previous moves to the left" the owner described, and it is stable across renders in a
          * way a client-side recency guess would not be.
          *
          * ⚠️ NOT IN THE ROW'S FLOW ANY MORE. They used to sit under the bubble and reserve their own
          * height; here they hang off it, which is why the message row carries `pb-4`.
          */}
        <ReactionPills reactions={reactions} onToggle={onToggle} burstEmoji={sent} className="mt-0" />

        <button
          type="button"
          onClick={() => pick(PRIMARY_REACTION)}
          onFocus={() => onBarOpenChange(true)}
          /* ⚠️ NAMES THE ACTION, NOT JUST THE GLYPH. "Heart, button" does not tell anyone what
             pressing it does. `top` is never empty — topReactions() tops up from
             DEFAULT_TOP_REACTIONS and a unit test asserts a full bar. */
          aria-label={tr(`React with ${reactionFor(PRIMARY_REACTION)?.label ?? PRIMARY_REACTION}`, `Bày tỏ ${reactionFor(PRIMARY_REACTION)?.labelVi ?? PRIMARY_REACTION}`)}
          className={cn(
            // ⚠️ 26px, UP FROM 18 (+44%) — owner, 2026-08-17, same note as the tallies. At 18px
            // this was a smudge rather than a control: it is the ONE-TAP shortcut, the most-used
            // affordance on a message, and it was the smallest thing on the row. Its hit area was
            // always larger than its paint; now the paint agrees with it.
            'press flex size-[26px] shrink-0 items-center justify-center rounded-full bg-popover text-xs leading-none shadow-sm ring-1 ring-border transition-[opacity,filter,scale] duration-200 ease-out',
            // ⛔ "OUTLINED" FOR AN EMOJI MEANS DESATURATED. There is no stroke form of a colour
            // emoji glyph. ⚠️ 0.55, not 0.9 — measured on the rendered page, at 0.9 an 18px ❤️ is a
            // grey smudge that stops reading as an emoji at all, which defeats showing WHICH emoji
            // the site uses most.
            'text-ink-4 hover:text-destructive hover:scale-110',
            // ⚠️ IT STAYS PUT WHILE THE BAR IS OPEN. The bar now opens ABOVE it rather than over it,
            // so there is nothing to hide from — and hiding the control the pointer is resting on is
            // how the previous version made itself unreachable.
            'opacity-60 hover:opacity-100',
          )}
        >
          {/**
            * ⛔ A SOLAR OUTLINE HEART, NOT THE MEASURED TOP EMOJI. Owner, 2026-08-16: "this should be
            * only the outline in gray to not stand out use solar heart outlined". An earlier pass
            * argued the opposite — a heart cannot express whichever glyph the tally says is most
            * used — and the owner's answer is that the resting mark should recede, not inform. The
            * BAR still shows the measured top five; only this one-tap shortcut is fixed.
            *
            * ⚠️ SO THE TAP SENDS ❤️, NOT top[0]. The icon and the action have to agree: a heart that
            * quietly posts 😂 because that is this week's most-used glyph is the worst kind of
            * surprise. It swaps to the full-colour animation for the moment it plays.
            */}
          <Heart className="size-4" aria-hidden />
        </button>

        {/**
        {/**
          * ⛔ TWO HOMES FOR ONE BAR, CHOSEN BY POINTER TYPE — and this is the fourth attempt at the
          * owner's "make it screen acnostic so it wont happen". The three before it were CSS
          * anchors, and the write-up of why they cannot work is worth keeping:
          *
          *  · `align`-based: a WIDE incoming card takes `left-0`, but the mark it hangs off is at
          *    the bubble's bottom-RIGHT for incoming and outgoing alike, so the bar began near the
          *    screen's right edge and ran off it. That was the reported bug.
          *  · `right-0` always: fixes that, breaks the mirror — a 91px incoming bubble at the left
          *    wall put the bar at x = -151 (measured, 390px viewport, 246px bar).
          *  · a container query picking the better side: still fails in the MIDDLE. A 200px incoming
          *    bubble has neither 246px to its left nor to its right, so there is no side to choose.
          *
          * The bar is simply wider than the space some bubbles offer, so NO bubble-relative anchor
          * can be right. It has to be positioned against the viewport, which needs measurement —
          * and measuring floating layers is what Base UI's positioner already does. CLAUDE.md's
          * standing rule is that floating layers come from Base UI rather than hand-rolled
          * positioning; three failed attempts is what ignoring it costs.
          *
          * ⛔ TOUCH ONLY. The mouse bar MUST stay a DOM descendant of the mark — a portal breaks
          * `pointerleave` and the bar closes under the cursor on the way to it (see the anchor's
          * note). Touch has no hover, so portalling is free there.
          *
          * ⚠️ ONE CARD, NOT TWO PILLS. The popup itself is the container, so the emoji row and the
          * quick actions sit in one rounded surface — which is also what "pin quick actions bar
          * below the emoji bar" asked for, and it means the collision maths runs once over the
          * whole stack rather than twice over two layers that could disagree.
          */}
        {coarse ? (
          <Popover
            open={barOpen || actionsOpen}
            onOpenChange={(next) => { if (!next) { onBarOpenChange(false); onActionsOpenChange(false) } }}
          >
            <PopoverContent
              anchor={markAnchor}
              side="top"
              align={align === 'end' ? 'end' : 'start'}
              sideOffset={6}
              /* ⚠️ THE ONE LINE THE WHOLE REWRITE EXISTS FOR: keep it 12px inside the viewport,
                 whatever the bubble's width or position. */
              collisionPadding={12}
              /* `w-auto` beats the primitive's `w-72` through twMerge; the padding tightens the
                 card around two rows of controls. The shadow and ring are the primitive's own and
                 are deliberately kept — this IS a floating card. */
              className="w-auto max-w-[calc(100vw-1.5rem)] gap-1.5 p-1.5"
            >
              {/**
                * ⚠️ `barOpen &&`, NOT ALWAYS — the popup is open on `barOpen || actionsOpen`, and the
                * two come apart in ordinary use: a long press opens both, then tapping an emoji (or
                * the ✕, or dismissing the grid) clears `barOpen` alone. Rendered unconditionally,
                * the emoji row then sat there VISIBLE with `tabIndex={-1}` — controls you can see,
                * can click, and cannot reach with a keyboard. The previous attempt collapsed that
                * row to zero height with a grid animation; a conditional is the same guarantee
                * without the machinery, because the popup is portalled and re-measures on resize.
                */}
              {barOpen && (
                <div className="flex items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0">
                  {barContent}
                </div>
              )}
              {actionList.length > 0 && actionsOpen && (
                // The divider only means anything when there is a row above it to divide from.
                <div className={cn('flex items-center gap-0.5', barOpen && 'border-t border-border/60 pt-1.5', align === 'end' ? 'justify-end' : 'justify-start')}>
                  {actionButtons}
                </div>
              )}
            </PopoverContent>
          </Popover>
        ) : (
          /* THE MOUSE BAR — a descendant of the mark, positioned by CSS, exactly as before.
             `aria-hidden` + `tabIndex={-1}` while closed so a collapsed bar is neither tabbable nor
             clickable — a hidden-by-opacity control that still takes clicks is an invisible target. */
          <div
            aria-hidden={!barOpen}
            className={cn(
              'absolute bottom-full z-30 mb-1.5 flex items-center gap-0.5 rounded-full border border-border bg-popover p-1 shadow-pop ring-1 ring-foreground/10 transition-[opacity,scale,translate] duration-200',
              // ⛔ IT RISES FROM THE MARK AND MAY COVER THE BUBBLE — owner's call, 2026-08-16: "its
              // okay let it cover the bubble". Nested in the mark's anchor it is also a DOM
              // descendant of the control that opened it, so the pointer never leaves that subtree
              // on the way up. The 6px bridge to the glyph below — see the anchor's note.
              'before:absolute before:inset-x-0 before:top-full before:h-2 before:content-[""]',
              // A mouse pointer has a gutter to hover in, so the old side rule is right HERE and
              // only here: hang off the outer edge and grow inward.
              align === 'end' ? 'right-0 origin-bottom-right' : 'left-0 origin-bottom-left',
              barOpen
                ? 'pointer-events-auto translate-y-0 scale-100 opacity-100'
                : 'pointer-events-none translate-y-1 scale-90 opacity-0',
            )}
            style={{ transitionTimingFunction: 'var(--ease-spring)' }}
          >
            {barContent}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Long-press detection for a message bubble.
 *
 * ⛔ IT NEVER CALLS preventDefault, AND THAT IS DELIBERATE — see the header. Cancelling the default
 * touch behaviour is the usual way to build this and it would break copy-out-of-a-message, which
 * people use to lift phone numbers and addresses from a thread. The timer is cancelled by movement
 * instead, so a scroll or a selection drag simply never becomes a press.
 */
/**
 * ⛔ A FACTORY, NOT A HOOK, AND THE REASON IS THE CALL SITE. A thread renders up to 200 bubbles and
 * each needs its own long-press handlers, which a hook cannot supply — hooks cannot be called in a
 * loop or inside a callback. `useLongPress` was exactly that shape and could never have been
 * mounted; this is the same behaviour as a plain function.
 *
 * ⚠️ THE IN-FLIGHT PRESS IS MODULE STATE, deliberately. A finger is singular: only one press can be
 * pending at a time across the whole thread, so one shared slot is not a shortcut but the accurate
 * model. It also means a press begun on one bubble is cancelled by a press begun on another, which
 * is what a user dragging across a list expects.
 */
/**
 * ⚠️ `el` AND ITS TWO SAVED STYLES ARE PART OF THE PRESS, not bookkeeping. The gesture SUPPRESSES
 * text selection while it is in flight and has to put it back on every exit path — including the
 * ones that are not a clean pointerup (a scroll that cancels it, a component that unmounts
 * mid-press). Leaving `user-select: none` behind on a bubble would silently make that message
 * uncopyable forever, which is a worse bug than the one being fixed.
 */
let pendingPress: { timer: number; x: number; y: number; el: HTMLElement; select: string; callout: string } | null = null

function cancelPress() {
  if (pendingPress) {
    window.clearTimeout(pendingPress.timer)
    pendingPress.el.style.userSelect = pendingPress.select
    pendingPress.el.style.setProperty('-webkit-user-select', pendingPress.select)
    pendingPress.el.style.setProperty('-webkit-touch-callout', pendingPress.callout)
  }
  pendingPress = null
}

/**
 * ⛔ CALL THIS ON UNMOUNT. `pendingPress` is module state, so a press armed on a bubble that then
 * navigates away would fire `hapticTap` and a stale callback into nothing — reviewer-caught, and
 * the cost of trading the hook for a factory. Any component mounting these handlers owns the
 * teardown: `React.useEffect(() => cancelLongPress, [])`.
 */
export const cancelLongPress = cancelPress

export function longPressHandlers(onLongPress: () => void) {
  return {
    onPointerDown: (e: React.PointerEvent) => {
      // Mouse users have hover; a long mouse-press would fight click-to-select.
      if (e.pointerType === 'mouse') return
      cancelPress()
      const el = e.currentTarget as HTMLElement
      /**
       * ⛔ SELECTION IS SUPPRESSED FOR THE DURATION OF THE PRESS, AND THIS REVERSES THE RULE THAT
       * USED TO BE WRITTEN HERE. Owner, 2026-08-17: "on mobile the long press also selects the
       * neares text inside the bubble, annoying". Holding a bubble fired BOTH gestures — iOS began
       * its own selection and callout at roughly the same moment our timer opened the reaction
       * chrome, so the reader got a blue selection and a magnifier on top of the bar they asked
       * for.
       *
       * ⚠️ IT MUST BE SET AT POINTERDOWN, NOT WHEN THE TIMER FIRES. The platform starts selecting
       * on its own schedule, near enough to ours that flipping `user-select` at 450ms is a race —
       * and one that loses on a slow frame. Setting it up front and restoring on EVERY exit path
       * (up, cancel, the movement check below, unmount) makes it deterministic.
       *
       * ⚠️ `-webkit-touch-callout` TOO, and it is not redundant: `user-select: none` alone still
       * lets iOS raise the callout menu over a long-pressed element.
       *
       * ⛔ THIS DOES COST TAP-AND-HOLD-TO-SELECT INSIDE A BUBBLE, which an older comment here
       * defended for lifting phone numbers and addresses out of a thread. That reason is no longer
       * load-bearing: the gesture now opens a toolbar whose second button is COPY, so the text is
       * one deliberate tap away instead of one accidental drag. Selection outside bubbles is
       * untouched.
       */
      const select = el.style.userSelect
      const callout = el.style.getPropertyValue('-webkit-touch-callout')
      el.style.userSelect = 'none'
      // ⚠️ THE PREFIX IS NOT REDUNDANT ON THE ONE BROWSER THIS IS FOR. Reviewer-caught: mobile
      // WebKit honours `-webkit-user-select` for suppressing the native selection, and iOS Safari
      // is the platform whose selection this exists to stop. Setting only the unprefixed property
      // would have been a fix that reads correctly and does nothing where it matters.
      el.style.setProperty('-webkit-user-select', 'none')
      el.style.setProperty('-webkit-touch-callout', 'none')
      pendingPress = {
        x: e.clientX,
        y: e.clientY,
        el,
        select,
        callout,
        timer: window.setTimeout(() => {
          /**
           * ⛔ RESTORE FIRST, FIRE SECOND. Both reviewers caught the original order and were right:
           * `onLongPress()` opens the chrome, which sets state, which can re-render or unmount this
           * bubble — and if it throws, nothing after it runs. Either way the inline
           * `user-select: none` would have been left on the message PERMANENTLY, making its text
           * uncopyable for the rest of the session. The cleanup must not depend on the callback
           * returning.
           * ⚠️ `cancelPress()` is the restore path, so this cannot drift from the other three exits.
           */
          const el = pendingPress?.el
          cancelPress()
          /**
           * ⚠️ ONLY THIS BUBBLE'S SELECTION, NOT THE DOCUMENT'S. `removeAllRanges()` on its own
           * wipes whatever the reader had highlighted anywhere on the page — including in the
           * composer they were mid-edit in — which is a bigger theft than the one being fixed.
           * Clearing is for the highlight the platform started INSIDE the pressed bubble before we
           * won the race, so it is conditional on the selection actually living there.
           */
          const sel = window.getSelection()
          if (el && sel && sel.anchorNode && el.contains(sel.anchorNode)) sel.removeAllRanges()
          hapticTap(18)
          onLongPress()
        }, LONG_PRESS_MS),
      }
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!pendingPress) return
      if (Math.abs(e.clientX - pendingPress.x) > PRESS_SLOP_PX || Math.abs(e.clientY - pendingPress.y) > PRESS_SLOP_PX) cancelPress()
    },
    onPointerUp: cancelPress,
    onPointerCancel: cancelPress,
  }
}
