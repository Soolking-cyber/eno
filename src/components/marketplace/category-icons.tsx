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
  type IconComponent,
} from '@/components/ui/icons'
// ⚠️ THE RENDERER LIVES IN A MAP-FREE LEAF NOW — see the header of category-glyph.tsx. Anything
// that only needs to DRAW a glyph must import from there, not from here, or it drags this file's
// 99-icon registry into its route. This file keeps only the name -> component lookup.
import { DuotoneGlyph, type CategoryGlyph } from '@/components/marketplace/category-glyph'
export { CategoryGlyphArt, type CategoryGlyph } from '@/components/marketplace/category-glyph'
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

