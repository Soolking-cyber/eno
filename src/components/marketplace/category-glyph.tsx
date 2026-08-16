import type { ComponentType, SVGProps } from 'react'
import type { IconComponent } from '@/components/ui/icons'
import { STROKE_DISPLAY } from '@/lib/icon-tokens'
import { cn } from '@/lib/utils'

/**
 * THE DUOTONE GLYPH RENDERER — DELIBERATELY MAP-FREE, AND THAT IS THE WHOLE POINT OF THE FILE.
 *
 * This is `category-icons.tsx` minus its registry. Everything here draws a glyph it is HANDED;
 * nothing here looks a glyph up by name.
 *
 * ⚠️ IT WAS SPLIT OUT BECAUSE THE RENDERER WAS DRAGGING 99 ICONS ONTO EVERY ROUTE IN THE APP.
 * `mobile-nav.tsx` imports `CategoryGlyphArt`, and mobile-nav is mounted in `providers.tsx` — so it
 * is in the module graph of EVERY page. While the renderer lived beside `ICONS`, importing it
 * imported the registry, and because `ICONS[name]` is a DYNAMIC lookup no bundler can shake a
 * single entry out of it. Measured on the home route: the icon chunk was 636 KB raw / 171 KB
 * transferred and held 223 of the shim's 243 icons, for a page that renders 45.
 *
 * ⛔ NEVER IMPORT `ICONS`, `CategoryIcon`, OR ANYTHING FROM `category-icons.tsx` INTO THIS FILE.
 * One such import re-couples the graph and silently restores the whole 99-icon payload to every
 * route — with no test failing, because everything still renders correctly. The only symptom is
 * the bundle. If you need a name-keyed lookup, do it at the CALL SITE and pass the component in.
 */

/** A glyph component: a shim icon, or bespoke artwork drawn to the same 24-grid contract. */
export type CategoryGlyph = IconComponent | ComponentType<SVGProps<SVGSVGElement>>

/**
 * THE CATEGORY DUOTONE — one rule, every key (docs/icon-language.md §0/§7,
 * owner mandate 2026-08-07: *"make sure your icons are fully filled, i see some
 * are half filled in categories"*).
 *
 * ⛔ THE PER-KEY `WASH_MAP` IS GONE, AND IT IS NOT COMING BACK. It filled ONE
 * curated region per glyph, which meant a single grid row rendered three
 * different densities side by side: tinted (House), hollow (Plane, Users,
 * Ellipsis — no separable closed region, the old "graceful degrade") and
 * half-tinted (a body whose interior is only part of its silhouette). Restraint
 * you cannot state as a rule reads as a rendering bug, and the owner read it as
 * one. Curation also scaled badly — 35 hand-tuned selectors against ~100 keys,
 * each one a guess about lucide's child ORDER, which is arbitrary and changes
 * between releases.
 *
 * The mechanism instead: draw the glyph TWICE in one box.
 *   1. the BODY layer — same paths, `fill-brand-100 stroke-brand-100`, stroke
 *      at the SAME width as the ink line. Filling every child tints every closed
 *      region; the fat stroke welds them into one silhouette and gives
 *      open-path glyphs (UtensilsCrossed, Zap, Users, Ellipsis) a body they
 *      never had. Density is identical across the whole set by construction.
 *   2. the INK layer — the untouched lucide line, painted ON TOP.
 *
 * Two properties fall out of the ordering, and both were requirements:
 *   · the ink line always reads crisply — nothing can paint over it, so the
 *     "lucide draws some bodies LAST" hazard that WASH_MAP existed to dodge
 *     simply cannot occur;
 *   · interior detail survives — a filled body can only ever cover the TINT
 *     layer's own paths, never a stroke.
 *
 * The tint stays `--color-brand-100` (one blue, §0), so the selected-chip trick
 * of redefining that variable to `transparent` still turns the glyph into pure
 * line on a brand pill — the variable inherits from the wrapper into both
 * layers.
 */
