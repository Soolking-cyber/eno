'use client'

import { fillTemplate } from '@/lib/i18n/placeholders'
import * as React from 'react'

import { useLanguage } from '@/context/language-context'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Copy, Trash2, Flag, Undo2, Heart } from '@/components/ui/icons'
import { LottieEmoji } from '@/components/marketplace/lottie-emoji'
import { hapticLongPress, hapticSelection, hapticTap } from '@/lib/haptics'
import { prefersReducedMotion } from '@/lib/reduced-motion'
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

/** The desktop pill keeps this far inside the thread column's edge. */
const EDGE_GAP_PX = 8
/** A double-click's second click arrives within this (macOS default ≈ 500ms). */
const DOUBLE_CLICK_MS = 500

/**
 * The horizontal span the element can actually be seen in: the viewport, narrowed by every ancestor that clips sideways
 * (the thread's scroller is one — `overflow-y: auto` computes `overflow-x` to auto as well).
 */
function clipAncestors(from: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = []
  for (let n = from.parentElement; n; n = n.parentElement) if (getComputedStyle(n).overflowX !== 'visible') out.push(n)
  return out
}

function clipEdges(from: HTMLElement): [number, number] {
  let min = 0
  let max = document.documentElement.clientWidth
  for (const n of clipAncestors(from)) {
    // The padding box, NOT the border box (commit gate, opus): a classic scrollbar (Windows) sits inside the border box,
    // and a pill clamped to it would hide its last emoji under the scrollbar.
    const left = n.getBoundingClientRect().left + n.clientLeft
    min = Math.max(min, left)
    max = Math.min(max, left + n.clientWidth)
  }
  return [min, max]
}

/** Long enough not to fire while scrolling, short enough not to feel broken. Matches iOS. */
const LONG_PRESS_MS = 450
/** A finger that travels this far was scrolling, not pressing. */
const PRESS_SLOP_PX = 10

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
 * THE REACTION BADGE — ONE PILL ON THE BUBBLE'S CORNER, THE MESSENGER WAY.
 *
 * ⛔ OWNER, 2026-11-27, REPLACING THE 2026-08 "TALLIES ON THE GLYPH'S LINE" DESIGN: "in messages the like system is janky
 * and ugly currently lets implement this type of system where like stay in place not next to similar to fb messenger one
 * smooth and nice intergration with all haptics", with a Messenger screenshot: the reaction sits IN ONE PILL hanging off
 * the bubble's bottom corner (a light pill with a ring the colour of the page), never strung beside a resting heart.
 *
 *   · ON THE INNER CORNER: bottom-right of an incoming bubble (the screenshot), bottom-left of an outgoing one, so it
 *     never sits against the screen edge. It overlaps the bubble's edge by 8px and hangs 16px below it (the row's pb-4).
 *   · Up to three emoji (the server sorts by count), then the TOTAL when more than one person reacted.
 *   · Pressing it opens the same picker a long-press does (with the ✕ to take yours back) — one way to change a reaction.
 *   · When the reactions change, the pill pops (`.reaction-pop`) and the emoji that was just added plays its animation
 *     ONCE — the owner's 2026-08-16 "play animation when emoji pressed" kept, for whoever added it. One player at a time.
 * ⚠️ PLAIN UNICODE AT REST (the perf rule in the header): LottieEmoji paints the character and only plays on change.
 */
/** When a badge last started an emoji animation, thread-wide; see ReactionBadge's effect. */
let lastBadgePlayAt = 0
const BADGE_PLAY_GAP_MS = 600

