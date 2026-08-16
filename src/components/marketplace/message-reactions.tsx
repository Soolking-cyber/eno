'use client'

import * as React from 'react'

import { useLanguage } from '@/context/language-context'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Plus } from '@/components/ui/icons'
import { LottieEmoji } from '@/components/marketplace/lottie-emoji'
import { hapticTap } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import { REACTIONS, reactionFor, topReactions } from '@/lib/reactions'

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

/** Long enough not to fire while scrolling, short enough not to feel broken. Matches iOS. */
const LONG_PRESS_MS = 450
/** A finger that travels this far was scrolling, not pressing. */
const PRESS_SLOP_PX = 10

/**
 * The row of tallies under a bubble. Renders nothing at all when there are no reactions — an empty
 * element here would add a gap to every message in the thread.
 */
export function ReactionPills({
  reactions,
  onToggle,
  className,
}: {
  reactions: MessageReaction[]
  onToggle: (emoji: string) => void
  className?: string
}) {
  const { tr } = useLanguage()
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
            onClick={() => onToggle(r.emoji)}
            aria-pressed={r.mine}
            aria-label={tr(`${name}, ${r.count}`, `${name}, ${r.count}`)}
            className={cn(
              'press flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs tabular-nums transition-colors',
              // `mine` is a live user-state, so it wears the brand pair — the same law the saved
              // heart and a pending offer follow (docs/design-language.md §5).
              r.mine
                ? 'border-brand/40 bg-primary/10 text-brand'
                : 'border-border bg-tint text-body hover:bg-muted',
            )}
          >
            <span aria-hidden="true" className="text-sm leading-none">{r.emoji}</span>
            {/* One reaction needs no "1" beside it — the glyph already says it. */}
            {r.count > 1 && <span aria-hidden="true">{r.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The reaction bar: the top five plus everything behind "＋". Nothing at rest.
 *
 * ⛔ THERE IS NO RESTING CONTROL, BY INSTRUCTION. Owner, 2026-08-16, on the outline heart that used
 * to live here: "remove this overall only reveal emojis on hover and long press or on press on
 * mobile". It is revealed by hovering the message on a pointer device and by long-pressing it on a
 * touch one — the message itself is the affordance, which is also why the touch target is the whole
 * bubble rather than a 24px circle.
 *
 * ⚠️ THE COST, ACCEPTED: nothing on screen advertises that reactions exist. On desktop hover finds
 * it by accident, but a phone user who never long-presses a message will never discover the
 * feature. That is the owner's call and it is the same bet iMessage makes.
 *
 * ⚠️ `measuredTop` IS THE GLOBAL TALLY and may be empty for weeks — `topReactions()` tops it up
 * from the fallback set so the bar is always five wide. See src/lib/reactions.ts.
 */
export function ReactionPicker({
  onPick,
  measuredTop = [],
  open,
  onOpenChange,
  align = 'start',
}: {
  onPick: (emoji: string) => void
  measuredTop?: readonly string[]
  /** Controlled so a long-press can open the same bar a hover does. */
  open: boolean
  onOpenChange: (open: boolean) => void
  align?: 'start' | 'end'
}) {
  const { tr } = useLanguage()
  const [allOpen, setAllOpen] = React.useState(false)
  const [hovered, setHovered] = React.useState<string | null>(null)
  const root = React.useRef<HTMLDivElement | null>(null)
  const top = React.useMemo(() => topReactions(measuredTop), [measuredTop])

  /**
   * ⛔ A TOUCH USER COULD NOT CLOSE THE BAR. Reviewer-caught, and it was the worst of the three:
   * long-press opens it, but every dismissal path was gated on `pointerType === 'mouse'`, and there
   * is no backdrop — so on a phone the bar stayed open over the thread until an emoji was tapped.
   * The only way out was to react, which is precisely the trap a reaction picker must not be.
   *
   * ⚠️ Listens in the CAPTURE phase, so a tap on a message bubble underneath dismisses the bar
   * rather than being swallowed by it, and `pointerdown` rather than `click` so the bar is gone
   * before the underlying element acts on the same gesture.
   */
  React.useEffect(() => {
    if (!open || allOpen) return
    function onOutside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node | null)) onOpenChange(false)
    }
    document.addEventListener('pointerdown', onOutside, true)
    return () => document.removeEventListener('pointerdown', onOutside, true)
  }, [open, allOpen, onOpenChange])

  function pick(emoji: string) {
    hapticTap()
    onPick(emoji)
    setAllOpen(false)
    onOpenChange(false)
  }

  return (
    <div
      ref={root}
      className="relative flex items-center"
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') onOpenChange(true) }}
      /**
       * ⛔ KEYBOARD PARITY. Reviewer-caught: opening was wired to pointerenter and long-press only,
       * so a keyboard user could tab to the heart and press it — and that was the entire feature.
       * Focus entering the group opens the bar exactly as hover does, and focus leaving it closes,
       * which also gives the mouse path a way out when the pointer never technically "leaves".
       */
      onFocus={() => onOpenChange(true)}
      onBlur={(e) => {
        if (!allOpen && !e.currentTarget.contains(e.relatedTarget as Node | null)) onOpenChange(false)
      }}
      /* ⚠️ NO `onPointerLeave` — a survivor of the previous design that an earlier edit only
         half-removed. The message row owns hover now, and this wrapper collapsed to 0×0 when the
         resting heart went, so a leave firing off the absolutely-positioned bar would close it
         while the pointer was still on the message that opened it. */
    >

      {/**
        * ⛔ A FOCUSABLE OPENER THAT IS INVISIBLE UNTIL FOCUSED. Removing the resting heart removed
        * the ONLY focusable element in this control — both reviewers caught that a keyboard or
        * screen-reader user was then left with no way to reach reactions at all, because the bar
        * below is `aria-hidden` and `tabIndex={-1}` while closed, and hover and long-press are both
        * unavailable to them.
        *
        * `sr-only` keeps it out of the layout and off the screen exactly as the owner asked, while
        * `focus:not-sr-only` materialises it the moment it is tabbed to — the same pattern a skip
        * link uses. Nothing is drawn at rest, and nobody is locked out.
        */}
      <button
        type="button"
        onClick={() => pick(top[0])}
        onFocus={() => onOpenChange(true)}
        /* ⚠️ NAMES THE ACTION, NOT JUST THE GLYPH. Reviewer-caught: "Heart, button" does not tell
           anyone what pressing it does. `top` is never empty — topReactions() tops up from
           DEFAULT_TOP_REACTIONS and a unit test asserts a full bar — so top[0] is always a
           catalogue member. */
        aria-label={tr(`React with ${reactionFor(top[0])?.label ?? top[0]}`, `Bày tỏ ${reactionFor(top[0])?.labelVi ?? top[0]}`)}
        className={cn(
          'press flex size-5 items-center justify-center rounded-full text-xs leading-none transition-[opacity,filter,scale] duration-200 ease-out',
          // ⛔ "OUTLINED" FOR AN EMOJI MEANS DESATURATED, NOT A STROKE. Owner: "user can use quick
          // outlined frequent used 1 emoji". There is no outline form of a colour emoji glyph, and
          // the previous attempt at this used a Heart ICON — which cannot represent whichever emoji
          // the tally says is most used. Greyscale at low opacity reads as the same "available but
          // not yet used" state, works for any glyph, and costs nothing to render.
          // ⚠️ ONE opacity CLASS, NOT TWO. Written first as a conditional `opacity-0/100` PLUS a
          // base `opacity-45`, which twMerge collapses to whichever came last — so the resting
          // glyph would never have hidden when the bar opened, and would have sat under it.
          'grayscale-[0.9] hover:grayscale-0 hover:scale-125',
          // ⚠️ STAYS VISIBLE WHILE FOCUSED. Reviewer-caught: tabbing here opens the bar, and the
          // `open` branch then set opacity-0 on the very control holding focus — so a keyboard user
          // lost the focus ring at the exact moment they opened it.
          open ? 'pointer-events-none opacity-0 focus-visible:pointer-events-auto focus-visible:opacity-100' : 'opacity-45 hover:opacity-100',
        )}
      >
        <span aria-hidden="true">{top[0]}</span>
      </button>

      {/* ON HOVER / LONG-PRESS: the top five plus the door to the rest. `aria-hidden` and
          `pointer-events-none` when closed so a collapsed bar is neither tabbable nor clickable —
          a hidden-by-opacity control that still takes clicks is a classic invisible tap target. */}
      <div
        aria-hidden={!open}
        className={cn(
          // ⚠️ THE BAR FLIPS SIDES WITH THE BUBBLE. It was hardcoded `left-8` — 32px right of the
          // resting heart that used to anchor it — which put ~200px of bar to the RIGHT of a
          // control already at the screen edge on an outgoing message. With the heart gone the
          // anchor is a zero-width point, so the bar hangs off the row edge and `align` picks which.
          // ⛔ ABOVE THE BUBBLE, NOT BESIDE IT. Owner: "on desktop only on hover above the bubble
          // not outside open more options". `bottom-full` lifts the bar over the message it belongs
          // to, so it reads as attached to that bubble instead of floating in the gutter — which is
          // also what the Zalo reference does. `align` still picks the side so it cannot run off a
          // right-aligned outgoing message.
          'absolute bottom-full z-20 mb-1 flex items-center gap-0.5 rounded-full border border-border bg-popover p-1 shadow-pop ring-1 ring-foreground/10 transition-[opacity,scale,translate] duration-200',
          align === 'end' ? 'right-0 origin-bottom-right' : 'left-0 origin-bottom-left',
          // ⚠️ It RISES as it appears — translate plus scale, not opacity alone. A bar that only
          // fades in reads as a tooltip; one that lifts off the bubble reads as belonging to it.
          open
            ? 'pointer-events-auto translate-y-0 scale-100 opacity-100'
            : 'pointer-events-none translate-y-1 scale-90 opacity-0',
        )}
        style={{ transitionTimingFunction: 'var(--ease-spring)' }}
      >
        {top.map((emoji) => {
          const entry = reactionFor(emoji)
          return (
            <button
              key={emoji}
              type="button"
              tabIndex={open ? 0 : -1}
              onClick={() => pick(emoji)}
              onPointerEnter={() => setHovered(emoji)}
              onPointerLeave={() => setHovered((h) => (h === emoji ? null : h))}
              onFocus={() => setHovered(emoji)}
              onBlur={() => setHovered((h) => (h === emoji ? null : h))}
              aria-label={entry ? tr(entry.label, entry.labelVi) : emoji}
              className="press flex size-8 items-center justify-center rounded-full transition-[scale,background-color] duration-150 hover:scale-[1.35] hover:bg-tint focus-visible:scale-[1.35]"
              // ⛔ NO transitionDelay HERE, THOUGH A STAGGER WAS TRIED. An inline delay keyed on
              // `open` stays applied for as long as the bar is open, so it does not only stagger the
              // entrance — it delays every subsequent hover scale by up to 80ms on the last glyph,
              // making the bar feel laggy exactly while being used. Reviewer-caught. The bar's own
              // rise-and-scale already reads as motion; a stagger is not worth a sticky hover.
            >
              {/* Animates only while pointed at: at most one player runs at a time. */}
              <LottieEmoji emoji={emoji} play={open && hovered === emoji} size={22} />
            </button>
          )
        })}

        {/* ⚠️ CLOSING THE GRID MUST ALSO RETIRE THE BAR. Reviewer-caught: the pointer-leave guard
            below deliberately ignores a leave while `allOpen` is true (so moving the mouse from the
            bar INTO the popover does not dismiss both). But that means dismissing the popover with
            an outside click, once the pointer has already wandered off the bar, leaves the bar
            stranded open with no pointer over it and no event coming to close it. */}
        <Popover
          open={allOpen}
          onOpenChange={(next) => {
            setAllOpen(next)
            if (!next) onOpenChange(false)
          }}
        >
          <PopoverTrigger
            render={
              <button
                type="button"
                tabIndex={open ? 0 : -1}
                aria-label={tr('More reactions', 'Thêm biểu cảm')}
                className="press flex size-8 items-center justify-center rounded-full text-body transition-colors hover:bg-tint hover:text-foreground"
              >
                <Plus className="size-4" />
              </button>
            }
          />
          <PopoverContent align={align} side="top" className="w-[17.5rem] p-2">
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
let pendingPress: { timer: number; x: number; y: number } | null = null

function cancelPress() {
  if (pendingPress) window.clearTimeout(pendingPress.timer)
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
      pendingPress = {
        x: e.clientX,
        y: e.clientY,
        timer: window.setTimeout(() => {
          hapticTap(18)
          onLongPress()
          pendingPress = null
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
