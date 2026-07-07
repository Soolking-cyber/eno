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

function ensureWired() {
  if (wired || typeof window === 'undefined' || !window.visualViewport) return
  wired = true
  window.visualViewport.addEventListener('resize', recompute)
  recompute()
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
