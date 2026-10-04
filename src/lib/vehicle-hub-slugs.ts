import { fold } from '@/lib/fold'

/**
 * THE FOUR HCMC VEHICLE-HIRE HUB URLS AS PLAIN DATA — {car, motorbike} × {en, vi} — and the one rule for
 * which listing belongs on which hub.
 *
 * ⚠️ A MODULE OF ITS OWN SO THAT A PAGE WHICH ONLY LINKS A HUB DOES NOT IMPORT THE HUB. The slugs used to
 * live in src/components/marketplace/vehicle-hub.tsx, which renders the article (SeoArticle, the listing
 * grid); the listing page's breadcrumb (NAV-10) needs only the path. vehicle-hub.tsx re-exports
 * VEHICLE_HUB_SLUGS from here, so the four route files are unchanged.
 */

export type VehicleHubKind = 'car' | 'motorbike'

export const VEHICLE_HUB_SLUGS: Record<VehicleHubKind, Record<'en' | 'vi', string>> = {
  car: { en: 'car-rental-ho-chi-minh-city', vi: 'thue-xe-tu-lai-tphcm' },
  motorbike: { en: 'motorbike-rental-ho-chi-minh-city', vi: 'thue-xe-may-tphcm' },
}

/** The Rentals subcategory each hub lists — the same pair src/lib/vehicle-hubs.ts queries. */
export const VEHICLE_HUB_SUBCAT: Record<VehicleHubKind, string> = { car: 'car-rental', motorbike: 'motorbike-rental' }

/**
 * Is this listing's city the hubs' city? The hub's own query matches `city` containing 'Hồ Chí Minh' (the
 * importers' spelling) or 'Ho Chi Minh' in any case (a wizard post) — vehicle-hubs.ts `hubWhere`. Folded
 * here, so the accents and the case of either spelling cannot decide it.
 */
export function isHubCity(city: string | null | undefined): boolean {
  return !!city && fold(city).includes('ho chi minh')
}

/**
 * The hub a Rentals listing belongs on, as a path in the page's language, or `null`: a car or motorbike
 * hire listing in Ho Chi Minh City. Anything else — a bicycle, a flat, a scooter in Hà Nội — has no hub.
 */
export function vehicleHubPathFor(
  l: { categorySlug: string; subcategorySlug: string | null | undefined; city: string | null | undefined },
  lang: 'en' | 'vi',
): string | null {
  if (l.categorySlug !== 'rentals' || !isHubCity(l.city)) return null
  const kind = (Object.keys(VEHICLE_HUB_SUBCAT) as VehicleHubKind[]).find((k) => VEHICLE_HUB_SUBCAT[k] === l.subcategorySlug)
  return kind ? `/${VEHICLE_HUB_SLUGS[kind][lang]}` : null
}
