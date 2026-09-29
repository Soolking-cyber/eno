import 'server-only'
import { cache } from 'react'
import { db } from '@/lib/db'
import { scopedListingWhere } from '@/lib/edition-scope'
import { serializeListingCard, LISTING_CARD_SELECT } from '@/lib/serialize'
import { localizeListingTitles } from '@/lib/translate'
import { carCohorts, bikeCohorts, districtCounts, periodOf, transmissionOf, seatsOf, isVinFast, type Cohort, type HubRow } from '@/lib/vehicle-hub-stats'

/**
 * THE DATA BEHIND ONE HCMC VEHICLE-HIRE HUB — one loader per kind, cached per render.
 *
 * ⚠️ THE HUB IS "LIVE VEHICLE HIRE IN HCMC", NOT "THE IMPORT". The predicate is the category +
 * subcategory + city, never the import sellers' ids, so the day a real shop posts a scooter on
 * eno.vn it is on the hub with no code change. (Today every row is an imported reference listing,
 * and the page's disclosure says so from the counts, not from a hard-coded claim.)
 *
 * ⛔ `scopedListingWhere` IS CALLED LITERALLY AT EACH `db.listing` READ — edition-lint checks for it
 * (the licensing boundary; see seo-landing-where.ts for why it is not hidden in a helper).
 */

export type VehicleHubKind = 'car' | 'motorbike'

const SUBCAT: Record<VehicleHubKind, string> = { car: 'car-rental', motorbike: 'motorbike-rental' }

/** The number of cards the hub renders server-side. The explorer link carries the rest. */
export const HUB_GRID_SIZE = 24

function hubWhere(kind: VehicleHubKind) {
  return {
    verified: true,
    status: 'active',
    category: { slug: 'rentals' },
    subcategorySlug: SUBCAT[kind],
    // Importers file HCMC as 'Hồ Chí Minh' (vehicle-rental-listing.ts HCMC); a wizard post may say
    // 'Ho Chi Minh City'. Either is this city; nothing else is.
    OR: [{ city: { contains: 'Hồ Chí Minh' } }, { city: { contains: 'Ho Chi Minh', mode: 'insensitive' as const } }],
  }
}

export type VehicleHubData = {
  kind: VehicleHubKind
  total: number
  cohorts: Cohort[]
  /** Cars: the four cohort counts a renter filters by. Bikes: automatic/manual × day/month. */
  counts: Record<string, number>
  districts: { district: string; count: number }[]
  /**
   * Live rows per publishing seller, largest first, with how many of them are LINKED (carry an
   * `affiliateUrl`, i.e. book on the source). ⛔ Counted per row, never "any row of this seller is
   * linked": the page's provenance copy is built from these counts (codex/opus review, 2026-09-29).
   */
  sources: { name: string; count: number; linkedCount: number }[]
  /** Rows that book on their source. `linked === total` is the only state the page may call "all". */
  linked: number
  /** The newest recorded change to any row: the honest "last updated" the database can support. */
  lastChange: Date | null
  listings: Awaited<ReturnType<typeof localizeListingTitles<ReturnType<typeof serializeListingCard>>>>
}

export const loadVehicleHub = cache(async (kind: VehicleHubKind): Promise<VehicleHubData> => {
  const where = hubWhere(kind)
  const [rows, raw] = await Promise.all([
    db.listing.findMany({
      where: await scopedListingWhere(where),
      select: {
        price: true, priceUnit: true, attributes: true, title: true, district: true, updatedAt: true,
        affiliateUrl: true, seller: { select: { name: true } },
      },
    }),
    db.listing.findMany({
      where: await scopedListingWhere(where),
      select: LISTING_CARD_SELECT,
      // The explorer's own order, so the hub and "see all" open on the same first cards.
      orderBy: [{ rankScore: 'desc' }, { id: 'desc' }],
      take: HUB_GRID_SIZE,
    }),
  ])

  const hubRows: HubRow[] = rows
  const bySource = new Map<string, { count: number; linkedCount: number }>()
  let linked = 0
  let lastChange: Date | null = null
  for (const r of rows) {
    const s = bySource.get(r.seller.name) ?? { count: 0, linkedCount: 0 }
    s.count++
    if (r.affiliateUrl) { s.linkedCount++; linked++ }
    bySource.set(r.seller.name, s)
    if (!lastChange || r.updatedAt > lastChange) lastChange = r.updatedAt
  }

  const counts: Record<string, number> = {}
  if (kind === 'car') {
    counts['seats-4-5'] = rows.filter((r) => seatsOf(r) === '4' || seatsOf(r) === '5').length
    counts['seats-7'] = rows.filter((r) => seatsOf(r) === '7').length
    counts.vinfast = rows.filter(isVinFast).length
  } else {
    for (const p of ['daily', 'monthly'] as const) {
      counts[p] = rows.filter((r) => periodOf(r) === p).length
    }
    for (const t of ['automatic', 'manual'] as const) {
      counts[t] = rows.filter((r) => transmissionOf(r) === t).length
    }
  }

  return {
    kind,
    total: rows.length,
    cohorts: kind === 'car' ? carCohorts(hubRows) : bikeCohorts(hubRows),
    counts,
    // Every raw spelling, not a top-N: the hub merges spellings of one place (vehicle-hub.tsx) before it cuts.
    districts: districtCounts(hubRows, 200),
    sources: [...bySource.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.count - a.count),
    linked,
    lastChange,
    listings: await localizeListingTitles(raw.map(serializeListingCard)),
  }
})

/**
 * Live rows behind one hub — the pages sitemap submits a hub URL only while this is > 0, so an empty
 * hub (which serves `noindex`) is never "Submitted URL marked noindex" in Search Console (opus, 2026-09-29).
 */
export async function vehicleHubLiveCount(kind: VehicleHubKind): Promise<number> {
  return db.listing.count({ where: await scopedListingWhere(hubWhere(kind)) })
}

/** Hub slug → kind, for the sitemap's gate. Kept beside the predicate it gates on. */
export const VEHICLE_HUB_KIND_BY_SLUG: Record<string, VehicleHubKind> = {
  'car-rental-ho-chi-minh-city': 'car',
  'thue-xe-tu-lai-tphcm': 'car',
  'motorbike-rental-ho-chi-minh-city': 'motorbike',
  'thue-xe-may-tphcm': 'motorbike',
}
