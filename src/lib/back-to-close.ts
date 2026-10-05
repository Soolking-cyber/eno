'use client'

import { useCallback, useEffect, useRef } from 'react'

/**
 * BACK CLOSES WHAT THE TAP OPENED (UX3 NAV-1, nav audit N1 / research R1).
 *
 * A phone sheet (the explorer's Filters, Area and Price sheets) and the phone header search panel are
 * full-screen layers, and on a phone Back is the primary way out of a layer — the Android gesture, the
 * hardware key, iOS swipe-back. With no history entry of their own, Back went straight through them and
 * off the page (measured: with a filter sheet open, Back left eno.vn). This module gives such a layer ONE
 * state-only entry while it is open, so Back closes it — the PDP lightbox and the video takeover already
 * do this by hand (listing-gallery.tsx, listings-video-feed.tsx); this is the shared version.
 *
 * ⛔ SCOPE IS DELIBERATE (plan §R): only those four layers. Not every ui/dialog or ui/drawer — the sign-in
 * dialog and friends contain links, and a generic version would have to solve "the close was a navigation"
 * for every dialog in the app.
 *
 * THE RULES, each one a measured or reviewed failure mode:
 *  · PUSH ONLY FROM A GESTURE. Chrome marks an entry added without user activation as skippable (the
 *    history-manipulation intervention), and Back then skips past it — the opposite of the point. The open
 *    always follows a tap or a key, so `navigator.userActivation.isActive` holds; where it is false the
 *    layer simply opens without an entry (unknown — an engine without the API — is treated as active).
 *  · BACK WHILE OPEN: a popstate that leaves our entry closes the layer. Nothing else to do — the entry is
 *    already gone.
 *  · A UI CLOSE (✕, scrim, swipe, Escape, "Show results") is decided after the closing commit's effects
 *    have run (a microtask — React flushes a discrete commit's passive effects synchronously):
 *      – our entry is no longer on top, or no longer marked → someone took it over (a committed explorer
 *        change "absorbs" it) or pushed above it: not ours to touch;
 *      – the VIEW changed while the layer was open — the URL, or the page's `VIEW_KEY` stamp (the explorer
 *        writes one for what the URL cannot show, e.g. a near-you circle) → the entry is KEPT, unmarked: it
 *        is the step the layer committed, and Back undoes it, as Baymard's users expect of a filter;
 *      – nothing changed → popped, so a layer opened and dismissed leaves history as it found it.
 *  · A CLOSE CAUSED BY A NAVIGATION (a suggestion, a link, a search submitted off the explorer) must NOT
 *    call `history.back()`: it is asynchronous, lands AFTER the navigation's own push and undoes it (and on
 *    a slow route, Next discards the pending navigation when the popstate's restore arrives). The owner
 *    calls `release()` first; the entry is marked released and the NEXT push of any kind REPLACES it rather
 *    than stacking on a dead entry (the pushState wrapper below). A released entry that nothing replaces
 *    costs one Back press that changes nothing — the accepted price of never racing a navigation.
 *  · A NAVIGATION THE LAYER NEVER HEARD OF (a notification tap, a deep link, a tap the owner did not
 *    classify) still replaces the entry of an OPEN layer: a URL-changing push over it becomes a replace.
 *  · OUR OWN POP IS TRACKED: until its popstate arrives, a layer's push waits (it would be cancelled by the
 *    traversal and its layer closed by the popstate), the explorer defers its writes (`whenLayerPopSettles`)
 *    and ignores that popstate (`popIsLayerClose`) — its state is already the newer one.
 *  · AN UNMOUNT WHILE OPEN releases; it never pops.
 *  · A STALE MARK IS IGNORED. history.state survives a reload and a Forward, so an old mark can be on the
 *    top entry with no layer open. Only keys pushed in THIS document count (`live`).
 *  · NEXT'S ROUTER: every write spreads the current history.state, so Next's own `__NA` + tree ride along
 *    and its patched pushState/replaceState pass the call straight through (app-router.js), and its
 *    popstate handler restores the same tree — the page underneath does not re-render into anything else.
 */

/** history.state key of a layer's entry: `{ id, key, released? }`. */
export const OVERLAY_KEY = 'enoOverlay'
/** history.state key of an explorer entry's identity (snapshots are kept per entry, listings-explorer.tsx). */
export const ENTRY_KEY = 'enoEntry'
/**
 * history.state key of a page's view stamp — whatever the page's view depends on that its URL does not show
 * (the explorer: the near-you circle). A layer counts a change of it as a change of view.
 */
export const VIEW_KEY = 'enoView'

export type OverlayMark = { id: string; key: string; released?: true }

/** Keys this document pushed and has not seen go — open or released. A mark not in here is stale. */
const live = new Map<string, { released: boolean }>()

let seq = 0
/** A key unique to this document's lifetime (and practically across documents — marks survive a reload). */
export function newHistoryKey(): string {
  seq += 1
  return `${Date.now().toString(36)}.${seq.toString(36)}.${Math.random().toString(36).slice(2, 8)}`
}

