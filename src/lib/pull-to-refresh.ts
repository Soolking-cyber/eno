/**
 * THE PULL GESTURE'S ARITHMETIC, kept out of the component so it can be tested without a touchscreen.
 *
 * Owner, 2026-09-18, pointing at the 58 app: "when screen pulled down cool small animation with
 * character". 58's home answers a downward drag at the top of the feed with a little mascot and the
 * label 松手刷新 — "let go to refresh" — and that is the shape copied here.
 */

/** Past this many pixels of PULL (not of finger travel — see `pullDistance`), releasing refreshes. */
export const PULL_THRESHOLD = 64
/** The pull cannot grow past this, so a long drag does not push the mascot off the screen. */
export const PULL_MAX = 112

/**
 * ⛔ RESISTANCE, NOT A 1:1 FOLLOW. A finger that moves 200px must not move the indicator 200px: the
 * whole point of a rubber-band is that the surface pulls BACK, which is what tells the hand it has
 * reached the end of the list. The curve is deliberately simple — half of the travel, then a hard
 * cap — because anything fancier is unverifiable by feel and this one can be read off the number.
 * ⚠️ NEGATIVE AND ZERO TRAVEL RETURN 0, so an upward drag never registers as a pull; the caller
 * decides whether the gesture is live, this only shapes it.
 */
export function pullDistance(travel: number): number {
  if (travel <= 0) return 0
  return Math.min(PULL_MAX, travel * 0.5)
}

export type PullState = 'idle' | 'pulling' | 'ready' | 'refreshing'

/** What the label and the mascot should be saying at this distance. */
export function pullState(distance: number, refreshing: boolean): PullState {
  if (refreshing) return 'refreshing'
  if (distance <= 0) return 'idle'
  return distance >= PULL_THRESHOLD ? 'ready' : 'pulling'
}

/**
 * 0 → 1 across the pull, for opacity and scale. ⚠️ IT SATURATES AT THE THRESHOLD, not at PULL_MAX:
 * the indicator should be fully itself at the moment releasing would refresh, so the last 48px of
 * over-pull is slack the hand can feel without anything more to look at.
 */
export function pullProgress(distance: number): number {
  return Math.max(0, Math.min(1, distance / PULL_THRESHOLD))
}
