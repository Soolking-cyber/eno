/**
 * PLACES VS VEHICLE HIRE inside the one `rentals` category.
 *
 * The taxonomy keeps every rental in one category (taxonomy.ts, rentals), homes and vehicle hire
 * alike. The rentals HUB pages (/c/rentals and /c/rentals/<district>) are about places: their H1s
 * answer "apartments for rent in …", their ledes count "places for rent" and say how many are
 * "linked from partner property portals". Since the HCMC vehicle-rental import
 * (scripts/import-vehicle-rentals.ts, ~6,400 cars and motorbikes) those pages must not count or
 * list a car as a place, or a car-hire site as a property portal. The explorer (/?category=rentals)
 * still shows everything, and its subcategory chips are how vehicle hire is browsed.
 */
import type { Prisma } from '@/generated/prisma/client'

export const VEHICLE_RENTAL_SUBCATS = ['motorbike-rental', 'car-rental', 'bicycle-rental', 'ebike-rental']

/**
 * A rentals row that is a place. ⚠️ `OR subcategorySlug IS NULL`: a Rever row with no mapped type
 * ("Bất động sản khác") is still a place, and a bare `notIn` would drop it — SQL's NOT IN over NULL
 * is NULL, not true.
 */
export const RENTAL_PLACES: Prisma.ListingWhereInput = {
  OR: [{ subcategorySlug: null }, { subcategorySlug: { notIn: VEHICLE_RENTAL_SUBCATS } }],
}

/** The /api/listings param a places-only hub sends with its sort and Show-more requests, so page 2
 *  comes from the same set the hub counted (feed-query.ts). */
export const PLACES_KIND_PARAM = { key: 'kind', value: 'places' } as const
