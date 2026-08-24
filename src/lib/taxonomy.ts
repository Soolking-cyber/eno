import { SERVICES_DESK_TILES } from '@/lib/edition-services-copy'
// The edition flag itself — import-free by design so client components can read it and have the
// dead branch minified away. See the note on DESK_SHORTCUTS below for why the gate is load-bearing.
import { IS_SERVICES } from '@/lib/edition'
// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL TAXONOMY — single source of truth for categories, subcategories,
// listing types (intent), and per-category facets.
//
// Consumed by: prisma/seed.ts (category upserts), the home category grid, the
// facet bar, the post wizard, and the SEO landing pages. Editing this file +
// reseeding categories is the ONLY place taxonomy changes are made.
//
// Design (per product decisions 2026-06-23):
//   • "What it is" (category/subcategory) is separate from "intent" (listingType).
//     A motorbike lives in Vehicles whether it's rented (rent) or sold (sell).
//   • Subcategory is chosen explicitly at post time (auto-suggested by keywords)
//     and stored on Listing.subcategorySlug — reliable filtering, accurate facets.
//   • Free & Giveaways and Wanted/ISO are INTENT SHORTCUTS (listingType filters
//     surfaced as chips), not real categories — so they don't double-code.
// ─────────────────────────────────────────────────────────────────────────────

import type { CategoryColor } from './types'
// Relative specifier (the visa-shop.ts idiom): `@/…` does not resolve under vitest, and
// this file's visa wiring is unit-tested in src/lib/taxonomy.visa.test.ts. speed.ts is a
// pure, import-free, side-effect-free module — safe to pull into a client bundle.
import { VISA_ENTRY_TYPES, VISA_SPEED_CODES, VISA_SPEED_SPECS } from './visa/speed'

// ── Intent axis ──────────────────────────────────────────────────────────────
export type ListingType = 'sell' | 'rent' | 'free' | 'wanted' | 'wholesale' | 'service' | 'job' | 'event'

export const LISTING_TYPES: { value: ListingType; label: string; labelVi: string; icon: string }[] = [
  { value: 'sell', label: 'For sale', labelVi: 'Cần bán', icon: 'Tag' },
  { value: 'rent', label: 'For rent', labelVi: 'Cho thuê', icon: 'KeyRound' },
  { value: 'free', label: 'Free', labelVi: 'Cho tặng', icon: 'Gift' },
  // ⚠️ `wanted` REVERSES THE DIRECTION OF A LISTING — it is the only intent where the poster is the
  // BUYER. Anything that reads listingType to decide who does what (contact copy, offers, the
  // price line) has to account for that; a "price" on a wanted post is a budget, not an ask.
  { value: 'wanted', label: 'Wanted', labelVi: 'Cần mua', icon: 'PackageSearch' },
  { value: 'wholesale', label: 'Wholesale', labelVi: 'Bán sỉ', icon: 'Boxes' },
  { value: 'service', label: 'Service', labelVi: 'Dịch vụ', icon: 'Wrench' },
  { value: 'job', label: 'Job', labelVi: 'Việc làm', icon: 'Briefcase' },
  { value: 'event', label: 'Event', labelVi: 'Sự kiện', icon: 'CalendarDays' },
]

export const LISTING_TYPE_LABEL: Record<ListingType, { en: string; vi: string }> = Object.fromEntries(
  LISTING_TYPES.map((t) => [t.value, { en: t.label, vi: t.labelVi }]),
) as Record<ListingType, { en: string; vi: string }>

// Intent shortcuts surfaced in the category grid (not real categories — they map
// to a listingType filter across all categories).
export const INTENT_SHORTCUTS: { type: ListingType; name: string; nameVi: string; icon: string }[] = [
  { type: 'free', name: 'Free & Giveaways', nameVi: 'Cho tặng miễn phí', icon: 'Gift' },
  // Owner, 2026-08-16: "cant we have both, wanted chip and the category renders all wanted
  // products". Both is what this list IS — an intent tile sits in the category grid and browses
  // like a category, while the data underneath stays one taxonomy. A wanted motorbike is still a
  // motorbike in Vehicles; it does not get a second Motorbike subcategory to drift out of sync.
  { type: 'wanted', name: 'Wanted', nameVi: 'Cần mua', icon: 'PackageSearch' },
  { type: 'wholesale', name: 'Wholesale', nameVi: 'Bán sỉ', icon: 'Boxes' },
]

// ── Facets (per-category structured attributes) ──────────────────────────────
// A range facet stores a precise NUMBER on a dedicated Listing column (queryable
// as a min/max range), not in the stringly-typed `attributes` JSON. `column` is
// the Listing field; the wizard renders a draggable slider + number input, and the
// advanced filter renders a min–max range over the same scale.
export type RangeColumn = 'year' | 'mileageKm' | 'engineL' | 'engineCc' | 'areaM2' | 'salaryM'
export type RangeMeta = {
  min: number
  max: number
  step: number
  unit?: string        // shown after the value, e.g. 'km', 'L' (year has none)
  column: RangeColumn  // dedicated Listing column this facet reads/writes
}
export type FacetDef = {
  key: string
  label: string
  labelVi: string
  // How it renders: 'toggle' = segmented button group (short enums — gear, fuel);
  // 'select' = dropdown (longer lists — color); 'range' = numeric slider + min/max
  // filter over `range.column`. Default 'select'.
  kind?: 'toggle' | 'select' | 'range'
  range?: RangeMeta // required when kind === 'range'
  // Restrict this facet to certain subcategory slugs (e.g. cc engine for motorbikes
  // vs litre engine for cars). Absent = applies to every subcategory in the category.
  subcats?: string[]
  // NOT required to publish. The post wizard requires every non-range facet of the
  // chosen subcategory before it will publish (that IS the gate — see isRequiredFacet),
  // which is right for "condition"/"transmission" but wrong for a facet that only
  // describes ONE kind of listing inside a shared subcategory: services/visa-legal
  // holds work-permit and tax listings as well as e-visa products, and an ordinary
  // seller must not be blocked by a chip that means nothing for their service.
  // Standing owner policy is maximum posting leniency at launch — mark such a facet
  // optional rather than narrowing the subcategory. Absent/false = required as before.
  optional?: boolean
  // The mirror image of `subcats`: applies everywhere in the category EXCEPT these
  // subcategories. Use it when a facet is right for almost the whole category and
  // meaningless in one corner of it — listing the other dozen subcategories in
  // `subcats` instead would silently drop each new subcategory out of the facet.
  excludeSubcats?: string[]
  // DERIVED, never asked. The value is computed server-side from something the app
  // already knows, so the wizard must not render a chip for it and it can never gate
  // publishing — but it is still a real facet for FILTERING, and sanitizeAttributes
  // still whitelists its key, so browse keeps working.
  derived?: boolean
  options: { value: string; label: string; labelVi: string }[]
}

/** A facet the post wizard BLOCKS PUBLISH on. Range facets (year/mileage/engine) were
 *  never part of the gate — they have a value at every position of the slider — and an
 *  `optional` facet opts out by declaration. One predicate, used by the wizard's
 *  completeness checklist AND its red-flagging, so the two can never disagree. */
export function isRequiredFacet(f: FacetDef): boolean {
  return f.kind !== 'range' && !f.optional && !f.derived
}

/** Facets the POST WIZARD shows as chips. `derived` ones are computed from the account,
 *  so asking would be redundant at best and contradictory at worst (a seller could tick
 *  "Individual" on a registered business account). They stay in facetsFor() because
 *  browse still filters on them. */
export function askableFacetsFor(categorySlug: string, subcategorySlug?: string | null): FacetDef[] {
  return facetsFor(categorySlug, subcategorySlug).filter((f) => !f.derived)
}

// Newest selectable model year — current year + 1 (dealers list next-year models).
const MAX_YEAR = new Date().getFullYear() + 1

// ── Subcategories ────────────────────────────────────────────────────────────
export type SubcatDef = {
  slug: string
  name: string
  nameVi: string
  /** lucide icon name (resolved via CategoryIcon) — every subcat has one. */
  icon: string
  keywords: string[]
}

// ── Categories ───────────────────────────────────────────────────────────────
export type CategoryDef = {
  slug: string
  name: string
  nameVi: string
  icon: string // lucide icon name (must be registered in category-icons.tsx)
  color: CategoryColor // cosmetic — all collapse to the single brand blue
  description: string
  types: ListingType[] // intents valid for this category (drives wizard + filters)
  subcategories: SubcatDef[]
  facets: FacetDef[]
}

const COND: FacetDef = {
  key: 'condition',
  label: 'Condition',
  labelVi: 'Tình trạng',
  kind: 'toggle',
  options: [
    { value: 'new', label: 'New / Like new', labelVi: 'Mới / Như mới' },
    { value: 'used', label: 'Used', labelVi: 'Đã dùng' },
  ],
}

// ── Visa products ────────────────────────────────────────────────────────────
// A Vietnam e-Visa service is sold as an ORDINARY listing: one product = one entry
// type at one processing speed, priced by whoever posts it on Listing.price. These
// two coordinates are where such a listing lives.
export const VISA_CATEGORY_SLUG = 'services'
export const VISA_SUBCATEGORY_SLUG = 'visa-legal'

/** Is this category+subcategory the slot an e-visa PRODUCT is sold from? Says nothing
 *  about WHO posted it — services/visa-legal is a perfectly ordinary subcategory that
 *  also holds work-permit, tax and legal listings from ordinary sellers. */
export function isVisaProductSlot(categorySlug: string, subcategorySlug?: string | null): boolean {
  return categorySlug === VISA_CATEGORY_SLUG && subcategorySlug === VISA_SUBCATEGORY_SLUG
}

