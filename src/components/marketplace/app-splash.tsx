'use client'

import { useEffect, useRef, useState } from 'react'
import { IS_SERVICES } from '@/lib/edition'

/**
 * THE LAUNCH REVEAL — the wordmark wipes in from the left behind a soft edge, and the app appears the
 * moment it is genuinely ready.
 *
 * Owner, 2026-09-16: "the eno.vn in open runde reveals from left to right with cloudy soft edge nicely
 * professionally once all revealed open the app so initital loading should follow actual loading in the
 * background and reveal app to users once app is ready to view".
 *
 * ⛔ THE SWEEP FOLLOWS REAL MILESTONES, NOT A TIMER, which is the whole of the owner's ask. Each stage
 * below is a fact about this page, and the bar cannot reach the end until the last one lands:
 *     0.18  this component mounted        → React is hydrating
 *     0.45  document.fonts.ready          → text will not reflow under the reader
 *     0.75  window load                   → the first view's images and CSS are in
 *     1.00  one rAF after all of the above → the frame under the splash is painted
 * ⚠️ IT EASES TOWARD EACH STAGE RATHER THAN JUMPING, because a bar that teleports reads as fake even
 * when it is honest. The easing only ever moves toward a target a real event has already set.
 *
 * ⛔ AND IT HAS A CEILING: after SPLASH_MAX_MS the reveal completes regardless. A dead network must
 * never leave the reader staring at a wordmark — the app behind this can show its own offline state,
 * and this is exactly the reasoning capacitor.config.ts gives for the native splash's own 3s floor.
 *
 * ⛔ ONCE PER DOCUMENT LOAD — WHICH IS NOT THE SAME AS ONCE PER SESSION, and the difference matters here
 * because sign-in is passwordless: a magic link and an OAuth return are both FULL document loads, so the
 * reveal plays again on the callback (astra). That is accepted rather than fixed: the callback resolves
 * fast, so the curtain lifts as soon as it is ready — and persisting "seen" in storage would mean a
 * visitor who reloads a slow page gets no feedback at all, which is worse than seeing the mark twice.
 * Client navigation never replays it: the provider tree survives, so this mounts once per document.
 *
 * ⚠️ SSR'd ON PURPOSE. The overlay is in the server HTML, so it covers the first paint instead of
 * appearing after hydration — in the native shell, where native-bootstrap hides Capacitor's own splash
 * at first paint, this is what the WebView reveals underneath it.
 */
const SPLASH_MAX_MS = 4000
/** How wide the soft edge is, as a share of the mark. Wide enough to read as cloud, not as a wipe. */
const FEATHER = 0.22

