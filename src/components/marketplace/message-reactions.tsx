'use client'

import * as React from 'react'

import { useLanguage } from '@/context/language-context'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Plus } from '@/components/ui/icons'
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
 * The affordance beside a bubble: a heart at rest, the top five on hover, everything behind "＋".
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
  const top = React.useMemo(() => topReactions(measuredTop), [measuredTop])

  function pick(emoji: string) {
    hapticTap()
    onPick(emoji)
    setAllOpen(false)
    onOpenChange(false)
  }

  return (
    <div
      className="relative flex items-center"
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') onOpenChange(true) }}
      onPointerLeave={(e) => {
        // ⚠️ Only the POINTER leaving closes it, and only when the full grid is not open — otherwise
        // moving the mouse from the bar into the popover it just opened would close both.
        if (e.pointerType === 'mouse' && !allOpen) onOpenChange(false)
      }}
    >
      {/* AT REST: one heart. Owner's words, and the whole point of the design — the common case is
          a single tap on a single emoji, and it must not require a hover, a menu or a decision. */}
      <button
        type="button"
        onClick={() => pick(PRIMARY_REACTION)}
        aria-label={tr('React with love', 'Thả tim')}
        className="press tap-44 flex size-7 items-center justify-center rounded-full border border-border bg-card text-sm shadow-pop transition-colors hover:bg-tint"
      >
        <span aria-hidden="true">{PRIMARY_REACTION}</span>
      </button>

      {/* ON HOVER / LONG-PRESS: the top five plus the door to the rest. `aria-hidden` and
          `pointer-events-none` when closed so a collapsed bar is neither tabbable nor clickable —
          a hidden-by-opacity control that still takes clicks is a classic invisible tap target. */}
      <div
        aria-hidden={!open}
        className={cn(
          'absolute left-8 z-10 flex items-center gap-0.5 rounded-full border border-border bg-popover p-1 shadow-pop ring-1 ring-foreground/10 transition-[opacity,scale] duration-150 ease-out',
          open ? 'pointer-events-auto scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0',
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
              className="press flex size-8 items-center justify-center rounded-full transition-transform hover:scale-125 focus-visible:scale-125"
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
export function useLongPress(onLongPress: () => void) {
  const timer = React.useRef<number | null>(null)
  const origin = React.useRef<{ x: number; y: number } | null>(null)

  const clear = React.useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    origin.current = null
  }, [])

  // Any unmount mid-press must not leave a timer that fires into a dead component.
  React.useEffect(() => clear, [clear])

  return {
    onPointerDown: (e: React.PointerEvent) => {
      // Mouse users have hover; a long mouse-press would fight click-to-select.
      if (e.pointerType === 'mouse') return
      origin.current = { x: e.clientX, y: e.clientY }
      timer.current = window.setTimeout(() => {
        hapticTap(18)
        onLongPress()
        clear()
      }, LONG_PRESS_MS)
    },
    onPointerMove: (e: React.PointerEvent) => {
      const start = origin.current
      if (!start) return
      if (Math.abs(e.clientX - start.x) > PRESS_SLOP_PX || Math.abs(e.clientY - start.y) > PRESS_SLOP_PX) clear()
    },
    onPointerUp: clear,
    onPointerCancel: clear,
  }
}
