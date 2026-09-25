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
 * ⛔ EVERY EASE IS MEASURED IN MILLISECONDS, NEVER IN FRAMES. The first version moved 16% of the
 * remaining distance PER FRAME, so its length was the device's frame rate: at 4x CPU throttling the
 * page was fully ready and the mark was still chasing the end 2.2s later (0.99 at 9.13s, 71 frames at
 * ~30fps). Before ready the smoothing is now `1 - exp(-dt / 90ms)` of the gap per frame, whatever dt
 * is; once ready, the rest of the mark paints on a fixed REVEAL_MS ease-out-cubic, so "ready" is at
 * most REVEAL_MS away from "done" on every device.
 *
 * ⛔ AND IT HAS A CEILING: SPLASH_MAX_MS after NAVIGATION the reveal completes regardless. A dead
 * network must never leave the reader staring at a wordmark — the app behind this can show its own
 * offline state, and this is exactly the reasoning capacitor.config.ts gives for the native splash's
 * own 3s floor. ⚠️ FROM NAVIGATION, NOT FROM THIS EFFECT: the reader has been looking at the
 * server-rendered curtain since first paint, and a timer armed at hydration measured the wrong wait —
 * at 4x CPU it armed at 5.3s and fired at 9.43s. `performance.now()` is the time since navigation, so
 * the timer gets only what is LEFT of the budget (zero, if hydration itself came in late).
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
 *
 * ⛔ NATIVE APP ONLY — owner, 2026-09-25: "Native app only". On the web this curtain held an ALREADY
 * PAINTED page behind a wordmark on every full document load: 1.4–2.5s on a fast phone and 9–10s at 4x
 * CPU (home and PDP, measured on eno.vn 2026-09-24), replayed on every magic-link/OAuth return and every
 * ad, search or Zalo landing. In the native shell it is the hand-over from the OS splash, and there it
 * stays exactly as it was. The gate is the codebase's own native signal, `html.native`, which the
 * pre-paint <head> script in [lang]/layout.tsx sets from `window.Capacitor.isNativePlatform()` (or the
 * native app's EnoNativeTabs UA) BEFORE <body> is parsed — no second detection, no UA sniff here.
 *   · CSS (globals.css, `html:not(.native) #app-splash`) keeps the web from ever PAINTING it. The
 *     server cannot make this call itself: the HTML is ISR-cached and shared by both audiences.
 *   · The first effect below unmounts it on the web before arming a single timer, frame or listener,
 *     so the web runs none of the reveal's work either.
 * ⛔ ONE SIGNAL, READ AT THE MOMENT THE CSS READ IT. The class is sampled while this component RENDERS
 * for hydration — before any effect in the tree has run — so it is exactly what the head script set
 * before first paint, i.e. exactly what `html:not(.native) #app-splash` decided. It is NOT read in the
 * effect, and there is no `isNativeShell()` belt, because both were a split brain (codex, opus): if the
 * head script ever threw inside the app, native-bootstrap's effect adds `native` a moment later — as an
 * earlier sibling in providers.tsx its effect runs BEFORE this one — so an effect-time read would keep
 * a curtain the CSS had hidden, and adding the class would then un-hide it over an app already painted
 * and in use. Read at render, that case degrades to "no splash", which is the harmless direction.
 */
const SPLASH_MAX_MS = 4000
/** Once the page is ready, how long the rest of the mark takes to paint in. Fixed, in ms. */
const REVEAL_MS = 250
/** Time constant of the pre-ready smoothing: ~63% of the remaining gap closes every 90ms. */
const SMOOTH_MS = 90
/** How wide the soft edge is, as a share of the mark. Wide enough to read as cloud, not as a wipe. */
const FEATHER = 0.22

export function AppSplash() {
  // See "ONE SIGNAL" above. `false` on the server, which never runs the effect that reads it.
  const [nativeAtFirstPaint] = useState(() => typeof document !== 'undefined' && document.documentElement.classList.contains('native'))
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
    // ⛔ The web gets no curtain (see the header): leave at hydration, before anything is armed. The
    // server HTML carried the node because it cannot know the client; CSS kept it from painting.
    if (!nativeAtFirstPaint) { setGone(true); return }
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
    let last = performance.now()
    /** Set when the page is ready: the moment, and where the mark stood, the final ease starts from. */
    let readyAt = -1
    let from = 0
    /** Latched once the mark is whole and `done` is set — nothing may write the reveal after that. */
    let finished = false
    const set = (v: number) => root.style.setProperty('--splash-reveal', String(v))
    /**
     * ⚠️ THE CURTAIN'S `data-done` IS WRITTEN HERE AS WELL AS THROUGH STATE. On a slow phone the moment
     * this runs is the tail of hydration, and a setState is then queued behind the rest of the tree:
     * measured at 4x CPU, the ceiling fired and React committed `data-done` 116ms later. The attribute
     * is what starts the CSS fade, so it goes on the node directly; React's own commit of the same
     * attribute follows and changes nothing. `done` state still drives the unmount.
     */
    const markDone = () => { finished = true; root.setAttribute('data-done', ''); setDone(true) }
    set(shown)

    const step = () => {
      if (!alive || finished) return
      // ⚠️ `performance.now()`, NOT the timestamp rAF passes in. That timestamp is when the frame BEGAN,
      // and on a phone mid-hydration a long task can sit between the frame's start and this callback —
      // measured at 4x CPU, a frame running at 3674ms carried a stamp from before a 287ms task, so the
      // "fixed" 250ms ease computed p < 1 and took another frame to finish. The wall clock cannot lag.
      const now = performance.now()
      if (readyAt >= 0) {
        // Ready: finish on the clock. ease-out-cubic over REVEAL_MS from wherever the mark stood, so a
        // slow device drops frames of this ease but never stretches it. (Clamped at 0 for safety.)
        const p = Math.min(1, Math.max(0, now - readyAt) / REVEAL_MS)
        shown = p >= 1 ? 1 : from + (1 - from) * (1 - (1 - p) ** 3)
      } else {
        // Before ready: glide toward the last milestone reached, by a share of the gap that depends on
        // ELAPSED TIME, not on how many frames this device managed. It never overshoots a target.
        const dt = Math.max(0, now - last)
        shown += (target - shown) * (1 - Math.exp(-dt / SMOOTH_MS))
      }
      last = now
      set(shown)
      if (shown >= 1) { markDone(); return }
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
      if (!alive || finished) return
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
      // ⛔ A SNAP ENDS THE LOOP. The ceiling can land in the middle of the timed ease below; the first
      // version of that ease kept running after the snap and pulled the mark back from 1 to ~0.85 while
      // the curtain was already fading (measured at 4x CPU). `finished` stops the loop and any later
      // finish(); cancelling the frame is belt-and-braces.
      if (snap || still || document.hidden) {
        cancelAnimationFrame(raf)
        shown = 1
        set(1)
        markDone()
        return
      }
      // Start the fixed-length final ease once; a second finish() (the ceiling) must not restart it.
      if (readyAt < 0) { readyAt = performance.now(); from = shown }
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

    // ⛔ What is LEFT of the budget since navigation — see the header. Zero if hydration came in late,
    // in which case the curtain lifts on the next task instead of four more seconds from now.
    const ceiling = setTimeout(() => finish(true), Math.max(0, SPLASH_MAX_MS - performance.now()))
    return () => {
      alive = false
      cancelAnimationFrame(raf)
      clearTimeout(ceiling)
      window.removeEventListener('load', onLoad)
      window.removeEventListener('load', onReady)
    }
  }, [nativeAtFirstPaint])

  // Unmount only after the fade, so the node is not ripped out mid-transition. 220ms = the 200ms exit
  // in globals.css (#app-splash) plus a frame of slack; it must never be shorter than that fade.
  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => setGone(true), 220)
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
