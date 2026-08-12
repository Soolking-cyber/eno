import { cn } from '@/lib/utils'

/** The nine files in `public/mascots/`. Exported as a value, not just a union, so
 *  `mascot.test.ts` can stat the real directory and catch a name with no file behind it. */
export const MASCOT_NAMES = [
  'wave',
  'saved',
  'help',
  'key',
  'search',
  'profile',
  'chat',
  'success',
  'cookie',
] as const

export type MascotName = (typeof MASCOT_NAMES)[number]

/**
 * eno.vn's shield mascots (public/mascots/*.svg), rendered as a CSS mask filled with
 * `currentColor`, so they're crisp at any size and adapt to the theme automatically: dark
 * line-art in light mode, light line-art in dark mode (via `text-foreground`). No raster,
 * no dark-mode invert hacks. Pass `white` to force white (e.g. on the blue panel).
 *
 * ⚠️ The nine files are not nine drawings — they are ONE drawing with nine props. The whole
 * body is generated from a single rig, so every one of these numbers is byte-identical across
 * all nine: canvas `viewBox="0 0 512 512"`; shield outer width 248, centre x 234, crown y 70,
 * tip y 384 (H/W 1.266); feet on the ground line y 411; line weight 8 outer / 4.8 rim; eyes on
 * y 219, 85 apart. Because the box is square and `mask-size: contain`, swapping mascots moves
 * nothing but the prop.
 *
 * The rig runs all the way out to the fingertips, which is the part that got missed the first
 * time round: ONE hand (the mitten) on all eighteen limbs, and ONE reach — every wrist sits
 * exactly 62 units from its shoulder pivot, so a pose changes an ANGLE and nothing else. Props
 * share one slot too: centre (410, 250), 92-unit box, no prop line thinner than 8. Nothing is
 * grounded on the foot line and nothing floats up at crown height.
 *
 * Do NOT hand-edit these files and do not drop a fresh trace in raw — an individually drawn
 * shield cannot be registered onto the others by scaling (that was tried; aspect ratio,
 * apex and foot line all stayed adrift), and a hand authored per pose is what gave the family
 * four different hand vocabularies. Regenerate the set from the rig instead
 * (eno-icons-gauntlet/scripts/mascot-draw.mjs) and gate it on the measured spread
 * (mascot-verify2.mjs for the body, mascot-verify3.mjs for limbs, props and weight).
 *
 * ⛔ THE PROPS ON `key` AND `profile` HAVE DIVERGED FROM THE RIG — CARRY THEM FORWARD BY HAND.
 * Those two prop groups are hand-authored here (see below) and `mascot-draw.mjs` lives in another
 * repository, so it still emits the potrace props these replaced. A regeneration will silently
 * revert them, and `mascot-verify3.mjs` — which gates props and weight — has never been run
 * against a stroked group and may reject one. Re-apply the two `<g fill="none" stroke="…">`
 * blocks after any regeneration, and treat that as the cost of the change until the rig learns
 * them. This is dangling state, recorded rather than hidden.
 *
 * ⚠️ SEVEN FILES ARE ONE FLAT FILL; `key` AND `profile` ALSO CARRY A STROKED PROP GROUP. Their
 * door and ID card come from the design project, redrawn as geometry (a rect, a circle, a few
 * paths) instead of the potrace outline they replaced — at 96px the traced versions were thin
 * enough to read as a smudge. That group's stroke is a literal 8, the rig's outer line weight,
 * so the number in the file is the width that paints.
 *
 * ⛔ DO NOT COPY THE DESIGN PROJECT'S MASCOT FILES IN WHOLESALE — the canvas is the thing it
 * gets wrong. It parks those two props at x 429..624 and x 421..560, outside this canvas, and
 * then grows each file's viewBox to fit, which leaves the nine files with nine different
 * viewBoxes (497.50 on `success`, 564.89 on `key`). Under `mask-size: contain` that is nine
 * different shield sizes: measured, the shield renders 13.55% larger on `success` than on
 * `key`, so eno visibly changes size as you move between empty states. The props here are that
 * same drawing scaled into the envelope the old prop occupied, which holds the spread at 0.00%.
 *
 * `mascot.test.ts` guards the canvas from both directions — the declared viewBox, and the prop
 * geometry's distance from the origin, because pasting the design's props into a 512 file
 * clips the right third silently while the viewBox still reads correct. It does NOT compute a
 * true bounding box: `getBBox` needs a real SVG engine and vitest runs in node here, so an
 * out-of-canvas TRACED path would still get through. Render it before you trust it.
 */
export function Mascot({ name, className, white = false }: { name: MascotName; className?: string; white?: boolean }) {
  const url = `url(/mascots/${name}.svg)`
  return (
    <span
      aria-hidden
      className={cn('inline-block bg-current', white ? 'text-white' : 'text-line-strong', className)}
      style={{
        maskImage: url,
        WebkitMaskImage: url,
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
      }}
    />
  )
}
