/**
 * CATEGORY ARTWORK — which top-level tiles have a Solar SVG, and where it lives.
 *
 * The files themselves are generated: `node scripts/gen-category-icons.mjs` reads the Solar set and
 * writes `public/icons/rest/<slug>.svg` and `public/icons/selected/<slug>.svg`. This module is the
 * only thing a renderer needs to know about them — a slug in, a public path out, `null` when there
 * is no artwork for that slug.
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

/** `rest` = the idle outline. `selected` = the same glyph with a tintable body layer beneath it. */
export type CategoryArtState = 'rest' | 'selected'

/**
 * ⚠️ THE SELECTED VARIANT SHIPS UNTINTED AND NEEDS ONE CSS RULE TO LIGHT UP.
 *
 * `selected/<slug>.svg` draws the glyph twice: a body layer carrying only this class, then the ink
 * line on top. The body layer's own attributes are `fill="none" stroke="none"`, so until a
 * stylesheet claims the class a selected glyph renders identically to its resting twin — the
 * failure mode is "no tint yet", never a blob.
 *
 * The rule to add (globals.css), which beats the presentation attributes and inherits into the
 * layer's children:
 *
 *     @media not (forced-colors: active) {
 *       .cat-art-body { fill: var(--color-brand-100); stroke: var(--color-brand-100); }
 *     }
 *
 * ⚠️ THE `forced-colors` GUARD IS NOT OPTIONAL, AND LEAVING IT OFF BREAKS THE ONE GROUP THAT NEEDS
 * THE GLYPH MOST. `fill` and `stroke` are both forced properties: in Windows High Contrast the
 * browser overrides the tint AND the ink to the same system colour, the body's fill swallows the
 * line it sits under, and every selected tile collapses into the solid silhouette this artwork was
 * designed twice-over to avoid. Inside the guard the rule simply does not apply there, the body
 * layer keeps its `fill="none" stroke="none"`, and a selected tile degrades to the resting outline
 * — legible, if less emphatic. Raised by an external reviewer; the mechanism is in CSS Color
 * Adjust §3, and it costs two lines to be right about.
 *
 * ⚠️ THE TINT IS A CLASS RATHER THAN A COLOUR IN THE FILE BECAUSE THE BRAND TINT IS THEME-DEPENDENT
 * — `--brand-100` is `#cfe3f5` in light and `#2b5983` in dark. A hex baked into 17 generated files
 * would be wrong in one theme forever, in files nobody re-reads.
 *
 * ⚠️ `--color-brand-100` IS THE RIGHT NAME AND IT EXISTS — globals.css:121 defines it as
 * `var(--brand-100)`, which is what re-themes it at :186 (light) and :442 (dark). Stated with the
 * line number because a reviewer flagged it twice as possibly-undefined, and the failure would be
 * silent: an unresolvable `var()` makes the declaration invalid at computed-value time, `fill` and
 * `stroke` then inherit the root `<svg fill="none">`, and the tint simply never appears — which
 * looks exactly like "the rule has not been added yet".
 */
/**
 * ⛔ DO NOT ADD THE `.cat-art-body` TINT RULE TO globals.css UNTIL TWO GLYPHS ARE REDRAWN.
 *
 * The selected variants are currently INERT — with no rule for this class they render identically
 * to their rest counterparts, which is a deliberate fail-safe (never a blob) and the reason this
 * wave could land at all. The moment the rule exists, two of the seventeen light up wrong, and an
 * adversarial review caught both on the shipped bytes rather than in theory:
 *   · food-drink — the chef hat gets a hard-edged white trapezoid punched through its crown
 *   · property   — both side wings stay untinted except for a thin diagonal sliver
 * Both are HALF-FILLED glyphs, which docs/icon-language.md forbids outright: a partly-tinted glyph
 * reads as a rendering fault, not as a state. Fix the two source paths (or exclude them from the
 * tint the way the other two exclusions are pinned) BEFORE adding:
 *   @media not (forced-colors: active) {
 *     .cat-art-body { fill: var(--color-brand-100); stroke: var(--color-brand-100); }
 *   }
 * ⚠️ The forced-colors guard is not optional — without it the tint fights the user's own palette.
 */
export const CATEGORY_ART_BODY_CLASS = 'cat-art-body'

/** The ink line — `stroke="currentColor"`, painted over the body. Exported so a renderer that
 *  post-processes the markup (a sprite builder, a sanitiser) can find the layer by name. */
export const CATEGORY_ART_INK_CLASS = 'cat-art-ink'

/**
 * Every slug with artwork: the 15 taxonomy categories in `TAXONOMY` order, then the two tiles that
 * are NOT categories.
 *
 * ⚠️ `free` IS THE ONLY INTENT TILE. `INTENT_SHORTCUTS` in taxonomy.ts is length 1; several
 * comments in the app still say "Free & Wanted", and there is no Wanted tile behind them.
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
  'all',
] as const

export type CategoryArtSlug = (typeof CATEGORY_ART_SLUGS)[number]

/** The two slugs above that are tiles rather than categories. Named so the test can assert that
 *  nothing ELSE quietly joins them — an unknown slug here means artwork nobody can reach. */
export const CATEGORY_ART_NON_TAXONOMY_SLUGS: readonly CategoryArtSlug[] = ['free', 'all']

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
