import type { VehicleHubKind } from '@/lib/vehicle-hub-slugs'

/** One vehicle-type chip: a facet value with its label in both languages. */
export type VehicleTypeChip = { value: string; en: string; vi: string }

/**
 * The type chips under a vehicle hub's lede (NAV-9, vehicle-hub-filter-row.tsx), in the taxonomy's own
 * values and order (taxonomy.ts, the rentals `transmission` and `seats` facets) — with the Vietnamese a
 * rider uses for a bike's gearbox: xe ga (automatic) and xe số (manual); the car labels are the seats
 * facet's own ("4 chỗ" …). `count` names the hub loader's tally (vehicle-hubs.ts `counts`).
 * ⚠️ PLAIN DATA IN A LIB, NOT IN THE ROW: the hub is a server component, and a function exported from a
 * 'use client' module cannot be called on the server.
 */
const TYPE_CHIPS: Record<VehicleHubKind, { facet: 'transmission' | 'seats'; chips: (VehicleTypeChip & { count: string })[] }> = {
  motorbike: {
    facet: 'transmission',
    chips: [
      { value: 'automatic', en: 'Automatic', vi: 'Xe ga', count: 'automatic' },
      { value: 'manual', en: 'Manual', vi: 'Xe số', count: 'manual' },
    ],
  },
  car: {
    facet: 'seats',
    chips: [
      { value: '4', en: '4 seats', vi: '4 chỗ', count: 'seats-4' },
      { value: '5', en: '5 seats', vi: '5 chỗ', count: 'seats-5' },
      { value: '7', en: '7 seats', vi: '7 chỗ', count: 'seats-7' },
      { value: '9plus', en: '9+ seats', vi: '9+ chỗ', count: 'seats-9plus' },
    ],
  },
}

/**
 * The type chips a hub's live rows support — "as the data supports": the facet, and only the values with
 * at least one live row, so no chip opens an empty result.
 */
export function hubTypeChips(data: { kind: VehicleHubKind; counts: Record<string, number> }): { facet: 'transmission' | 'seats'; types: VehicleTypeChip[] } {
  const t = TYPE_CHIPS[data.kind]
  return { facet: t.facet, types: t.chips.filter((c) => (data.counts[c.count] ?? 0) > 0).map(({ value, en, vi }) => ({ value, en, vi })) }
}
