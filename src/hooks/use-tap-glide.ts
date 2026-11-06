import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'

/**
 * Tapping a category tile changes the layout on purpose: on a phone the tile grid folds into one row and the results rise 115 px, on
 * desktop the brand row opens and they drop 108 px, and the tiles to the right of the tapped one slide aside for its subcategories, then
 * back when the counts arrive and the plate narrows. All of it happened in single frames, so the page visibly jumped under the finger
 * (owner, 2026-11-04: "fix tiles jump"). It scores 0 on PageSpeed because it follows a tap; a person still sees it.
 *
 * The layout stays what it is. Each piece moves from where it WAS to where it now is, on the compositor (FLIP).
 *
 * ⚠️ `offsetTop` / `offsetLeft`, NOT getBoundingClientRect: they are the layout's own answer, so page scrolling and a running glide's
 * transform do not read as a move. Review found both ways the rect went wrong: a flick during the wait lurched the whole ladder, and a
 * second tap mid-glide jumped by what was left of the first.
 * ⚠️ IT FOLLOWS, IT DOES NOT FIRE ONCE. The moves land in several commits (the fold, then the plate narrowing when the counts answer about
 * half a second later), so it looks at every commit from the tap until shortly after the last move, and a move during a glide starts from
 * where the piece is on screen.
 * ⛔ "WHERE IT IS ON SCREEN" IS WORKED OUT FROM THE GLIDE'S OWN START AND CURVE, NEVER READ FROM getComputedStyle. The glide runs on the
 * compositor; the page's copy of it is only as fresh as the page's last frame, and while the page is busy rendering the new results it
 * can still say "not started" when the screen shows it nearly done. Reading that put every tile back where it was before the tap for a
 * frame, over the narrowed plate (live, desktop, 2026-11-06, screen frames). It also never mistakes a tile's own CSS transform for a glide.
 * Start: the animation's startTime once the page has it; before that, the first frame after it was made (a glide reaches the screen
 * only in a frame, and that frame's rAF runs first); with neither, it has not been drawn and the screen still shows its first keyframe.
 * And a glide that replaces one in flight is set again in that first frame, from where the old one is THEN: a page busy after the commit
 * reaches the frame late, and the screen played the old glide meanwhile (measured: 54-115 px back without it, 0 with it, harness below).
 * ⚠️ Not `composite: 'add'`, which needs no clock: Chrome runs an additive animation on the page's thread, so a busy page froze the tile
 * for 250 ms and then jumped it (harness). Proof of all this: ~/eno-perf-2026-11/glide-race (screen frames, old vs this, busy timings).
 * ⚠️ NO DEPENDENCY LIST ON THE EFFECT, AND THAT COSTS ONE NULL CHECK: outside that window it does nothing. Inside it, a second filter
 * tapped within the second also glides, which is the same page settling and looks the same.
 * ⚠️ `transform` AND `opacity` ONLY: nothing lays out again per frame, so a slow phone cannot drop into a jank here.
 * ⚠️ NOT WHEN THE VISITOR ASKED FOR LESS MOTION: they get the old instant change.
 */
const GLIDE_MS = 220
const CURVE = [0.23, 1, 0.32, 1] as const // --ease-out-strong; WAAPI cannot read a CSS variable
const EASE_OUT_STRONG = `cubic-bezier(${CURVE.join(', ')})`
const WAIT_FOR_FIRST_MOVE_MS = 1500
const FOLLOW_AFTER_A_MOVE_MS = 1000
const MIN_MOVE_PX = 4

type Place = { x: number; y: number }
type Watch = { until: number; places: Map<HTMLElement, Place> }
/**
 * A glide this hook started: the offset it starts from (`move`, its own layout change, plus what `after` still had to go), and when it
 * reached the screen as far as the page can know.
 */
type Glide = { from: Place; move: Place; after: Glide | undefined; made: number; framed: number | null; anim: Animation | undefined }

const placeOf = (el: HTMLElement): Place => ({ x: el.offsetLeft, y: el.offsetTop })
const translateOf = (p: Place) => `translate(${p.x}px, ${p.y}px)`

/** The rows of the ladder, and the tiles inside it. Not one with no layout of its own (`display: none`, offsetParent null). */
function piecesOf(box: HTMLElement, tiles: string): HTMLElement[] {
  return [...new Set([...box.children, ...box.querySelectorAll(tiles)])].filter((el): el is HTMLElement => el instanceof HTMLElement && el.offsetParent !== null)
}

