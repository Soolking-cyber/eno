import { CATEGORY_ART_STAMP } from '@/generated/category-art-stamp'
/**
 * CATEGORY ARTWORK — which top-level tiles have a Solar SVG, and where it lives.
 *
 * The files themselves are generated: `npm run icons` (scripts/gen-icons.mjs) reads the official
 * Solar v2 set and writes `public/icons/rest/<slug>.svg` and `public/icons/selected/<slug>.svg`.
 * This module is the only thing a renderer needs to know about them — a slug in, a public path
 * out, `null` when there is no artwork for that slug.
 *
 * ⚠️ THE TWO STATES ARE TWO SOLAR WEIGHTS, NOT ONE GLYPH PAINTED TWICE. `rest` is Outline and
 * `selected` is Bold, both drawn by Solar. An earlier revision built the selected state here — the
 * same paths twice, a tint layer under an ink layer, lit by a `.cat-art-body` CSS rule — because a
 * line glyph has no filled form to switch to. It never shipped: filling an OPEN path implicitly
 * closes it, so `food-drink`'s toque and `property`'s wings came out half-filled, and the CSS rule
 * was never added. Bold has no open path to close, so that whole mechanism (the two classes, the
 * `fillExclude` pins, the forced-colors guard) is DELETED and must not come back.
 *
 * ⚠️ `null` IS THE POINT, NOT AN OVERSIGHT. This covers SEVENTEEN tiles and the app has far more
 * glyphs than that: `category-icons.tsx` registers 98 immutable keys (`Category.icon`, mirrored in
 * the database) covering every category AND subcategory. Those ~81 subcategory keys have no Solar
 * artwork and must keep resolving to lucide, so a caller reads:
 *
 *     const art = categoryArtPath(slug, selected ? 'selected' : 'rest')
 *     return art ? <CategorySvg src={art} …/> : <CategoryIcon name={key} …/>
 *
 * A migration that half-lands is the failure mode here — a rail where six tiles are Solar and nine
 * are lucide looks broken in a way no test catches — so the contract is deliberately "all of these
 * or none of them", and the paired test refuses to let a new category ship without artwork.
 *
 * ⚠️ THE SLUG LIST IS A COPY, AND `category-art.test.ts` IS WHY THAT IS SAFE. It could import
 * `TAXONOMY` and derive the fifteen, but `taxonomy.ts` is 70 KB and category tiles render in client
 * components — the exact trade `taxonomy-nav.ts` exists to avoid. So this module imports NOTHING,
 * and the test asserts the copy still equals `TAXONOMY`'s slugs, in order, on every run. Do not
 * delete one without the other.
 *
 * ⚠️ THE ARTWORK IS MEANT TO BE INLINED, NOT `<img src>`-ed. Both variants paint with
 * `currentColor` so a tile's own text colour drives the ink, exactly like the lucide glyph they
 * replace; an `<img>` isolates the file from the page's colour and the hover/selected/dark-mode
 * behaviour disappears. Fetch-and-inline, a build-time sprite, or an inline React component are all
 * fine — an `<img>` or a CSS `background-image` is not.
 */

/** `rest` = the Solar Outline weight, the idle tile. `selected` = the Solar Bold weight, a
 *  separately drawn filled glyph rather than a filled copy of the line. */
export type CategoryArtState = 'rest' | 'selected'

/**
 * Every slug with artwork: the 15 taxonomy categories in `TAXONOMY` order, then the four tiles that
 * are NOT categories (three intent shortcuts + the browse rail's reset).
 *
 * ⚠️ `free` IS THE ONLY INTENT TILE WITH ARTWORK, AND IT IS NO LONGER THE ONLY INTENT TILE.
 * `INTENT_SHORTCUTS` gained Wanted and Wholesale on 2026-08-16 — the "Free & Wanted" the older
 * comments in this app kept referring to finally exists. Both are drawn in Solar
 * here, so no tile in the grid falls through to the lucide fallback in CategoryTileGlyph — which
 * matters because that fallback is the last place a lucide glyph would still reach a tile.
 * ⚠️ `all` IS THE BROWSE RAIL'S LEADING TILE (`data-cat="all"` in category-rail.tsx), which is a
 * filter reset rather than a category — it has no taxonomy row and never will.
 */
