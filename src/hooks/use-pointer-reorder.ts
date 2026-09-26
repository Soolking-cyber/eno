'use client'

import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { haptic } from '@/lib/haptics'

// Pointer-based drag-to-reorder that works on BOTH touch and mouse (HTML5 native drag-and-drop
// fires no events on touch, so mobile couldn't rearrange). Bind the returned props to each
// draggable tile; once a drag is active, moving the pointer over another tile reorders live via
// `move(from, to)`.
//
// Touch/pen use a LONG-PRESS to start: tiles keep `touch-action: pan-y` so a normal swipe still
// SCROLLS the page (the old `touch-action: none` made the photo grid a scroll dead-zone), and a
// pre-lift move beyond a small tolerance is treated as that scroll — so brushing past a thumbnail
// never triggers an accidental reorder. After ~250ms held still the tile "lifts" (a haptic tick +
// the lifted visual). touch-action is only consulted at gesture START, so flipping it at lift
// would do nothing for the in-progress touch — instead a non-passive window `touchmove` listener
// preventDefault()s while lifted, which reliably blocks the scroll because the finger was held
// still through the long-press (the browser hasn't claimed the gesture for panning yet).
// Mouse has neither problem (the wheel scrolls regardless) so it drags immediately, preserving
// the desktop feel; its lifted visual waits for the first movement so a plain click doesn't
// flash the "grabbed" style. A pointerdown on a <button> (remove / make-cover) is ignored so
// those taps still work.
const LIFT_MS = 250 // long-press before a touch drag lifts
const MOVE_TOLERANCE = 8 // px of pre-lift movement that counts as a scroll, not a drag

