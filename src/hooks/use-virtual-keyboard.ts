'use client'

import { useEffect, useState } from 'react'

// Detects the on-screen (virtual) keyboard via the VisualViewport API AND publishes the
// live viewport geometry as CSS variables on <html> so a chat shell can pin itself FLUSH
// over the visual viewport.
//
// iOS Safari OVERLAYS the keyboard: it does NOT shrink innerHeight/dvh — it shrinks only
// visualViewport.height and SCROLLS the page up (exposed as visualViewport.offsetTop) so
// the focused field clears the keyboard. Three numbers matter:
//   --vvh  = visualViewport.height    → the visible height while the keyboard is up
//   --vvt  = visualViewport.offsetTop → how far iOS scrolled the visual viewport
//   --kb-h = how much of the LAYOUT viewport the keyboard covers (0 when closed)
// A position:fixed shell of height var(--vvh) translated by translateY(var(--vvt)) sits
// EXACTLY over the visible area: its bottom == keyboard top (flush, zero gap), its top ==
// header pinned. Missing the offsetTop term is why the composer floated over a gap.
//
// --kb-h is the APP-WIDE contract (see globals.css "KEYBOARD-AWARE SURFACES"): any sticky
// footer / CTA / bottom sheet anywhere in the app can lift itself clear of the keyboard with
// `.kb-bottom` / `.kb-lift` / `.kb-pad` / var(--kb-safe-bottom) without knowing the geometry above.
// It is deliberately SELF-CORRECTING across platforms: it is derived from how much of the
// layout viewport is left UNSEEN below the visual viewport, so on any engine that shrinks the
// layout viewport instead of overlaying (Android Chrome with interactiveWidget:resizes-content,
// some standalone-PWA webviews) it evaluates to ~0 — which is right, because there `bottom: 0`
// is ALREADY above the keyboard and lifting again would double-compensate.
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
// the keyboard fully up.
// ⛔ THIS COMMENT USED TO END "The URL bar only moves vv.height by ~60-100px, under the 120px
// threshold, so it never false-positives." That was true of THIS baseline test and false of the
// `innerHeight` one beside it, and the difference is what made the bottom nav vanish while
// scrolling. See `keyboardOpen` — both tests now sit behind a focus check.
let maxVvh = 0

/**
 * ⛔ A KEYBOARD CANNOT BE OPEN WITHOUT AN EDITABLE ELEMENT FOCUSED, AND THAT IS THE ONLY SIGNAL
 * THE BROWSER'S OWN CHROME CANNOT IMITATE.
 *
 * The height test alone false-positived on ordinary SCROLLING, which is what the owner reported as
 * "bottom navbar sometimes disappears on scroll up and down" (2026-08-18). The mechanism, and the
 * comment above `maxVvh` asserts the opposite of it: on iOS Safari `window.innerHeight` stays at the
 * FULL layout height while `visualViewport.height` shrinks by the top AND bottom toolbars when
 * scrolling UP re-expands them. `innerHeight - vv.height` is then the height of the visible browser
 * chrome — which crosses 120px on real devices. Scroll up, bars expand, the app decides a keyboard
 * opened and hides the nav; scroll down, bars collapse, the nav returns. Intermittent by nature,
 * because it depends on how far the toolbars happen to be extended.
 *
 * The `maxVvh` branch was safe (the URL bar really does move that baseline by less than 120px). The
 * `innerHeight` branch was not, and it exists for a real reason — some iOS PWA/webview contexts
 * shrink innerHeight in step with the visual viewport, making the baseline test useless. So neither
 * test can be deleted; they are gated instead.
 *
 * ⚠️ FOCUS IS CHECKED FIRST AND SHORT-CIRCUITS. Scrolling never moves focus into a text field, so a
 * toolbar animation can no longer be mistaken for a keyboard however large the height delta gets.
 * The failure mode this trades into is the honest one: if a keyboard were ever open with nothing
 * focused, the nav would stay visible — which is what it does today for every non-typing user.
 */
