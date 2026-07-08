'use client'

import { useEffect, useState } from 'react'

// Detects the on-screen (virtual) keyboard via the VisualViewport API. iOS Safari
// OVERLAYS the keyboard without shrinking innerHeight, so the keyboard height is
// simply `innerHeight - visualViewport.height` (do NOT subtract offsetTop — that's
// scroll position, and subtracting it under-counts the overlap while the page is
// scrolled, making detection flap and fighting the keyboard).
type KB = { open: boolean; height: number | null }
const CLOSED: KB = { open: false, height: null }

// ONE shared VisualViewport listener + a change-guarded store, no matter how many
// components subscribe (the nav AND the messages shell both do). A per-component
// listener firing setState on every viewport event caused a re-render storm during
// the keyboard-open animation that dismissed the keyboard.
let current: KB = CLOSED
const subscribers = new Set<(s: KB) => void>()
let wired = false
let settleTimer: ReturnType<typeof setTimeout> | null = null

function recompute() {
  const vv = window.visualViewport
  if (!vv) return
  const overlap = window.innerHeight - vv.height
  const open = overlap > 120 // >120px ⇒ a keyboard, not the URL bar collapsing
  const next: KB = open ? { open: true, height: vv.height } : CLOSED
  if (next.open === current.open && next.height === current.height) return // no-op ⇒ no re-render
  current = next
  subscribers.forEach((notify) => notify(current))
}

// COALESCE the resize burst. iOS fires a `resize` on every frame of the keyboard's
// slide animation (vv.height changes continuously), so reacting to each one re-renders
// the chat shell every frame — that ancestor reflow makes iOS ABORT the keyboard, so it
// never actually appears (focus stays, nav returns). Waiting for the viewport to STOP
// moving (~120ms after the last event) means we re-render exactly once, after the
// keyboard is already fully up, where a single height change is harmless.
function onViewportChange() {
  if (settleTimer) clearTimeout(settleTimer)
  settleTimer = setTimeout(recompute, 120)
}

function ensureWired() {
  if (wired || typeof window === 'undefined' || !window.visualViewport) return
  wired = true
  window.visualViewport.addEventListener('resize', onViewportChange)
  recompute() // initial state — immediate, no keyboard animation in flight
}

/** `open` = keyboard up; `height` = visible viewport height while open (for sizing a
 *  chat shell). SSR/desktop-safe: no visualViewport ⇒ stays `{ open:false, height:null }`. */
export function useVirtualKeyboard(): KB {
  const [state, setState] = useState<KB>(current)
  useEffect(() => {
    ensureWired()
    setState(current)
    const notify = (s: KB) => setState(s)
    subscribers.add(notify)
    return () => { subscribers.delete(notify) }
  }, [])
  return state
}
