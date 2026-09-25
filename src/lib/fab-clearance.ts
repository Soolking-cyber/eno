/**
 * THE FLOATING CONTROLS' RULES — back-to-top.tsx's arithmetic, kept pure so it can be pinned.
 *
 * Owner, 2026-09-25: "back-to-top arrow shows ONLY while the user scrolls UP (hidden while scrolling
 * down and near the top), and both it and the support bubble never overlap the right column's save
 * hearts and lift above the product page's sticky buy/CTA bar".
 *
 * 1. `nextScrollDirection` — which way the reader last MEANT to scroll (the chevron's WHEN).
 * 2. `planClearance` — at rest, what each visible control does about a page control under it (WHERE).
 *
 * ⛔ WHY NOT A NEW PLACE ON THE SCREEN. The cluster lives at the right edge, and so does every card's
 * save heart: on a 390px phone the right column's hearts are centred at x≈354 and the cluster spans
 * x 330–374. Measured on eno.vn before this (16-fab-steal.js): 7 of 70 rest positions handed a heart tap
 * to "Back to top" (which then threw the reader's scroll away) or to "Contact support". And no lane is
 * free: sweeping the home feed up in 90px steps, a control sat under a cluster-sized box at 32/70 rests
 * at the right edge, 17/70 one card-width in, 28/70 at the centre and 19/70 at the LEFT edge (rail
 * headers' "See all", "Browse everything", chips). Moving the cluster would change who it covers, not
 * whether it covers.
 *
 * ⛔ WHY TWO ANSWERS — LIFT FOR A BAR, YIELD FOR A SMALL CONTROL — AND NOT ONE. MEASURED on that sweep
 * (checks/sim.js, same 70 rest positions, several policies replayed on the same obstacles):
 *   · lifting the whole column above whatever is under it moved it at 47 of 70 rests, by 94px on
 *     average and up to 266px; "stay put while clear, else nearest clear place" still moved it at 37,
 *     drifting up to 316px. A right-edge column meets a heart or a "See all" roughly every 150px, so
 *     any MOVE rule moves it on most stops — floating chrome that hops whenever you stop reads as jitter,
 *     and a control that moves as you reach for it is the tap-steal in a different form.
 *   · a full-width control (the PDP's CTA, "Browse everything") is different: it spans every lane, so
 *     the only way off it is up — exactly the owner's "lift above the … CTA bar" — and it is rare (2
 *     moves on the same sweep).
 * So: rise just above a WIDE control; over a SMALL one (a heart, a link, a chip), the one floating
 * control that is on it YIELDS — fades out and goes inert — and nothing moves. It comes back the moment
 * the page moves again. Measured with that rule: 2 moves, and a control yielded at ~a third of rests.
 */

/**
 * ⛔ A YIELD HIDES FROM THE FINGER AND THE EYE, NOT FROM THE KEYBOARD OR A SCREEN READER. The first
 * version made a yielded control `inert` — and a control sits over something at ~a third of rests, so
 * a keyboard user tabbing toward "Contact support" found it missing from the tab order for a reason
 * that exists only on screen (opus). Now it stays focusable and announced, and shows itself whenever
 * it HAS focus — `:focus`, not `:focus-visible`: focus restored to it by a closing sheet is programmatic,
 * and Safari may not count that as visible, which would leave a focused control that cannot be seen
 * (codex, opus). It still takes NO POINTER while yielded, focused or not: keyboard activation needs
 * none, and a mark that took pointers again after Escape returned focus to it would be back on the
 * heart it yielded to.
 * Shared by back-to-top.tsx and support-button.tsx, so the two controls yield the same way. (A class
 * string in a .ts file is fine: Tailwind scans every source file, not just .tsx.)
 */
export const YIELDED = 'pointer-events-none opacity-0 focus:opacity-100'

export type Box = { top: number; bottom: number; left: number; right: number }

/** The app's tap-target floor (`tap-44`): a 32px heart takes taps across 44px via a ::before, and a
 *  rect from getBoundingClientRect cannot see a pseudo-element, so every obstacle is grown to it. */
export const TAP_FLOOR = 44
/** Air between the lifted cluster and the control it rose above. */
export const CLEARANCE_GAP = 8
/**
 * Anything taller than this is not a control the cluster could be covering by accident — it is a
 * card's stretched link (`absolute inset-0` over a ~250–300px card) or a media button (the PDP gallery).
 * The floating cluster sits over cards BY DESIGN; clearing a whole card would put it at the top of the
 * screen. A CTA is 44–56px, a heart 32px, a chip 36px — and 160 rather than 96 leaves room for a CTA
 * whose label wraps at a large OS text size (codex), which is still a control.
 */
export const MAX_OBSTACLE_HEIGHT = 160

