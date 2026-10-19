import type { ReactNode } from 'react'
import { Bilingual } from '@/components/marketplace/bilingual'
import { CalendarDay } from '@/components/marketplace/calendar-day'
import { CountValue, VndValue } from '@/components/marketplace/rating-value'
import {
  ArrowUpDown, Bath, BedDouble, Blinds, CarFront, CheckCircle2, CircleParking, Clock, CookingPot, Dumbbell, Flower2,
  Heater, KeyRound, Layers, LockKeyhole, PawPrint, Refrigerator, ShieldCheck, Shirt, Snowflake, Sun, Waves, WashingMachine,
  Wifi, Zap, type IconComponent,
} from '@/components/ui/icons'
import { ICON_SIZE } from '@/lib/icon-tokens'
import { RENTAL_FACT_LABELS, RENT_PER, RENT_ROW, type CostRow, type FactRow, type LabelPair } from '@/lib/rental-facts'
import { cn } from '@/lib/utils'

/**
 * THE LISTING PAGE'S RENTAL FACTS — "Costs", "Amenities" and the occupancy rows of Details (GoPlus partnership,
 * owner 2026-10-19: "display properly like management fee, electricity rate, car access etc"). The rows are computed
 * on the server (src/lib/rental-facts.ts); this file only prints them, in the Details table's own idiom — hairline
 * rows, muted label, strong right-aligned value, `data-fab-avoid` on every value (the floating support mark yields
 * over one — page.tsx's Details note) — so the three sections read as one page, not a widget dropped onto it.
 * A server component: the language-following parts are the shared client leaves (<Bilingual>, <VndValue>,
 * <CountValue>, <CalendarDay>), as everywhere else on this ISR page.
 */

/** "/ kWh", "/ tháng" — the unit an amount is quoted per, after it. */
function Per({ per }: { per: LabelPair | null }) {
  if (!per) return null
  return <span className="font-normal text-muted-foreground"> / <Bilingual en={per.label} vi={per.labelVi} /></span>
}

/** One row in the Details idiom. */
function Row({ name, children }: { name: LabelPair; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <dt className="text-muted-foreground"><Bilingual en={name.label} vi={name.labelVi} /></dt>
      <dd data-fab-avoid className="min-w-0 text-right font-medium text-foreground [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

/**
 * "Costs": the rent, then deposit, electricity, water, service/management fee and parking — what a renter adds
 * up before messaging. Rendered only when the listing states at least one cost beyond the rent (the caller checks).
 * `rent` is the monthly price, or null when the listing is not priced per month (then no rent row — a number without
 * its period would be a guess).
 */
export function RentalCosts({ rent, rows }: { rent: number | null; rows: readonly CostRow[] }) {
  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold text-foreground"><Bilingual en={RENTAL_FACT_LABELS.costs.label} vi={RENTAL_FACT_LABELS.costs.labelVi} /></h2>
      <dl className="divide-y divide-border text-sm">
        {rent != null && rent > 0 && <Row name={RENT_ROW}><VndValue value={rent} /><Per per={RENT_PER} /></Row>}
        {rows.map((r) => (
          <Row key={r.key} name={r.name}><VndValue value={r.amount} /><Per per={r.per} /></Row>
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
 */
export function RentalAmenities({ items }: { items: readonly (LabelPair & { value: string })[] }) {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-foreground"><Bilingual en={RENTAL_FACT_LABELS.amenities.label} vi={RENTAL_FACT_LABELS.amenities.labelVi} /></h2>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm text-foreground sm:grid-cols-3">
        {items.map((a) => {
          const Icon = AMENITY_ICON[a.value] ?? CheckCircle2
          return (
            <li key={a.value} className="flex min-w-0 items-center gap-2">
              <Icon aria-hidden className={cn(ICON_SIZE.lg, 'shrink-0 text-muted-foreground')} />
              <span className="min-w-0 [overflow-wrap:anywhere]"><Bilingual en={a.label} vi={a.labelVi} /></span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
