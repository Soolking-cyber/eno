import { cn } from '@/lib/utils'

export type MascotName = 'wave' | 'saved' | 'help' | 'key' | 'search' | 'profile' | 'chat' | 'success' | 'cookie'

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
 * (mascot-verify2.mjs for the body, mascot-verify3.mjs for limbs, props and weight). Keep every
 * file one flat fill with no strokes.
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