/** cubic-bezier(x1, y1, x2, y2) as a function of time, the same curve the browser runs the glide on. */
function bezier(x1: number, y1: number, x2: number, y2: number): (p: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
  const x = (t: number) => ((ax * t + bx) * t + cx) * t
  const y = (t: number) => ((ay * t + by) * t + cy) * t
  return (p) => {
    if (p <= 0) return 0
    if (p >= 1) return 1
    // x(t) rises from 0 to 1 for these control points, so halving finds t; 30 rounds is far below a pixel.
    let lo = 0, hi = 1, t = p
    for (let i = 0; i < 30; i++) { if (x(t) < p) lo = t; else hi = t; t = (lo + hi) / 2 }
    return y(t)
  }
}
export const easeOutStrong = bezier(...CURVE)

/** How far a glide this hook started still has the piece off its place, on screen, at `now`. */
function offsetOnScreen(glide: Glide | undefined, now: number): Place {
  // Cancelled ('idle'): it no longer moves anything, and a cancelled animation has no startTime to tell it from one not yet drawn.
  if (!glide || glide.anim?.playState === 'idle') return { x: 0, y: 0 }
  const known = glide.anim?.startTime
  const start = typeof known === 'number' ? known : glide.framed
  if (start === null) return glide.from // not drawn yet: the screen shows its first frame
  const left = 1 - easeOutStrong(Math.min(1, Math.max(0, (now - start) / GLIDE_MS)))
  return { x: glide.from.x * left, y: glide.from.y * left }
}

/** Returns what to call right before the state change. `containerRef`'s direct children glide, and whatever in it matches `tiles`. */
export function useTapGlide(containerRef: RefObject<HTMLElement | null>, tiles: string): () => void {
  const watch = useRef<Watch | null>(null)
  const glides = useRef(new WeakMap<HTMLElement, Glide>())

  useLayoutEffect(() => {
    const seen = watch.current
    if (!seen) return
    const box = containerRef.current
    const now = performance.now()
    if (!box || now > seen.until) { watch.current = null; return }
    const timing = { duration: GLIDE_MS, easing: EASE_OUT_STRONG }
    const pieces = piecesOf(box, tiles)
    const places = new Map<HTMLElement, Place>()
    const fresh: Glide[] = []
    let moved = false
    for (const el of pieces) {
      const place = placeOf(el)
      places.set(el, place)
      const was = seen.places.get(el)
      if (!was) {
        // A row that arrived fades in. A tile that arrived belongs to a row doing that, or to the rail's own entrance.
        if (el.parentElement === box) { el.animate?.([{ opacity: 0 }, { opacity: 1 }], timing); moved = true }
        continue
      }
      const dx = was.x - place.x
      const dy = was.y - place.y
      if (Math.abs(dx) < MIN_MOVE_PX && Math.abs(dy) < MIN_MOVE_PX) continue
      const after = glides.current.get(el)
      const on = offsetOnScreen(after, now)
      const from = { x: dx + on.x, y: dy + on.y }
      const anim = el.animate?.([{ transform: translateOf(from) }, { transform: 'translate(0, 0)' }], timing)
      moved = true
      // No animation made (no WAAPI): the piece moved at once, and nothing is left in flight to carry into a later move.
      if (!anim) { glides.current.delete(el); continue }
      const glide: Glide = { from, move: { x: dx, y: dy }, after, made: now, framed: null, anim }
      glides.current.set(el, glide)
      fresh.push(glide)
    }
    // The frame that draws them. A busy page can reach it long after `now`, and until then the screen plays the glide being replaced, so
    // each new glide's start is worked out again for this frame and set before it paints (setKeyframes on a glide not drawn yet).
    if (fresh.length && typeof requestAnimationFrame === 'function') requestAnimationFrame((t) => {
      for (const g of fresh) {
        if (g.framed !== null) continue
        g.framed = Math.max(t, g.made)
        const after = g.after
        g.after = undefined // read once, here: a tile keeps no chain of old glides across taps
        // Already on screen (a commit that landed after this frame's rAF ran, so it painted a frame earlier): leave it as drawn.
        if (!after || typeof g.anim?.startTime === 'number' || g.anim?.pending === false) continue
        const on = offsetOnScreen(after, g.framed)
        const from = { x: g.move.x + on.x, y: g.move.y + on.y }
        if (Math.abs(from.x - g.from.x) < 0.5 && Math.abs(from.y - g.from.y) < 0.5) continue
        g.from = from
        const effect = g.anim?.effect as KeyframeEffect | null | undefined
        effect?.setKeyframes?.([{ transform: translateOf(from) }, { transform: 'translate(0, 0)' }])
      }
    })
    seen.places = places
    if (moved) seen.until = now + FOLLOW_AFTER_A_MOVE_MS
  })

  return useCallback(() => {
    const box = containerRef.current
    if (!box || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const places = new Map(piecesOf(box, tiles).map((el) => [el, placeOf(el)] as const))
    watch.current = { until: performance.now() + WAIT_FOR_FIRST_MOVE_MS, places }
  }, [containerRef, tiles])
}
