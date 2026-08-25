/**
 * HOW MANY PHOTO SLOTS A LISTING CARD SHOWS, and what the last one is.
 *
 * The card is divided into at most FOUR slots, and sweeping the pointer across the photo
 * left→right walks them (owner, 2026-08-09, citing Avito: "when you hover on product from left to
 * right it show 5 images it has and last section is look more +n images and opens product page …
 * show 3 and last 4th is look more +n images if it has more than 4, if 4 just show 4").
 *
 * ⚠️ FOUR IS A CEILING ON SLOTS, NOT ON PHOTOS. With five or more photos the fourth slot stops
 * being a photo and becomes the doorway to the PDP, so the strip is 3 photos + "+N". With four or
 * fewer, every slot is a real photo and there is no doorway — a "+0" tile would be a dead end, and
 * the owner asked for exactly four photos in that case.
 *
 * Why a ceiling at all: the card is a decision surface, not a gallery. Past ~4 the zones get too
 * narrow to aim at (a 2-col phone card is ~180px → 45px per slot), the dot strip stops being
 * countable, and every extra slot is another full-size image decoded on hover across a 48-card
 * grid. The PDP owns the full gallery; the card's job is to earn the click.
 *
 * Lives in lib/ rather than inline in the card so the off-by-one that this function exists to get
 * right can actually be tested at every count — see card-slots.test.ts.
 */
export const CARD_SEGMENTS = 4

export type CardSlots = {
  /** Photos that get a slide of their own. */
  photoCount: number
  /** True when there are more photos than slots, so the last slot is the "+N" doorway. */
  overflow: boolean
  /** What the doorway advertises. 0 when there is no doorway. */
  moreCount: number
  /** Slides actually rendered = photos + the doorway, if any. */
  segments: number
}

export function cardSlots(imageCount: number): CardSlots {
  // Defensive floor: a negative or fractional length is not reachable from `images.length`, but
  // this is also the function a future caller will reach for with a server-side count.
  const n = Math.max(0, Math.floor(imageCount) || 0)
  const overflow = n > CARD_SEGMENTS
  const photoCount = overflow ? CARD_SEGMENTS - 1 : n
  // Counts every photo the strip does not show CLEANLY — which includes the one dimmed behind the
  // doorway's scrim, because a photo under a 55% scrim has been teased, not shown. So 9 photos
  // reads "+6": three you saw, six you did not. Derived from photoCount rather than a literal 3 so
  // it stays honest if the ceiling ever moves.
  const moreCount = overflow ? n - photoCount : 0
  return { photoCount, overflow, moreCount, segments: photoCount + (overflow ? 1 : 0) }
}

/**
 * Should a finished touch gesture page the card's photo strip?
 *
 * ⚠️ THIS IS A PURE FUNCTION BECAUSE THE INLINE VERSION COULD NOT BE PROVEN. The decision used to
 * live in `listing-card.tsx`'s `onTouchEnd`, where the only way to exercise it is a real multi-photo
 * card under a real touch driver — and the live catalogue is single-image, so `segments < 2` short-
 * circuits every gesture and a browser probe can only ever report "nothing happened". A rule that
 * cannot fail visibly is a rule nobody can check.
 *
 * The rule itself, and why each clause is there:
 *  · DISTANCE **OR** VELOCITY. Distance alone ignored a decisive flick — the short, fast gesture
 *    people actually make on a photo — while rewarding a slow 41px drag. `listing-gallery.tsx`
 *    reached the same conclusion for the lightbox; this is the higher-traffic surface.
 *  · AXIS LOCK ON BOTH BRANCHES. The card sits in a VERTICALLY SCROLLING feed, so a fast
 *    flick-scroll that drifts sideways must not page the photo. The distance branch shipped without
 *    this and a ≥41px lateral drift during a scroll already paged it.
 *  · A 20px FLOOR under the velocity branch, so a tap whose finger rolls two pixels in 3ms — an
 *    enormous px/ms — is not a swipe.
 */
export const SWIPE_DISTANCE_PX = 40
export const FLICK_MIN_PX = 20
export const FLICK_MIN_VELOCITY = 0.4

export function isSwipe(dx: number, dy: number, elapsedMs: number): boolean {
  const ax = Math.abs(dx)
  if (ax <= Math.abs(dy)) return false
  const ms = Math.max(1, elapsedMs)
  return ax > SWIPE_DISTANCE_PX || (ax > FLICK_MIN_PX && ax / ms > FLICK_MIN_VELOCITY)
}
