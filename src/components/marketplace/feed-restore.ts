/**
 * PUTTING THE READER BACK WHERE THEY WERE, AFTER BACK FROM A LISTING — the frame loop and the two
 * browser details around it, kept out of listings-explorer.tsx so they can be tested frame by frame
 * without mounting the 4,000-line explorer (the same reason explorer-place.ts exists).
 *
 * The explorer owns WHEN a restore runs (its snapshot, its rows, its abort listeners); this file owns
 * HOW the tapped card is brought back under the finger.
 *
 * What it fixes, measured on production at 390×844 (mobile audit, 2026-09-24):
 *   · Back from a deep feed showed the site FOOTER for 0.4–1s: the browser restored the old scroll
 *     offset against a document still twelve rows short and clamped to its bottom.
 *   · The tapped card then landed 294–365px from where it was, under the sticky header and the
 *     filter strip: the loop aligned ONCE, the moment the card appeared, and everything that grew
 *     above it afterwards (the deferred grid commit, lazily mounted chrome) pushed it away again.
 */

/** Frames to wait for the tapped card to be in the DOM at all (unchanged: ~2/3s at 60Hz). */
export const RESTORE_FIND_FRAMES = 40
/** Frames to keep re-aligning once it is. The loop normally settles in 2–4; this is the ceiling. */
export const RESTORE_SETTLE_FRAMES = 30
/** Breathing room between the pinned chrome and a card the clamp had to move below it. */
export const CHROME_GAP_PX = 8
/** Frames an ALREADY-ALIGNED card may be missing (a re-render swapping rows) before the loop gives up. */
export const RESTORE_LOST_FRAMES = 3

export type RestoreTarget = {
  /** The raw scroll offset when the card was tapped — the fallback when the card never reappears. */
  y: number
  /** The tapped card (`data-feed-card`), or null for a snapshot that recorded none. */
  anchorId: string | null
  /** Where that card's top sat in the viewport when it was tapped. */
  anchorTop: number
}

export type RestoreEnv = {
  /** The tapped card's viewport top right now, or null while it is not in the DOM. */
  anchorTopOf: (id: string) => number | null
  /** The bottom edge of the sticky chrome pinned over the top of the viewport right now (0 = none). */
  chromeBottom: () => number
  scrollBy: (dy: number) => void
  scrollTo: (y: number) => void
  /** Is the document tall enough for `y` to land where it did before (no clamp to the bottom)? */
  fits: (y: number) => boolean
  raf: (cb: () => void) => number
  caf: (id: number) => void
}

/**
 * Where the tapped card's top must end up: where it was, unless that is under the pinned chrome.
 * ⚠️ RECOMPUTED EVERY FRAME, because the chrome moves on its own: the header slides away on a
 * scroll-down (250ms) and the filter strip's sticky `top` follows it — the restore's own jump is a
 * scroll-down. A target frozen at the first frame would park the card under a bar that is arriving,
 * or leave a gap for one that has gone.
 */
export function restoreTargetTop(anchorTop: number, chromeBottom: number): number {
  return chromeBottom > 0 ? Math.max(anchorTop, chromeBottom + CHROME_GAP_PX) : anchorTop
}

/**
 * Run the restore. The first step runs SYNCHRONOUSLY — call this from a layout effect, so that when
 * the rows are already in the DOM the jump happens before the browser paints. Returns `stop`, which
 * the caller wires to the reader's own input (a drag, the wheel, a key) and to unmount: we never
 * fight a finger. `onDone` runs exactly once, however the loop ends.
 *
 * ⛔ IT KEEPS ALIGNING UNTIL TWO CONSECUTIVE FRAMES AGREE, NOT UNTIL THE FIRST scrollBy. A frame
 * "agrees" when the card is within 1px of the target AND the target itself has not moved since the
 * previous frame — the second half is what stops it declaring victory halfway through the header's
 * slide. Height that changes ABOVE the card after a jump (the deferred grid commit, a rail that
 * mounts late) is absorbed on the next frame instead of becoming the 294px the audit measured.
 * ⚠️ BOUNDED IN FRAMES, NOT MILLISECONDS: a backgrounded WebView pauses rAF, and a time budget would
 * burn down while nothing can be painted.
 */