/**
 * The two things eno.vn SELLS, pinned to the head of the home category grid.
 *
 * ⚠️ WHY THESE NEED NAMING AT ALL. Measured 2026-07-28: `/` took 570 page views in seven days
 * and `/vietnam-evisa` took ZERO. The products were never actually unreachable — the grid is
 * ordered by real demand and `services` already sat SECOND (electronics 303, services 106), and
 * the business rail already carried the desk. What was missing was a NAME: nobody scanning
 * category tiles reads "Services" as "Vietnam e-Visa", and the trip planner had no tile at all.
 *
 * ⚠️ NO BESPOKE CHROME, DELIBERATELY. A previous attempt built a visa pricing table plus an admin
 * grid and threw it away, because a visa service is an ORDINARY LISTING whose type and speed are
 * taxonomy facets. So the e-Visa entry is a FILTER, not a route: it applies
 * ?category=services&subcategory=visa-legal and the ordinary explorer renders all 14 SKUs with
 * the visaEntryType/visaSpeed chips and vnd.ts prices that already exist. Verified against the
 * live API: that filter returns exactly 14. The trip planner is the one that is genuinely not a
 * listing — it is a tool — so it routes.
 *
 * ⚠️ THE HREF IS DERIVED FROM THE SLUG CONSTANTS ABOVE, never typed out, so it cannot drift from
 * the taxonomy the way the SEO landing pages did (two of them shipped pointing at `house-rentals`
 * and `motorbike-rentals`, neither of which is a real Category slug, and nothing caught it because
 * a wrong slug does not throw — it just renders an empty rail that looks like "no inventory yet").
 *
 * ⚠️ CalendarDays FOR THE TRIP TILE, NOT Map. `Map` is ALREADY on this screen: it is the area
 * selector inside the hero search pill (listings-explorer.tsx:1572), a few pixels above this grid.
 * Reusing the glyph would put one icon on one screen meaning two different things. Caught by a
 * reviewer; both icons are registered in category-icons.tsx.
 *
 * Shape mirrors INTENT_SHORTCUTS above, plus the kind/href pair the tile needs.
 */
/**
 * ⚠️ EMPTY ON THE MARKETPLACE EDITION. These two tiles read "Vietnam e-Visa" and "Trip planner" and
 * sit ABOVE THE FOLD on the most-crawled page of the site — the single most visible mention of an
 * unlicensed service on eno.vn, which is a licensed sàn TMĐT.
 *
 * ⚠️ GATED IN THE DATA, NOT AT THE RENDER SITE, and that is deliberate. The plan proposed wrapping
 * the `.map` in listings-explorer.tsx; gating here means the NEXT consumer of this constant is
 * covered too, without anyone remembering. It is exported, so "there is only one call site today" is
 * a fact with a short shelf life. It also keeps the change out of listings-explorer.tsx, a landmine
 * file whose pagination sentinel must never be touched incidentally.
 *
 * ⛔ THE SENTENCE THAT USED TO BE HERE WAS FALSE, AND IT WAS ONE ENV FLIP FROM PUTTING A TRIP
 * PLANNER ON eno.vn'S HOME PAGE. It claimed "`IS_SERVICES` is a build-time constant, so on a
 * marketplace build this is a literal `[]`" — but there was no `IS_SERVICES` in the expression at
 * all. The only thing emptying this was the `@/lib/edition-services-copy` ALIAS in next.config.ts,
 * and that alias is skipped whenever `MARKETPLACE_HOSTS_SERVICES` is on. The render site
 * (category-rail.tsx, via listings-explorer.tsx) is ungated too, so turning the flag on to host a
 * partner's visa CHAT would also have shipped "Vietnam e-Visa" and "Trip planner" tiles above the
 * fold on the most-crawled page on the site — the second while itineraries are deliberately off.
 *
 * ⚠️ A GATE DECIDES WHAT RENDERS; AN ALIAS DECIDES WHAT SHIPS. Both are wanted, and they are not
 * substitutes: the alias keeps the words out of the artifact, this keeps the tiles off the page
 * even in a build where the alias is not applied. The repo has been bitten by treating either one
 * as sufficient — see the note on the visa-start alias in next.config.ts.
 */
export const DESK_SHORTCUTS: {
  key: string; name: string; nameVi: string; icon: string; kind: 'filter' | 'route'; href: string
}[] = IS_SERVICES ? SERVICES_DESK_TILES : []

// Entry-type copy. The VALUES and their order come from VISA_ENTRY_TYPES (the engine's
// own union), so a new entry type is a TYPE ERROR here instead of a chip that silently
// never appears. Only two exist: src/lib/visa/schema.ts models entryType alone, over one
// window (MAX_EVISA_VALIDITY_DAYS = 90) — 90-day is implied by both options, so don't
// invent other validities here.
const VISA_ENTRY_TYPE_COPY: Record<(typeof VISA_ENTRY_TYPES)[number], { label: string; labelVi: string }> = {
  single: { label: 'Single entry', labelVi: 'Nhập cảnh một lần' },
  multiple: { label: 'Multiple entry', labelVi: 'Nhập cảnh nhiều lần' },
}
const VISA_ENTRY_TYPE_OPTIONS = VISA_ENTRY_TYPES.map((value) => ({ value, ...VISA_ENTRY_TYPE_COPY[value] }))

// Processing-speed copy is DERIVED, never restated: src/lib/visa/speed.ts owns both the
// codes and their wording (see the ⚠️ block at the top of that file). Restating them here
// is what let 'Normal processing' and 'Standard' drift apart while the buyer's chip and
// the operator's tier claimed to be the same thing — and a restated VALUE would be worse
// still: parseVisaSpeedCode() only accepts these seven, so a rename in one file alone
// would make every already-posted product unresolvable and therefore unsellable.
// ⚠️ scripts/gen-ui-strings.mjs harvests EN copy out of THIS file by regex, so these seven
// labels are no longer harvested — the script needs src/lib/visa/speed.ts added to that
// block (it would also pick up the turnaround copy, which has never been harvested).
const VISA_SPEED_OPTIONS = VISA_SPEED_CODES.map((code) => ({
  value: code,
  label: VISA_SPEED_SPECS[code].label,
  labelVi: VISA_SPEED_SPECS[code].labelVi,
}))

// Shared colour palette — used by several product categories.
const COLOR_OPTIONS = [
  { value: 'black', label: 'Black', labelVi: 'Đen' },
  { value: 'white', label: 'White', labelVi: 'Trắng' },
  { value: 'grey', label: 'Grey / Silver', labelVi: 'Xám / Bạc' },
  { value: 'red', label: 'Red', labelVi: 'Đỏ' },
  { value: 'blue', label: 'Blue', labelVi: 'Xanh dương' },
  { value: 'green', label: 'Green', labelVi: 'Xanh lá' },
  { value: 'neutral', label: 'Beige / Gold', labelVi: 'Be / Vàng' },
  { value: 'other', label: 'Other', labelVi: 'Khác' },
]

