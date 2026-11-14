import type { ReactNode } from 'react'
import { Bilingual } from '@/components/marketplace/bilingual'
import { SECTION_TITLE } from '@/components/marketplace/section-title'
import { CalendarDay } from '@/components/marketplace/calendar-day'
import { CountValue, VndValue } from '@/components/marketplace/rating-value'
import {
  ArrowUpDown, Bath, BedDouble, Blinds, CarFront, CheckCircle2, CircleParking, Clock, CookingPot, Dumbbell, Flower2,
  Heater, KeyRound, Layers, LockKeyhole, PawPrint, Refrigerator, ShieldCheck, Shirt, Snowflake, Sun, Waves, WashingMachine,
  Wifi, Zap, type IconComponent,
} from '@/components/ui/icons'
import { ICON_SIZE } from '@/lib/icon-tokens'
import { RENTAL_FACT_LABELS, type CostRow, type FactRow, type LabelPair } from '@/lib/rental-facts'
import { cn } from '@/lib/utils'
import { SHEET_HEAD_GAP, SHEET_ROWS, amenityTakesRow } from '@/lib/rental-sheet'

/**
 * THE LISTING PAGE'S RENTAL FACTS — "Costs", "Amenities" and the occupancy rows of Details (GoPlus partnership,
 * owner 2026-10-19: "display properly like management fee, electricity rate, car access etc"). The rows are computed
 * on the server (src/lib/rental-facts.ts); this file only prints them, in the Details table's own idiom — hairline
 * rows, muted label, strong right-aligned value, `data-fab-avoid` on every value (the floating support mark yields
 * over one — page.tsx's Details note) — so the three sections read as one page, not a widget dropped onto it.
 * ⛔ EXCEPT ON THE RENTAL SHEET BELOW md (`sheet`, owner-approved 2026-11-14, cook r05 "rental-c"; src/lib/rental-sheet.ts):
 * there every table on the page (Costs, Details, Seller information) drops its rules and reads 16/24, the label in body ink,
 * the value in ink at 400 — one row style, the section's hairline the only line; each row 44px at the least since build 7
 * (owner-approved 2026-11-15 (build 7), SHEET_ROWS). Same rows, same words, same order.
 * A server component: the language-following parts are the shared client leaves (<Bilingual>, <VndValue>,
 * <CountValue>, <CalendarDay>), as everywhere else on this ISR page.
 */

/** "/ kWh", "/ tháng" — the unit an amount is quoted per, after it. */
function Per({ per }: { per: LabelPair | null }) {
  if (!per) return null
  return <span className="font-normal text-muted-foreground"> / <Bilingual en={per.label} vi={per.labelVi} /></span>
}

