'use client'

import { useId } from 'react'
import Link from 'next/link'
import { Map as MapIcon } from '@/components/ui/icons'
import { chipVariants } from '@/components/ui/chip'
import { Bilingual } from '@/components/marketplace/bilingual'
import { localizedHref } from '@/lib/lang-pinned'
import { VEHICLE_HUB_SUBCAT, type VehicleHubKind } from '@/lib/vehicle-hub-slugs'
import type { VehicleTypeChip } from '@/lib/vehicle-hub-chips'
import { CategoryFiltersLink } from '@/app/[lang]/c/[category]/category-filters-link'

/** Ho Chi Minh City's province code (src/data/vn-units.json) — the hubs' city, as the explorer URL carries it. */
export const HCMC_PROVINCE_CODE = '79'

/**
 * THE VEHICLE HUBS' WAY INTO THE EXPLORER, AT THE TOP (NAV-9, UX3 2026-10-05) — the district hub's row
 * (DistrictFilterRow, A13 / rentals-03) for /motorbike-rental-ho-chi-minh-city, /thue-xe-may-tphcm,
 * /car-rental-ho-chi-minh-city and /thue-xe-tu-lai-tphcm. Measured before it (nav audit N9): the first
 * filter on the motorbike hub was "See all 232 motorbikes with filters" at y≈4,433 — under the whole
 * article — while the first card was at y≈1,026.
 *
 *   Bộ lọc · Bản đồ · Loại xe: Xe ga · Xe số        (cars: 4 chỗ · 5 chỗ · 7 chỗ · 9+ chỗ)
 *
 * ⚠️ EVERY LINK CARRIES THE HUB'S SCOPE IN ITS URL: Rentals › this vehicle subcategory, in the page's language
 * (`/vi?…` on a Vietnamese hub — localizedHref). ⛔ NO sessionStorage AREA HAND-OFF (codex + opus, gate
 * 2026-10-05): it was lost in a new tab and lingered after a cancelled navigation, applying HCMC to some
 * later, unrelated explorer visit. The city is in the URL instead — `province=79` (vn-units.json), which the
 * explorer reads since NAV-2 (lib/explorer-url.ts) — so a new tab, a reload and a shared link keep it.
 * ⚠️ TYPE CHIPS ONLY "AS THE DATA SUPPORTS": the caller passes the facet values with live rows (counted
 * by the hub's own loader), so a chip never opens an empty result. Gearbox for motorbikes (the
 * `transmission` facet: automatic = xe ga, manual = xe số), seats for cars (the `seats` facet).
 * ⛔ NO "Theo ngày / tuần / tháng" CHIPS (plan rev 2, §R): what the rental-period facet means is the
 * undecided N17 question ("Theo tuần" today means "priced per week", which drops every daily-priced bike
 * that can be rented for a week).
 * ⚠️ rel="nofollow" + prefetch={false}, as the district row: these URLs canonicalise to `/`, and a hub
 * is read for minutes, so a prefetched explorer would be wasted bytes. Navigating chips are
 * `chipVariants()` on a <Link> (the canon's interactive chip — a link is not a toggle), and the group
 * label names them for a screen reader (role="group" + aria-labelledby).
 */
export function VehicleHubFilterRow({
  kind,
  facet,
  types,
  lang,
}: {
  kind: VehicleHubKind
  facet: 'transmission' | 'seats'
  types: VehicleTypeChip[]
  lang: 'en' | 'vi'
}) {
  const subcategory = VEHICLE_HUB_SUBCAT[kind]
  const explorer = (extra: Record<string, string>) =>
    localizedHref(`/?${new URLSearchParams({ category: 'rentals', subcategory, province: HCMC_PROVINCE_CODE, ...extra }).toString()}`, lang)
  const typesLabel = useId()
  return (
    <div data-hub-filter-row className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
      <CategoryFiltersLink slug="rentals" query={{ subcategory, province: HCMC_PROVINCE_CODE }} />
      <Link
        href={explorer({ view: 'map' })}
        rel="nofollow"
        prefetch={false}
        className="relative tap-44 inline-flex items-center gap-1.5 whitespace-nowrap py-2.5 text-sm font-semibold text-accent-foreground hover:underline"
      >
        <MapIcon className="h-4 w-4" aria-hidden />
        <Bilingual en="Map" vi="Bản đồ" />
      </Link>
      {types.length > 0 && (
        <div role="group" aria-labelledby={typesLabel} className="flex flex-wrap items-center gap-2">
          <span id={typesLabel} className="text-xs font-semibold text-ink-4"><Bilingual en="Type:" vi="Loại xe:" /></span>
          {types.map((t) => (
            <Link
              key={t.value}
              href={explorer({ [`attr_${facet}`]: t.value })}
              rel="nofollow"
              prefetch={false}
              className={chipVariants({ size: 'sm', tone: 'neutral' })}
            >
              <Bilingual en={t.en} vi={t.vi} />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