export const TAXONOMY: CategoryDef[] = [
  // 1 ── VEHICLES ─────────────────────────────────────────────────────────────
  {
    slug: 'vehicles',
    name: 'Vehicles',
    nameVi: 'Xe cộ',
    icon: 'CarFront',
    color: 'sky',
    description: 'Buy or sell motorbikes, bicycles, cars, e-bikes, parts & gear. (To rent, see the Rentals category.)',
    types: ['sell', 'wanted', 'wholesale'],
    subcategories: [
      { slug: 'motorbike', name: 'Motorbike', nameVi: 'Xe máy', icon: 'Gauge', keywords: ['motorbike', 'scooter', 'vision', 'airblade', 'air blade', 'lead', 'sh', 'vespa', 'xe ga', 'tay ga', 'manual', 'wave', 'sirius', 'exciter', 'winner', 'xe máy', 'xe số', 'côn tay'] },
      { slug: 'bicycle', name: 'Bicycle', nameVi: 'Xe đạp', icon: 'Bike', keywords: ['bicycle', 'bike', 'mountain bike', 'road bike', 'xe đạp'] },
      { slug: 'car', name: 'Car', nameVi: 'Ô tô', icon: 'Car', keywords: ['car', 'ô tô', 'sedan', 'suv', 'toyota', 'honda civic', 'mazda'] },
      { slug: 'ebike-scooter', name: 'E-bike', nameVi: 'Xe điện', icon: 'Zap', keywords: ['e-bike', 'ebike', 'electric', 'vinfast', 'xe điện'] },
      { slug: 'parts-gear', name: 'Parts', nameVi: 'Phụ tùng', icon: 'Wrench', keywords: ['helmet', 'parts', 'tire', 'phụ tùng', 'mũ bảo hiểm', 'nón'] },
      { slug: 'vehicle-other', name: 'Other', nameVi: 'Khác', icon: 'Truck', keywords: ['truck', 'van', 'boat', 'trailer', 'xe tải', 'xe van', 'thuyền', 'khác'] },
    ],
    facets: [
      // Precise, draggable numeric specs (slider + type-in). Engine is subcategory-
      // aware: cc for motorbikes, LITRES (0.1 steps) for cars. Year & mileage exact.
      { key: 'year', label: 'Year', labelVi: 'Đời xe', kind: 'range', options: [],
        range: { min: 1990, max: MAX_YEAR, step: 1, column: 'year' } },
      // xe.chotot's #1 motorbike facet — a filter now, not a subcategory split.
      { key: 'bikeType', label: 'Bike type', labelVi: 'Loại xe', kind: 'toggle',
        subcats: ['motorbike'], options: [
        { value: 'scooter', label: 'Scooter', labelVi: 'Tay ga' },
        { value: 'semi-auto', label: 'Semi-auto', labelVi: 'Xe số' },
        { value: 'clutch', label: 'Clutch', labelVi: 'Tay côn' },
      ] },
      { key: 'transmission', label: 'Transmission', labelVi: 'Hộp số', kind: 'toggle',
        subcats: ['car'], options: [
        { value: 'automatic', label: 'Automatic', labelVi: 'Số tự động' },
        { value: 'manual', label: 'Manual', labelVi: 'Số sàn' },
      ] },
      { key: 'fuel', label: 'Fuel', labelVi: 'Nhiên liệu', kind: 'toggle',
        subcats: ['car'], options: [
        { value: 'petrol', label: 'Petrol', labelVi: 'Xăng' },
        { value: 'diesel', label: 'Diesel', labelVi: 'Dầu' },
        { value: 'hybrid', label: 'Hybrid', labelVi: 'Hybrid' },
        { value: 'electric', label: 'Electric', labelVi: 'Điện' },
      ] },
      // Uniquely-Vietnamese trust/price axis (bonbanh + chotot first-class filter).
      { key: 'origin', label: 'Origin', labelVi: 'Xuất xứ', kind: 'toggle',
        subcats: ['motorbike', 'car'], options: [
        { value: 'domestic', label: 'Assembled VN', labelVi: 'Lắp ráp trong nước' },
        { value: 'imported', label: 'Imported', labelVi: 'Nhập khẩu' },
      ] },
      { key: 'mileage', label: 'Mileage', labelVi: 'Số km đã đi', kind: 'range', options: [],
        range: { min: 0, max: 300000, step: 1000, unit: 'km', column: 'mileageKm' } },
      { key: 'bodyType', label: 'Body type', labelVi: 'Kiểu dáng', subcats: ['car'], options: [
        { value: 'sedan', label: 'Sedan', labelVi: 'Sedan' },
        { value: 'suv-crossover', label: 'SUV/Crossover', labelVi: 'SUV / Crossover' },
        { value: 'hatchback', label: 'Hatchback', labelVi: 'Hatchback' },
        { value: 'pickup', label: 'Pickup', labelVi: 'Bán tải' },
        { value: 'minivan-mpv', label: 'MPV/Minivan', labelVi: 'Minivan (MPV)' },
        { value: 'van', label: 'Van', labelVi: 'Van' },
        { value: 'coupe', label: 'Coupe', labelVi: 'Coupe (2 cửa)' },
        { value: 'convertible', label: 'Convertible', labelVi: 'Mui trần' },
        { value: 'wagon', label: 'Wagon', labelVi: 'Wagon' },
      ] },
      { key: 'engineCc', label: 'Engine', labelVi: 'Phân khối', kind: 'range', options: [],
        subcats: ['motorbike'],
        range: { min: 50, max: 1500, step: 5, unit: 'cc', column: 'engineCc' } },
      { key: 'engineL', label: 'Engine', labelVi: 'Dung tích', kind: 'range', options: [],
        subcats: ['car'],
        range: { min: 0.8, max: 6.0, step: 0.1, unit: 'L', column: 'engineL' } },
      { key: 'color', label: 'Color', labelVi: 'Màu sắc', options: COLOR_OPTIONS },
    ],
  },

  // ★ RENTALS (tourists & expats) ──────────────────────────────────────────────
  // The ONE place anything is rented. Tourists/expats look for "rent a bike",
  // "rent an apartment", "hotel" as nouns — not "Vehicles → filter Rent". So every
  // rental (transport + homes + short stays) lives here, intent always `rent`, with
  // the KeyRound 🔑 icon + "Cho thuê" (literally "for rent") as the visual signal.
  // Vehicles & Property are therefore BUY/SELL-ONLY — clean, non-overlapping split.
  {
    slug: 'rentals',
    name: 'Rentals',
    nameVi: 'Cho thuê',
    icon: 'KeyRound',
    color: 'sky',
    description: 'Rent — never buy. Motorbikes, cars, bicycles, e-bikes, plus apartments, houses, rooms, hotels & serviced stays. By the day, week or month. Built for tourists & expats.',
    types: ['rent', 'wanted'],
    subcategories: [
      // Transport rentals
      { slug: 'motorbike-rental', name: 'Motorbike', nameVi: 'Xe máy', icon: 'Gauge', keywords: ['motorbike rental', 'scooter rental', 'rent a bike', 'bike rental', 'rent motorbike', 'vision', 'airblade', 'air blade', 'wave', 'monthly bike', 'thuê xe máy', 'thuê xe ga', 'thuê xe số'] },
      { slug: 'car-rental', name: 'Car', nameVi: 'Ô tô', icon: 'CarFront', keywords: ['car rental', 'rent a car', 'self drive', 'self-drive', 'with driver', 'car hire', 'thuê ô tô', 'thuê xe hơi', 'thuê xe tự lái', 'thuê xe có tài'] },
      { slug: 'bicycle-rental', name: 'Bicycle', nameVi: 'Xe đạp', icon: 'Bike', keywords: ['bicycle rental', 'bike hire', 'rent bicycle', 'thuê xe đạp'] },
      { slug: 'ebike-rental', name: 'E-bike', nameVi: 'Xe điện', icon: 'Zap', keywords: ['e-bike rental', 'ebike rental', 'electric scooter rental', 'thuê xe điện'] },
      // Home rentals (long-term residential — moved out of Property, which is buy/sell-only)
      { slug: 'apartment-rental', name: 'Apartment', nameVi: 'Căn hộ', icon: 'Building2', keywords: ['apartment rental', 'rent apartment', 'condo for rent', 'apartment for rent', 'thuê căn hộ', 'thuê chung cư'] },
      { slug: 'house-rental', name: 'House', nameVi: 'Nhà', icon: 'House', keywords: ['house rental', 'rent house', 'villa for rent', 'townhouse for rent', 'thuê nhà', 'thuê nhà nguyên căn', 'thuê biệt thự'] },
      { slug: 'room-rental', name: 'Room', nameVi: 'Phòng trọ', icon: 'BedSingle', keywords: ['room rental', 'rent room', 'roommate', 'shared room', 'thuê phòng', 'phòng trọ', 'ở ghép'] },
      // Short-term / serviced stays (tourists + arriving expats)
      { slug: 'hotel-short-stay', name: 'Hotel', nameVi: 'Khách sạn', icon: 'Hotel', keywords: ['hotel', 'hostel', 'guesthouse', 'short stay', 'short-term stay', 'nightly', 'airbnb', 'khách sạn', 'nhà nghỉ', 'lưu trú ngắn hạn'] },
      { slug: 'homestay-serviced', name: 'Homestay', nameVi: 'Homestay', icon: 'ConciergeBell', keywords: ['homestay', 'serviced apartment', 'service apartment', 'furnished stay', 'căn hộ dịch vụ'] },
      { slug: 'office-rental', name: 'Office', nameVi: 'Mặt bằng', icon: 'Store', keywords: ['office rental', 'commercial space', 'retail space', 'shopfront', 'mặt bằng', 'văn phòng cho thuê', 'thuê mặt bằng'] },
    ],
    facets: [
      { key: 'rentalPeriod', label: 'Rental period', labelVi: 'Kỳ thuê', kind: 'toggle', options: [
        { value: 'hourly', label: 'Hourly', labelVi: 'Theo giờ' },
        { value: 'daily', label: 'Daily', labelVi: 'Theo ngày' },
        { value: 'weekly', label: 'Weekly', labelVi: 'Theo tuần' },
        { value: 'monthly', label: 'Monthly', labelVi: 'Theo tháng' },
        { value: 'long-term', label: 'Long term', labelVi: 'Dài hạn' },
      ] },
      // batdongsan/nhatot rank Diện tích right after price on rent panels too.
      { key: 'areaM2', label: 'Area', labelVi: 'Diện tích', kind: 'range', options: [],
        subcats: ['apartment-rental', 'house-rental', 'room-rental', 'office-rental'],
        range: { min: 0, max: 500, step: 5, unit: 'm²', column: 'areaM2' } },
      { key: 'furnishing', label: 'Furnishing', labelVi: 'Nội thất', kind: 'toggle',
        subcats: ['apartment-rental', 'house-rental', 'room-rental', 'office-rental', 'homestay-serviced'], options: [
        { value: 'premium', label: 'Premium', labelVi: 'Nội thất cao cấp' },
        { value: 'fully', label: 'Furnished', labelVi: 'Nội thất đầy đủ' },
        { value: 'partly', label: 'Unfurnished', labelVi: 'Nhà trống' },
      ] },
      { key: 'bedrooms', label: 'Bedrooms', labelVi: 'Phòng ngủ', kind: 'toggle',
        subcats: ['apartment-rental', 'house-rental', 'room-rental'], options: [
        { value: '0', label: 'Studio', labelVi: 'Studio' },
        { value: '1', label: '1 BR', labelVi: '1 PN' },
        { value: '2', label: '2 BR', labelVi: '2 PN' },
        { value: '3', label: '3+ BR', labelVi: '3+ PN' },
      ] },
      { key: 'transmission', label: 'Transmission', labelVi: 'Hộp số', kind: 'toggle',
        subcats: ['motorbike-rental', 'car-rental'], options: [
        { value: 'automatic', label: 'Automatic', labelVi: 'Tự động / Xe ga' },
        { value: 'manual', label: 'Manual', labelVi: 'Số / Côn tay' },
      ] },
      // Mioto-class car-rental sites lead with 4/5/7-chỗ.
      { key: 'seats', label: 'Seats', labelVi: 'Số chỗ', kind: 'toggle',
        subcats: ['car-rental'], options: [
        { value: '4', label: '4 seats', labelVi: '4 chỗ' },
        { value: '5', label: '5 seats', labelVi: '5 chỗ' },
        { value: '7', label: '7 seats', labelVi: '7 chỗ' },
        { value: '9plus', label: '9+ seats', labelVi: '9+ chỗ' },
      ] },
      { key: 'delivery', label: 'Delivery', labelVi: 'Giao nhận', kind: 'toggle',
        subcats: ['motorbike-rental', 'car-rental', 'bicycle-rental', 'ebike-rental'], options: [
        { value: 'delivered', label: 'Delivered to you', labelVi: 'Giao tận nơi' },
        { value: 'pickup', label: 'Self-pickup', labelVi: 'Tự đến lấy' },
      ] },
      { key: 'guests', label: 'Guests', labelVi: 'Số khách', kind: 'toggle',
        subcats: ['hotel-short-stay', 'homestay-serviced'], options: [
        { value: '1-2', label: '1–2', labelVi: '1–2 khách' },
        { value: '3-4', label: '3–4', labelVi: '3–4 khách' },
        { value: '5plus', label: '5+', labelVi: '5+ khách' },
      ] },
    ],
  },

  // 2 ── PROPERTY (buy/sell only) ──────────────────────────────────────────────
  // Real estate to BUY or SELL. Anything for rent (apartments, houses, rooms) lives
  // in the Rentals category instead — Property never carries the `rent` intent.
  {
    slug: 'property',
    name: 'Property',
    nameVi: 'Nhà đất',
    icon: 'Building2',
    color: 'teal',
    description: 'Apartments, houses, land, offices & retail — to buy or sell. (To rent a home, see the Rentals category.)',
    types: ['sell', 'wanted'],
    subcategories: [
      { slug: 'apartment', name: 'Apartment', nameVi: 'Căn hộ', icon: 'Building', keywords: ['apartment', 'condo', 'buy apartment', 'căn hộ', 'chung cư', 'mua căn hộ'] },
      { slug: 'house', name: 'House', nameVi: 'Nhà', icon: 'House', keywords: ['house', 'villa', 'townhouse', 'buy house', 'nhà nguyên căn', 'nhà phố', 'biệt thự', 'mua nhà'] },
      { slug: 'land', name: 'Land', nameVi: 'Đất', icon: 'LandPlot', keywords: ['land', 'plot', 'lot', 'đất', 'đất nền', 'lô đất', 'thổ cư'] },
      { slug: 'office-retail', name: 'Office', nameVi: 'Văn phòng', icon: 'Store', keywords: ['office', 'retail', 'commercial', 'shop', 'văn phòng', 'mặt bằng'] },
    ],
    facets: [
      // batdongsan ranks Diện tích co-equal with price — a true from–to range.
      { key: 'areaM2', label: 'Area', labelVi: 'Diện tích', kind: 'range', options: [],
        range: { min: 0, max: 2000, step: 10, unit: 'm²', column: 'areaM2' } },
      { key: 'bedrooms', label: 'Bedrooms', labelVi: 'Phòng ngủ', kind: 'toggle',
        subcats: ['apartment', 'house'], options: [
        { value: '0', label: 'Studio', labelVi: 'Studio' },
        { value: '1', label: '1 BR', labelVi: '1 PN' },
        { value: '2', label: '2 BR', labelVi: '2 PN' },
        { value: '3', label: '3 BR', labelVi: '3 PN' },
        { value: '4', label: '4+ BR', labelVi: '4+ PN' },
      ] },
      { key: 'legalStatus', label: 'Legal status', labelVi: 'Pháp lý', kind: 'toggle', options: [
        { value: 'red-pink-book', label: 'Title deed', labelVi: 'Sổ đỏ / Sổ hồng' },
        { value: 'sale-contract', label: 'Sale contract', labelVi: 'Hợp đồng mua bán' },
        { value: 'pending-book', label: 'Deed pending', labelVi: 'Đang chờ sổ' },
        { value: 'other-papers', label: 'Other papers', labelVi: 'Giấy tờ khác' },
      ] },
      { key: 'direction', label: 'Direction', labelVi: 'Hướng nhà',
        subcats: ['apartment', 'house', 'land'], options: [
        { value: 'east', label: 'East', labelVi: 'Đông' },
        { value: 'west', label: 'West', labelVi: 'Tây' },
        { value: 'south', label: 'South', labelVi: 'Nam' },
        { value: 'north', label: 'North', labelVi: 'Bắc' },
        { value: 'northeast', label: 'Northeast', labelVi: 'Đông Bắc' },
        { value: 'southeast', label: 'Southeast', labelVi: 'Đông Nam' },
        { value: 'northwest', label: 'Northwest', labelVi: 'Tây Bắc' },
        { value: 'southwest', label: 'Southwest', labelVi: 'Tây Nam' },
      ] },
      { key: 'furnishing', label: 'Furnishing', labelVi: 'Nội thất', kind: 'toggle',
        subcats: ['apartment', 'house'], options: [
        { value: 'premium', label: 'Premium', labelVi: 'Nội thất cao cấp' },
        { value: 'fully', label: 'Furnished', labelVi: 'Nội thất đầy đủ' },
        { value: 'partly', label: 'Basic finish', labelVi: 'Hoàn thiện cơ bản' },
        { value: 'bare', label: 'Bare shell', labelVi: 'Bàn giao thô' },
      ] },
      { key: 'houseType', label: 'House type', labelVi: 'Loại nhà', subcats: ['house'], options: [
        { value: 'nha-rieng', label: 'Detached', labelVi: 'Nhà riêng' },
        { value: 'nha-mat-pho', label: 'Street-front', labelVi: 'Nhà mặt phố' },
        { value: 'biet-thu', label: 'Villa', labelVi: 'Biệt thự' },
        { value: 'lien-ke', label: 'Townhouse', labelVi: 'Nhà liền kề' },
        { value: 'shophouse', label: 'Shophouse', labelVi: 'Shophouse' },
      ] },
      { key: 'bathrooms', label: 'Bathrooms', labelVi: 'Số toilet', kind: 'toggle',
        subcats: ['apartment', 'house'], options: [
        { value: '1', label: '1', labelVi: '1' },
        { value: '2', label: '2', labelVi: '2' },
        { value: '3', label: '3+', labelVi: '3+' },
      ] },
      { key: 'floors', label: 'Floors', labelVi: 'Số tầng', kind: 'toggle',
        subcats: ['house'], options: [
        { value: '1', label: '1', labelVi: '1' },
        { value: '2', label: '2', labelVi: '2' },
        { value: '3', label: '3', labelVi: '3' },
        { value: '4', label: '4+', labelVi: '4+' },
      ] },
    ],
  },

  // 3 ── MOVING SALE (flagship) ─────────────────────────────────────────────────
  {
    slug: 'moving-sale',
    name: 'Moving',
    nameVi: 'Thanh lý',
    icon: 'PackageOpen',
    color: 'brand',
    description: 'Leaving Vietnam? Whole-home liquidations — furniture, appliances and more in one go.',
    types: ['sell', 'free'],
    subcategories: [
      { slug: 'whole-home', name: 'Full home', nameVi: 'Trọn gói', icon: 'Boxes', keywords: ['whole home', 'everything', 'moving out', 'cả nhà', 'trọn gói'] },
      { slug: 'furniture', name: 'Furniture', nameVi: 'Nội thất', icon: 'Armchair', keywords: ['sofa', 'table', 'bed', 'cabinet', 'desk', 'ghế', 'bàn', 'giường', 'tủ'] },
      { slug: 'appliances', name: 'Appliances', nameVi: 'Đồ gia dụng', icon: 'WashingMachine', keywords: ['fridge', 'washer', 'microwave', 'aircon', 'tủ lạnh', 'máy giặt', 'lò vi sóng', 'máy lạnh'] },
      { slug: 'kitchen-home', name: 'Kitchen', nameVi: 'Đồ bếp', icon: 'CookingPot', keywords: ['kitchen', 'cookware', 'plates', 'bếp', 'nồi', 'chén'] },
      { slug: 'misc', name: 'Other', nameVi: 'Khác', icon: 'Shapes', keywords: ['misc', 'various', 'linh tinh'] },
    ],
    facets: [
      COND,
      // Garage-sale behavior is driven by seller urgency (leaving date ≈ discount depth).
      { key: 'urgency', label: 'Urgency', labelVi: 'Mức độ gấp', kind: 'toggle', options: [
        { value: 'this-week', label: 'This week', labelVi: 'Đi trong tuần' },
        { value: 'this-month', label: 'This month', labelVi: 'Trong tháng' },
        { value: 'flexible', label: 'Flexible', labelVi: 'Linh hoạt' },
      ] },
    ],
  },

  // 4 ── FURNITURE & APPLIANCES ─────────────────────────────────────────────────
  {
    slug: 'furniture-appliances',
    name: 'Home',
    nameVi: 'Nhà cửa',
    icon: 'Sofa',
    color: 'indigo',
    description: 'Sofas, beds, tables, storage, lighting, fridges, washers, ACs, plants & garden.',
    types: ['sell', 'free', 'wanted', 'wholesale'],
    subcategories: [
      { slug: 'sofa-seating', name: 'Sofa', nameVi: 'Sofa', icon: 'Sofa', keywords: ['sofa', 'couch', 'armchair', 'chair', 'ghế', 'sofa'] },
      { slug: 'tables-desks', name: 'Tables', nameVi: 'Bàn', icon: 'Table', keywords: ['table', 'desk', 'dining', 'bàn', 'bàn làm việc'] },
      { slug: 'beds-mattresses', name: 'Beds', nameVi: 'Giường nệm', icon: 'BedDouble', keywords: ['bed', 'mattress', 'giường', 'nệm'] },
      { slug: 'storage', name: 'Storage', nameVi: 'Tủ kệ', icon: 'Archive', keywords: ['wardrobe', 'cabinet', 'shelf', 'tủ', 'kệ'] },
      { slug: 'lighting-decor', name: 'Decor', nameVi: 'Trang trí', icon: 'Lamp', keywords: ['lamp', 'light', 'decor', 'rug', 'đèn', 'trang trí', 'thảm'] },
      { slug: 'white-goods', name: 'Appliances', nameVi: 'Điện máy', icon: 'WashingMachine', keywords: ['fridge', 'refrigerator', 'washer', 'air conditioner', 'aircon', 'tủ lạnh', 'máy giặt', 'máy lạnh'] },
      { slug: 'kitchenware', name: 'Kitchen', nameVi: 'Đồ bếp', icon: 'CookingPot', keywords: ['kitchen', 'cookware', 'pan', 'pot', 'bếp', 'nồi', 'chảo'] },
      { slug: 'plants-garden', name: 'Plants', nameVi: 'Cây cảnh', icon: 'Sprout', keywords: ['plant', 'garden', 'pot', 'cây', 'cây cảnh', 'sân vườn'] },
    ],
    facets: [
      COND,
      { key: 'material', label: 'Material', labelVi: 'Chất liệu', kind: 'toggle',
        subcats: ['sofa-seating', 'tables-desks', 'beds-mattresses', 'storage'], options: [
        { value: 'wood', label: 'Wood', labelVi: 'Gỗ' },
        { value: 'fabric', label: 'Fabric/Leather', labelVi: 'Vải / Da' },
        { value: 'metal', label: 'Metal', labelVi: 'Kim loại' },
        { value: 'glass', label: 'Glass', labelVi: 'Kính' },
        { value: 'rattan-bamboo', label: 'Rattan', labelVi: 'Mây tre' },
      ] },
    ],
  },

  // 5 ── ELECTRONICS ────────────────────────────────────────────────────────────
  {
    slug: 'electronics',
    name: 'Electronics',
    nameVi: 'Điện tử',
    icon: 'Smartphone',
    color: 'indigo',
    description: 'Phones, laptops, TVs, audio, cameras, gaming, accessories & components.',
    types: ['sell', 'free', 'wanted', 'wholesale'],
    subcategories: [
      { slug: 'phones-tablets', name: 'Phones', nameVi: 'Điện thoại', icon: 'TabletSmartphone', keywords: ['iphone', 'ipad', 'phone', 'tablet', 'samsung', 'điện thoại', 'máy tính bảng'] },
      { slug: 'laptops-pcs', name: 'Laptops', nameVi: 'Laptop', icon: 'Laptop', keywords: ['macbook', 'laptop', 'pc', 'computer', 'dell', 'asus', 'thinkpad', 'máy tính'] },
      { slug: 'tv-monitors', name: 'TVs', nameVi: 'Tivi', icon: 'TvMinimal', keywords: ['tv', 'television', 'monitor', 'tivi', 'màn hình'] },
      { slug: 'audio', name: 'Audio', nameVi: 'Âm thanh', icon: 'Headphones', keywords: ['speaker', 'headphone', 'airpods', 'earbuds', 'loa', 'tai nghe'] },
      { slug: 'cameras', name: 'Cameras', nameVi: 'Máy ảnh', icon: 'Camera', keywords: ['camera', 'sony', 'canon', 'fujifilm', 'lens', 'máy ảnh', 'ống kính'] },
      { slug: 'gaming', name: 'Gaming', nameVi: 'Máy game', icon: 'Gamepad2', keywords: ['playstation', 'ps5', 'xbox', 'nintendo', 'switch', 'console', 'game'] },
      /**
       * ⛔ THE BIG ACCESSORY TYPES ARE THEIR OWN AISLES (owner: "branch out massive ones"). One
       * `accessories` bucket held 3,132 products — a third of the whole electronics catalogue in a
       * single unfilterable chip, which is the same "can't find anything" problem as no
       * subcategory at all. Split by MEASURED size, not by neatness: cases 1,126, screen
       * protectors 422, keyboards & mice 394, bags 287, cables+chargers 421, power banks 177.
       * ⚠️ THE TAIL STAYS IN `accessories` — watch straps (68), stands (68) and styluses (20) are
       * too thin to earn a chip, and the brand + model filters are what narrow those.
       */
      { slug: 'phone-cases', name: 'Cases & covers', nameVi: 'Ốp lưng & bao da', icon: 'Smartphone', keywords: ['ốp lưng', 'bao da', 'case', 'cover', 'ốp'] },
      { slug: 'screen-protectors', name: 'Screen protectors', nameVi: 'Dán màn hình', icon: 'Shapes', keywords: ['cường lực', 'dán màn', 'miếng dán', 'screen protector', 'tempered glass'] },
      { slug: 'keyboards-mice', name: 'Keyboards & mice', nameVi: 'Bàn phím & chuột', icon: 'Keyboard', keywords: ['bàn phím', 'keyboard', 'chuột', 'mouse', 'lót chuột', 'mousepad'] },
      { slug: 'bags-sleeves', name: 'Bags & sleeves', nameVi: 'Balo & túi chống sốc', icon: 'Briefcase', keywords: ['balo', 'túi chống sốc', 'backpack', 'sleeve', 'cặp laptop'] },
      { slug: 'cables-chargers', name: 'Cables & chargers', nameVi: 'Cáp & sạc', icon: 'Cable', keywords: ['cáp', 'cable', 'sạc', 'charger', 'adapter', 'hub'] },
      { slug: 'power-banks', name: 'Power banks', nameVi: 'Pin dự phòng', icon: 'Zap', keywords: ['pin dự phòng', 'sạc dự phòng', 'power bank'] },
      { slug: 'accessories', name: 'Other accessories', nameVi: 'Phụ kiện khác', icon: 'Boxes', keywords: ['phụ kiện', 'linh kiện', 'dây đeo', 'giá đỡ', 'tripod', 'bút cảm ứng'] },
      /**
       * ⚠️ THE FOUR BELOW WERE ADDED 2026-08-25 FROM MEASURED DEMAND, not from a wish to be
       * thorough. 3,070 imported electronics (32% of that catalogue) matched none of the seven
       * above, and clustering their titles put smartwatches, storage, networking and printers at
       * the top by a wide margin — each in the hundreds. CellphoneS carries all four as their own
       * top-level departments too, so this is where a shopper expects to look.
       * ⛔ DELIBERATELY STOPPING AT FOUR (owner: "keep tight not too many"). Power banks, tripods
       * and bags stay under `accessories`; the brand + model filters are what narrow those, and a
       * facet list with a three-product tail is worse than a short one.
       */
      { slug: 'smartwatch', name: 'Smartwatches', nameVi: 'Đồng hồ thông minh', icon: 'Watch', keywords: ['smartwatch', 'apple watch', 'galaxy watch', 'đồng hồ thông minh', 'smart band'] },
      { slug: 'storage', name: 'Storage', nameVi: 'Lưu trữ', icon: 'Archive', keywords: ['ssd', 'hdd', 'thẻ nhớ', 'usb', 'ổ cứng', 'memory card', 'flash drive'] },
      { slug: 'networking', name: 'Networking', nameVi: 'Mạng & Wifi', icon: 'Wifi', keywords: ['router', 'wifi', 'modem', 'phát sóng', 'access point', 'mesh'] },
      { slug: 'printers', name: 'Printers', nameVi: 'Máy in', icon: 'Printer', keywords: ['máy in', 'printer', 'mực in', 'toner', 'máy scan'] },
    ],
    facets: [
      COND,
      { key: 'storage', label: 'Storage', labelVi: 'Bộ nhớ', kind: 'toggle',
        subcats: ['phones-tablets', 'laptops-pcs', 'gaming'], options: [
        { value: '64', label: '64 GB', labelVi: '64 GB' },
        { value: '128', label: '128 GB', labelVi: '128 GB' },
        { value: '256', label: '256 GB', labelVi: '256 GB' },
        { value: '512-up', label: '512 GB+', labelVi: '512 GB+' },
      ] },
      { key: 'ram', label: 'RAM', labelVi: 'RAM', kind: 'toggle',
        subcats: ['phones-tablets', 'laptops-pcs', 'gaming'], options: [
        { value: '4-8', label: '4–8 GB', labelVi: '4–8 GB' },
        { value: '16', label: '16 GB', labelVi: '16 GB' },
        { value: '32-up', label: '32 GB+', labelVi: '32 GB+' },
      ] },
      { key: 'cpu', label: 'Processor', labelVi: 'Chip', kind: 'toggle',
        subcats: ['laptops-pcs'], options: [
        { value: 'intel-i3', label: 'Core i3', labelVi: 'Core i3' },
        { value: 'intel-i5', label: 'Core i5', labelVi: 'Core i5' },
        { value: 'intel-i7-i9', label: 'Core i7/i9', labelVi: 'Core i7/i9' },
        { value: 'amd-ryzen', label: 'AMD Ryzen', labelVi: 'AMD Ryzen' },
        { value: 'apple-silicon', label: 'Apple M-series', labelVi: 'Chip Apple M' },
      ] },
      { key: 'screenSize', label: 'Screen size', labelVi: 'Kích thước màn', kind: 'toggle',
        subcats: ['tv-monitors'], options: [
        { value: 'under-27', label: 'Under 27"', labelVi: 'Dưới 27"' },
        { value: '27-32', label: '27–32"', labelVi: '27–32"' },
        { value: '40-55', label: '40–55"', labelVi: '40–55"' },
        { value: '55-plus', label: '55"+', labelVi: '55" trở lên' },
      ] },
      { key: 'warranty', label: 'Warranty', labelVi: 'Bảo hành', kind: 'toggle', options: [
        { value: 'yes', label: 'In warranty', labelVi: 'Còn bảo hành' },
        { value: 'no', label: 'No warranty', labelVi: 'Hết bảo hành' },
      ] },
      { key: 'color', label: 'Color', labelVi: 'Màu sắc', options: COLOR_OPTIONS },
    ],
  },

  // 6 ── FASHION & BEAUTY ───────────────────────────────────────────────────────
  {
    slug: 'fashion-beauty',
    name: 'Fashion',
    nameVi: 'Thời trang',
    icon: 'Shirt',
    color: 'violet',
    description: "Women's & men's clothing, shoes, bags, watches, jewelry and cosmetics.",
    types: ['sell', 'wanted', 'wholesale'],
    subcategories: [
      { slug: 'womens', name: 'Women', nameVi: 'Nữ', icon: 'Venus', keywords: ['dress', 'women', 'skirt', 'đầm', 'váy', 'nữ'] },
      { slug: 'mens', name: 'Men', nameVi: 'Nam', icon: 'Mars', keywords: ['men', 'shirt', 'jacket', 'áo', 'quần', 'nam'] },
            { slug: 'shoes', name: 'Shoes', nameVi: 'Giày dép', icon: 'Footprints', keywords: ['shoes', 'sneakers', 'heels', 'giày', 'dép'] },
      { slug: 'bags', name: 'Bags', nameVi: 'Túi xách', icon: 'ShoppingBag', keywords: ['bag', 'backpack', 'wallet', 'túi', 'ví', 'balo'] },
      { slug: 'watches-jewelry', name: 'Watches', nameVi: 'Đồng hồ', icon: 'Watch', keywords: ['watch', 'jewelry', 'ring', 'necklace', 'đồng hồ', 'trang sức', 'nhẫn'] },
      { slug: 'beauty', name: 'Beauty', nameVi: 'Mỹ phẩm', icon: 'Sparkles', keywords: ['cosmetics', 'makeup', 'skincare', 'perfume', 'mỹ phẩm', 'nước hoa'] },
    ],
    facets: [
      COND,
      { key: 'gender', label: 'For', labelVi: 'Dành cho', kind: 'toggle', options: [
        { value: 'women', label: 'Women', labelVi: 'Nữ' },
        { value: 'men', label: 'Men', labelVi: 'Nam' },
        { value: 'unisex', label: 'Unisex', labelVi: 'Unisex' },
      ] },
      { key: 'size', label: 'Size', labelVi: 'Kích cỡ', kind: 'toggle',
        subcats: ['womens', 'mens'], options: [
        { value: 'xs-s', label: 'XS–S', labelVi: 'XS–S' },
        { value: 'm', label: 'M', labelVi: 'M' },
        { value: 'l', label: 'L', labelVi: 'L' },
        { value: 'xl-up', label: 'XL+', labelVi: 'XL+' },
        { value: 'free-size', label: 'Free size', labelVi: 'Free size' },
      ] },
      { key: 'shoeSize', label: 'Shoe size', labelVi: 'Cỡ giày', subcats: ['shoes'], options: [
        { value: 'eu-35', label: 'EU 35', labelVi: '35' },
        { value: 'eu-36', label: 'EU 36', labelVi: '36' },
        { value: 'eu-37', label: 'EU 37', labelVi: '37' },
        { value: 'eu-38', label: 'EU 38', labelVi: '38' },
        { value: 'eu-39', label: 'EU 39', labelVi: '39' },
        { value: 'eu-40', label: 'EU 40', labelVi: '40' },
        { value: 'eu-41', label: 'EU 41', labelVi: '41' },
        { value: 'eu-42', label: 'EU 42', labelVi: '42' },
        { value: 'eu-43', label: 'EU 43', labelVi: '43' },
        { value: 'eu-44-plus', label: 'EU 44+', labelVi: '44+' },
      ] },
      { key: 'color', label: 'Color', labelVi: 'Màu sắc', options: COLOR_OPTIONS },
    ],
  },

  // 7 ── BABY & KIDS ────────────────────────────────────────────────────────────
  {
    slug: 'baby-kids',
    name: 'Kids',
    nameVi: 'Mẹ & Bé',
    icon: 'Baby',
    color: 'cyan',
    description: 'Strollers, car seats, baby gear, toys, kids clothing and maternity.',
    types: ['sell', 'free', 'wanted', 'wholesale'],
    subcategories: [
      { slug: 'strollers-seats', name: 'Strollers', nameVi: 'Xe đẩy', icon: 'Baby', keywords: ['stroller', 'pram', 'car seat', 'xe đẩy', 'ghế ô tô'] },
      { slug: 'baby-gear', name: 'Gear', nameVi: 'Đồ dùng', icon: 'Milk', keywords: ['crib', 'cot', 'high chair', 'baby', 'cũi', 'nôi', 'ghế ăn'] },
      { slug: 'toys', name: 'Toys', nameVi: 'Đồ chơi', icon: 'ToyBrick', keywords: ['toy', 'lego', 'game', 'đồ chơi'] },
      { slug: 'kids-clothing', name: 'Clothes', nameVi: 'Quần áo', icon: 'Shirt', keywords: ['kids clothes', 'children', 'quần áo trẻ em', 'đồ trẻ em'] },
      { slug: 'maternity', name: 'Maternity', nameVi: 'Đồ bầu', icon: 'Heart', keywords: ['maternity', 'pregnancy', 'đồ bầu', 'bà bầu'] },
    ],
    facets: [
      COND,
      // Carousell/Shopee baby verticals segment by child age band above all else.
      { key: 'ageRange', label: 'Age range', labelVi: 'Độ tuổi', kind: 'toggle',
        subcats: ['strollers-seats', 'baby-gear', 'toys', 'kids-clothing'], options: [
        { value: '0-6-months', label: '0–6 mo', labelVi: '0–6 tháng' },
        { value: '6-12-months', label: '6–12 mo', labelVi: '6–12 tháng' },
        { value: '1-3-years', label: '1–3 yrs', labelVi: '1–3 tuổi' },
        { value: '3-6-years', label: '3–6 yrs', labelVi: '3–6 tuổi' },
        { value: 'over-6-years', label: '6+ yrs', labelVi: 'Trên 6 tuổi' },
      ] },
      { key: 'kidsGender', label: 'For', labelVi: 'Dành cho', kind: 'toggle',
        subcats: ['kids-clothing'], options: [
        { value: 'boy', label: 'Boy', labelVi: 'Bé trai' },
        { value: 'girl', label: 'Girl', labelVi: 'Bé gái' },
        { value: 'unisex', label: 'Unisex', labelVi: 'Unisex' },
      ] },
    ],
  },

  // 8 ── HOBBIES, SPORTS & BOOKS ────────────────────────────────────────────────
  {
    slug: 'hobbies-sports',
    name: 'Hobbies',
    nameVi: 'Sở thích',
    icon: 'Dumbbell',
    color: 'sky',
    description: 'Fitness gear, instruments, English books, board games, collectibles, camping & outdoors.',
    types: ['sell', 'free', 'wanted', 'wholesale'],
    subcategories: [
      { slug: 'fitness', name: 'Sports', nameVi: 'Thể thao', icon: 'Dumbbell', keywords: ['dumbbell', 'weights', 'yoga', 'gym', 'treadmill', 'tạ', 'thể thao'] },
      { slug: 'instruments', name: 'Instruments', nameVi: 'Nhạc cụ', icon: 'Guitar', keywords: ['guitar', 'piano', 'keyboard', 'instrument', 'đàn', 'nhạc cụ'] },
      { slug: 'books', name: 'Books', nameVi: 'Sách', icon: 'BookOpen', keywords: ['book', 'novel', 'english book', 'sách', 'truyện'] },
      { slug: 'board-games', name: 'Board games', nameVi: 'Board game', icon: 'Dices', keywords: ['board game', 'boardgame', 'collectible', 'figure', 'lego', 'sưu tầm'] },
      { slug: 'camping-outdoor', name: 'Camping', nameVi: 'Cắm trại', icon: 'Tent', keywords: ['camping', 'tent', 'hiking', 'outdoor', 'cắm trại', 'lều'] },
      { slug: 'art-crafts', name: 'Art', nameVi: 'Nghệ thuật', icon: 'Palette', keywords: ['art', 'painting', 'craft', 'tranh', 'thủ công'] },
    ],
    facets: [
      COND,
      // High-value for the bilingual audience: book language.
      { key: 'bookLanguage', label: 'Language', labelVi: 'Ngôn ngữ', kind: 'toggle',
        subcats: ['books'], options: [
        { value: 'english', label: 'English', labelVi: 'Tiếng Anh' },
        { value: 'vietnamese', label: 'Vietnamese', labelVi: 'Tiếng Việt' },
        { value: 'other', label: 'Other', labelVi: 'Khác' },
      ] },
    ],
  },

  // 9 ── PETS ───────────────────────────────────────────────────────────────────
  {
    slug: 'pets',
    name: 'Pets',
    nameVi: 'Thú cưng',
    icon: 'PawPrint',
    color: 'teal',
    description: 'Dogs, cats, adoption & rehoming, supplies, birds, fish and more.',
    types: ['sell', 'free', 'wanted'],
    subcategories: [
      { slug: 'dogs', name: 'Dogs', nameVi: 'Chó', icon: 'Dog', keywords: ['dog', 'puppy', 'chó', 'cún'] },
      { slug: 'cats', name: 'Cats', nameVi: 'Mèo', icon: 'Cat', keywords: ['cat', 'kitten', 'mèo'] },
      { slug: 'adoption', name: 'Adoption', nameVi: 'Nhận nuôi', icon: 'HeartHandshake', keywords: ['adopt', 'adoption', 'rehome', 'rescue', 'nhận nuôi', 'cho nhận nuôi'] },
      { slug: 'supplies', name: 'Supplies', nameVi: 'Phụ kiện', icon: 'Bone', keywords: ['pet food', 'cage', 'leash', 'thức ăn', 'lồng', 'phụ kiện thú cưng'] },
      { slug: 'other-pets', name: 'Other', nameVi: 'Khác', icon: 'Bird', keywords: ['bird', 'fish', 'aquarium', 'hamster', 'chim', 'cá', 'thú cưng khác'] },
    ],
    facets: [
      // chotot thú cưng: age bucket + vaccination + sex for live animals.
      { key: 'petAge', label: 'Age', labelVi: 'Độ tuổi', kind: 'toggle',
        subcats: ['dogs', 'cats', 'adoption', 'other-pets'], options: [
        { value: 'under-3-months', label: 'Baby', labelVi: 'Dưới 3 tháng' },
        { value: '3-12-months', label: 'Young', labelVi: '3–12 tháng' },
        { value: 'over-1-year', label: 'Adult', labelVi: 'Trên 1 tuổi' },
      ] },
      { key: 'vaccinated', label: 'Vaccination', labelVi: 'Tiêm phòng', kind: 'toggle',
        subcats: ['dogs', 'cats', 'adoption', 'other-pets'], options: [
        { value: 'vaccinated', label: 'Vaccinated', labelVi: 'Đã tiêm' },
        { value: 'not-vaccinated', label: 'Not yet', labelVi: 'Chưa tiêm' },
      ] },
      { key: 'petSex', label: 'Sex', labelVi: 'Giới tính', kind: 'toggle',
        subcats: ['dogs', 'cats', 'adoption', 'other-pets'], options: [
        { value: 'male', label: 'Male', labelVi: 'Đực' },
        { value: 'female', label: 'Female', labelVi: 'Cái' },
      ] },
      { ...COND, subcats: ['supplies'] },
    ],
  },

  // 10 ── JOBS ──────────────────────────────────────────────────────────────────
  {
    slug: 'jobs',
    name: 'Jobs',
    nameVi: 'Việc làm',
    icon: 'Briefcase',
    color: 'violet',
    description: 'Teaching, hospitality, IT, sales, marketing, admin, healthcare, trades, remote & internships.',
    types: ['job', 'wanted'],
    subcategories: [
      { slug: 'teaching', name: 'Teaching', nameVi: 'Giảng dạy', icon: 'GraduationCap', keywords: ['teacher', 'teaching', 'english', 'tutor', 'esl', 'giáo viên', 'gia sư'] },
      { slug: 'hospitality', name: 'Hospitality', nameVi: 'Nhà hàng', icon: 'ConciergeBell', keywords: ['barista', 'waiter', 'chef', 'hotel', 'f&b', 'phục vụ', 'pha chế'] },
      { slug: 'sales-cs', name: 'Sales', nameVi: 'Bán hàng', icon: 'Headset', keywords: ['sales', 'customer service', 'telesale', 'bán hàng', 'cskh'] },
      { slug: 'it-design', name: 'IT', nameVi: 'IT', icon: 'Code', keywords: ['developer', 'software', 'engineer', 'designer', 'it', 'thiết kế', 'lập trình'] },
      { slug: 'marketing-media', name: 'Marketing', nameVi: 'Marketing', icon: 'Megaphone', keywords: ['marketing', 'content', 'media', 'social media', 'truyền thông'] },
      { slug: 'office-admin', name: 'Admin', nameVi: 'Văn phòng', icon: 'ClipboardList', keywords: ['admin', 'office', 'accountant', 'hr', 'hành chính', 'kế toán'] },
      { slug: 'healthcare', name: 'Healthcare', nameVi: 'Y tế', icon: 'Stethoscope', keywords: ['nurse', 'doctor', 'healthcare', 'y tế', 'điều dưỡng'] },
      { slug: 'trades-labor', name: 'Trades', nameVi: 'Thợ', icon: 'HardHat', keywords: ['driver', 'labor', 'technician', 'lao động', 'tài xế', 'kỹ thuật'] },
      { slug: 'remote-freelance', name: 'Remote', nameVi: 'Freelance', icon: 'Laptop', keywords: ['remote', 'freelance', 'work from home', 'từ xa', 'freelancer'] },
      { slug: 'internship', name: 'Internship', nameVi: 'Thực tập', icon: 'Sprout', keywords: ['intern', 'internship', 'thực tập'] },
      { slug: 'job-other', name: 'Other', nameVi: 'Khác', icon: 'Shapes', keywords: ['other', 'khác'] },
    ],
    facets: [
      // VietnamWorks/TopCV panel order: salary → type → experience → work mode.
      { key: 'salary', label: 'Salary', labelVi: 'Mức lương', kind: 'range', options: [],
        range: { min: 0, max: 100, step: 1, unit: 'tr/tháng', column: 'salaryM' } },
      { key: 'jobtype', label: 'Type', labelVi: 'Loại hình', options: [
        { value: 'fulltime', label: 'Full-time', labelVi: 'Toàn thời gian' },
        { value: 'parttime', label: 'Part-time', labelVi: 'Bán thời gian' },
        { value: 'contract', label: 'Contract', labelVi: 'Hợp đồng' },
        { value: 'freelance', label: 'Freelance', labelVi: 'Tự do' },
        { value: 'temporary', label: 'Temporary', labelVi: 'Thời vụ' },
        { value: 'remote', label: 'Remote', labelVi: 'Từ xa' },
      ] },
      { key: 'experience', label: 'Experience', labelVi: 'Kinh nghiệm', kind: 'toggle', options: [
        { value: 'no-experience', label: 'None', labelVi: 'Không cần' },
        { value: 'under-1-year', label: 'Under 1yr', labelVi: 'Dưới 1 năm' },
        { value: '1-3-years', label: '1–3 yrs', labelVi: '1–3 năm' },
        { value: '3-5-years', label: '3–5 yrs', labelVi: '3–5 năm' },
        { value: 'over-5-years', label: '5+ yrs', labelVi: 'Trên 5 năm' },
      ] },
      { key: 'workMode', label: 'Work mode', labelVi: 'Hình thức', kind: 'toggle', options: [
        { value: 'on-site', label: 'On-site', labelVi: 'Tại chỗ' },
        { value: 'remote', label: 'Remote', labelVi: 'Từ xa' },
        { value: 'hybrid', label: 'Hybrid', labelVi: 'Kết hợp' },
      ] },
      { key: 'english', label: 'English', labelVi: 'Tiếng Anh', options: [
        { value: 'required', label: 'Required', labelVi: 'Yêu cầu' },
      ] },
    ],
  },

  // 11 ── SERVICES ──────────────────────────────────────────────────────────────
  {
    slug: 'services',
    name: 'Services',
    nameVi: 'Dịch vụ',
    icon: 'Wrench',
    color: 'cyan',
    description: 'Visa & legal, language lessons, cleaning, moving, repairs, beauty, fitness, photography, childcare & more.',
    types: ['service', 'wanted'],
    subcategories: [
      { slug: 'visa-legal', name: 'Visa', nameVi: 'Visa', icon: 'Stamp', keywords: ['visa', 'work permit', 'legal', 'tax', 'permit', 'giấy tờ', 'thuế', 'pháp lý'] },
      { slug: 'language-lessons', name: 'Languages', nameVi: 'Ngoại ngữ', icon: 'Languages', keywords: ['vietnamese lesson', 'english class', 'language', 'học tiếng việt', 'dạy tiếng', 'ngoại ngữ'] },
      { slug: 'coworking', name: 'Coworking', nameVi: 'Coworking', icon: 'LampDesk', keywords: ['coworking', 'co-working', 'hot desk', 'day pass', 'dedicated desk', 'shared office', 'workspace', 'không gian làm việc chung', 'văn phòng chia sẻ'] },
      { slug: 'airport-transfer', name: 'Airport', nameVi: 'Sân bay', icon: 'PlaneTakeoff', keywords: ['airport transfer', 'airport pickup', 'private transfer', 'driver', 'car with driver', 'đưa đón sân bay', 'tài xế', 'thuê xe có tài'] },
      { slug: 'cleaning', name: 'Cleaning', nameVi: 'Dọn dẹp', icon: 'BrushCleaning', keywords: ['cleaning', 'maid', 'housekeeping', 'dọn dẹp', 'giúp việc', 'vệ sinh'] },
      { slug: 'moving-delivery', name: 'Moving', nameVi: 'Chuyển nhà', icon: 'Truck', keywords: ['moving', 'delivery', 'transport', 'chuyển nhà', 'vận chuyển', 'giao hàng'] },
      { slug: 'repair', name: 'Repair', nameVi: 'Sửa chữa', icon: 'Hammer', keywords: ['repair', 'handyman', 'plumber', 'electrician', 'fix', 'sửa chữa', 'thợ'] },
      { slug: 'beauty-wellness', name: 'Beauty', nameVi: 'Làm đẹp', icon: 'Flower2', keywords: ['salon', 'spa', 'massage', 'nails', 'làm đẹp', 'thư giãn'] },
      { slug: 'fitness-pt', name: 'Fitness', nameVi: 'Thể hình', icon: 'BicepsFlexed', keywords: ['personal trainer', 'pt', 'yoga', 'fitness', 'gym', 'huấn luyện viên'] },
      { slug: 'photography', name: 'Photography', nameVi: 'Chụp ảnh', icon: 'Camera', keywords: ['photographer', 'photography', 'video', 'chụp ảnh', 'quay phim'] },
      { slug: 'childcare', name: 'Childcare', nameVi: 'Trông trẻ', icon: 'Baby', keywords: ['nanny', 'babysitter', 'childcare', 'trông trẻ', 'giữ trẻ'] },
      { slug: 'pet-services', name: 'Pets', nameVi: 'Thú cưng', icon: 'PawPrint', keywords: ['pet grooming', 'pet sitting', 'vet', 'grooming', 'thú y', 'chăm sóc thú cưng'] },
      { slug: 'service-other', name: 'Other', nameVi: 'Khác', icon: 'Shapes', keywords: ['other', 'khác'] },
    ],
    facets: [
      // Not asked for visa/legal work: it is online essentially by definition, and the rare
      // in-person case is something the applicant and the desk settle in the chat thread —
      // a chip that always reads "Online" is a required field that carries no information.
      { key: 'serviceLocation', label: 'Location type', labelVi: 'Địa điểm', kind: 'toggle', excludeSubcats: ['visa-legal'], options: [
        { value: 'at-customer', label: 'At yours', labelVi: 'Tận nơi' },
        { value: 'at-provider', label: 'At theirs', labelVi: 'Tại cơ sở' },
        { value: 'online', label: 'Online', labelVi: 'Trực tuyến' },
      ] },
      // DERIVED from the account, never asked. Profile.accountType already records whether
      // this seller onboarded as a business or an individual, so a chip here is a question
      // the app can answer itself — and one the seller could answer INCONSISTENTLY, ticking
      // "Individual" on a registered business. Still a live browse filter; only the asking
      // is gone (see askableFacetsFor + the write in createListingCore).
      { key: 'providerType', label: 'Provider', labelVi: 'Người cung cấp', kind: 'toggle', derived: true, options: [
        { value: 'individual', label: 'Individual', labelVi: 'Cá nhân' },
        { value: 'business', label: 'Business', labelVi: 'Doanh nghiệp' },
      ] },
      // ── Visa products ────────────────────────────────────────────────────────
      // A visa service is sold as an ORDINARY listing: one product = one entry type
      // at one processing speed, priced by whoever posts it on Listing.price. These
      // two facets are the product's parameters, so they ride in Listing.attributes
      // like every other facet — there is no separate visa pricing table and nothing
      // here encodes an amount. Scoped to `visa-legal` so cleaning/fitness/etc never
      // see them (same mechanism as motorbike `cc` vs car `litre`).
      //
      // ⚠️ BOTH ARE `optional`. `visa-legal` is not a visa-products-only subcategory:
      // its keywords are visa / work permit / legal / tax / permit / giấy tờ / thuế /
      // pháp lý, and suggestSubcategory() drops any Services listing mentioning one of
      // them in here. Without the flag, a Vietnamese agent posting "gia hạn work
      // permit" could not publish until they picked an e-visa entry type — exactly the
      // kind of gate the owner's launch-leniency policy forbids. The e-visa surfaces
      // read these attributes defensively (parseVisaEntryType / parseVisaSpeedCode
      // answer null, never a guessed default), so an unset chip costs a product its
      // auto-fill, never a wrong government form.
      { key: 'visaEntryType', label: 'Entry type', labelVi: 'Loại nhập cảnh', kind: 'toggle',
        subcats: [VISA_SUBCATEGORY_SLUG], optional: true, options: VISA_ENTRY_TYPE_OPTIONS },
      // Turnaround as the BUYER reads it, worded once in src/lib/visa/speed.ts. The
      // submission cutoffs attached to each tier are an operational fact of the
      // provider, not a price, so they live in code — never in this admin-editable
      // data, and never as a number a client can send.
      { key: 'visaSpeed', label: 'Processing speed', labelVi: 'Tốc độ xử lý', kind: 'toggle',
        subcats: [VISA_SUBCATEGORY_SLUG], optional: true, options: VISA_SPEED_OPTIONS },
    ],
  },

  // 12 ── COMMUNITY & EVENTS ────────────────────────────────────────────────────
  {
    slug: 'community-events',
    name: 'Community',
    nameVi: 'Cộng đồng',
    icon: 'UsersRound',
    color: 'brand',
    description: 'Meetups, language exchange, classes, sports clubs, lost & found and volunteering.',
    types: ['event', 'free'],
    subcategories: [
      { slug: 'events-meetups', name: 'Events', nameVi: 'Sự kiện', icon: 'CalendarDays', keywords: ['event', 'meetup', 'party', 'sự kiện', 'gặp gỡ'] },
      { slug: 'language-exchange', name: 'Language', nameVi: 'Ngôn ngữ', icon: 'MessagesSquare', keywords: ['language exchange', 'conversation', 'giao lưu', 'trao đổi ngôn ngữ'] },
      { slug: 'classes-workshops', name: 'Classes', nameVi: 'Lớp học', icon: 'Presentation', keywords: ['class', 'workshop', 'course', 'lớp học', 'khóa học'] },
      { slug: 'sports-clubs', name: 'Sports', nameVi: 'Thể thao', icon: 'Volleyball', keywords: ['football', 'running', 'club', 'sports group', 'clb', 'chạy bộ'] },
      { slug: 'lost-found', name: 'Lost & Found', nameVi: 'Thất lạc', icon: 'PackageSearch', keywords: ['lost', 'found', 'mất', 'thất lạc', 'nhặt được'] },
      { slug: 'volunteers', name: 'Volunteers', nameVi: 'Tình nguyện', icon: 'HandHeart', keywords: ['volunteer', 'charity', 'cause', 'tình nguyện', 'từ thiện'] },
    ],
    facets: [
      { key: 'entryCost', label: 'Cost', labelVi: 'Chi phí', kind: 'toggle',
        subcats: ['events-meetups', 'language-exchange', 'classes-workshops', 'sports-clubs'], options: [
        { value: 'free', label: 'Free', labelVi: 'Miễn phí' },
        { value: 'paid', label: 'Paid', labelVi: 'Có phí' },
      ] },
      { key: 'eventFormat', label: 'Format', labelVi: 'Hình thức', kind: 'toggle',
        subcats: ['events-meetups', 'language-exchange', 'classes-workshops'], options: [
        { value: 'in-person', label: 'In person', labelVi: 'Trực tiếp' },
        { value: 'online', label: 'Online', labelVi: 'Trực tuyến' },
      ] },
    ],
  },

  // 13 ── TICKETS & TRAVEL ──────────────────────────────────────────────────────
  {
    slug: 'tickets-travel',
    name: 'Travel',
    nameVi: 'Du lịch',
    icon: 'Plane',
    color: 'sky',
    description: 'Event tickets, tours & experiences, transport, and visa runs.',
    types: ['sell', 'service', 'wanted'],
    subcategories: [
      { slug: 'event-tickets', name: 'Tickets', nameVi: 'Vé', icon: 'Ticket', keywords: ['ticket', 'concert', 'show', 'vé', 'vé sự kiện'] },
      { slug: 'tours', name: 'Tours', nameVi: 'Tour', icon: 'Map', keywords: ['tour', 'experience', 'trip', 'du lịch', 'trải nghiệm'] },
      { slug: 'transport', name: 'Transport', nameVi: 'Di chuyển', icon: 'BusFront', keywords: ['flight', 'bus', 'train', 'transfer', 'vé máy bay', 'xe khách'] },
      { slug: 'visa-runs', name: 'Visa runs', nameVi: 'Visa run', icon: 'Stamp', keywords: ['visa run', 'border run', 'visa run'] },
      { slug: 'vouchers', name: 'Vouchers', nameVi: 'Voucher', icon: 'TicketPercent', keywords: ['voucher', 'coupon', 'deal', 'ưu đãi'] },
    ],
    facets: [
      { key: 'ticketFormat', label: 'Format', labelVi: 'Hình thức vé', kind: 'toggle',
        subcats: ['event-tickets', 'vouchers'], options: [
        { value: 'e-ticket', label: 'E-ticket', labelVi: 'Vé điện tử' },
        { value: 'physical', label: 'Physical', labelVi: 'Vé giấy' },
        { value: 'voucher-code', label: 'Code', labelVi: 'Mã voucher' },
      ] },
      { key: 'tourDuration', label: 'Duration', labelVi: 'Thời lượng', kind: 'toggle',
        subcats: ['tours'], options: [
        { value: 'day-trip', label: 'Day trip', labelVi: 'Trong ngày' },
        { value: '2-3-days', label: '2–3 days', labelVi: '2–3 ngày' },
        { value: '4-plus-days', label: '4+ days', labelVi: 'Từ 4 ngày' },
      ] },
    ],
  },

  // 14 ── FOOD & DRINK ──────────────────────────────────────────────────────────
  {
    slug: 'food-drink',
    name: 'Food',
    nameVi: 'Ẩm thực',
    icon: 'UtensilsCrossed',
    color: 'brand',
    description: 'Home bakers & cooks, imported groceries, meal prep, catering, coffee & tea.',
    types: ['sell', 'service', 'wanted', 'wholesale'],
    subcategories: [
      { slug: 'home-baking', name: 'Homemade', nameVi: 'Nhà làm', icon: 'Cookie', keywords: ['baking', 'cake', 'homemade', 'bánh', 'nhà làm'] },
      { slug: 'groceries', name: 'Groceries', nameVi: 'Thực phẩm', icon: 'ShoppingBasket', keywords: ['groceries', 'imported', 'cheese', 'thực phẩm', 'nhập khẩu'] },
      { slug: 'meal-prep', name: 'Catering', nameVi: 'Suất ăn', icon: 'Salad', keywords: ['meal prep', 'catering', 'tiffin', 'suất ăn', 'đặt tiệc'] },
      { slug: 'coffee-tea', name: 'Coffee', nameVi: 'Cà phê', icon: 'Coffee', keywords: ['coffee', 'tea', 'beans', 'cà phê', 'trà'] },
    ],
    facets: [
      // Dietary tags are critical for the expat audience; ready-now vs pre-order.
      { key: 'dietary', label: 'Dietary', labelVi: 'Chế độ ăn', kind: 'toggle', options: [
        { value: 'vegetarian', label: 'Vegetarian', labelVi: 'Chay' },
        { value: 'vegan', label: 'Vegan', labelVi: 'Thuần chay' },
        { value: 'halal', label: 'Halal', labelVi: 'Halal' },
        { value: 'gluten-free', label: 'Gluten-free', labelVi: 'Không gluten' },
      ] },
      { key: 'orderType', label: 'Availability', labelVi: 'Tình trạng hàng', kind: 'toggle', options: [
        { value: 'ready-now', label: 'Ready now', labelVi: 'Có sẵn' },
        { value: 'pre-order', label: 'Pre-order', labelVi: 'Đặt trước' },
      ] },
    ],
  },
]