/** A copy of the current entry's state as a plain object (never null), safe to extend. */
export function currentHistoryState(): Record<string, unknown> {
  const s = typeof window === 'undefined' ? null : window.history.state
  return s && typeof s === 'object' ? { ...(s as Record<string, unknown>) } : {}
}

/** The view the current entry shows: its URL and its page's stamp. */
export function viewStamp(): string {
  if (typeof window === 'undefined') return ''
  const v = currentHistoryState()[VIEW_KEY]
  return `${window.location.href}\n${typeof v === 'string' ? v : ''}`
}

export function overlayMarkOf(state: unknown): OverlayMark | null {
  const m = state && typeof state === 'object' ? (state as Record<string, unknown>)[OVERLAY_KEY] : null
  return m && typeof m === 'object' && typeof (m as OverlayMark).key === 'string' ? (m as OverlayMark) : null
}

/** The top entry is a layer's handle pushed in THIS document — open or released. */
export function liveOverlayOnTop(): OverlayMark | null {
  if (typeof window === 'undefined') return null
  const m = overlayMarkOf(window.history.state)
  return m && live.has(m.key) ? m : null
}

/**
 * The top entry is the handle of a layer that is OPEN right now — Back belongs to it. native-bootstrap.tsx
 * asks this so the Android hardware Back goes through `history.back()` (and so through the layer's own
 * popstate close), exactly as browser Back does, instead of also being turned into an Escape.
 */
export function backPressClosesOverlay(): boolean {
  const m = liveOverlayOnTop()
  return !!m && !m.released && live.get(m.key)?.released === false
}

/**
 * Make the top entry an ordinary entry: drop the layer mark (the layer is done with it), merging `extra`
 * into its state and optionally moving its URL. The explorer calls this when a committed view change lands
 * on a layer's entry ("absorb"); the hook calls it when a closing layer's view changed.
 */
export function stripOverlayEntry(extra?: Record<string, unknown>, url?: string): void {
  const s = currentHistoryState()
  const m = overlayMarkOf(s)
  if (m) live.delete(m.key)
  delete s[OVERLAY_KEY]
  window.history.replaceState({ ...s, ...extra }, '', url)
}

/** Has the page the transient activation of a tap or key press? Unknown (no API) counts as yes. */
export function hasUserActivation(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = (navigator as Navigator & { userActivation?: { isActive?: boolean } }).userActivation
  return ua?.isActive !== false
}

/* ── our own pop ─────────────────────────────────────────────────────────────────────────────────── */

/** A layer's `history.back()` is on its way (set before the call, cleared by its popstate or a timeout). */
let layerPop: { timer: ReturnType<typeof setTimeout> } | null = null
/** True for the duration of the popstate dispatch that our own pop caused (cleared after the dispatch). */
let layerPopNow = false
const afterLayerPop: (() => void)[] = []

function settleLayerPop(): void {
  if (!layerPop) return
  clearTimeout(layerPop.timer)
  layerPop = null
  // After the whole dispatch: every listener of THIS popstate sees `popIsLayerClose()` first.
  setTimeout(() => {
    layerPopNow = false
    for (const fn of afterLayerPop.splice(0)) {
      try { fn() } catch { /* one deferred write must not stop the next */ }
    }
  }, 0)
}

/**
 * Registered at module evaluation, i.e. before any component's popstate listener — it marks the popstate
 * our own pop caused, for every listener after it in the same dispatch.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (!layerPop) return
    layerPopNow = true
    settleLayerPop()
  })
}

/** Pop a layer's pristine entry, and mark that the next popstate is ours. */
function popLayerEntry(): void {
  // ~1s ceiling: a traversal that never reports (a WebView that swallowed it) must not freeze writes.
  layerPop = { timer: setTimeout(() => settleLayerPop(), 1000) }
  window.history.back()
}

/** Is this popstate the one a layer's own close caused? (The explorer ignores it: its state is newer.) */
export function popIsLayerClose(): boolean {
  return layerPopNow
}

/**
 * Run `fn` now — or, while a layer's own pop is on its way, once it has landed. A push issued in that window
 * would be cancelled by the traversal (and a layer opened in it closed by the popstate), so the explorer's
 * writes and a layer's own push wait.
 */
export function whenLayerPopSettles(fn: () => void): void {
  if (layerPop || layerPopNow) afterLayerPop.push(fn)
  else fn()
}

/** Tests only: forget every live mark and any pop in flight (a fresh "document"). */
export function __resetBackToCloseForTests(): void {
  live.clear()
  if (layerPop) clearTimeout(layerPop.timer)
  layerPop = null
  layerPopNow = false
  afterLayerPop.length = 0
}

/* ── the push wrapper ────────────────────────────────────────────────────────────────────────────── */

