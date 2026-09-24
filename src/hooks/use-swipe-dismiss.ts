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
 * The panel follows the finger 1:1 along `direction`; dragged the WRONG way it moves at a fifth of the finger (friction,
 * not a wall) and springs home on release. It dismisses when it travelled far enough (30% of its size, capped at 120px)
 * or was FLICKED: moving faster than 0.15 px/ms over the last 100ms, having travelled at least 24px. Otherwise it springs
 * back. The axis is decided once per gesture on the first 10px, the way a native pager does, so a vertical scroll inside
 * a right-hand sheet never turns into a dismissal. A gesture that STARTS inside something that can still scroll the same
 * way (a scrolled list, a horizontal chip row) belongs to that scroller, not to the sheet — and so does the wrong-way
 * drag, when something under the finger can scroll that way.
 *
 * ⛔ WHY THE VELOCITY IS MEASURED OVER THE LAST 100ms, NOT SINCE touchstart. The old rule averaged the whole gesture —
 * including the 10px axis lock and the finger settling — against a 0.5 px/ms bar, so an ordinary flick never counted:
 * on the 293px support sheet, 50/60/70/80px swipes at 0.16–0.18 px/ms average ALL snapped back, and only a 100px drag
 * (the distance rule) closed it. What a flick means is how fast the finger is moving when it LETS GO, which is what
 * the trailing window measures. 0.15 sits just above the ~0.11 px/ms Sonner/Vaul use for the same decision; the 24px
 * floor keeps a tap that wobbles from counting.
 * ⛔ WHY FRICTION RATHER THAN `Math.max(0, …)`. A wrong-way drag used to stop the panel dead at its edge, which reads as
 * the app freezing under the finger; a damped move that snaps back reads as "that way does not go".
 *
 * Touch only (pointer events would also claim mouse drags on desktop, where the X and the backdrop are the norm).
 * Returns a CALLBACK ref for the panel: a portaled popup mounts only when it opens, long after this hook first ran, and a
 * plain ref's effect would never see it.
 */
/** How far back the release velocity looks. */
export const SWIPE_VELOCITY_WINDOW_MS = 100
/** A release faster than this (px/ms, in the dismiss direction) is a flick. */
export const SWIPE_FLICK_VELOCITY = 0.15
/** …and a flick must have moved the panel at least this far, so a wobbling tap never counts. */
export const SWIPE_FLICK_MIN_PX = 24
/** A wrong-way drag moves the panel this fraction of the finger's travel. */
export const SWIPE_WRONG_WAY_FRICTION = 0.2

type Sample = { t: number; p: number }

/**
 * Velocity (px/ms, signed along the dismiss direction) at release: the slope across the samples inside the trailing
 * window. A finger that stopped before lifting has no sample in the window and releases at 0 — a pause kills a flick,
 * which is what a held finger means. With only ONE sample in the window (a very fast, sparse gesture) the slope is taken
 * from the last sample before it, so a two-event flick still has a velocity.
 */
export function releaseVelocity(samples: readonly Sample[], now: number, windowMs = SWIPE_VELOCITY_WINDOW_MS): number {
  const last = samples[samples.length - 1]
  if (!last || now - last.t > windowMs) return 0
  let i = samples.length - 1
  while (i > 0 && now - samples[i - 1].t <= windowMs) i--
  if (i === samples.length - 1 && i > 0) i--
  const first = samples[i]
  const dt = last.t - first.t
  return dt > 0 ? (last.p - first.p) / dt : 0
}

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
    let axis: 'x' | 'y' | null = null
    let tracking = false
    let offset = 0
    /** Recent (time, travel-along-the-dismiss-direction) points, for the release velocity. */
    let samples: Sample[] = []
    /** Something under the finger can scroll the WRONG way — that drag belongs to it, so the panel stays put. */
    let reverseOwned = false

    /** Would a drag in the dismiss direction (or, with `towards` flipped, the opposite one) belong to something inside
     *  the panel instead — a control that drags (a slider, a text field, a carousel or map marked
     *  `data-no-swipe-dismiss`), or a scroller that can still move that way? */
    const ownedByScroller = (target: EventTarget | null, towards: 1 | -1 = sign) => {
      // `[data-slot^="slider"]`: a Base UI Slider's thumb and track are plain divs — its role="slider" sits on a hidden
      // input INSIDE the thumb, which `closest` from a finger on the track never reaches (opus).
      if (target instanceof Element && target.closest('[role="slider"], [data-slot^="slider"], input, textarea, select, [contenteditable="true"], [data-no-swipe-dismiss]')) return true
      for (let n = target instanceof Element ? target : null; n && n !== el.parentElement; n = n.parentElement) {
        const style = getComputedStyle(n)
        if (horizontal) {
          const scrolls = /(auto|scroll)/.test(style.overflowX) && n.scrollWidth > n.clientWidth + 1
          // Dragging right reveals content to the LEFT: only a scroller not already at its start owns it.
          if (scrolls && (towards === 1 ? n.scrollLeft > 0 : n.scrollLeft + n.clientWidth < n.scrollWidth - 1)) return true
        } else {
          const scrolls = /(auto|scroll)/.test(style.overflowY) && n.scrollHeight > n.clientHeight + 1
          if (scrolls && (towards === 1 ? n.scrollTop > 0 : n.scrollTop + n.clientHeight < n.scrollHeight - 1)) return true
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
      if (e.touches.length !== 1) { if (tracking || offset !== 0) restore(); offset = 0; return }
      const t = e.touches[0]
      startX = t.clientX
      startY = t.clientY
      axis = null
      offset = 0
      samples = [{ t: Date.now(), p: 0 }]
      // After a browser pinch-zoom a one-finger drag is a pan around the zoomed page, not a dismissal (astra).
      tracking = !ownedByScroller(e.target) && (window.visualViewport?.scale ?? 1) <= 1.01
      // A wrong-way drag over a list that can scroll that way is a SCROLL: the panel must not move under it.
      reverseOwned = tracking && ownedByScroller(e.target, sign === 1 ? -1 : 1)
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
      const raw = (horizontal ? dx : dy) * sign
      const now = Date.now()
      samples.push({ t: now, p: raw })
      // Bounded: nothing older than two windows can matter to the release.
      while (samples.length > 2 && now - samples[0].t > 2 * SWIPE_VELOCITY_WINDOW_MS) samples.shift()
      offset = raw >= 0 ? raw : reverseOwned ? 0 : raw * SWIPE_WRONG_WAY_FRICTION
      setTransform(offset)
      if (offset !== 0 && e.cancelable) e.preventDefault()
    }

    const onEnd = () => {
      if (!tracking || axis === null) { tracking = false; return }
      tracking = false
      const size = horizontal ? el.offsetWidth : el.offsetHeight
      const velocity = releaseVelocity(samples, Date.now())
      // `offset` is the panel's own travel, so a wrong-way drag (negative) can never dismiss.
      const dismiss = offset > Math.min(120, size * 0.3) || (velocity > SWIPE_FLICK_VELOCITY && offset >= SWIPE_FLICK_MIN_PX)
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
    const onCancel = () => { if (tracking || offset !== 0) restore() }

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