export function hasEditableFocus(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  // `readOnly` inputs and `disabled` controls raise no keyboard, so they must not count.
  if (tag === 'TEXTAREA') return !(el as HTMLTextAreaElement).readOnly && !(el as HTMLTextAreaElement).disabled
  if (tag === 'INPUT') {
    const input = el as HTMLInputElement
    // Non-text inputs (checkbox, radio, button, file…) never summon a soft keyboard.
    const noKeyboard = ['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color', 'image']
    return !input.readOnly && !input.disabled && !noKeyboard.includes(input.type)
  }
  // ⚠️ `=== true`, NOT the bare property. `isContentEditable` is UNDEFINED in environments that do
  // not implement it (jsdom, and older webviews), and returning it raw makes this function answer
  // `undefined` — falsy in an `if`, but it would silently poison anything that compares the result
  // or stores it as a boolean. Caught by the test on the very first run.
  return el.isContentEditable === true
}

function keyboardOpen(vv: VisualViewport): boolean {
  if (vv.height > maxVvh) maxVvh = vv.height
  if (!hasEditableFocus()) return false
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
  // The slice of the LAYOUT viewport that is not visible below the visual viewport = exactly
  // how far a `position: fixed; bottom: 0` bar has to rise to sit on the keyboard. Clamped at
  // 0 and forced to 0 while closed (a stale offsetTop must never leave a phantom lift).
  root.style.setProperty('--kb-h', `${open ? Math.max(0, window.innerHeight - vv.offsetTop - vv.height) : 0}px`)
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
  if (wired || typeof window === 'undefined') return
  // On the Capacitor native shell the VisualViewport signal is unreliable (the keyboard is a
  // native overlay), so the @capacitor/keyboard plugin drives this store instead — see
  // setNativeKeyboard, wired from native-bootstrap. Skip the web VisualViewport path entirely.
  if ((window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()) {
    wired = true
    return
  }
  if (!window.visualViewport) return
  wired = true
  const vv = window.visualViewport
  vv.addEventListener('resize', onViewportChange)
  vv.addEventListener('scroll', scheduleSync) // offsetTop changes fire `scroll`, NOT `resize`
  window.addEventListener('focusout', onFocusOut)
  // Rotation changes the keyboard-free baseline — reset it so the drop-from-max
  // detector re-learns the new orientation's full height.
  window.addEventListener('orientationchange', () => { maxVvh = 0; onViewportChange() })
  // ⚠️ THE INITIAL SYNC RUNS IN A rAF, NOT INLINE. `ensureKeyboardWired()` is called from a
  // `useEffect`, i.e. inside React's commit with the tree it just mutated still dirty, and
  // `syncVars()` reads `visualViewport.height` — which forces a recalc of the WHOLE document before
  // the browser would have done one anyway. Measured on prod 2026-08-23 (headless chromium, mobile
  // emulation, 4x CPU): 47.7 ms of forced style+layout, out of 314.01 ms total on that load. The same
  // read inside a rAF costs 0.0 ms, because layout has already settled by then.
  // ⚠️ SAFE ONLY BECAUSE THE KEYBOARD IS DEFINITIONALLY CLOSED AT MOUNT, so this initial pass has no
  // deadline — it is establishing the resting values, not tracking an animation. Every consumer is
  // correct for that one extra frame: `--kb-h` has a resting `0px` in globals.css (:root) and every
  // keyboard-aware rule is gated on `html.kb-open`, which is absent until syncVars adds it; the chat
  // shell's `--vvh`/`--vvt` reads carry `100dvh`/`0px` fallbacks for exactly this pre-hydration
  // window. The per-frame path (onViewportChange) is untouched and still runs the moment the
  // viewport actually moves.
  requestAnimationFrame(() => { syncVars(); recompute() })
}

// ── NATIVE --kb-h: the plugin height MINUS WebKit's own pan ──────────────────────────
// The chat surface can hardcode --vvt to 0 because it LOCKS the document (html.chat-locked →
// touch-action:none), so WebKit never pans and offsetTop stays ~0. The app-wide contract has
// no such luxury: on an ordinary form WebKit pans the page up to reveal the focused field,
// which ALREADY lifts a position:fixed bar by visualViewport.offsetTop. Lifting it by the full
// keyboardHeight on top of that floats the CTA offsetTop px ABOVE the keyboard (Gemini 3.1 Pro
// caught this). The geometry, in CSS px, with the WebView never resized (Keyboard resize:'none'):
//   fixed;bottom:0 sits at layout y = innerHeight; screen y = innerHeight - offsetTop
//   keyboard top   sits at screen y = innerHeight - keyboardHeight
//   ⇒ lift = keyboardHeight - offsetTop
// This is the SAME quantity the web path computes as innerHeight - offsetTop - vv.height, since
// vv.height == innerHeight - keyboardHeight. It degrades safely in every regime: if WebKit never
// learned about the keyboard it also never pans (offsetTop 0 ⇒ lift = keyboardHeight), and if it
// pans via a plain document scroll instead, offsetTop is likewise 0 and fixed elements don't move.
let nativeKbHeight = 0
let nativePanWired = false
let nativeRafId = 0

function syncNativeKbVar() {
  nativeRafId = 0
  const offsetTop = window.visualViewport?.offsetTop ?? 0
  const lift = nativeKbHeight > 0 ? Math.max(0, nativeKbHeight - offsetTop) : 0
  document.documentElement.style.setProperty('--kb-h', `${lift}px`)
}

function scheduleNativeSync() {
  if (nativeRafId) return
  nativeRafId = requestAnimationFrame(syncNativeKbVar)
}

/** Track WebKit's pan while the native keyboard is up. rAF-coalesced and writing ONE custom
 *  property, so it costs a style invalidation per frame and never a React render — the same
 *  budget the web path's syncVars already spends. Idempotent; never removed (the listener is
 *  a no-op while nativeKbHeight is 0). */
function wireNativePan() {
  if (nativePanWired || typeof window === 'undefined' || !window.visualViewport) return
  nativePanWired = true
  window.visualViewport.addEventListener('scroll', scheduleNativeSync)
  window.visualViewport.addEventListener('resize', scheduleNativeSync)
}

/** NATIVE bridge: on the Capacitor shell the @capacitor/keyboard plugin's willShow/willHide
 *  events call this to drive the SAME store the web path uses — so mobile-nav's `off =
 *  keyboardOpen` slides the bar away, and the chat composer's --vvh/--vvt geometry tracks the
 *  real native keyboard. `height` is the plugin's keyboardHeight (px); 0 on hide. Wired from
 *  src/components/native/native-bootstrap.tsx (native only).
 *  ⚠️ ANDROID passes height 0 even on OPEN (by design, not a bug): Capacitor's SystemBars
 *  insets listener already shrinks the WebView by the IME inset there, so innerHeight is the
 *  post-keyboard height and `innerHeight - 0` below is already the visible area — adding the
 *  keyboard height again would double-compensate. iOS overlays (resize:'none' honored) and
 *  passes the real height. height==0 is safe here: it only ever widens --vvh to innerHeight. */
export function setNativeKeyboard(open: boolean, height: number) {
  if (typeof window === 'undefined') return
  const root = document.documentElement
  // The native keyboard overlays the WebView (resize: 'none'), so the visible area is the full
  // height minus the keyboard — the same shape the iOS-overlay web path produces.
  root.style.setProperty('--vvh', `${open ? window.innerHeight - height : window.innerHeight}px`)
  root.style.setProperty('--vvt', '0px')
  // App-wide lift contract (globals.css "KEYBOARD-AWARE SURFACES"). NOT simply `height`:
  // see syncNativeKbVar — outside the chat surface WebKit is free to PAN the page to reveal
  // the focused field, which already lifts a fixed bar by visualViewport.offsetTop.
  nativeKbHeight = open ? height : 0
  wireNativePan()
  syncNativeKbVar()
  root.classList.toggle('kb-open', open)
  const next: KB = open ? { open: true, height: window.innerHeight - height } : CLOSED
  if (next.open === current.open && next.height === current.height) return
  current = next
  subscribers.forEach((notify) => notify(current))
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