export const CATEGORY_ART_SLUGS = [
  'vehicles',
  'rentals',
  'property',
  'moving-sale',
  'furniture-appliances',
  'electronics',
  'fashion-beauty',
  'baby-kids',
  'hobbies-sports',
  'pets',
  'jobs',
  'services',
  'community-events',
  'tickets-travel',
  'food-drink',
  'free',
  'wanted',
  'wholesale',
  'all',
] as const

export type CategoryArtSlug = (typeof CATEGORY_ART_SLUGS)[number]

/** The two slugs above that are tiles rather than categories. Named so the test can assert that
 *  nothing ELSE quietly joins them — an unknown slug here means artwork nobody can reach. */
export const CATEGORY_ART_NON_TAXONOMY_SLUGS: readonly CategoryArtSlug[] = ['free', 'wanted', 'wholesale', 'all']

const SLUGS: ReadonlySet<string> = new Set(CATEGORY_ART_SLUGS)

/** Narrowing guard — `true` when this slug has generated artwork. */
export function hasCategoryArt(slug: string): slug is CategoryArtSlug {
  return SLUGS.has(slug)
}

/**
 * The public path for a tile's artwork, or `null` when there is none — every subcategory key, and
 * any category added to the taxonomy since the generator last ran. A caller that gets `null` must
 * fall back to the lucide registry rather than render nothing.
 */
export function categoryArtPath(slug: string, state: CategoryArtState): string | null {
  return hasCategoryArt(slug) ? `/icons/${state}/${slug}.svg` : null
}

/**
 * The tile's raster artwork — the owner's 3D pack, one file per slug, greyed by CSS until pressed.
 *
 * ⚠️ `?v=` IS NOT OPTIONAL. next.config.ts grants `max-age=31536000, immutable` to `/icons/*` only
 * when a `v` query is PRESENT, and the stamp is a content hash of every generated file, so a
 * redrawn pack is a new cache key for everyone. ⛔ The stamp rides in the QUERY, never in the
 * filename: eno.vn edge-caches its HTML for hours, so a hashed filename 404s out of already-cached
 * HTML after a deploy.
 */
export function categoryTileArtPath(slug: string): string | null {
  return hasCategoryArt(slug) ? `/icons/categories/${slug}.webp?v=${CATEGORY_ART_STAMP}` : null
}

/**
 * THE BOTTOM NAV'S FIVE TABS — the same pack, the same treatment (owner, 2026-08-28: "also use
 * these icons for navbar similar to category icons"). Generated by the same script into
 * `public/icons/nav/<key>.webp`, and sharing `CATEGORY_ART_STAMP`, which hashes every file the
 * generator writes — so redrawing one nav icon busts the cache for the whole pack. That is the
 * right trade at this size: five icons, and a stamp per folder would be three things to keep in
 * step instead of one.
 *
 * ⚠️ THESE ARE TAB KEYS, NOT ROUTES. `explore` is `/`, `account` is `/dashboard/account`; the tab
 * a key names is the contract, not the path it happens to point at today.
 * ⛔ BOTH EDITIONS SHIP THESE. Unlike the services artwork next door there is nothing regulated
 * about a house or a heart, and the bottom bar is identical on eno.forum — so this folder is
 * deliberately absent from the Dockerfile's marketplace prune.
 */
export const NAV_ART_KEYS = ['explore', 'saved', 'post', 'messages', 'account'] as const

export type NavArtKey = (typeof NAV_ART_KEYS)[number]

export function navArtPath(key: NavArtKey): string {
  return `/icons/nav/${key}.webp?v=${CATEGORY_ART_STAMP}`
}