// ── Lookups ──────────────────────────────────────────────────────────────────
export const CATEGORY_BY_SLUG: Record<string, CategoryDef> = Object.fromEntries(
  TAXONOMY.map((c) => [c.slug, c]),
)

// Categories where a brand is meaningful (product categories). Client-safe; the
// server-only brand resolver (src/lib/brand.ts) re-exports this same set.
export const BRAND_CATEGORY_SLUGS = [
  'electronics', 'fashion-beauty', 'vehicles', 'rentals', 'furniture-appliances', 'baby-kids', 'hobbies-sports',
] as const
export function categoryHasBrand(slug: string | null | undefined): boolean {
  return !!slug && (BRAND_CATEGORY_SLUGS as readonly string[]).includes(slug)
}

export function subcategoriesFor(categorySlug: string): SubcatDef[] {
  return CATEGORY_BY_SLUG[categorySlug]?.subcategories ?? []
}

// Facets for a category, narrowed to a subcategory when given. A facet with
// `subcats` only shows for those subcategories (e.g. cc engine for motorbikes, L
// for cars); facets without `subcats` always show. Passing no subcategory hides
// subcategory-specific facets (can't know which engine unit applies yet).
export function facetsFor(categorySlug: string, subcategorySlug?: string | null): FacetDef[] {
  const all = CATEGORY_BY_SLUG[categorySlug]?.facets ?? []
  return all.filter((f) => {
    if (f.excludeSubcats && subcategorySlug && f.excludeSubcats.includes(subcategorySlug)) return false
    return !f.subcats || (!!subcategorySlug && f.subcats.includes(subcategorySlug))
  })
}