export function usePointerReorder(move: (from: number, to: number) => void) {
  const from = useRef<number | null>(null)
  const lifted = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startPt = useRef<{ x: number; y: number } | null>(null)
  const captured = useRef<{ el: HTMLElement; pointerId: number } | null>(null)
  /** The pointer that owns the current gesture — only its moves and its lift count. */
  const owner = useRef<number | null>(null)
  const ownerType = useRef<string | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)

  const clearTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }

  const blockTouchScroll = useRef((e: TouchEvent) => { e.preventDefault() })
  const removeBlocker = () => window.removeEventListener('touchmove', blockTouchScroll.current)

  /**
   * ⚠️ THE OWNER'S LIFT ENDS THE DRAG WHEREVER IT HAPPENS. Only the owner may end a lifted drag (see
   * the note on onPointerDown), so a lost `pointerup` would strand it — tile stuck lifted, page scroll
   * blocked — until reload. Pointer capture normally delivers it to the tile, but a gesture must not
   * depend on that: from the press on, a window listener also ends it on the owner's up/cancel.
   * The stable wrapper is what gets added/removed; the effect keeps it pointing at this render's reset.
   */
  const endHandler = useRef<(e: PointerEvent) => void>(() => {})
  const onWindowEnd = useRef((e: PointerEvent) => endHandler.current(e))
  const removeWindowEnd = () => {
    window.removeEventListener('pointerup', onWindowEnd.current)
    window.removeEventListener('pointercancel', onWindowEnd.current)
  }

  const reset = () => {
    clearTimer()
    removeBlocker()
    removeWindowEnd()
    if (captured.current) {
      try { captured.current.el.releasePointerCapture(captured.current.pointerId) } catch {}
      captured.current = null
    }
    from.current = null
    lifted.current = false
    startPt.current = null
    owner.current = null
    ownerType.current = null
    setDragging(null)
  }

  // The long-press timer / scroll blocker must not outlive the component (a timer firing after
  // unmount would buzz the haptic on a dead screen; a leaked blocker would freeze page scroll).
  useEffect(() => () => { clearTimer(); removeBlocker(); removeWindowEnd() }, [])
  useEffect(() => {
    endHandler.current = (e) => { if (e.pointerId === owner.current) reset() }
  })

  const lift = (el: HTMLElement, pointerId: number, i: number, touch: boolean) => {
    lifted.current = true
    try { el.setPointerCapture(pointerId); captured.current = { el, pointerId } } catch {}
    if (touch) {
      haptic() // subtle tick confirming the tile is grabbed (no-op under reduced-motion)
      window.addEventListener('touchmove', blockTouchScroll.current, { passive: false })
      setDragging(i) // lifted visual right at the haptic moment
    }
    // Mouse: visual waits for the first pointermove so a plain click doesn't flash it.
  }

  // ⚠️ ONE POINTER OWNS THE GESTURE — its pointerId, not just `isPrimary`. A second finger on another
  // tile while one is lifted used to overwrite from/startPt/lifted; the first finger's next move then
  // read as >8px from the NEW start, reset() dropped the drag and removed the scroll blocker
  // mid-gesture, and the grid scrolled under the finger. `isPrimary` alone is per pointer TYPE (a
  // Pencil and a resting palm are both "primary"), so the owner's id is tracked: once a tile is
  // lifted no other pointer can start, move or end the drag. Before the lift a new primary press
  // simply restarts — nothing is held yet, and a missed pointerup can never strand the hook.
  const onPointerDown = (i: number) => (e: ReactPointerEvent<HTMLElement>) => {
    if (!e.isPrimary) return
    if (lifted.current && owner.current !== null && owner.current !== e.pointerId) return
    // Palm rejection: a pen press is waiting on its long-press and a TOUCH arrives — that is the hand
    // resting on the screen, not a new gesture.
    if (ownerType.current === 'pen' && e.pointerType === 'touch') return
    if ((e.target as HTMLElement).closest('button')) return // let buttons handle their own taps
    if (e.button !== 0) return // primary button/contact only — a right-click's context menu swallows pointerup and would strand the drag
    // A new press before any lift REPLACES the pending one completely — its long-press timer included,
    // or that timer would later lift a tile for a finger that is gone. (After the button/secondary
    // checks, so a tap on a tile's own button never cancels a pending press.)
    if (owner.current !== null) reset()
    owner.current = e.pointerId
    ownerType.current = e.pointerType
    // From the PRESS, not the lift: a pointerup lost before the long-press fires must still end it,
    // or the timer would lift a tile with no finger down and block page scroll until reload.
    window.addEventListener('pointerup', onWindowEnd.current)
    window.addEventListener('pointercancel', onWindowEnd.current)
    from.current = i
    startPt.current = { x: e.clientX, y: e.clientY }
    lifted.current = false
    if (e.pointerType === 'mouse') {
      lift(e.currentTarget, e.pointerId, i, false) // desktop: no scroll-hijack risk, drag right away
    } else {
      const el = e.currentTarget
      const pointerId = e.pointerId
      clearTimer()
      timer.current = setTimeout(() => {
        // isConnected: the tile can unmount within the 250ms (removing a neighbour re-keys the
        // grid) — lifting a detached node would buzz the haptic with nothing grabbed.
        if (from.current === i && !lifted.current && el.isConnected) lift(el, pointerId, i, true)
      }, LIFT_MS)
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.pointerId !== owner.current || from.current === null) return
    if (!lifted.current) {
      // Pre-lift movement beyond tolerance = the user is scrolling/swiping, not reordering: bail
      // so the page scrolls normally and no accidental reorder fires.
      const s = startPt.current
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_TOLERANCE) reset()
      return
    }
    if (dragging === null) setDragging(from.current) // mouse: first real movement shows the lift
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
    const tile = el?.closest('[data-reorder-idx]') as HTMLElement | null
    if (!tile) return
    const to = Number(tile.dataset.reorderIdx)
    if (!Number.isNaN(to) && to !== from.current) {
      move(from.current, to)
      from.current = to
      // Tiles are keyed by index, so after the reorder the dragged photo LIVES at `to` — the
      // lifted visual must follow it there, not stay on the old index (a different photo now).
      setDragging(to)
    }
  }

  const bind = (i: number) => ({
    'data-reorder-idx': i,
    onPointerDown: onPointerDown(i),
    onPointerMove,
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => { if (e.pointerId === owner.current) reset() },
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => { if (e.pointerId === owner.current) reset() },
    // pan-y: a swipe on a tile scrolls the page; mid-drag scroll suppression is handled by the
    // touchmove blocker above (touch-action changes don't apply to an in-progress gesture).
    style: { touchAction: 'pan-y' as const },
  })

  return { bind, dragging }
}
