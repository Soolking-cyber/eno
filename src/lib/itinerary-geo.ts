import { haversineKm, hasRealCoords } from '@/lib/geo'

/**
 * Coordinate validation for itinerary places — the gate every lat/lng crosses before it can
 * reach a map.
 *
 * Why this exists rather than a `typeof lat === 'number'` check at the call site is recorded in
 * geo.ts: on 2026-07-22 eight of 24 live listings sat at (0, 0), and because `typeof 0 ===
 * 'number'` the fallback never fired — one pin in the Gulf of Guinea dragged the explorer's
 * fitBounds across the whole planet and zoomed every other listing into invisibility. One bad
 * row broke the map for all of them. Itinerary places are worse exposed: their coordinates are
 * catalog- or AI-sourced, so no human has ever looked at them.
 *
 * Two tiers, because they catch different lies:
 *  · isInVietnam — a bounding box. Catches (0,0), a swapped lat/lng, another country, corruption.
 *  · isNearCity  — distance from the city the place CLAIMS to be in. This is the one that matters
 *    for generated data, because a hallucinated coordinate is usually still inside Vietnam:
 *    "Ben Thanh Market" at Hanoi's coordinates passes any bbox you can write. Only a per-city
 *    radius rejects it.
 */

/**
 * Vietnam's land + island envelope, generous at the edges but no more.
 *
 * South: Con Dao ~8.68N, the Ca Mau tip ~8.56N → 8.0.
 * North: Lung Cu (Ha Giang), the northernmost point, ~23.39N → 23.6.
 * West:  the Lao/Cambodian border and Phu Quoc's west shore ~103.5E → 102.0.
 * East:  Ly Son ~109.1E, Con Dao ~106.6E → 110.0.
 *
 * ⚠️ Deliberately NOT extended to the Spratly/Paracel claims. Those would push the east edge past
 * 114E and make the box wide enough to swallow coordinates in the South China Sea and the
 * Philippines — it would stop rejecting the very errors it exists to catch. No itinerary place is
 * out there; keep the box where travellers actually go.
 *
 * ⚠️ And know what this box CANNOT do: Vietnam is an S-curve wrapped around Cambodia, so any
 * axis-aligned rectangle containing it also contains most of Cambodia and part of Laos —
 * Phnom Penh and Vientiane both pass. Tightening it to exclude them would cut off the Mekong
 * Delta and the northwest. That is not a defect to be fixed here (a test pins the behaviour so
 * nobody tries); it is the reason isNearCity exists. The box rejects nonsense; only the radius
 * rejects a coordinate in the wrong PLACE.
 */
export const VN_BBOX = { minLat: 8.0, maxLat: 23.6, minLng: 102.0, maxLng: 110.0 } as const

/** A plausible coordinate inside Vietnam? Rejects (0,0), NaN, swaps and corruption. */
export function isInVietnam(lat: number | null | undefined, lng: number | null | undefined): boolean {
  // hasRealCoords first: it owns the (0,0)/NaN/off-earth rules, and restating them here is how
  // the two drift apart.
  if (!hasRealCoords(lat, lng)) return false
  const la = lat as number
  const ln = lng as number
  return la >= VN_BBOX.minLat && la <= VN_BBOX.maxLat && ln >= VN_BBOX.minLng && ln <= VN_BBOX.maxLng
}

/**
 * How far a place may sit from the centre of the city it is filed under.
 *
 * Per-city, because a "city" in this catalog is really a DESTINATION and they differ by an order
 * of magnitude: Hoi An's sights are a few km apart, while `mekong` spans the whole delta and
 * `hagiang` is a multi-day mountain loop. One global radius would either reject every legitimate
 * loop stop or accept a Hanoi coordinate filed under Da Nang.
 */
export const CITY_RADIUS_KM: Record<string, number> = {
  // Compact towns, beach strips, islands.
  hoian: 25, hue: 30, danang: 30, cantho: 30, condao: 30,
  nhatrang: 35, quynhon: 35, dalat: 35,
  muine: 40, ninhbinh: 40, sapa: 40, phuquoc: 45,
  // Bases whose signature sight is a national park an hour out (Yok Don, the caves).
  buonmathuot: 50, phongnha: 50, puluong: 60, hanoi: 70, hochiminh: 70, halong: 70,
  // Genuinely regional: a mountain loop and a river delta.
  caobang: 90, hagiang: 120, mekong: 120,
}

/** Fallback for a city not listed above — mid-range, never unbounded. */
export const DEFAULT_RADIUS_KM = 50

/**
 * Is `point` close enough to `cityCentre` to be credibly IN that destination?
 * Returns false for an invalid point, so callers get ONE answer to "may I plot this".
 */
export function isNearCity(
  point: { lat: number; lng: number },
  cityCentre: { lat: number; lng: number },
  cityId: string,
): boolean {
  if (!isInVietnam(point.lat, point.lng)) return false
  if (!isInVietnam(cityCentre.lat, cityCentre.lng)) return false
  const limit = CITY_RADIUS_KM[cityId] ?? DEFAULT_RADIUS_KM
  return haversineKm(point, cityCentre) <= limit
}

/** Distance in km, or null when either point is unusable. Exposed for diagnostics and tests. */
export function distanceFromCityKm(
  point: { lat: number; lng: number },
  cityCentre: { lat: number; lng: number },
): number | null {
  if (!isInVietnam(point.lat, point.lng) || !isInVietnam(cityCentre.lat, cityCentre.lng)) return null
  return haversineKm(point, cityCentre)
}