/** One row in the Details idiom. `className` only hides a row at a width (RentalCosts' `phoneHidden`). */
function Row({ name, children, className }: { name: LabelPair; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 py-2.5', className)}>
      <dt className="text-muted-foreground"><Bilingual en={name.label} vi={name.labelVi} /></dt>
      <dd data-fab-avoid className="min-w-0 text-right font-medium text-foreground [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

/**
 * "Costs": deposit, electricity, water, service/management fee and parking — what a renter adds up before messaging.
 * Rendered only when the listing states at least one of them (the caller checks).
 * ⛔ NO RENT ROW (UI climb batch 89, 2026-11-13; blind A/B, Opus +0.24; owner: "reduce lines … super clean, minimal wording,
 * only what's necessary"): the headline price states the rent with its unit. `phoneHidden`: the keys whose row is hidden
 * BELOW md only — the deposit, when the facts line under the title already prints it on a phone (the line's deposit is
 * phone-only, so from md this row is where the deposit is). ⚠️ The caller hides the whole block below md when no other row
 * is left there, so a phone never gets an empty "Costs" heading or its hairline.
 * ⛔ A GUESSED AMOUNT IS NEVER PRINTED AS FACT (owner, 2026-10-20: "fix error electricity prices with closest guess" —
 * CostRow.estimated, an impossible GoPlus electricity rate read as its closest plausible typo): "≈ 4,000 đ / kWh estimate",
 * the "≈" bound to the figure by a no-break space. ⚠️ THE WORD IS PLAIN TEXT, never a hover title (a reviewer's catch,
 * 2026-10-20): a tooltip reaches no touch or keyboard reader, so everyone reads the same "estimate".
 */
export function RentalCosts({ rows, phoneHidden, sheet = false }: { rows: readonly CostRow[]; phoneHidden?: readonly string[]; /** The rental sheet's rows below md (src/lib/rental-sheet.ts SHEET_ROWS): no rules, 16/24, label body ink, value at 400. */ sheet?: boolean }) {
  return (
    <div className={cn('space-y-2', sheet && SHEET_HEAD_GAP)}>
      <h2 className={SECTION_TITLE}><Bilingual en={RENTAL_FACT_LABELS.costs.label} vi={RENTAL_FACT_LABELS.costs.labelVi} /></h2>
      <dl className={cn('divide-y divide-border text-sm', sheet && SHEET_ROWS)}>
        {rows.map((r) => (
          <Row key={r.key} name={r.name} className={phoneHidden?.includes(r.key) ? 'max-md:hidden' : undefined}>
            {r.estimated && <>≈&nbsp;</>}
            <VndValue value={r.amount} /><Per per={r.per} />
            {r.estimated && <> <span className="text-xs font-normal text-muted-foreground"><Bilingual en={RENTAL_FACT_LABELS.estimate.label} vi={RENTAL_FACT_LABELS.estimate.labelVi} /></span></>}
          </Row>
        ))}
      </dl>
    </div>
  )
}

/**
 * The occupancy rows (max occupants, floor, available from), drawn INSIDE the page's Details `<dl>` — they are the
 * same kind of fact as Area and Bedrooms beside them, just not facets, so they need their own labels.
 */
export function RentalFactRows({ rows }: { rows: readonly FactRow[] }) {
  return (
    <>
      {rows.map((r) => (
        <Row key={r.key} name={r.name}>
          {r.key === 'maxTenants' ? <CountValue value={r.count} />
            : r.key === 'floor' ? (typeof r.floor === 'number' ? <CountValue value={r.floor} /> : <Bilingual en={r.floor.label} vi={r.floor.labelVi} />)
            : <CalendarDay value={r.date} />}
        </Row>
      ))}
    </>
  )
}

/**
 * ⚠️ ONE GLYPH PER AMENITY, NAMED — a wrong glyph is a product bug (scripts/gen-icons.mjs), so each is the closest
 * Solar mark and the three substitutions (parking, window, water heater) are argued in scripts/lucide-solar-map.mjs.
 * An amenity with no row here gets the plain tick: still listed, never a misleading picture.
 */
const AMENITY_ICON: Readonly<Record<string, IconComponent>> = {
  'no-landlord': KeyRound,
  'car-alley': CarFront,
  'free-hours': Clock,
  pets: PawPrint,
  'private-wc': Bath,
  aircon: Snowflake,
  window: Blinds,
  balcony: Flower2,
  kitchen: CookingPot,
  fridge: Refrigerator,
  'private-washer': WashingMachine,
  washer: WashingMachine,
  'water-heater': Heater,
  bed: BedDouble,
  wardrobe: Shirt,
  mezzanine: Layers,
  'drying-yard': Sun,
  wifi: Wifi,
  elevator: ArrowUpDown,
  'fingerprint-lock': LockKeyhole,
  security: ShieldCheck,
  parking: CircleParking,
  'ev-parking': Zap,
  pool: Waves,
  gym: Dumbbell,
}

/**
 * "Amenities": what the room and building have, in the taxonomy's order (GoPlus's two headline filters first — no
 * live-in landlord, car access) and with the filter chips' own words, so a renter who filtered by one finds it here.
 * Two columns on a phone, three from `sm`; each label wraps inside its track (`minmax(0,1fr)` columns), never pushing
 * the grid past a 320px screen.
 * ⛔ `sheet` — THE RENTAL SHEET'S AMENITY LIST BELOW md (owner-approved 2026-11-15 (build 7), cook r07 "rental"; it reverses there
 * the 2026-11-14 cook r05 icon grid, "three to a row, the glyph OVER its name", and goes back to "two columns on a phone"): two
 * columns 16 apart, each amenity a 44px row — its glyph (24, ink) BESIDE its name (16/24 body ink), 12 between. A name too long
 * for a column (src/lib/rental-sheet.ts amenityTakesRow — decided from the words, in both languages, on the server) takes the
 * whole row. A name wraps where it must and is never cut; the list keeps the taxonomy's order (DOM = paint).
 */
export function RentalAmenities({ items, sheet = false }: { items: readonly (LabelPair & { value: string })[]; sheet?: boolean }) {
  return (
    <div className={cn('space-y-3', sheet && SHEET_HEAD_GAP)}>
      <h2 className={SECTION_TITLE}><Bilingual en={RENTAL_FACT_LABELS.amenities.label} vi={RENTAL_FACT_LABELS.amenities.labelVi} /></h2>
      <ul className={cn('grid grid-cols-2 gap-x-4 gap-y-3 text-sm text-foreground sm:grid-cols-3', sheet && 'max-md:grid-cols-2 max-md:gap-x-4 max-md:gap-y-1 max-md:text-base max-md:text-body')}>
        {items.map((a) => {
          const Icon = AMENITY_ICON[a.value] ?? CheckCircle2
          return (
            <li key={a.value} className={cn('flex min-w-0 items-center gap-2', sheet && 'max-md:min-h-11 max-md:gap-3', sheet && amenityTakesRow(a) && 'max-md:col-span-2')}>
              <Icon aria-hidden className={cn(ICON_SIZE.lg, 'shrink-0 text-muted-foreground', sheet && 'max-md:h-6 max-md:w-6 max-md:text-foreground')} />
              <span className={cn('min-w-0 [overflow-wrap:anywhere]', sheet && 'max-md:text-pretty')}><Bilingual en={a.label} vi={a.labelVi} /></span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
