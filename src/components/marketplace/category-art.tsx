import { CATEGORY_ART } from '@/generated/icon-paths'
import { cn } from '@/lib/utils'
import { CategoryIcon } from './category-icons'

/**
 * A CATEGORY TILE'S GLYPH — official Solar v2, inlined.
 *
 * `rest` is Solar's Outline weight and `selected` is its Bold weight: two separately drawn
 * glyphs, not one painted twice. That is the whole reason the old tint layer could be deleted —
 * see `scripts/gen-icons.mjs` for the half-filled toque it used to produce.
 *
 * ⚠️ INLINE, NOT `<img>` OR A CSS MASK, AND THE REASON IS `currentColor`. The tile paints its
 * glyph from its OWN text colour, which is what carries hover, selected, dark mode and the
 * `group-hover:scale-110` treatment. An `<img src="/icons/rest/…svg">` isolates the file from
 * the page's colour and all of that stops; a CSS mask keeps the colour but can carry only one,
 * and loses the fill-rule holes. The path data comes from `src/generated/icon-paths.ts`, emitted
 * by the same generator pass that writes the SVGs, so inlining costs no request at all.
 *
 * ⚠️ `fillRule="evenodd"` IS LOAD-BEARING, NOT DECORATION. Solar draws counters — the hole in a
 * keyhole, the gap inside a padlock, the window of a building — as subpaths of the same filled
 * path. Drop the rule and every one of them fills solid, which is exactly the "solid silhouette"
 * failure docs/icon-language.md forbids. `clipRule` rides with it for the same reason.
 */
export function CategoryArt({
  slug,
  selected = false,
  className,
}: {
  slug: string
  selected?: boolean
  className?: string
}) {
  const art = CATEGORY_ART[slug]
  if (!art) return null
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={cn('shrink-0', className)}>
      {(selected ? art.selected : art.rest).map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill="currentColor"
          fillRule={p.evenOdd ? 'evenodd' : undefined}
          clipRule={p.evenOdd ? 'evenodd' : undefined}
        />
      ))}
    </svg>
  )
}

/**
 * The tile glyph a call site should reach for: Solar when the slug has artwork, the lucide
 * registry otherwise.
 *
 * ⚠️ THE FALLBACK IS THE POINT, NOT A LOOSE END. `CATEGORY_ART` covers SEVENTEEN slugs — the 15
 * taxonomy categories plus `free` and `all`. `category-icons.tsx` registers 98 immutable keys
 * (`Category.icon`, mirrored in the database) covering every category AND subcategory, so the
 * ~81 subcategory glyphs have no Solar equivalent and must keep resolving to lucide. A caller
 * addressing a subcategory passes a slug this map does not hold and gets its lucide glyph, which
 * is why this component takes BOTH a slug and a registry key.
 */
export function CategoryTileGlyph({
  slug,
  icon,
  selected = false,
  className,
}: {
  slug: string
  icon: string
  selected?: boolean
  className?: string
}) {
  return CATEGORY_ART[slug] ? (
    <CategoryArt slug={slug} selected={selected} className={className} />
  ) : (
    <CategoryIcon name={icon} selected={selected} className={className} />
  )
}
