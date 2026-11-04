import { useSyncExternalStore } from 'react'

/**
 * ⛔ A VISITOR WHO LOOKS AND LEAVES DOES NOT PAY FOR WHAT ONLY A STAYING VISITOR USES (PageSpeed, 2026-11-04).
 * Two things started by themselves as soon as a phone had hydrated the page:
 *   · a listing's clip on the first screen. PageSpeed's phone run downloaded 4.3 MB of its 5.5 MB there, and the 30 newest clips
 *     measure 4.4-20.9 MB (median 7.5);
 *   · the Post tab's prefetch: 4 renders at the origin, 22 KB of payload and 98 KB of wizard chunks, on every page.
 * Both now wait for this: the first scroll, swipe, key or mouse movement, or GRACE_MS on the page for someone who is reading the first
 * screen without touching it. A deliberate act of the visitor (hovering a card, reaching for a tab) does not wait: those keep their own
 * paths.
 *
 * ⛔ A TAP DOES NOT COUNT. It asks for one thing, and whatever this releases would run alongside that thing. Measured on a real build
 * with the first tap on a listing card, 4x CPU and slow 4G: with the Post prefetch released by the tap, the listing arrived in 4,197 ms;
 * with that prefetch refused, 3,787 ms (medians of the 4 rounds each while this Mac was quiet; under load the gap grew). A visitor who
 * taps and stays is reached by their next scroll or by the grace.
 * ⚠️ ONLY THE PAGE'S OWN `scroll`, HEARD ON window WITHOUT CAPTURE. A rail or tab strip can scroll itself as it mounts, and that is not
 * the visitor; a finger or a wheel on a rail is already heard as such.
 * ⚠️ A BACKGROUND TAB DOES NOT RUN OUT THE GRACE: nobody is there to read the first screen, so hiding the tab stops it and showing
 * the tab starts it again.
 * ⚠️ MODULE STATE ON PURPOSE: a soft navigation keeps it, so nothing goes back to waiting on the next page.
 */
const GRACE_MS = 10_000
const NOTIFY_WITHIN_MS = 200
const GESTURES = ['touchmove', 'keydown', 'wheel'] as const

let engaged = false
let armed = false
let graceTimer: ReturnType<typeof setTimeout> | undefined
const waiting = new Set<() => void>()

/** A mouse only: a finger's pointermove can come from a tap's small wobble, and a swipe is already heard as touchmove. */
function onPointerMove(e: PointerEvent) {
  if (e.pointerType === 'mouse') settle()
}

function unlisten() {
  for (const g of GESTURES) window.removeEventListener(g, settle, { capture: true })
  window.removeEventListener('pointermove', onPointerMove, { capture: true })
  window.removeEventListener('scroll', settle)
  window.removeEventListener('load', startGrace)
  document.removeEventListener('visibilitychange', startGrace)
}

function settle() {
  if (engaged) return
  engaged = true
  unlisten()
  clearTimeout(graceTimer)
  // ⚠️ NOT INSIDE THE GESTURE: this listener runs before the tap's own handlers, and a useSyncExternalStore update renders at once.
  // The flag is already true, so anything that asks from here on gets its answer; only the waiting work moves out of the way.
  const notify = () => {
    for (const then of [...waiting]) then()
    waiting.clear()
  }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(notify, { timeout: NOTIFY_WITHIN_MS })
  else setTimeout(notify, NOTIFY_WITHIN_MS)
}

/** Ten seconds on screen in one go, from the load event or from this script's arrival if that came later (on a slow phone hydration alone can use most of it). */
function startGrace() {
  clearTimeout(graceTimer)
  if (!document.hidden && document.readyState === 'complete') graceTimer = setTimeout(settle, GRACE_MS)
}

function arm() {
  if (armed || typeof window === 'undefined') return
  armed = true
  // A reader the browser put back down the page came back; the scroll event for it may have gone before this script ran.
  if (window.scrollY > 0) {
    settle()
    return
  }
  for (const g of GESTURES) window.addEventListener(g, settle, { capture: true, passive: true })
  window.addEventListener('pointermove', onPointerMove, { capture: true, passive: true })
  window.addEventListener('scroll', settle, { passive: true })
  window.addEventListener('load', startGrace, { once: true })
  document.addEventListener('visibilitychange', startGrace)
  startGrace()
}

// On import, not on the first caller: a scroll before the first clip's chunk has arrived counts too.
arm()

/** Run `then` once the visitor is engaged, at once if they already are. Returns how to stop waiting. */
export function whenVisitorEngaged(then: () => void): () => void {
  if (engaged) {
    then()
    return () => {}
  }
  waiting.add(then)
  return () => { waiting.delete(then) }
}

function subscribe(onChange: () => void) {
  return whenVisitorEngaged(onChange)
}

/** False on the server and in the hydration render, so it is only for what never reaches the DOM (a Link's `prefetch`). */
export function useVisitorEngaged(): boolean {
  return useSyncExternalStore(subscribe, () => engaged, () => false)
}

/** Tests only: module state outlives a test file's cases. Re-arms, as a fresh page's import would. */
export function resetVisitorEngagedForTests() {
  if (typeof window !== 'undefined') unlisten()
  clearTimeout(graceTimer)
  engaged = false
  armed = false
  waiting.clear()
  arm()
}