export function runRestore(target: RestoreTarget, env: RestoreEnv, onDone: () => void): () => void {
  let findFrames = 0
  let found = false
  let lostFrames = 0
  let settleFrames = 0
  let agreeing = 0
  let lastWant = Number.NaN
  let rafId = 0
  let done = false
  const finish = () => {
    if (done) return
    done = true
    env.caf(rafId)
    onDone()
  }
  const step = () => {
    if (done) return
    const top = target.anchorId ? env.anchorTopOf(target.anchorId) : null
    // ⚠️ A CARD THAT GOES AWAY AFTER IT WAS ALIGNED ENDS THE RESTORE WHERE IT IS — after a short grace,
    // because a re-render can take it out for a frame and put it straight back. The rows can be
    // replaced under a settling loop (a refetch reshuffles the tapped card out); falling through to
    // the raw-offset fallback below would yank a reader who is already in the right place to an
    // offset that stopped being true when the grid grew.
    if (top == null && found) {
      if (++lostFrames > RESTORE_LOST_FRAMES) { finish(); return }
      rafId = env.raf(step)
      return
    }
    if (top != null) {
      found = true
      lostFrames = 0
      const want = restoreTargetTop(target.anchorTop, env.chromeBottom())
      const delta = top - want
      const targetHeld = Math.abs(want - lastWant) <= 1
      lastWant = want
      if (Math.abs(delta) <= 1 && targetHeld) {
        if (++agreeing >= 2) { finish(); return }
      } else {
        agreeing = 0
        if (Math.abs(delta) > 1) env.scrollBy(delta)
      }
      if (++settleFrames >= RESTORE_SETTLE_FRAMES) { finish(); return }
      rafId = env.raf(step)
      return
    }
    // No card to align on (a snapshot that recorded none): the raw offset, once the page can hold it.
    if (!target.anchorId && env.fits(target.y)) { env.scrollTo(target.y); finish(); return }
    // If the tapped card never reappears (sold, moderated, or reshuffled out of the refreshed page),
    // fall back to the raw offset — but only if the page is long enough for it, else a clamp would
    // dump the reader at the footer, which is the flash this file exists to remove.
    if (findFrames++ < RESTORE_FIND_FRAMES) { rafId = env.raf(step); return }
    if (env.fits(target.y)) env.scrollTo(target.y)
    finish()
  }
  step()
  return finish
}

/**
 * The two bars that pin over the top of the feed: the site header and the explorer's filter strip.
 * ⚠️ BY ID, AND THE IDS ARE PINNED BY A TEST (feed-restore.test.ts reads header.tsx and
 * explorer-toolbar.tsx): a renamed id would make the clamp a silent no-op with every test green.
 */
export const PINNED_CHROME_IDS = ['app-header', 'explorer-toolbar'] as const

/**
 * The bottom edge of whichever of those bars is PINNED over the viewport right now, or 0.
 * ⚠️ "PINNED" MEANS SITTING AT ITS OWN STICKY OFFSET. The filter strip is `position: sticky`, so deep
 * in the feed it is pinned under the header, but near the top it is an ordinary row in the flow —
 * and counting it there would clamp the card below a bar that is not covering anything. The header
 * hides by translating itself up (and fading out), which moves its box off its offset: not pinned.
 * ⚠️ ±1px, not equality: sticky offsets resolve to fractional pixels (safe-area insets, `rem`).
 */
export function pinnedChromeBottom(doc: Document = document): number {
  const view = doc.defaultView
  if (!view) return 0
  let bottom = 0
  for (const id of PINNED_CHROME_IDS) {
    const el = doc.getElementById(id)
    if (!el) continue
    const cs = view.getComputedStyle(el)
    if (cs.position !== 'sticky' && cs.position !== 'fixed') continue
    if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue
    const r = el.getBoundingClientRect()
    if (r.height === 0 || r.bottom <= 0) continue
    const offset = Number.parseFloat(cs.top)
    if (!Number.isFinite(offset) || Math.abs(r.top - offset) > 1) continue
    bottom = Math.max(bottom, r.bottom)
  }
  return bottom
}