// Range facets (numeric slider + min/max filter) for a category (+subcategory).
export function rangeFacetsFor(categorySlug: string, subcategorySlug?: string | null): (FacetDef & { range: RangeMeta })[] {
  return facetsFor(categorySlug, subcategorySlug).filter((f): f is FacetDef & { range: RangeMeta } => f.kind === 'range' && !!f.range)
}

// Allow-list of columns a `range_<col>` query param may target — guards the API
// from filtering on an arbitrary client-supplied field name.
export const RANGE_COLUMNS: readonly RangeColumn[] = ['year', 'mileageKm', 'engineL', 'engineCc', 'areaM2', 'salaryM']
export function isRangeColumn(s: string): s is RangeColumn {
  return (RANGE_COLUMNS as readonly string[]).includes(s)
}

export function typesFor(categorySlug: string): ListingType[] {
  return CATEGORY_BY_SLUG[categorySlug]?.types ?? ['sell']
}

// ── Money: the currency a listing is stored in ───────────────────────────────
// ⚠️ EVERY LISTING ON eno IS PRICED IN ĐỒNG. No category, no subcategory, no seller
// is an exception — including the e-Visa storefront, whose admin prices each product
// in VND exactly like every other seller (owner, 2026-07-22). A buyer who is charged
// in dollars is SHOWN the USD equivalent of that VND price and charged a
// SERVER-ISSUED quote of it; the conversion is a display/checkout concern and never
// a stored listing currency. A short-lived rule that stored visa products as '$'
// (f7f8ca40) was reverted for exactly this reason — do not reintroduce it.
//
// There is therefore no currency picker anywhere and a client can never send one:
// the whole money shape is DERIVED here, and the literal types below are the
// enforcement (an attempt to return anything but ₫/VND is a type error).