export function ReactionBadge({
  reactions,
  align,
  onOpen,
}: {
  reactions: MessageReaction[]
  /** Which side of the thread the bubble sits on: 'start' = theirs (badge bottom-right), 'end' = mine (bottom-left). */
  align: 'start' | 'end'
  /** Opens the picker for this message. */
  onOpen: () => void
}) {
  const { tr } = useLanguage()
  const total = reactions.reduce((n, r) => n + r.count, 0)
  const sig = reactions.map((r) => `${r.emoji}:${r.count}`).join(',')
  // The counts as last seen, to tell which emoji just ARRIVED (or grew) — that one plays. Never on first paint: a thread
  // opening on fifty reacted messages must not light up like a slot machine.
  const seen = React.useRef<Map<string, number> | null>(null)
  const [pop, setPop] = React.useState(0)
  /**
   * THE POP REPLAYS IN PLACE. Re-keying the button to restart the animation unmounted it, and a keyboard user resting on
   * the badge lost focus to <body> whenever the other side reacted (commit gate, opus). The class is taken off, the box
   * reflowed, and the class put back: the same node, the animation from frame one. Never on first paint.
   */
  const popEl = React.useRef<HTMLButtonElement | null>(null)
  React.useEffect(() => {
    const el = popEl.current
    if (!pop || !el) return
    el.classList.remove('reaction-pop')
    void el.offsetWidth
    el.classList.add('reaction-pop')
  }, [pop])
  const [playing, setPlaying] = React.useState<string | null>(null)
  const playTimer = React.useRef<number | null>(null)
  React.useEffect(() => () => { if (playTimer.current !== null) window.clearTimeout(playTimer.current) }, [])
  React.useEffect(() => {
    const now = new Map(reactions.map((r) => [r.emoji, r.count] as const))
    const before = seen.current
    seen.current = now
    if (!before) return
    const grew = reactions.find((r) => r.count > (before.get(r.emoji) ?? 0))
    if (!grew) return
    setPop((n) => n + 1)
    // ONE PLAYER ACROSS THE THREAD (commit gate, opus): a reconnect that brings reactions on many messages at once pops
    // every badge (cheap CSS) but animates only the first emoji — dozens of concurrent Lottie players is the
    // dropped-frames machine the header warns about.
    const at = Date.now()
    if (at - lastBadgePlayAt < BADGE_PLAY_GAP_MS) return
    lastBadgePlayAt = at
    if (playTimer.current !== null) window.clearTimeout(playTimer.current)
    setPlaying(grew.emoji)
    // Long enough for the longest animation in the pack; the player never outlives a thread scrolled past.
    playTimer.current = window.setTimeout(() => { playTimer.current = null; setPlaying(null) }, 2000)
  }, [sig])

  if (!total) return null
  const shown = reactions.slice(0, 3)
  // Spoken: each reaction by name, YOURS marked (the old per-emoji aria-pressed said that), and what pressing does.
  const yours = tr('yours', 'của bạn')
  const names = reactions.map((r) => {
    const e = reactionFor(r.emoji)
    const n = `${e ? tr(e.label, e.labelVi) : r.emoji}${r.count > 1 ? ` ${r.count}` : ''}`
    return r.mine ? `${n} (${yours})` : n
  }).join(', ')
  const mine = reactions.some((r) => r.mine)
  return (
    <button
      ref={popEl}
      type="button"
      onClick={onOpen}
      aria-label={mine
        ? fillTemplate(tr('Reactions: {list}. Change your reaction', 'Biểu cảm: {list}. Đổi biểu cảm của bạn'), 'Reactions: {list}. Change your reaction', { list: names })
        : fillTemplate(tr('Reactions: {list}. Add yours', 'Biểu cảm: {list}. Thêm biểu cảm của bạn'), 'Reactions: {list}. Add yours', { list: names })}
      className={cn(
        // -bottom-4 on a 24px pill: 8px over the bubble — inside its own bottom padding, never over its text, its time
        // or a card's buttons (commit gate, opus) — and 16px below, which the row's pb-4 holds.
        'press pointer-events-auto absolute -bottom-4 z-10 flex h-6 items-center gap-px rounded-full bg-tint px-1 shadow-sm ring-2 ring-background',
        /**
         * ⛔ IT GROWS TOWARD THE MIDDLE OF THE THREAD, NEVER TOWARD THE SCREEN EDGE (commit gate, opus). Pinned `left-2` on a
         * short outgoing "Ok" against the right wall, a two-emoji badge grew rightward past the bubble and off the screen.
         * So its INNER end sits 2rem in from the bubble's inner corner and it extends from there toward the centre: one
         * emoji rests on the corner, more spill into the open middle.
         */
        align === 'end' ? 'right-[calc(100%-2rem)] origin-bottom-right' : 'left-[calc(100%-2rem)] origin-bottom-left',
      )}
    >
      {shown.map((r) => <LottieEmoji key={r.emoji} emoji={r.emoji} play={playing === r.emoji} size={16} />)}
      {/* One reaction needs no "1" — the glyph already says it. */}
      {total > 1 && <span aria-hidden="true" className="pl-0.5 pr-0.5 text-2xs font-semibold tabular-nums text-body">{total}</span>}
    </button>
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
  /** The reactions, drawn as one badge on the bubble's inner bottom corner (ReactionBadge). */
  reactions: MessageReaction[]
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
  const reactButton = React.useRef<HTMLButtonElement | null>(null)
  const toolbar = React.useRef<HTMLDivElement | null>(null)
  /** Px the desktop pill is slid sideways to stay inside the thread column — see the toolbar's note. */
  const [nudge, setNudge] = React.useState(0)
  const top = React.useMemo(() => topReactions(measuredTop), [measuredTop])

  /**
   * ⛔ THE BAR OPENS ON A CLICK OF React, NEVER ON A HOVER (2026-11-27). The hover-with-delay opening belonged to the faded
   * heart on every bubble (owner 2026-08-16, "meaningful delays"), removed the same day for Messenger — whose desktop React
   * button opens its picker on a click. With the bar swapping in where the toolbar stood, a hover-open put an emoji under a
   * hand that was on its way to Reply or about to click React, and each guard against that found a new hole (commit gate,
   * opus, rounds 3–5). The TOOLBAR still waits for a settled hover (the thread's 500ms, page.tsx); the bar answers a click.
   */

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
    /**
     * ⛔ SKIPPED ENTIRELY ON TOUCH, AND THIS IS THE FIX FOR "EMOJI DON'T WORK ON CHROME".
     *
     * On coarse pointers the bar lives inside a Base UI Popover, which PORTALS to the end of
     * <body>. `root.current.contains(target)` therefore answers FALSE for the bar's own emoji
     * buttons — they are not DOM descendants of this component any more. So this listener treated
     * a tap on an emoji as an OUTSIDE press and closed the bar on `pointerdown`, before the
     * `click` that calls pick() could fire. Long-press opened the bar and every tap inside it
     * dismissed it instead of reacting, which is exactly what was reported.
     *
     * ⚠️ IT WAS CORRECT WHEN WRITTEN AND THE PORTAL BROKE IT. The containment check predates the
     * Popover migration, when the touch bar was a plain descendant. That is the hazard with a
     * hand-rolled outside-press check: it does not fail loudly when the tree moves under it.
     *
     * ⚠️ NOTHING IS LOST BY SKIPPING IT — Base UI's Popover already dismisses on an outside press,
     * and it knows about its own portal. The mouse path keeps this listener because that bar is
     * still a DOM descendant and has no popup to do the job.
     */
    if (coarse) return
    function onOutside(event: PointerEvent) {
      // A pointer at work anywhere is not a keyboard (commit gate, opus): the flag must not pull focus back to React and
      // reopen the toolbar after a click elsewhere closed it.
      keyboardFocusIn.current = false
      if (root.current?.contains(event.target as Node | null)) return
      onBarOpenChange(false)
      onActionsOpenChange(false)
      onLockChange?.(false)
    }
    document.addEventListener('pointerdown', onOutside, true)
    return () => document.removeEventListener('pointerdown', onOutside, true)
  }, [barOpen, actionsOpen, allOpen, coarse, onBarOpenChange, onActionsOpenChange])

  function pick(emoji: string) {
    hapticTap()
    // A KEYBOARD pick must not leave focus on a button that is fading out (commit gate, opus): it goes back to React,
    // which reopens the toolbar around it. A mouse or a finger leaves focus where it was — the toolbar just closes.
    const active = document.activeElement as HTMLElement | null
    let keyboard = false
    // `:focus-visible` in matches() throws on a browser that predates it: then it is simply not a keyboard pick.
    try { keyboard = !!active?.matches(':focus-visible') } catch { keyboard = false }
    if (!coarse && active && root.current?.contains(active) && keyboard && keyboardFocusIn.current) {
      window.setTimeout(() => reactButton.current?.focus(), 0)
    }
    // The badge plays the emoji that landed (ReactionBadge watches the counts) — nothing to hand over here.
    onPick(emoji)
    setAllOpen(false)
    onLockChange?.(false)
    onBarOpenChange(false)
    /**
     * ⛔ CLOSE THE QUICK ACTIONS TOO — WITHOUT THIS THE CARD DOES NOT GO AWAY, IT SHRINKS. Owner,
     * 2026-08-18: "when i select emoji from bar it fires second round of quick action tools reply
     * copy and delete". The popup is open on `barOpen || actionsOpen`; picking an emoji cleared
     * only the first, so the emoji row unmounted and the reply/copy/delete row was left floating
     * over the thread on its own. It reads as a NEW menu appearing in response to the tap, which is
     * exactly backwards — the tap was the user finishing.
     * A long press opens both, so anything that completes the interaction has to close both.
     */
    onActionsOpenChange(false)
  }

  React.useEffect(() => () => onLockChange?.(false), [onLockChange])
  // A pinned bar that closes by any route (a pick, the ✕, Escape, the thread) releases the pin with it.
  const wasOpen = React.useRef(barOpen)
  React.useEffect(() => {
    if (wasOpen.current && !barOpen && !allOpen) onLockChange?.(false)
    wasOpen.current = barOpen
  }, [barOpen, allOpen, onLockChange])

  /**
   * ⛔ THE LIFT OF THE LONG-PRESS IS NOT A TAP OUTSIDE THE CARD. Measured 2026-11-27 (Playwright, touch): the card was
   * open while the finger was held and GONE the moment it lifted — Base UI dismisses a touch popup on the release, and the
   * release of the very press that opened it counted as an outside press. So the card is only dismissed by a press that
   * STARTED after it opened: a fresh pointerdown anywhere marks one, and an outside press without it is the opening
   * gesture ending, which is ignored.
   */
  /**
   * THE TOUCH CARD'S ANCHOR: THE PART OF THE BUBBLE ON SCREEN (commit gate, opus). Anchored to the whole bubble, a message
   * taller than the screen and scrolled half away put the card above its top edge — off screen, with only the haptic to
   * say anything happened. Clamping the anchor to the viewport keeps the card next to what the finger is on.
   */
  const visibleBubble = React.useCallback(() => {
    const el = root.current
    if (!el) return null
    return {
      contextElement: el,
      getBoundingClientRect: () => {
        const r = el.getBoundingClientRect()
        // The VISUAL viewport: with the iOS keyboard up it is shorter than the layout one and may be offset within it.
        const vv = window.visualViewport
        const vTop = vv?.offsetTop ?? 0
        const vBottom = vTop + (vv?.height ?? window.innerHeight)
        const top = Math.min(Math.max(r.top, vTop), vBottom)
        const bottom = Math.max(Math.min(r.bottom, vBottom), top)
        return { x: r.left, y: top, left: r.left, right: r.right, width: r.width, top, bottom, height: bottom - top }
      },
    }
  }, [])
  const touchCardOpen = coarse && (barOpen || actionsOpen)
  const pressedSinceOpen = React.useRef(false)
  React.useEffect(() => {
    if (!touchCardOpen) return
    pressedSinceOpen.current = false
    const mark = () => { pressedSinceOpen.current = true }
    document.addEventListener('pointerdown', mark, true)
    return () => document.removeEventListener('pointerdown', mark, true)
  }, [touchCardOpen])

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

  /**
   * THE DESKTOP PILL STAYS INSIDE THE THREAD COLUMN. Measured from layout (offsetLeft/offsetWidth ignore the open
   * animation's scale) before paint, again whenever its content changes (toolbar ↔ bar, the ✕ coming and going) and on
   * resize. The pill is slid, never shrunk: every emoji stays a whole target.
   */
  const toolbarShown = !coarse && (barOpen || actionsOpen)
  React.useLayoutEffect(() => {
    if (!toolbarShown) return
    const fit = () => {
      const el = toolbar.current
      const base = root.current
      if (!el || !base) return
      const left = base.getBoundingClientRect().left + el.offsetLeft
      const right = left + el.offsetWidth
      const [min, max] = clipEdges(base)
      const lo = min + EDGE_GAP_PX
      const hi = max - EDGE_GAP_PX
      // Too wide for the column: its start edge wins, the end clips (never at 1366+, where the column is ≥ 500px).
      setNudge(left < lo || right - left > hi - lo ? lo - left : right > hi ? hi - right : 0)
    }
    fit()
    window.addEventListener('resize', fit)
    // The column can change width without the window doing so (the conversation list collapsing, a scrollbar appearing).
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit)
    if (root.current) for (const n of clipAncestors(root.current)) ro?.observe(n)
    return () => { window.removeEventListener('resize', fit); ro?.disconnect() }
  }, [toolbarShown, barOpen, myReaction, actionList.length, align, top.length])

  /**
   * ⛔ A CLICK THAT OPENS THE BAR LEAVES NO HIGHLIGHT IN THIS MESSAGE (owner 2026-11-27, desktop: the outgoing bubble's whole
   * text stood selected in blue under the bar). A click on React or the badge is a reaction, not a copy, so a selection
   * held inside this message's own box goes — never one elsewhere (the composer, another message).
   * ⚠️ Only the click's: a selection made in another message, or in the composer, is someone else's business.
   */
  const clearSelectionHere = () => {
    const host = root.current?.parentElement
    const sel = window.getSelection()
    if (!host || !sel || sel.isCollapsed) return
    if ((sel.anchorNode && host.contains(sel.anchorNode)) || (sel.focusNode && host.contains(sel.focusNode))) sel.removeAllRanges()
  }

  /**
   * ⚠️ KEYBOARD FOCUS SURVIVES THE SWAP (commit gate, opus). Toolbar ↔ bar unmounts whichever buttons hold focus — a ✕
   * pressed with Enter, or an emoji picked with Enter — and focus would fall to <body>. When it was
   * a keyboard's focus that fell, it lands on the bar's first emoji or back on React. A mouse's focus is left alone: after a
   * click the toolbar is meant to just close.
   */
  const keyboardFocusIn = React.useRef(false)
  const blurTimer = React.useRef<number | null>(null)
  React.useEffect(() => () => { if (blurTimer.current !== null) window.clearTimeout(blurTimer.current) }, [])

  /**
   * ⛔ A DOUBLE-CLICK ON React NEVER POSTS A REACTION (commit gate, opus). The first click opens the bar and the swap puts an
   * emoji (or the ✕) where React stood, so the second click would land on it — a reaction the other person sees and nobody
   * picked. Clicks where React stood are swallowed for a double-click's length, or until the pointer leaves that spot.
   */
  const openedUnder = React.useRef<{ rect: DOMRect; until: number } | null>(null)
  // The bar's buttons unmount when it closes, so a pointerleave never clears the one last pointed at (commit gate, opus):
  // without this it would start animating the next time the bar opens.
  React.useEffect(() => { if (!barOpen) { openedUnder.current = null; setHovered(null) } }, [barOpen])
  const inRect = (r: DOMRect, e: { clientX: number; clientY: number }) =>
    e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
  React.useLayoutEffect(() => {
    if (coarse || !keyboardFocusIn.current) return
    const active = document.activeElement
    if (active && active !== document.body) return
    const target = barOpen ? toolbar.current?.querySelector<HTMLElement>('[data-reaction]') : reactButton.current
    target?.focus()
  }, [barOpen, coarse])

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
      // Reachable whenever its toolbar shows — on desktop that is also while the bar stands on it. Hidden from assistive
      // tech otherwise, per button: aria-hidden on a `display: contents` wrapper is not honoured everywhere (commit gate).
      tabIndex={actionsOpen || (!coarse && barOpen) ? 0 : -1}
      aria-hidden={actionsOpen || (!coarse && barOpen) ? undefined : true}
      onClick={() => { hapticTap(); onActionsOpenChange(false); onBarOpenChange(false); a.run() }}
      aria-label={a.label}
      title={a.label}
      className={cn(
        /**
         * ⚠️ `flex-1` + A LEFT HAIRLINE ON EVERY BUTTON BUT THE FIRST — this is the "line between"
         * the owner asked for, and it is drawn by the BUTTONS rather than by separator elements on
         * purpose: a `<div role="separator">` between flex children is one more focusable-adjacent
         * node in a row that is already keyboard-navigated, and it would need its own margin maths
         * to line up with `items-stretch`. A border on the child is exactly as tall as the child.
         * ⚠️ `first:border-l-0` NOT `:not(:first-child)` — Tailwind emits the variant, and the
         * negation form loses to the base `border-l` on specificity ties.
         *
         * ⚠️ ON TOUCH THE BUTTON GROWS TO 44px TALL. Same reasoning as the emoji row above: this is
         * where Delete lives, and a 28px target next to Copy is how a message gets deleted by
         * accident. Width comes from flex-1, so only the height is set.
         */
        'press flex items-center justify-center rounded-xl transition-colors',
        coarse ? 'h-11 flex-1 border-l border-border/60 first:border-l-0 rounded-none first:rounded-l-xl last:rounded-r-xl' : 'size-7',
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
            data-reaction=""
            tabIndex={barOpen ? 0 : -1}
            onClick={() => pick(emoji)}
            onPointerEnter={() => setHovered(emoji)}
            onPointerLeave={() => setHovered((h) => (h === emoji ? null : h))}
            onFocus={() => setHovered(emoji)}
            onBlur={() => setHovered((h) => (h === emoji ? null : h))}
            aria-label={entry ? tr(entry.label, entry.labelVi) : emoji}
            aria-pressed={myReaction === emoji}
            className={cn(
              /**
               * ⚠️ size-11 (44px) ON TOUCH, size-8 (32px) WITH A MOUSE — owner, 2026-08-18: "too
               * small bar make it large". 44px is not a round number picked for looks: it is the
               * Apple/Google minimum tap target and the same floor `tap-44` enforces elsewhere in
               * this app. A 32px emoji in a row of eight is a 32px target with 2px between
               * neighbours, which is how you tap 😂 and send ❤️.
               * The mouse row stays 32px: a cursor is precise, and a 44px row of eight is 350px of
               * chrome hanging off a bubble that may be 91px wide.
               */
              'press flex items-center justify-center rounded-full transition-[scale,background-color] duration-150 ease-spring-snappy hover:scale-[1.35] hover:bg-tint focus-visible:scale-[1.35]',
              coarse ? 'size-11' : 'size-8',
              myReaction === emoji && 'bg-primary/10',
            )}
            // ⛔ NO transitionDelay HERE, THOUGH A STAGGER WAS TRIED. An inline delay keyed on
            // the open state stays applied for as long as the bar is open, so it does not only
            // stagger the entrance — it delays every subsequent hover scale by up to 80ms on the
            // last glyph, making the bar feel laggy exactly while being used.
          >
            {/* Animates only while pointed at: at most one player runs at a time. */}
            <LottieEmoji emoji={emoji} play={barOpen && hovered === emoji} size={coarse ? 30 : 22} />
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
            // Closes the toolbar too, like a pick (commit gate, opus): the actions coming back under a double-clicking cursor
            // would put its second click on Copy or Delete.
            onClick={() => { hapticTap(); onRemove(myReaction); onBarOpenChange(false); onActionsOpenChange(false) }}
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
        * THE DESKTOP TOOLBAR — BESIDE THE BUBBLE, ON THE INNER SIDE: React first, then reply/copy/delete/report.
        * Owner 2026-08-16: "to the right of the bubble box if bubble is on the left and to the left of the bubble box if it
        * is on the right side". The INNER side in both cases, the only one with a gutter.
        *
        * ⛔ SINCE 2026-11-27 THE REACTION BAR OPENS FROM HERE, NOT FROM A HEART ON EVERY BUBBLE. The owner called the resting
        * heart beside each message "janky and ugly" and asked for Messenger, whose desktop shows a React button beside the
        * hovered message. The bar is a DOM DESCENDANT of this toolbar — the one rule that keeps it reachable with a mouse
        * (a portal fires `pointerleave` on the way to it and the bar closes under the cursor; history in git).
        *
        * ⚠️ THE STRIP BETWEEN THE BUBBLE AND THE TOOLBAR IS PART OF THE HOVER TARGET — the `before:` bridge spans the 8px
        * gap so the pointer never leaves this message's subtree on the way across.
        * ⚠️ VISIBLE WHILE THE BAR IS OPEN TOO, because the bar stands on it.
        * ⛔ MOUSE ONLY: a phone has no gutter (owner 2026-08-17); touch gets the long-press card below.
        */}
      {/**
        * ⛔ ONE PILL AT A TIME, KEPT INSIDE THE THREAD COLUMN (owner 2026-11-27, desktop: "what on earth is this"). The emoji
        * bar used to rise ABOVE this toolbar as a second pill: both stood stacked over the message above and its badge, and
        * beside a wide outgoing message the bar — growing toward the middle — ran under the conversation list, clipped to
        * 😂 😭 🤯. Now the toolbar BECOMES the bar in place (React folds away, the five emoji take the actions' seat), and
        * `nudge` pulls the pill back inside the nearest clipping ancestor (the thread scroller) whenever its content changes
        * — over the bubble's edge if the gutter is too narrow, which the owner allowed on 2026-08-16 ("let it cover the bubble").
        * ⚠️ `select-none`: a quick double or triple click on these buttons selected the bubble's whole text next to them.
        */}
      {!coarse && (
        <div
          ref={toolbar}
          onPointerMove={(e) => { const g = openedUnder.current; if (g && !inRect(g.rect, e)) openedUnder.current = null }}
          // A pointer at work here is not a keyboard (commit gate, opus): Safari does not focus a clicked button, so without
          // this a keyboard flag left from an earlier Tab would pull the toolbar back under a clicking mouse.
          onPointerDown={() => { keyboardFocusIn.current = false }}
          onClickCapture={(e) => {
            const g = openedUnder.current
            if (!g || e.detail === 0 || Date.now() > g.until || !inRect(g.rect, e)) return
            // Kept for the whole window, not one click (commit gate, opus): a triple-click's third click is as unaimed.
            e.stopPropagation()
            e.preventDefault()
          }}
          // ⛔ THE KEYBOARD WAY IN (commit gate, opus): the old heart was focusable on every bubble, and with it gone a
          // keyboard user could not add a first reaction. React is now always in the tab order; focusing it shows the
          // toolbar, and focus leaving this message closes it.
          onFocus={(e) => {
            // `:focus-visible` in matches() throws on a browser that predates it: then it is not a keyboard's focus.
            try { keyboardFocusIn.current = (e.target as HTMLElement).matches(':focus-visible') } catch { keyboardFocusIn.current = false }
            if (!actionsOpen) onActionsOpenChange(true)
          }}
          // Not while the "＋" grid is open: it is a portalled popup, so focus moving into it leaves this subtree.
          // Judged one task later: the toolbar ↔ bar swap blurs the button it unmounts, and the keyboard-focus effect puts the
          // focus back inside this message first — only focus that really left closes the pill.
          onBlur={(e) => {
            if (allOpen || root.current?.contains(e.relatedTarget as Node | null)) return
            if (blurTimer.current !== null) window.clearTimeout(blurTimer.current)
            blurTimer.current = window.setTimeout(() => {
              blurTimer.current = null
              if (root.current?.contains(document.activeElement)) return
              keyboardFocusIn.current = false
              onActionsOpenChange(false)
              onBarOpenChange(false)
            }, 0)
          }}
          className={cn(
            // One pill (owner 2026-08-16: "one pill … similar to bubble box"); open 200ms, close 100ms (the house contract).
            'absolute top-1/2 z-30 flex -translate-y-1/2 select-none items-center gap-0.5 rounded-2xl border border-border bg-popover p-0.5 shadow-pop transition-[opacity,scale,translate]',
            barOpen && 'rounded-full p-1 ring-1 ring-foreground/10',
            'before:absolute before:inset-y-0 before:w-3 before:content-[""]',
            align === 'end'
              ? 'right-full mr-2 origin-right before:left-full'
              : 'left-full ml-2 origin-left before:right-full',
            /**
             * ⚠️ A NARROW WINDOW WITH A MOUSE HAS NO GUTTER (commit gate, opus): beside a long message the toolbar — now the
             * only mouse way to a first reaction — ran off the screen. Below `sm` it stands ABOVE the bubble instead, its
             * bridge underneath, pinned to the bubble's OUTER edge (the one against the screen wall) and growing toward the
             * middle — so a short "Ok" against the wall and a long message both keep it on screen.
             */
            'max-sm:top-auto max-sm:bottom-full max-sm:mb-1.5 max-sm:translate-y-0 max-sm:before:inset-x-0 max-sm:before:inset-y-auto max-sm:before:top-full max-sm:before:h-2 max-sm:before:w-auto',
            align === 'end'
              ? 'max-sm:left-auto max-sm:right-0 max-sm:mr-0 max-sm:origin-bottom-right'
              : 'max-sm:right-auto max-sm:left-0 max-sm:ml-0 max-sm:origin-bottom-left',
            actionsOpen || barOpen
              ? 'pointer-events-auto translate-x-0 scale-100 opacity-100 duration-200'
              : cn('pointer-events-none scale-90 opacity-0 duration-100', align === 'end' ? 'translate-x-1' : '-translate-x-1'),
          )}
          // `transform`, not `translate`: the individual `translate` property carries the centring and the open slide (Tailwind
          // v4), and `transform` composes with it instead of replacing it. Not in the transition list: the pill lands placed.
          style={{ transitionTimingFunction: 'var(--ease-spring)', transform: nudge ? `translateX(${nudge}px)` : undefined }}
        >
          <button
            ref={reactButton}
            type="button"
            aria-label={tr('React', 'Bày tỏ cảm xúc')}
            aria-expanded={barOpen}
            // Out of the tab order while folded (commit gate, opus): Shift+Tab from the bar must not land on an invisible control.
            tabIndex={barOpen ? -1 : 0}
            title={tr('React', 'Bày tỏ cảm xúc')}
            // OPENS (see the click-only note above). It closes on a pick, the ✕, an outside press or the pointer leaving.
            // A KEYBOARD press (detail 0) carries focus into the bar, since React folds away while the bar is up.
            onClick={(e) => {
              clearSelectionHere()
              openedUnder.current = e.detail > 0 ? { rect: e.currentTarget.getBoundingClientRect(), until: Date.now() + DOUBLE_CLICK_MS } : null
              onBarOpenChange(true)
              if (e.detail === 0) window.requestAnimationFrame(() => toolbar.current?.querySelector<HTMLElement>('[data-reaction]')?.focus())
            }}
            /**
             * ⚠️ FOLDED AWAY, NOT UNMOUNTED, WHILE THE BAR IS UP: `sr-only` keeps it focusable, so the focus a click left on it
             * stays inside this toolbar (unmounting it would blur to <body>, and the blur handler would shut the bar it opened).
             * Open = the house grammar for a disclosure: aria-expanded turns the glyph bold, in the accent ink (globals.css).
             */
            className={barOpen ? 'sr-only' : 'press flex size-7 items-center justify-center rounded-xl text-body transition-colors hover:bg-tint hover:text-foreground'}
          >
            <Heart className="size-3.5" aria-hidden />
          </button>
          {barOpen ? barContent : actionButtons}
        </div>
      )}

      {/**
        * ⛔ TOUCH, WITHOUT A FINGER GESTURE (commit gate, opus): long-press and double-tap are pointer gestures, so VoiceOver /
        * TalkBack (whose double-tap is a click) and an iPad with a keyboard had no way to a FIRST reaction once the resting
        * heart was gone. This button is that way: in the accessibility tree always, on screen only while keyboard-focused,
        * and it opens the same card a long-press does.
        */}
      {coarse && (
        <button
          type="button"
          onClick={() => { hapticSelection(); onBarOpenChange(true); onActionsOpenChange(true) }}
          className={cn(
            'sr-only focus-visible:not-sr-only focus-visible:pointer-events-auto focus-visible:absolute focus-visible:-bottom-4 focus-visible:z-10 focus-visible:rounded-full focus-visible:bg-popover focus-visible:px-2 focus-visible:py-0.5 focus-visible:text-2xs focus-visible:font-semibold focus-visible:shadow-sm',
            align === 'end' ? 'focus-visible:right-2' : 'focus-visible:left-2',
          )}
        >
          {tr('React', 'Bày tỏ cảm xúc')}
        </button>
      )}

      {/* THE REACTIONS: one badge on the bubble's inner bottom corner (see ReactionBadge). Pressing it opens the picker. */}
      {/* ⚠️ WITH A MOUSE, A BADGE-OPENED BAR IS PINNED (commit gate, opus): the bar stands on the toolbar beside the bubble,
          and the diagonal from the badge to it crosses gutter no bridge covers — the thread's 160ms leave-close fired on the
          way. Locked like the "＋" grid: it closes on a pick, an outside press, or its own ✕, never on the pointer leaving. */}
      <ReactionBadge reactions={reactions} align={align} onOpen={() => { hapticSelection(); onBarOpenChange(true); if (coarse) onActionsOpenChange(false); else { clearSelectionHere(); onLockChange?.(true) } }} />

      {/**
        * TOUCH: THE LONG-PRESS CARD — emoji row over the quick actions, in a Base UI popup kept 12px inside the viewport.
        * ⚠️ ANCHORED TO THE BUBBLE'S VISIBLE PART (visibleBubble) since the resting heart it used to hang from is gone.
        * Base UI measures it like any element; the bar is wider than many bubbles, so only a viewport-aware positioner can
        * place it (the three failed CSS anchors before it are in git history).
        * ⚠️ `barOpen &&` and `actionsOpen &&` render each row only while it is open — a visible row with tabIndex -1 is a
        * control you can see and cannot reach.
        */}
      {coarse && (
        <Popover
          open={barOpen || actionsOpen}
          onOpenChange={(next, details) => {
            if (next) return
            if (details?.reason === 'outside-press' && !pressedSinceOpen.current) return
            onBarOpenChange(false); onActionsOpenChange(false)
          }}
        >
          <PopoverContent
            anchor={visibleBubble}
            side="top"
            align={align === 'end' ? 'end' : 'start'}
            sideOffset={6}
            collisionPadding={12}
            className="w-auto max-w-[calc(100vw-1.5rem)] gap-1.5 p-1.5"
          >
            {barOpen && (
              <div className="flex items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0">
                {barContent}
              </div>
            )}
            {actionList.length > 0 && actionsOpen && (
              // Full width, split by hairlines (owner 2026-08-18: "seed acros all lenght of bar with line between").
              <div className={cn('flex w-full items-stretch', barOpen && 'border-t border-border/60 pt-1.5')}>
                {actionButtons}
              </div>
            )}
          </PopoverContent>
        </Popover>
      )}
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

/**
 * DOUBLE-TAP ❤️ (owner 2026-11-27, Messenger: the one-tap heart that sat on every bubble is gone, and this is the quick
 * reaction that replaces it on a phone). Module state for the same reason as the press: a finger is singular.
 *   · `tap` is the touch in flight: set at pointerdown, dropped by movement past the slop or by the long-press firing.
 *   · `lastTap` is the previous clean tap; a second on the same bubble within DOUBLE_TAP_MS and DOUBLE_TAP_PX is the double.
 * ⛔ NEVER ON A CONTROL INSIDE THE BUBBLE: a link, a button (an offer's Accept, a card's Call) keeps its own taps.
 */
const DOUBLE_TAP_MS = 300
const DOUBLE_TAP_PX = 24
let tap: { x: number; y: number; el: HTMLElement } | null = null
let lastTap: { t: number; x: number; y: number; el: HTMLElement } | null = null
const INTERACTIVE = 'a,button,input,textarea,select,label,[role="button"],[role="link"],[contenteditable="true"]'

/**
 * ⚠️ A HELD BUBBLE SHOWS IT IS BEING HELD. Nothing moved for the 450ms before the long-press fired, so
 * on a phone a hold was indistinguishable from a stuck touch. Slow where the person is deciding, fast
 * where the system answers: the bubble eases to 0.97 over 330ms after a 120ms delay (so a scroll that
 * starts on a bubble never flashes it), and springs back in 160ms on every exit — fire, move, lift or
 * cancel all run through cancelPress(). `scale` is paint-only (no layout), inline styles are restored,
 * and reduced motion skips it (the haptic still answers).
 */
const PRESS_DOWN = 'scale 330ms var(--ease-spring) 120ms'
const PRESS_UP = 'scale 160ms var(--ease-spring-snappy)'
/**
 * The bubble's OWN inline scale/transition, saved once per element for the whole press → release
 * cycle. A second press inside the 200ms release window reuses the saved originals (and cancels the
 * pending restore) instead of saving PRESS_UP as if it were the bubble's own — which would have left
 * it on the bubble for good. No string comparison of `style.transition` is involved.
 */
const pressStyles = new WeakMap<HTMLElement, { scale: string; transition: string; restore?: number }>()

function pressDown(el: HTMLElement) {
  if (prefersReducedMotion()) return
  let saved = pressStyles.get(el)
  if (saved) window.clearTimeout(saved.restore)
  else pressStyles.set(el, (saved = { scale: el.style.scale, transition: el.style.transition }))
  el.style.transition = PRESS_DOWN
  el.style.scale = '0.97'
}

function pressUp(el: HTMLElement) {
  const saved = pressStyles.get(el)
  if (!saved) return
  el.style.transition = PRESS_UP
  el.style.scale = saved.scale
  window.clearTimeout(saved.restore)
  saved.restore = window.setTimeout(() => {
    el.style.transition = saved.transition
    pressStyles.delete(el)
  }, 200)
}

function cancelPress() {
  if (pendingPress) {
    window.clearTimeout(pendingPress.timer)
    const { el } = pendingPress
    el.style.userSelect = pendingPress.select
    el.style.setProperty('-webkit-user-select', pendingPress.select)
    el.style.setProperty('-webkit-touch-callout', pendingPress.callout)
    pressUp(el)
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

export function longPressHandlers(onLongPress: () => void, onDoubleTap?: () => void) {
  return {
    onPointerDown: (e: React.PointerEvent) => {
      // Mouse users have hover; a long mouse-press would fight click-to-select.
      if (e.pointerType === 'mouse') return
      cancelPress()
      const el = e.currentTarget as HTMLElement
      tap = (e.target as Element | null)?.closest?.(INTERACTIVE) ? null : { x: e.clientX, y: e.clientY, el }
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
      pressDown(el)
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
          // A held press is never also a tap.
          tap = null
          lastTap = null
          // The platform's own long-press texture: Android's system LONG_PRESS, the Taptic medium impact on iOS.
          hapticLongPress()
          onLongPress()
        }, LONG_PRESS_MS),
      }
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (tap && (Math.abs(e.clientX - tap.x) > PRESS_SLOP_PX || Math.abs(e.clientY - tap.y) > PRESS_SLOP_PX)) tap = null
      if (!pendingPress) return
      if (Math.abs(e.clientX - pendingPress.x) > PRESS_SLOP_PX || Math.abs(e.clientY - pendingPress.y) > PRESS_SLOP_PX) cancelPress()
    },
    onPointerUp: (e: React.PointerEvent) => {
      cancelPress()
      const t = tap
      tap = null
      if (e.pointerType === 'mouse' || !onDoubleTap || !t) { lastTap = null; return }
      const now = Date.now()
      if (lastTap && lastTap.el === t.el && now - lastTap.t <= DOUBLE_TAP_MS && Math.abs(t.x - lastTap.x) <= DOUBLE_TAP_PX && Math.abs(t.y - lastTap.y) <= DOUBLE_TAP_PX) {
        lastTap = null
        // A double-tap may also start a word selection on some Android builds: a heart, never a stray highlight. Only this
        // bubble's selection, never the composer's (the long-press rule).
        const sel = window.getSelection()
        if (sel && sel.anchorNode && t.el.contains(sel.anchorNode)) sel.removeAllRanges()
        hapticTap()
        onDoubleTap()
        return
      }
      lastTap = { t: now, x: t.x, y: t.y, el: t.el }
    },
    onPointerCancel: () => { tap = null; cancelPress() },
  }
}
