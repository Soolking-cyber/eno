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
 *  step; like lucide's own Bike, the front wheel needs no touching fork. The
 *  wash lives in WASH_MAP like every other key (both wheel discs — a mirrored
 *  twin pair counts as ONE wash move, §0 addendum, exactly how Bike washes). */
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

// THE SIGNATURE WASH (docs/icon-language.md §0/§7): every category glyph is a
// single ink line over ONE soft brand-blue interior region — the region a child
// would color in. Selectors are curated per key because lucide child order is
// arbitrary; keys without an entry fall back to washing `rect` children (a rect
// is always a closed body region, so the default can never mis-fill an open
// path). Keys with no washable region render pure line and still belong to the
// family. ⚠️ Class strings must stay LITERAL (no template concatenation) —
// Tailwind's scanner and the design-lint hook both read the source text.
const WASH_MAP: Record<string, string> = {
  Baby: '[&>path:nth-of-type(3)]:fill-brand-100',
  Bike: '[&>circle]:fill-brand-100',
  BookOpen: '[&>path]:fill-brand-100',
  Building2: '[&>path:first-of-type]:fill-brand-100',
  Camera: '[&>circle]:fill-brand-100',
  Coffee: '[&>path:nth-of-type(3)]:fill-brand-100',
  Compass: '[&>path]:fill-brand-100',
  Dumbbell: '[&>path:first-of-type]:fill-brand-100 [&>path:nth-of-type(4)]:fill-brand-100',
  Gamepad2: '[&>path]:fill-brand-100',
  // Bespoke motorbike: both wheel discs — a mirrored twin pair is ONE wash move
  // (§0 addendum), exactly how Bike washes its circles.
  Gauge: '[&>circle]:fill-brand-100',
  Heart: '[&>path]:fill-brand-100',
  House: '[&>path:first-of-type]:fill-brand-100',
  KeyRound: '[&>path]:fill-brand-100',
  Laptop: '[&>path:first-of-type]:fill-brand-100',
  Map: '[&>path:first-of-type]:fill-brand-100',
  MessagesSquare: '[&>path:first-of-type]:fill-brand-100',
  PackageOpen: '[&>path:nth-of-type(3)]:fill-brand-100',
  PawPrint: '[&>*]:fill-brand-100',
  // Plane: deliberately NO entry. Its single closed path is the whole
  // silhouette, and §0 forbids whole-silhouette washes — §6's graceful degrade
  // (pure line) applies. Confirmed as a spec breach by the blind critic
  // (2026-08-06, pixel-probed); do not re-add without a separable region.
  PlaneTakeoff: '[&>path:nth-of-type(2)]:fill-brand-100',
  Search: '[&>circle]:fill-brand-100',
  Shirt: '[&>path]:fill-brand-100',
  ShoppingBag: '[&>path:first-of-type]:fill-brand-100',
  Sofa: '[&>path:nth-of-type(2)]:fill-brand-100',
  Sparkles: '[&>path:first-of-type]:fill-brand-100',
  Stamp: '[&>path:nth-of-type(2)]:fill-brand-100',
  Tag: '[&>path]:fill-brand-100',
  Truck: '[&>circle]:fill-brand-100',
  UsersRound: '[&>circle]:fill-brand-100',
  UtensilsCrossed: '[&>path:nth-of-type(2)]:fill-brand-100',
  WashingMachine: '[&>rect]:fill-brand-100 [&>circle]:fill-brand-100',
  Watch: '[&>circle]:fill-brand-100',
  Wrench: '[&>path]:fill-brand-100',
  Zap: '[&>path]:fill-brand-100',
}
const WASH_DEFAULT = '[&>rect]:fill-brand-100'

export function CategoryIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? HelpCircle
  // Display tier stroke (icon-language §2): category art renders at h-11+ where
  // stroke 2 looks rubber-stamped; 1.5 scales to the premium ~2.75px line. The
  // caller's className comes last so a call-site can still override anything.
  return (
    <Icon
      strokeWidth={STROKE_DISPLAY}
      className={cn(WASH_MAP[name] ?? WASH_DEFAULT, className)}
    />
  )
}