/**
 * ⛔ THE BROWSER'S OWN SCROLL RESTORATION IS WHAT SHOWED THE FOOTER. On Back it jumps to the offset
 * the feed had when the card was tapped — thousands of pixels — while the document is still the
 * short, twelve-row version the restore is about to lengthen, so it clamps to the bottom: the legal
 * footer, for 0.4–1s, before the explorer's own restore takes over. With 'manual' the browser leaves
 * the scroll alone and the explorer's restore is the only thing that moves the page.
 *
 * ⚠️ IT IS PER HISTORY ENTRY, AND THAT CUTS BOTH WAYS. The setter changes the CURRENT entry only, so
 * it has to run while the feed is still current — before `router.push`. But pushState COPIES the
 * current entry's mode into the entry it creates (HTML "URL and history update steps"), so the
 * listing page would inherit 'manual' and lose its own restoration on every later Back to it. So the
 * destination is handed 'auto' back the moment it becomes the current entry (its pathname differs
 * from the feed's). Bounded: a navigation that never commits stops being watched after 15s, and the
 * feed entry then stays 'manual' — correct, because its snapshot is still waiting in sessionStorage.
 */
/** The feed path a hold is out for, until the entry that inherited it has been handed 'auto' back. */
let heldFor: string | null = null

export function holdScrollRestoration(feedPath: string, win: Window = window): void {
  try { win.history.scrollRestoration = 'manual' } catch { /* not supported — nothing to hold */ }
  heldFor = feedPath
  const started = win.performance.now()
  const watch = () => {
    if (heldFor !== feedPath) return // handed back already (or by a newer hold's watcher)
    if (win.location.pathname !== feedPath) { heldFor = null; releaseScrollRestoration(win); return }
    if (win.performance.now() - started < 15_000) win.requestAnimationFrame(watch)
  }
  win.requestAnimationFrame(watch)
}

/**
 * The feed is going away (the explorer unmounted). If a hold is still out and the reader has left the
 * feed's path, the entry they left TO inherited 'manual' — hand it 'auto' back, however long the
 * navigation took (codex: the watcher above gives up after 15s, and a slow or suspended navigation
 * can commit later than that). One frame later, because the router pushes the new entry in the same
 * commit that unmounts the feed.
 */
export function handBackAfterLeaving(win: Window = window): void {
  const path = heldFor
  if (!path) return
  win.requestAnimationFrame(() => {
    if (heldFor === path && win.location.pathname !== path) { heldFor = null; releaseScrollRestoration(win) }
  })
}

/**
 * Give the CURRENT entry its browser restoration back ('auto') — called on the feed once its own
 * restore has finished or has nothing to restore, and on the listing page by the watcher above.
 * ⚠️ NOT BEFORE THE DOCUMENT HAS LOADED. On a full-document Back (the listing page was reloaded, so
 * returning to the feed loads it afresh) the browser attempts its restoration during the load, and
 * flipping the entry back to 'auto' before that finishes could re-arm the very jump 'manual' was
 * holding off — on top of the explorer's own restore.
 */
export function releaseScrollRestoration(win: Window = window, stillWanted: () => boolean = () => true): void {
  const release = () => {
    // ⚠️ RE-ASKED WHEN IT FIRES, NOT ONLY WHEN IT WAS SCHEDULED (codex). A release deferred to `load`
    // can fire after the reader has already tapped the next card, i.e. after a NEW hold for a NEW
    // snapshot — and releasing then would silently hand that Back the footer flash again.
    if (!stillWanted()) return
    try { if (win.history.scrollRestoration === 'manual') win.history.scrollRestoration = 'auto' } catch { /* unsupported */ }
  }
  if (win.document.readyState === 'complete') release()
  else win.addEventListener('load', release, { once: true })
}