/**
 * ⛔ PUSHES OVER A LAYER'S ENTRY REPLACE IT:
 *  · over a RELEASED entry — a layer closed by an action that may navigate — the next push of ANY kind (a
 *    router.push or <Link> to a listing, another layer's handle) replaces the dead entry instead of
 *    stacking on it; that is what keeps "open the search panel, pick a suggestion, Back" one step, without
 *    ever calling the asynchronous `history.back()` the navigation would race;
 *  · over an OPEN entry, a push that CHANGES THE URL is a navigation the layer never heard of (a
 *    notification tap, a native deep link) — it replaces the layer's entry, which the navigation is
 *    leaving anyway. A state-only push (a nested layer, the lightbox) stacks normally.
 * Installed the first time a layer pushes, once per document. It wraps whatever `pushState` is at that
 * moment (Next's patch, safe-back's latch) and converts through the CURRENT `replaceState`, so Next's own
 * patch still sees the call — its `__NA` passes straight through.
 */
let pushWatchInstalled = false
function installPushWatch(): void {
  if (pushWatchInstalled || typeof window === 'undefined') return
  pushWatchInstalled = true
  const prev = window.history.pushState.bind(window.history)
  window.history.pushState = function layerAwarePushState(...args: Parameters<History['pushState']>) {
    const m = overlayMarkOf(window.history.state)
    const mine = m ? live.get(m.key) : undefined
    if (m && mine) {
      const url = args[2]
      const moves = url != null && new URL(String(url), window.location.href).href !== window.location.href
      if (mine.released || moves) {
        live.delete(m.key)
        window.history.replaceState(...args)
        return
      }
    }
    prev(...args)
  }
}

/* ── the hook ────────────────────────────────────────────────────────────────────────────────────── */

type Entry = { key: string; stampAtOpen: string; poppedByBack: boolean; released: boolean; pushed: boolean }

/** Mark our entry released (see the rules above) — the next push replaces it; the close will not pop it. */
function releaseEntry(rec: Entry): void {
  if (rec.poppedByBack || rec.released) return
  rec.released = true
  const m = overlayMarkOf(window.history.state)
  if (!rec.pushed || m?.key !== rec.key) { live.delete(rec.key); return }
  live.set(rec.key, { released: true })
  window.history.replaceState({ ...currentHistoryState(), [OVERLAY_KEY]: { ...m, released: true } }, '')
}

/**
 * Give an open layer a history entry, so Back closes it. `open` is the layer's own state, `close` sets it
 * false (it is called only when Back closed the layer), `id` names the layer in the mark (debugging, and the
 * native shell's exemption). Returns `release`, to call BEFORE a close that navigates — see the rules above.
 * Pass `open` only where the layer is a phone sheet/panel: the caller decides (`isPhone && open`).
 */
export function useBackToClose(open: boolean, close: () => void, id: string): { release: () => void } {
  const closeRef = useRef(close)
  useEffect(() => { closeRef.current = close })
  const entry = useRef<Entry | null>(null)

  // Open → push our handle (after a pop of ours in flight, if any) and listen for Back.
  useEffect(() => {
    if (!open || !hasUserActivation()) return
    const key = newHistoryKey()
    const rec: Entry = { key, stampAtOpen: '', poppedByBack: false, released: false, pushed: false }
    entry.current = rec
    let listening = false
    const onPop = () => {
      if (overlayMarkOf(window.history.state)?.key === key) return // a layer above ours was popped
      rec.poppedByBack = true
      live.delete(key)
      closeRef.current()
    }
    whenLayerPopSettles(() => {
      if (entry.current !== rec || rec.released) return // closed (or released) before it could push
      installPushWatch()
      const s = currentHistoryState()
      delete s[OVERLAY_KEY]
      window.history.pushState({ ...s, [OVERLAY_KEY]: { id, key } }, '')
      live.set(key, { released: false })
      rec.pushed = true
      rec.stampAtOpen = viewStamp()
      window.addEventListener('popstate', onPop)
      listening = true
    })
    return () => { if (listening) window.removeEventListener('popstate', onPop) }
  }, [open, id])

  // Open → closed (not an unmount): pop, keep or leave our entry — after the closing commit's effects.
  const wasOpen = useRef(open)
  useEffect(() => {
    const was = wasOpen.current
    wasOpen.current = open
    if (!was || open) return
    const rec = entry.current
    entry.current = null
    if (!rec || !rec.pushed || rec.poppedByBack || rec.released) return
    queueMicrotask(() => {
      const m = overlayMarkOf(window.history.state)
      // Someone pushed above it or took it over (a committed explorer change strips the mark) — not ours to touch.
      if (m?.key !== rec.key) { live.delete(rec.key); return }
      if (viewStamp() !== rec.stampAtOpen) {
        // The layer changed the view: our entry IS that step now. A fresh identity, so the entry below keeps its own.
        stripOverlayEntry({ [ENTRY_KEY]: newHistoryKey() })
        return
      }
      live.delete(rec.key)
      popLayerEntry()
    })
  }, [open])

  // Unmounted while open → release, never pop (a route change may be what unmounted us).
  useEffect(() => () => {
    const rec = entry.current
    if (rec) releaseEntry(rec)
  }, [])

  const release = useCallback(() => {
    const rec = entry.current
    if (rec) releaseEntry(rec)
  }, [])

  return { release }
}
