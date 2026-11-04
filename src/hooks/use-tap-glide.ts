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
 * ⚠️ NO DEPENDENCY LIST ON THE EFFECT, AND THAT COSTS ONE NULL CHECK: outside that window it does nothing. Inside it, a second filter
 * tapped within the second also glides, which is the same page settling and looks the same.
 * ⚠️ `transform` AND `opacity` ONLY: nothing lays out again per frame, so a slow phone cannot drop into a jank here.
 * ⚠️ NOT WHEN THE VISITOR ASKED FOR LESS MOTION: they get the old instant change.
 */
const GLIDE_MS = 220
const EASE_OUT_STRONG = 'cubic-bezier(0.23, 1, 0.32, 1)' // --ease-out-strong; WAAPI cannot read a CSS variable
const WAIT_FOR_FIRST_MOVE_MS = 1500
const FOLLOW_AFTER_A_MOVE_MS = 1000
const MIN_MOVE_PX = 4

type Place = { x: number; y: number }
type Watch = { until: number; places: Map<HTMLElement, Place> }

const placeOf = (el: HTMLElement): Place => ({ x: el.offsetLeft, y: el.offsetTop })

/** The rows of the ladder, and the tiles inside it. Not one with no layout of its own (`display: none`, offsetParent null). */
function piecesOf(box: HTMLElement, tiles: string): HTMLElement[] {
  return [...new Set([...box.children, ...box.querySelectorAll(tiles)])].filter((el): el is HTMLElement => el instanceof HTMLElement && el.offsetParent !== null)
}

/** How far a running glide has this piece off its place right now. */
function offsetOnScreen(el: HTMLElement): Place {
  const t = getComputedStyle(el).transform
  if (!t || t === 'none' || typeof DOMMatrixReadOnly === 'undefined') return { x: 0, y: 0 }
  const m = new DOMMatrixReadOnly(t)
  return { x: m.m41, y: m.m42 }
}

/** Returns what to call right before the state change. `containerRef`'s direct children glide, and whatever in it matches `tiles`. */
export function useTapGlide(containerRef: RefObject<HTMLElement | null>, tiles: string): () => void {
  const watch = useRef<Watch | null>(null)

  useLayoutEffect(() => {
    const seen = watch.current
    if (!seen) return
    const box = containerRef.current
    const now = performance.now()
    if (!box || now > seen.until) { watch.current = null; return }
    const timing = { duration: GLIDE_MS, easing: EASE_OUT_STRONG }
    const pieces = piecesOf(box, tiles)
    const places = new Map<HTMLElement, Place>()
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
      const on = offsetOnScreen(el)
      el.animate?.([{ transform: `translate(${dx + on.x}px, ${dy + on.y}px)` }, { transform: 'translate(0, 0)' }], timing)
      moved = true
    }
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