export function AppSplash() {
  const [done, setDone] = useState(false)
  const [gone, setGone] = useState(false)
  const el = useRef<HTMLDivElement>(null)

  /**
   * ⚠️ NO `inert` LOCK ON THE PAGE BEHIND THIS, AND THAT IS A DECISION MADE AFTER TRYING ONE. astra was
   * right that an opaque overlay stops pointers but not Tab, so for up to ~4s a keyboard user can reach
   * controls they cannot see. The obvious fix — `inert` on every body child while the curtain is down —
   * was written, measured (all 15 siblings locked, all released) and then REMOVED, because the panel
   * found it does more harm than the hole it closes:
   *   · A focused element that becomes inert hands focus back to <body>, and nothing restores it. React
   *     applies `autoFocus` during commit and effects run after — so the sign-in code field, on the
   *     passwordless path that is a FULL page load every time, opened with no cursor and no mobile
   *     keyboard (opus).
   *   · The CSS bailout hides this overlay at 8s without React. If hydration lands after that, the effect
   *     would lock a page the visitor is already USING, with no overlay to explain it (astra).
   *   · A portal mounted after the snapshot escapes the lock anyway, while a dialog that legitimately
   *     paints above the splash gets locked (astra).
   * The window is bounded by the same 4s ceiling as everything else here, and nothing behind the curtain
   * is destructive to activate. Fixing it properly means a focus trap that restores what it took —
   * worth doing if the splash ever grows beyond a few seconds, and not worth a broken sign-in today.
   */

  useEffect(() => {
    const root = el.current
    if (!root) return
    /**
     * ⚠️ REDUCED MOTION SKIPS THE SWEEP, NOT THE WAIT. The mark is painted whole immediately, but the
     * overlay still leaves only when the page is READY — an early exit would hand this reader a
     * half-hydrated, shifting layout, which is the opposite of the accommodation (agy).
     */
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

    let target = still ? 1 : 0.18
    // Starts where the CSS already painted it (see --splash-reveal in globals.css), so hydration
    // continues the sweep instead of restarting it from an invisible mark.
    let shown = still ? 1 : 0.12
    let raf = 0
    let alive = true
    const set = (v: number) => root.style.setProperty('--splash-reveal', String(v))
    set(shown)

    const step = () => {
      if (!alive) return
      // Critically-damped-ish easing: 16% of the remaining distance each frame, so it glides into each
      // milestone and never overshoots. Snap the last hair so the mark always finishes fully painted.
      shown += (target - shown) * 0.16
      if (target >= 1 && target - shown < 0.004) shown = 1
      set(shown)
      if (shown >= 1) { setDone(true); return }
      raf = requestAnimationFrame(step)
    }
    if (!still) raf = requestAnimationFrame(step)

    const reach = (v: number) => { if (v > target) target = v }
    /**
     * ⛔ FINISHING CANNOT DEPEND ON A FRAME. requestAnimationFrame is PAUSED in a background tab, so a
     * reader who opened the app in another tab and came back would have found the overlay still mounted,
     * its easing frozen mid-sweep and `done` never set (opus). The last step is therefore taken here,
     * synchronously: paint the mark whole and mark it done, whatever the frame clock is doing.
     */
    const finish = (snap = false) => {
      if (!alive) return
      reach(1)
      // ⚠️ SNAP ONLY WHEN A FRAME CANNOT BE TRUSTED. Forcing shown to 1 on every finish teleported the
      // mark on a warm cache, where the page is already complete when this mounts (opus, agy). A visible
      // tab eases to the end through the loop below; a hidden tab or the ceiling takes the shortcut,
      // because there rAF is paused and easing would never arrive.
      // ⛔ `still` TAKES THE SHORTCUT TOO, AND LEAVING IT OUT COST A 4-SECOND STALL. With reduced motion
      // the rAF loop is never started (there is no sweep to run), so the eased path that normally
      // reaches 1 does not exist — finish() returned without setting `done` and the overlay sat there
      // until the 4s ceiling, on every single load. Both reviewers found it; it is the accommodation
      // becoming the punishment.
      if (snap || still || document.hidden) {
        shown = 1
        set(1)
        setDone(true)
      }
    }

    let fontsDone = false
    let pageDone = false
    const onFonts = () => { fontsDone = true; reach(0.45); if (pageDone) settle() }
    const onLoad = () => reach(0.75)
    /**
     * "Ready to view" = the page has LOADED, the FONTS have resolved, and the browser has had a frame to
     * paint both. Waiting on window load alone let the curtain lift while text was still swapping face
     * underneath it (astra) — which is the reflow this screen exists to hide.
     */
    const settle = () => requestAnimationFrame(() => requestAnimationFrame(() => finish()))
    const onReady = () => { pageDone = true; if (fontsDone) settle() }

    // ⚠️ `?.ready` GUARDS THE OBJECT, NOT THE CHAIN. Where FontFaceSet is missing (older WebViews, and
    // jsdom in this repo's own tests) `document.fonts?.ready` is undefined and `.then` on it throws
    // inside the effect — a hydration crash, from a progress bar (agy). Resolve it either way.
    const fontsReady = document.fonts?.ready
    if (fontsReady) void fontsReady.then(onFonts).catch(onFonts)
    else onFonts()
    if (document.readyState === 'complete') { onLoad(); onReady() } else {
      window.addEventListener('load', onLoad, { once: true })
      window.addEventListener('load', onReady, { once: true })
    }

    const ceiling = setTimeout(() => finish(true), SPLASH_MAX_MS)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      clearTimeout(ceiling)
      window.removeEventListener('load', onLoad)
      window.removeEventListener('load', onReady)
    }
  }, [])

  // Unmount only after the fade, so the node is not ripped out mid-transition.
  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => setGone(true), 620)
    return () => clearTimeout(t)
  }, [done])

  if (gone) return null

  return (
    <div ref={el} id="app-splash" data-edition={IS_SERVICES ? 'services' : 'marketplace'} data-done={done ? '' : undefined} aria-hidden="true">
      {/* The mark is an <img>, not an inline <svg>: both files are ~5KB of path data that would
          otherwise sit in the server HTML of every single page, and the browser has them cached from
          the header's own use. `fetchPriority=high` because this IS the first paint.
          ⚠️ PER-EDITION FILE — logo-dotvn.svg spells the licensed marketplace's name and must never
          render on eno.forum, and logo-dotforum.svg the reverse. */}
      <img
        src={IS_SERVICES ? '/logo-dotforum.svg' : '/logo-dotvn.svg'}
        alt=""
        fetchPriority="high"
        decoding="sync"
        draggable={false}
      />
    </div>
  )
}
