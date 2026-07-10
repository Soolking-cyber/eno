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
  const [dragging, setDragging] = useState<number | null>(null)

  const clearTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }

  const blockTouchScroll = useRef((e: TouchEvent) => { e.preventDefault() })
  const removeBlocker = () => window.removeEventListener('touchmove', blockTouchScroll.current)

  const reset = () => {
    clearTimer()
    removeBlocker()
    if (captured.current) {
      try { captured.current.el.releasePointerCapture(captured.current.pointerId) } catch {}
      captured.current = null
    }
    from.current = null
    lifted.current = false
    startPt.current = null
    setDragging(null)
  }

  // The long-press timer / scroll blocker must not outlive the component (a timer firing after
  // unmount would buzz the haptic on a dead screen; a leaked blocker would freeze page scroll).
  useEffect(() => () => { clearTimer(); removeBlocker() }, [])

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

  const onPointerDown = (i: number) => (e: ReactPointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button')) return // let buttons handle their own taps
    if (e.button !== 0) return // primary button/contact only — a right-click's context menu swallows pointerup and would strand the drag
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
    if (from.current === null) return
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
    onPointerUp: reset,
    onPointerCancel: reset,
    // pan-y: a swipe on a tile scrolls the page; mid-drag scroll suppression is handled by the
    // touchmove blocker above (touch-action changes don't apply to an in-progress gesture).
    style: { touchAction: 'pan-y' as const },
  })

  return { bind, dragging }
}