/**
 * DECORATION, NOT BODY — the children a selected glyph must NOT fill.
 *
 * The duotone fills the WHOLE glyph by default, because that is what the owner asked
 * for glyph after glyph on 2026-08-07: "fill side rectangles too" (Building2's wings),
 * "fill as circle inside head shape" (Baby), "fill full body and between front person
 * and person behind" (Users), "fill bottom of the box too" (PackageOpen), "cover of box
 * should be filled" (Gift's lid), "car front window half not filled" (CarFront).
 *
 * ⚠️ AN EARLIER VERSION FILLED ONLY SUBPATHS THAT CLOSE, AND IT WAS WRONG. lucide draws
 * most bodies as OPEN paths that close visually against a neighbour — a sofa back, a
 * building wing, a baby's head, a box lid — so that rule left half of every glyph
 * hollow, which is the exact "half filled" defect this work started from. Geometry is
 * not the drawing.
 *
 * These exclusions are the inverse case: children that are decoration, where a fill
 * implicitly closes an open line into a blob. Add one ONLY from a rendered screenshot.
 *   · Layers — the two lower sheets suggest depth; filling them stacks three overlapping
 *     blobs ("infill only top closed shape").
 *   · UtensilsCrossed — the fork's tines ("fork shouldnt have infill"); the knife blade,
 *     which is a real closed body, still fills ("needs knife infill").
 */
const FILL_EXCLUDE: Record<string, number[]> = {
  Layers: [2, 3],
  UtensilsCrossed: [1, 4],
  // Community — front person only (owner, 2026-08-07: "revert, put previous icon and fill
  // only front person"). Child 3 is the figure BEHIND, drawn as two thin arcs: filling it
  // implicitly closes them into a crescent that reads as a smudge rather than a person. A
  // bespoke two-body glyph was tried and rejected — the stock drawing is the one to keep.
  UsersRound: [3],
}

const excludeClasses = (name?: string) =>
  (name && FILL_EXCLUDE[name] ? FILL_EXCLUDE[name] : [])
    .filter((i) => i >= 1 && i <= 8)
    .map((i) => `duo-x${i}`)

/** Exported so the name-keyed `CategoryIcon` in category-icons.tsx can render through it without
 *  this file ever learning what a registry is. */