export type ListingMoney = {
  /** Listing.currency — the symbol stored on the row and rendered by <Price>. */
  currency: '₫'
  /** Listing.priceUnit — the suffix <Price> appends ('' = none, 'VND' = none). */
  priceUnit: string
  /** ISO code for ad/analytics payloads (Meta CAPI). Never for display. */
  isoCode: 'VND'
}

/**
 * The money shape a listing must be stored with — the ONE place either half is
 * decided, so a post and a later edit can never contradict each other.
 *
 * Always đồng. The only thing that varies is the price UNIT, which follows the
 * intent: monthly for rent/job, per-service for a service, bare otherwise.
 *
 * `categorySlug`/`subcategorySlug` stay in the contract because every caller knows
 * them and a future unit rule may want them — but they DO NOT and must not affect
 * the currency. Nor does the seller: the old `visaShopSeller` flag is gone.
 */
export function listingMoneyFor(input: {
  categorySlug: string
  subcategorySlug?: string | null
  listingType?: string | null
}): ListingMoney {
  const t = input.listingType
  return {
    currency: '₫',
    // A service price is the price OF that service, not a starting bid (owner, 2026-07-22:
    // "we dont need broad from, exact price"). "(from)" invited a haggle the seller never
    // offered and made every service card read as an estimate.
    priceUnit: t === 'rent' || t === 'job' ? 'VND/month' : t === 'service' ? 'VND/service' : 'VND',
    isoCode: 'VND',
  }
}

// Pick the best subcategory slug for a free-text title (post-wizard auto-suggest
// + mock generation). Returns undefined when nothing matches.
export function suggestSubcategory(categorySlug: string, text: string): string | undefined {
  const subs = subcategoriesFor(categorySlug)
  const hay = (text || '').toLowerCase()
  for (const s of subs) {
    if (s.keywords.some((k) => hay.includes(k.toLowerCase()))) return s.slug
  }
  return undefined
}

// Back-compat shape for the existing SUBCATEGORIES consumers (keyword-matched).
export type SubcatDefLegacy = { slug: string; name: string; nameVi: string; icon: string; keywords: string[] }
export const SUBCATEGORIES: Record<string, SubcatDefLegacy[]> = Object.fromEntries(
  TAXONOMY.map((c) => [c.slug, c.subcategories]),
)
