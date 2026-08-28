import { navArtPath, type NavArtKey } from '@/lib/category-art'
import { cn } from '@/lib/utils'

/**
 * A BOTTOM-NAV TAB'S GLYPH — the owner's 3D pack, grey until the tab is the one you are on.
 *
 * Owner, 2026-08-28: "also use these icons for navbar similar to category icons". Same pack, same
 * generator (`scripts/gen-category-art.mjs`), same `grayscale()` state model as the category tiles,
 * for the same reason: these are full-colour renders with no single colour to inherit.
 *
 * ⛔ ITS OWN FILE, AND THAT IS A CHUNK-SIZE DECISION RATHER THAN TIDINESS. The obvious home for
 * this was `category-art.tsx` beside `CategoryArt`, which it is nearly identical to — but that
 * module imports `CategoryIcon`, whose registry is a 99-icon map, and `mobile-nav.tsx` already
 * carries a warning about exactly this: it deliberately imports from `category-glyph` rather than
 * `category-icons` to keep that map out of its chunk. The bottom bar is on every mobile screen in
 * the app, so it is the worst possible place to undo that. This file imports one path helper.
 *
 * ⚠️ WHAT THE RASTER COSTS HERE, ON TOP OF WHAT IT COSTS ON A TILE. The tabs used to be lucide
 * glyphs painting with `currentColor`, which is what let `TabBody` turn a whole stack brand-blue
 * on the active route in one rule, and what let Saved and Messages paint themselves `fill-brand`
 * when they had something to report. Neither mechanism survives an `<img>`:
 *   · the active state is now the artwork's own colour against a grey inactive state, so the LABEL
 *     carries the brand ink alone;
 *   · "has unread" / "has saved" is passed in as `lit` and rendered as the coloured state, so the
 *     signal is kept — it simply arrives through the same filter instead of a fill;
 *   · dark mode gets the same pixels as light.
 * ⚠️ Five more requests on the most-visited component in the app, which is why `fetchPriority` is
 * low and decoding async — the same reasoning as the tiles, and it matters more here.
 */
export function NavArt({
  name,
  lit = false,
  className,
}: {
  name: NavArtKey
  /** Coloured rather than grey: the active tab, or a tab with something to report. */
  lit?: boolean
  className?: string
}) {
  return (
    /* eslint-disable-next-line @next/next/no-img-element -- a fixed-size static asset from our own
       origin; next/image would add a proxy hop and a layout wrapper for no benefit at 28px. */
    <img
      src={navArtPath(name)}
      alt=""
      aria-hidden
      width={184}
      height={184}
      draggable={false}
      fetchPriority="low"
      decoding="async"
      /* ⚠️ NOT `loading="lazy"`: the bar is fixed to the viewport bottom and always on screen, so
         lazy would blank the tabs the visitor is looking at. */
      /* ⚠️ `h-7 w-7` matches what the lucide glyphs rendered at, so the bar's geometry is unchanged
         — `TabStack`'s centring maths depends on every glyph being the same box. `className` comes
         last so a call site can still override through tailwind-merge. */
      className={cn(
        'h-7 w-7 shrink-0 select-none object-contain transition-[filter] duration-200',
        !lit && 'grayscale',
        className,
      )}
    />
  )
}