export function DuotoneGlyph({
  Icon,
  name,
  className,
  stroke = STROKE_DISPLAY,
  selected = false,
}: {
  Icon: CategoryGlyph
  name?: string
  className?: string
  stroke?: number
  selected?: boolean
}) {
  // ⚠️ FILL IS A STATE, NOT A STYLE (owner, 2026-08-07: "use icons filling only
  // when selected, not as default"). Default is the pure ink line — the same
  // outline-idle / filled-active grammar iOS and Carousell use, and the reason
  // the old always-on tint made a category row look like a rendering bug: a
  // filled magnifier, filled brackets and filled cutlery are only defensible as
  // a deliberate "you are here", never as a resting state.
  // Fill is a STATE (owner, 2026-08-07: "use icons filling only when selected, not as
  // default"): the resting glyph is a pure ink line, exactly the outline-idle /
  // filled-active grammar iOS and Carousell use. A glyph with no fillable body simply
  // has no tint layer to render — no special-casing needed.
  /**
   * ⚠️ THIS FALLBACK IS INERT TODAY, AND THE COMMENT THAT USED TO SIT HERE HID THAT.
   * It said every glyph "carries `displayName` = its PascalCase name (createLucideIcon sets it)".
   * lucide has not drawn an icon in this app since 2026-08-12 and is not a dependency; the Solar
   * shim emits `export const Search = (p) => <Glyph … />`, an arrow function with a `.name` but NO
   * `.displayName`. So for a nameless mount this resolves to `undefined`.
   *
   * ⚠️ WHAT THAT ACTUALLY COSTS IS SMALL, WHICH IS WHY IT WENT UNNOTICED — and worth stating
   * exactly, because I first read it as a live bug. `key` feeds FILL_EXCLUDE only, a three-entry
   * EXCLUSION map (Layers, UtensilsCrossed, UsersRound). `undefined` yields `[]`, i.e. no
   * exclusions — which is the correct answer for every glyph except those three. Nothing stays
   * hollow; a nameless mount of one of those three would simply fill a sub-shape it should not.
   *
   * ⛔ SO DO NOT "FIX" THIS BY READING `.name`: it survives dev and is mangled by the production
   * minifier, which would make the behaviour differ between the build you test and the one you
   * ship. The real fix, if a nameless mount of an excluded glyph ever appears, is to pass `name`
   * at that call site — or to have gen-icons.mjs emit displayName, at ~243 assignments of bundle.
   */
  const key = name ?? (Icon as { displayName?: string }).displayName
  return (
    // The caller's className lands HERE, on the box: size (h-11 w-11 …), ink
    // colour (currentColor inherits into both layers), margins, hover/press
    // transitions. h-6 w-6 is a floor for an unsized mount, not a default worth
    // relying on — the §4 ladder still says put the size on the call site.
    // ⚠️ `size-full` on the layers, not `h-full w-full`: ui/button's icon rule
    // is `[&_svg:not([class*='size-'])]:size-4`, and matching that attribute
    // selector is what opts a 44px tile glyph out of being shrunk to 16px.
    <span
      aria-hidden
      /* ⚠️ `align-middle` keeps this wrapper on the same optical line as a BARE <svg>. An
         inline-flex box takes its baseline from its own content, so where a plain lucide
         icon sat, this wrapper rode ~3px higher — visible the moment one bottom-nav tab
         used the duotone and the other four did not (owner, 2026-08-07: "why are some
         icons above and some below, they are not aligned"). Harmless inside flex/grid
         parents, which ignore vertical-align. */
      className={cn('relative inline-flex h-6 w-6 shrink-0 align-middle', className)}
    >
      {/* ⚠️ THE TINT STROKE MATCHES THE INK STROKE EXACTLY — it must never be fatter.
          A fattened underlay (this was `stroke + 2`) paints tint OUTSIDE the ink line, so
          every glyph wore a pale-blue halo and read as an OUTLINED icon rather than a
          filled one (owner, 2026-08-07: "make sure icons dont have outline, fill only
          inside"). At equal width the two layers share one geometry, so the opaque ink
          line covers the tint stroke completely and the tint survives only where it
          should: inside the shape. The FILL is what closes open paths (SVG implicitly
          closes a filled subpath), so the weld the fat stroke was there for costs
          nothing. */}
      {selected && (
        <Icon
          aria-hidden
          strokeWidth={stroke}
          className={cn('absolute inset-0 size-full fill-brand-100 stroke-brand-100', excludeClasses(key))}
        />
      )}
      {/* `relative`, so the ink layer is POSITIONED too. Absolutely-positioned
          boxes paint above in-flow content regardless of document order, so a
          static ink layer would end up UNDER the tint. */}
      {/* ⚠️ `fill-none` IS LOAD-BEARING, not a default. The ink layer must never fill — and
          it also has to be IMMUNE to an ancestor's blanket fill rule. The bottom nav paints
          its active tab with `[&_svg:not([class*=fill-])]:fill-brand-100`; without a fill-*
          class here that rule caught the ink layer too, Compass's outer circle filled over
          its own needle, and the glyph collapsed into a solid disc (owner, 2026-08-07:
          "explore icon when filled inside disappears"). Carrying `fill-none` makes the
          guard skip this layer, which is exactly what the guard is for. */}
      <Icon aria-hidden strokeWidth={stroke} className="relative size-full fill-none" />
    </span>
  )
}

/**
 * The same duotone for a glyph that has no registry key — a slug-keyed artwork
 * fix (post-wizard-parts' Cog/Ellipsis) or a non-taxonomy tile (the browse
 * rail's "All" Layers). Registry keys are DB-mirrored and immutable, so these
 * mounts cannot be expressed as keys; they still have to look like family.
 */
export function CategoryGlyphArt({ Icon, name, className, stroke, selected }: { Icon: CategoryGlyph; name?: string; className?: string; stroke?: number; selected?: boolean }) {
  // `name` is the FILL KEY, not a registry lookup — these mounts have no taxonomy key
  // (the rail's "All" Layers tile, the wizard's slug-fixed Cog/Ellipsis). Without it the
  // glyph resolves no fillable body and can never light up when selected.
  return <DuotoneGlyph Icon={Icon} name={name} className={className} stroke={stroke} selected={selected} />
}