/** Grow a rect to the tap floor around its own centre. */
export function tapBox(r: { top: number; bottom: number; left: number; right: number }): Box {
  const w = Math.max(r.right - r.left, TAP_FLOOR)
  const h = Math.max(r.bottom - r.top, TAP_FLOOR)
  const cx = (r.left + r.right) / 2
  const cy = (r.top + r.bottom) / 2
  return { left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2 }
}

/**
 * The smallest UPWARD lift (px, 0..`maxLift`) at which `box` comes within `gap` of none of `obstacles`,
 * or `null` when there is no such place within `maxLift` — the caller then stands the controls down
 * rather than cover something. Never downward: the resting place is already the lowest the cluster may
 * go (the tab bar is under it).
 * Each obstacle forbids the open interval of lifts at which the moved box would touch it; the answer is
 * the lowest lift left over. Only ever asked about BARS (see the header and `planClearance`).
 */
export function clearanceLift(box: Box, obstacles: readonly Box[], maxLift: number, gap = CLEARANCE_GAP): number | null {
  const forbidden = obstacles
    .filter((o) => o.right > box.left && o.left < box.right)
    .map((o) => [box.top - o.bottom - gap, box.bottom - o.top + gap] as const)
    .filter(([lo, hi]) => hi > 0 && lo < maxLift)
    .sort((a, b) => a[0] - b[0])
  let lift = 0
  for (const [lo, hi] of forbidden) {
    if (lo >= lift) break // a clear gap below this interval: `lift` is free
    lift = Math.max(lift, hi)
  }
  return lift <= maxLift ? lift : null
}

/** A control at least this share of the viewport wide is a BAR: it spans every lane, so the cluster
 *  rises above it. Narrower ones are what the cluster yields to. The PDP CTA is 366/390 = 94%. */
export const WIDE_SHARE = 0.6
/** …or at least this wide in absolute terms, which is what a bar is on a DESKTOP: the PDP's buy box
 *  sits in a 5/12 column there, so its CTA is ~400px of a 1280px window — a bar, not a heart (codex).
 *  Hearts, links and chips are all far narrower. */
export const WIDE_MIN_PX = 240

const overlaps = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

export type ClearancePlan = { rise: number; standDown: boolean; yielded: boolean[] }

/**
 * What the visible floating controls do at rest (see the header for why it is shaped this way).
 * `parts` are the controls' boxes at their RESTING place; `obstacles` are page controls already grown to
 * the tap floor. Returns the rise (px) above the resting place, whether the whole cluster stands down
 * (no clear place above a bar within `maxLift`), and, per part, whether it yields to a small control
 * under it. Yielding is judged on the tap boxes themselves, with no extra air: two 44px targets that
 * only touch share no pixel a finger could mean for both.
 */
export function planClearance(parts: readonly Box[], obstacles: readonly Box[], viewportWidth: number, maxLift: number): ClearancePlan {
  if (!parts.length) return { rise: 0, standDown: false, yielded: [] }
  const union: Box = {
    top: Math.min(...parts.map((p) => p.top)),
    bottom: Math.max(...parts.map((p) => p.bottom)),
    left: Math.min(...parts.map((p) => p.left)),
    right: Math.max(...parts.map((p) => p.right)),
  }
  const isWide = (o: Box) => o.right - o.left >= Math.min(WIDE_SHARE * viewportWidth, WIDE_MIN_PX)
  const rise = clearanceLift(union, obstacles.filter(isWide), maxLift)
  if (rise === null) return { rise: 0, standDown: true, yielded: parts.map(() => true) }
  const small = obstacles.filter((o) => !isWide(o))
  return {
    rise,
    standDown: false,
    yielded: parts.map((p) => small.some((o) => overlaps({ ...p, top: p.top - rise, bottom: p.bottom - rise }, o))),
  }
}

export type ScrollDir = { anchor: number | null; height: number; up: boolean }
/** Deltas below this are finger jitter and rubber-band, never a decision — same as use-hide-on-scroll. */
export const DIR_THRESHOLD = 6

/**
 * ⚠️ THE SAME READING OF A SCROLL AS use-hide-on-scroll.ts, which the tab bar and the support bubble
 * ride on — but that hook starts at "show", and the chevron must start HIDDEN: it appears only after a
 * real upward scroll (owner). So this keeps its own flag, with the hook's two hard-won rules:
 *   · the first frame only adopts a reference (a page restored mid-scroll is not one huge scroll-down);
 *   · a document that GREW is not a reader who scrolled — at the bottom of an infinite feed the browser
 *     moves scrollY by the appended height with nobody touching the screen. Re-anchor, decide nothing.
 */
export function nextScrollDirection(s: ScrollDir, y: number, height: number): ScrollDir {
  const at = Math.max(0, y)
  if (s.anchor === null) return { anchor: at, height, up: s.up }
  if (height !== s.height) return { anchor: at, height, up: s.up }
  const d = at - s.anchor
  if (Math.abs(d) <= DIR_THRESHOLD) return s
  return { anchor: at, height, up: d < 0 }
}
