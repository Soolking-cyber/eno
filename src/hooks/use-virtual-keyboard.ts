'use client'

import { useEffect, useState } from 'react'

// Detects the on-screen (virtual) keyboard via the VisualViewport API AND publishes the
// live viewport geometry as CSS variables on <html> so a chat shell can pin itself FLUSH
// over the visual viewport.
//
// iOS Safari OVERLAYS the keyboard: it does NOT shrink innerHeight/dvh — it shrinks only
// visualViewport.height and SCROLLS the page up (exposed as visualViewport.offsetTop) so
// the focused field clears the keyboard. Two numbers matter:
//   --vvh = visualViewport.height   → the visible height while the keyboard is up
//   --vvt = visualViewport.offsetTop → how far iOS scrolled the visual viewport
// A position:fixed shell of height var(--vvh) translated by translateY(var(--vvt)) sits
// EXACTLY over the visible area: its bottom == keyboard top (flush, zero gap), its top ==
// header pinned. Missing the offsetTop term is why the composer floated over a gap.
type KB = { open: boolean; height: number | null }
const CLOSED: KB = { open: false, height: null }

// ONE shared VisualViewport listener + a change-guarded store, no matter how many
// components subscribe. A per-component listener firing setState on every viewport event
// caused a re-render storm during the keyboard-open animation that dismissed the keyboard.
let current: KB = CLOSED
const subscribers = new Set<(s: KB) => void>()
let wired = false
let settleTimer: ReturnType<typeof setTimeout> | null = null
let rafId = 0
// Largest visualViewport height seen this orientation — the keyboard-free baseline.
// Detecting "keyboard open" as a DROP FROM THIS BASELINE is robust where the classic
// `innerHeight - vv.height` fails: some iOS standalone-PWA/webview contexts shrink
// innerHeight together with the visual viewport, making their difference ~0 even with
// the keyboard fully up. The URL bar only moves vv.height by ~60-100px, under the 120px
// threshold, so it never false-positives.
let maxVvh = 0

function keyboardOpen(vv: VisualViewport): boolean {
  if (vv.height > maxVvh) maxVvh = vv.height
  return window.innerHeight - vv.height > 120 || maxVvh - vv.height > 120
}

// IMPERATIVE geometry writer — runs every frame the visual viewport moves. Writes CSS
// vars + toggles `kb-open` DIRECTLY on <html>, with NO React state: per-frame setState
// re-renders the chat shell and iOS ABORTS the keyboard (the reason the boolean store
// below stays coalesced). The shell reads these vars from CSS, so it tracks the keyboard
// frame-accurately without any React render.
function syncVars() {
  const vv = window.visualViewport
  if (!vv) return
  const root = document.documentElement
  const open = keyboardOpen(vv)
  root.style.setProperty('--vvh', `${vv.height}px`)
  // Only apply the scroll offset while the keyboard is up; on close snap back to 0 so a
  // stale offsetTop (iOS 26 regression, WebKit #297779) can't strand the shell.
  root.style.setProperty('--vvt', `${open ? vv.offsetTop : 0}px`)
  root.classList.toggle('kb-open', open)
}

function scheduleSync() {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = requestAnimationFrame(syncVars)
}

function recompute() {
  const vv = window.visualViewport
  if (!vv) return
  const open = keyboardOpen(vv)
  const next: KB = open ? { open: true, height: vv.height } : CLOSED
  if (next.open === current.open && next.height === current.height) return // no-op ⇒ no re-render
  current = next
  subscribers.forEach((notify) => notify(current))
}

// COALESCE the boolean store's resize burst (iOS fires resize every animation frame; an
// ancestor reflow each frame makes iOS abort the keyboard). The CSS vars update every
// frame (cheap, no re-render); only the React `{open}` boolean waits for the viewport to
// settle (~120ms after the last event).
function onViewportChange() {
  scheduleSync()
  if (settleTimer) clearTimeout(settleTimer)
  settleTimer = setTimeout(recompute, 120)
}

// On blur/keyboard-dismiss, iOS 26 sometimes leaves offsetTop/height stale; force a
// re-sync (immediately + a beat later) so the shell never strands over a phantom gap.
function onFocusOut() {
  scheduleSync()
  setTimeout(() => { scheduleSync(); recompute() }, 60)
}

/** Wire the single shared VisualViewport listener (idempotent). Safe to call from any
 *  always-mounted client component to keep the --vvh/--vvt vars live app-wide. */
export function ensureKeyboardWired() {
  if (wired || typeof window === 'undefined' || !window.visualViewport) return
  wired = true
  const vv = window.visualViewport
  vv.addEventListener('resize', onViewportChange)
  vv.addEventListener('scroll', scheduleSync) // offsetTop changes fire `scroll`, NOT `resize`
  window.addEventListener('focusout', onFocusOut)
  // Rotation changes the keyboard-free baseline — reset it so the drop-from-max
  // detector re-learns the new orientation's full height.
  window.addEventListener('orientationchange', () => { maxVvh = 0; onViewportChange() })
  syncVars() // initial — no keyboard animation in flight
  recompute()
}

/** `open` = keyboard up; `height` = visible viewport height while open. Positioning is
 *  driven by CSS vars (see syncVars); this store is for coarse open/closed React logic.
 *  SSR/desktop-safe: no visualViewport ⇒ stays `{ open:false, height:null }`. */
export function useVirtualKeyboard(): KB {
  const [state, setState] = useState<KB>(current)
  useEffect(() => {
    ensureKeyboardWired()
    setState(current)
    const notify = (s: KB) => setState(s)
    subscribers.add(notify)
    return () => { subscribers.delete(notify) }
  }, [])
  return state
}
