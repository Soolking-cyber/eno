'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type SwipeDirection = 'left' | 'right' | 'up' | 'down'

/**
 * DRAG A PANEL THE WAY IT CLOSES, AND IT CLOSES — the native sheet gesture for panels that are not Base UI Drawers.
 *
 * Owner, 2026-09-14: "make sure all pages panels are closed on swipe action use mobile native swiping all across the
 * app properly". ui/drawer.tsx already gets this from Base UI's Drawer; ui/sheet.tsx (a Base UI Dialog positioned at an
 * edge) did not, so a side sheet could only be left by its X, a backdrop tap or the back key.
 *
 * The panel follows the finger 1:1 along `direction` (never past its resting edge — dragging the wrong way does
 * nothing), and on release it dismisses when it travelled far enough (30% of its size, capped at 120px) or was flicked
 * (≥0.5 px/ms over ≥30px); otherwise it springs back. The axis is decided once per gesture on the first 10px, the way
 * a native pager does, so a vertical scroll inside a right-hand sheet never turns into a dismissal. A gesture that
 * STARTS inside something that can still scroll the same way (a scrolled list, a horizontal chip row) belongs to that
 * scroller, not to the sheet.
 *
 * Touch only (pointer events would also claim mouse drags on desktop, where the X and the backdrop are the norm).
 * Returns a CALLBACK ref for the panel: a portaled popup mounts only when it opens, long after this hook first ran, and a
 * plain ref's effect would never see it.
 */
export function useSwipeDismiss<T extends HTMLElement>({ direction, onDismiss, disabled = false }: {
  direction: SwipeDirection
  onDismiss: () => void
  disabled?: boolean
}) {
  const [el, setEl] = useState<T | null>(null)
  const ref = useCallback((node: T | null) => setEl(node), [])
  const dismissRef = useRef(onDismiss)
  useEffect(() => { dismissRef.current = onDismiss })

  useEffect(() => {
    if (!el || disabled) return
    const horizontal = direction === 'left' || direction === 'right'
    const sign = direction === 'right' || direction === 'down' ? 1 : -1
    let startX = 0
    let startY = 0
    let startT = 0
    let axis: 'x' | 'y' | null = null
    let tracking = false
    let offset = 0

    /** Would a drag in the dismiss direction belong to something inside the panel instead — a control that drags
     *  (a slider, a text field, a carousel or map marked `data-no-swipe-dismiss`), or a scroller that can still move? */
    const ownedByScroller = (target: EventTarget | null) => {
      // `[data-slot^="slider"]`: a Base UI Slider's thumb and track are plain divs — its role="slider" sits on a hidden
      // input INSIDE the thumb, which `closest` from a finger on the track never reaches (opus).
      if (target instanceof Element && target.closest('[role="slider"], [data-slot^="slider"], input, textarea, select, [contenteditable="true"], [data-no-swipe-dismiss]')) return true
      for (let n = target instanceof Element ? target : null; n && n !== el.parentElement; n = n.parentElement) {
        const style = getComputedStyle(n)
        if (horizontal) {
          const scrolls = /(auto|scroll)/.test(style.overflowX) && n.scrollWidth > n.clientWidth + 1
          // Dragging right reveals content to the LEFT: only a scroller not already at its start owns it.
          if (scrolls && (sign === 1 ? n.scrollLeft > 0 : n.scrollLeft + n.clientWidth < n.scrollWidth - 1)) return true
        } else {
          const scrolls = /(auto|scroll)/.test(style.overflowY) && n.scrollHeight > n.clientHeight + 1
          if (scrolls && (sign === 1 ? n.scrollTop > 0 : n.scrollTop + n.clientHeight < n.scrollHeight - 1)) return true
        }
        if (n === el) break
      }
      return false
    }

    // The panel's own inline transform/transition, if its owner set one, is what a restore goes back to — never a blank (astra).
    const baseTransform = el.style.transform
    const baseTransition = el.style.transition
    const setTransform = (px: number) => {
      el.style.transform = px === 0 ? baseTransform : horizontal ? `translate3d(${px * sign}px,0,0)` : `translate3d(0,${px * sign}px,0)`
    }

    let resetTimer: ReturnType<typeof setTimeout> | null = null
    /** Put the panel back on its edge — a second finger, an interrupted touch, or a close the owner refused. */
    const restore = () => { tracking = false; el.style.transition = baseTransition; setTransform(0) }

    const onStart = (e: TouchEvent) => {
      // A pending post-dismiss reset must not yank a NEW drag back to the edge under the finger — so it settles NOW
      // instead, before the new gesture measures anything (astra: a refused close then a quick tap left it displaced).
      if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; if (!el.hasAttribute('data-ending-style')) setTransform(0) }
      // A second finger ends the drag AND puts the panel back — leaving it mid-drag with transitions off was a stuck panel (astra).
      if (e.touches.length !== 1) { if (tracking || offset > 0) restore(); offset = 0; return }
      const t = e.touches[0]
      startX = t.clientX
      startY = t.clientY
      startT = Date.now()
      axis = null
      offset = 0
      // After a browser pinch-zoom a one-finger drag is a pan around the zoomed page, not a dismissal (astra).
      tracking = !ownedByScroller(e.target) && (window.visualViewport?.scale ?? 1) <= 1.01
    }

    const onMove = (e: TouchEvent) => {
      if (!tracking || e.touches.length !== 1) return
      const t = e.touches[0]
      const dx = t.clientX - startX
      const dy = t.clientY - startY
      if (axis === null) {
        if (Math.hypot(dx, dy) < 10) return
        axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
        if (axis !== (horizontal ? 'x' : 'y')) { tracking = false; return }
        el.style.transition = 'none'
      }
      offset = Math.max(0, (horizontal ? dx : dy) * sign)
      setTransform(offset)
      if (offset > 0 && e.cancelable) e.preventDefault()
    }

    const onEnd = () => {
      if (!tracking || axis === null) { tracking = false; return }
      tracking = false
      const size = horizontal ? el.offsetWidth : el.offsetHeight
      const velocity = offset / Math.max(1, Date.now() - startT)
      const dismiss = offset > Math.min(120, size * 0.3) || (velocity >= 0.5 && offset >= 30)
      el.style.transition = baseTransition
      if (dismiss) {
        // Leave the panel where the finger put it: the exit animation fades it from there, instead of it snapping back
        // to its resting edge first and then leaving. If it is STILL OPEN a moment later — the owner refused the close (an
        // unsaved-changes guard), or the popup is kept mounted — it goes back to its edge (astra, opus).
        dismissRef.current()
        if (resetTimer) clearTimeout(resetTimer)
        // Once the exit has run, the offset goes either way: a popup that is still open was refused, and one that is
        // kept mounted CLOSED would otherwise reopen displaced (astra, opus). Mid-exit it waits for the animation.
        const settle = () => {
          resetTimer = null
          if (!el.isConnected) return
          if (el.hasAttribute('data-ending-style')) { resetTimer = setTimeout(settle, 150); return }
          setTransform(0)
        }
        resetTimer = setTimeout(settle, 450)
        return
      }
      setTransform(0)
    }
    // An INTERRUPTED touch (the OS took the gesture, a call came in) never dismisses — it restores (astra).
    const onCancel = () => { if (tracking || offset > 0) restore() }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onCancel, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onCancel)
      if (resetTimer) clearTimeout(resetTimer)
      el.style.transform = baseTransform
      el.style.transition = baseTransition
    }
  }, [el, direction, disabled])

  return ref
}
