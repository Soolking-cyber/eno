import { uiArtPath, type UiArtKey } from '@/lib/category-art'
import { cn } from '@/lib/utils'
import { ArtImage } from '@/components/marketplace/art-image'

/**
 * A CHROME CONTROL'S GLYPH — the owner's outline pack, grey until the control is the chosen one.
 *
 * Owner, 2026-08-29: "also replace remaining outline icons on top navbar and view type icons line
 * grid map and video gray by default blue when pressed". Same pack, same generator and the same
 * `grayscale()` state model as the category tiles and the bottom bar, so the app tells one story
 * about what a 3D icon does when it is selected.
 *
 * ⛔ ITS OWN FILE FOR THE SAME REASON `nav-art.tsx` IS. The obvious home is beside `CategoryArt`,
 * which this is nearly identical to — but that module imports `CategoryIcon`, whose registry is a
 * 99-icon map, and the header and toolbar are on every page in the app. Keeping the import surface
 * to one path helper is the whole point.
 *
 * ⚠️ WHAT THE RASTER COSTS, the same list as the other two sets and worth restating where someone
 * will read it: no `currentColor`, so hover no longer tints the glyph and dark mode gets the same
 * pixels as light; and each one is a request that used to be inline path data. They are 2–4 KB,
 * same-origin and immutably cached, which is why `fetchPriority` is low and decoding async.
 */
export function UiArt({
  name,
  lit = false,
  className,
}: {
  name: UiArtKey
  /**
   * Coloured rather than grey. ⛔ THIS MEANS "THIS CONTROL IS THE ACTIVE ONE" — the pressed view
   * mode, an open panel — and nothing else. Do not wire it to a count or a notification, for the
   * reason written on `NavArt`'s own `lit`: colour that means two things stops meaning either.
   */
  lit?: boolean
  className?: string
}) {
  return (
    <ArtImage
      src={uiArtPath(name)}
      alt=""
      aria-hidden
      width={184}
      height={184}
      draggable={false}
      fetchPriority="low"
      decoding="async"
      /* ⚠️ NOT `loading="lazy"`: these sit in the header and the toolbar, both above the fold, and
         lazy would blank the controls the visitor is looking straight at. */
      /* ⚠️ `h-5 w-5` IS THE DEFAULT AND THE TOOLBAR ROW DOES GROW — 16px to 20px — which is worth
         saying rather than claiming otherwise. The glyphs it replaces ASKED for `h-5 w-5` in their
         own markup and never got it: `ui/button`'s base carries
         `[&_svg:not([class*='size-'])]:size-4`, which out-specificities a plain `h-5` and pinned
         every one of them to 16px. That selector cannot match an `<img>`, so the size the source
         always requested is finally the size that renders. A reviewer caught the claim; the
         measurement (20px) is the authored intent, not a drift.
         ⚠️ `className` comes last so the header can ask for its larger sizes through tailwind-merge. */
      className={cn(
        'h-5 w-5 shrink-0 select-none object-contain transition-[filter] duration-200',
        !lit && 'grayscale',
        className,
      )}
    />
  )
}
