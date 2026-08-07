import {
  Archive,
  Armchair,
  Baby,
  BedDouble,
  BedSingle,
  BicepsFlexed,
  Bike,
  Bird,
  Bone,
  BookOpen,
  Boxes,
  Briefcase,
  BrushCleaning,
  Building,
  Building2,
  BusFront,
  Cable,
  CalendarDays,
  Camera,
  Car,
  CarFront,
  Cat,
  ClipboardList,
  Code,
  Coffee,
  Cog,
  ConciergeBell,
  Cookie,
  CookingPot,
  Dices,
  Dog,
  Dumbbell,
  Flower2,
  Footprints,
  Gamepad2,
  Gift,
  GraduationCap,
  Guitar,
  Hammer,
  HandHeart,
  HardHat,
  Headphones,
  Headset,
  Heart,
  HeartHandshake,
  Home,
  Hotel,
  House,
  KeyRound,
  Lamp,
  LampDesk,
  LandPlot,
  Languages,
  Laptop,
  Map,
  Mars,
  Megaphone,
  MessagesSquare,
  Milk,
  PackageOpen,
  PackageSearch,
  Palette,
  PawPrint,
  Plane,
  PlaneTakeoff,
  Presentation,
  Salad,
  Search,
  Shapes,
  Shirt,
  ShoppingBag,
  ShoppingBasket,
  Smartphone,
  Sofa,
  Sparkles,
  Sprout,
  Stamp,
  Stethoscope,
  Store,
  Table,
  TabletSmartphone,
  Tag,
  Tent,
  Ticket,
  TicketPercent,
  ToyBrick,
  Truck,
  TvMinimal,
  Users,
  UsersRound,
  UtensilsCrossed,
  Venus,
  Volleyball,
  WashingMachine,
  Watch,
  Wrench,
  Zap,
  HelpCircle,
  type LucideIcon,
} from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'
import { cn } from '@/lib/utils'
import { STROKE_DISPLAY } from '@/lib/icon-tokens'

/** Bespoke motorbike ("xe máy" — the single most posted item in Vietnam). The
 *  taxonomy maps the motorbike slugs to the immutable key 'Gauge', whose lucide
 *  artwork draws a SPEEDOMETER — a recognition failure on the market's #1
 *  category (blind critic 2026-08-06; artwork swap under the existing key
 *  authorized by lead ruling 2026-08-07 — §7: "change artwork under existing
 *  keys"). lucide has no motorbike, so this is authored on the family's rules
 *  (§1/§3/§7): 24-grid, round caps/joins, currentColor line, wheels identical to
 *  sibling Bike's circles (cx 5.5/18.5, cy 17.5, r 3.5). Exactly TWO strokes
 *  besides the wheels — tail → saddle → step-through dip → floorboard, then the
 *  steering column with its grip hooking back. Earlier drafts added a leg shield
 *  AND a front fork and the converging lines mushed into a curl at the 14px chip
 *  step; like lucide's own Bike, the front wheel needs no touching fork. It
 *  needs no wash entry of its own: the duotone below is a rule about the whole
 *  silhouette, so bespoke artwork joins the family for free — which is the
 *  point of having deleted the per-key map. */
function MotorbikeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <circle cx="5.5" cy="17.5" r="3.5" />
      <circle cx="18.5" cy="17.5" r="3.5" />
      <path d="M5.5 14l-.9-3.3h5.6l1.5 3.3h3.2" />
      <path d="M18 13l-2-6h-1.8" />
    </svg>
  )
}

// A registry value is a lucide component or a bespoke first-party mark drawn on
// the same 24-grid contract (§1 permits bespoke category artwork in this file).
type CategoryGlyph = LucideIcon | ComponentType<SVGProps<SVGSVGElement>>

// Resolves a lucide icon NAME (stored in the taxonomy / Category rows) to its
// component. Covers every category AND subcategory glyph — keep in sync with
// src/lib/taxonomy.ts (tsc + the fallback make drift visible, never fatal).
const ICONS: Record<string, CategoryGlyph> = {
  // 'Gauge' is the taxonomy's MOTORBIKE key (immutable, DB-mirrored). The lucide
  // speedometer it once resolved to failed recognition on Vietnam's #1 category;
  // the key now owns bespoke artwork (see MotorbikeIcon above). Head of the map
  // so the one artwork exception stays visible.
  Gauge: MotorbikeIcon,
  Archive,
  Armchair,
  Baby,
  BedDouble,
  BedSingle,
  BicepsFlexed,
  Bike,
  Bird,
  Bone,
  BookOpen,
  Boxes,
  Briefcase,
  BrushCleaning,
  Building,
  Building2,
  BusFront,
  Cable,
  CalendarDays,
  Camera,
  Car,
  CarFront,
  Cat,
  ClipboardList,
  Code,
  Coffee,
  Cog,
  ConciergeBell,
  Cookie,
  CookingPot,
  Dices,
  Dog,
  Dumbbell,
  Flower2,
  Footprints,
  Gamepad2,
  Gift,
  GraduationCap,
  Guitar,
  Hammer,
  HandHeart,
  HardHat,
  Headphones,
  Headset,
  Heart,
  HeartHandshake,
  Home,
  Hotel,
  House,
  KeyRound,
  Lamp,
  LampDesk,
  LandPlot,
  Languages,
  Laptop,
  Map,
  Mars,
  Megaphone,
  MessagesSquare,
  Milk,
  PackageOpen,
  PackageSearch,
  Palette,
  PawPrint,
  Plane,
  PlaneTakeoff,
  Presentation,
  Salad,
  Search,
  Shapes,
  Shirt,
  ShoppingBag,
  ShoppingBasket,
  Smartphone,
  Sofa,
  Sparkles,
  Sprout,
  Stamp,
  Stethoscope,
  Store,
  Table,
  TabletSmartphone,
  Tag,
  Tent,
  Ticket,
  TicketPercent,
  ToyBrick,
  Truck,
  TvMinimal,
  Users,
  UsersRound,
  UtensilsCrossed,
  Venus,
  Volleyball,
  WashingMachine,
  Watch,
  Wrench,
  Zap,
}

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

function DuotoneGlyph({
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
  // ⚠️ RESOLVE THE FILL KEY FROM THE COMPONENT when no name is passed. Every lucide
  // component carries `displayName` = its PascalCase name (createLucideIcon sets it), and
  // that is exactly the key the fill map is generated under. Without this fallback every
  // <CategoryGlyphArt> mount — the rail's "All" tile, the whole dashboard rail, the
  // wizard's slug-fixed glyphs — would resolve no body and stay hollow when selected,
  // which is the "some are filled, some are not" defect the owner rejected.
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
 * A category/subcategory glyph, resolved from the immutable registry key that
 * mirrors the DB's `Category.icon` row.
 *
 * `stroke` re-tiers the ink line for small mounts (icon-language §2): the tile
 * default is the display tier (1.5, which at h-11 renders the premium ~2.75px),
 * but at the 14/16px chip step that scales to under a pixel and the glyph goes
 * wispy beside its stroke-2 lucide neighbours — chips pass STROKE_UI. It is a
 * PROP rather than a `[stroke-width:2]` class because the glyph is no longer a
 * single svg: a class on the wrapper cannot reach past each layer's own
 * presentation attribute, and the tint layer must stay fatter than the ink one.
 */
export function CategoryIcon({ name, className, stroke, selected }: { name: string; className?: string; stroke?: number; selected?: boolean }) {
  return <DuotoneGlyph Icon={ICONS[name] ?? HelpCircle} name={name} className={className} stroke={stroke} selected={selected} />
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
