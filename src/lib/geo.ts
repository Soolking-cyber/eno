import type { SerializedListingCard } from '@/lib/types'

// Lean geo helpers (no Leaflet) — safe to import anywhere without pulling the map
// bundle. Prefer stored coordinates; fall back to a deterministic district-based
// guess so every listing has a plottable point.
/**
 * Is this a real point on earth, or a zero that a writer left behind?
 *
 * ⚠️ (0, 0) is "Null Island" — open ocean in the Gulf of Guinea, ~1,600km off Ghana. It is
 * never a real eno.vn location, and it arrives whenever something defaults a missing
 * coordinate to 0 instead of null: importers, seeders, and any listing whose category has
 * no meaningful place at all (a visa service is not *somewhere*). On 2026-07-22 EIGHT of
 * 24 live listings sat at (0,0).
 *
 * The damage is not limited to those listings. `typeof lat === 'number'` is true for 0, so
 * the district fallback below was skipped and the pin was plotted mid-Atlantic — and one
 * such pin in a result set drags the explorer map's fitBounds across the entire planet,
 * zooming every OTHER listing into invisibility. One bad row broke the map for all of them.
 */
export function hasRealCoords(lat: number | null | undefined, lng: number | null | undefined): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  if (lat === 0 && lng === 0) return false
  // Out-of-range values can only be corrupt; plotting them throws inside Leaflet.
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}


/**
 * City/province → a point in that city, for listings that carry no stored coordinate.
 *
 * ⛔ THIS TABLE REPLACED A THREE-CITY `if` CHAIN THAT MATCHED ALMOST NOTHING. It tested
 * `city.includes('hanoi')` and `city.includes('danang')` — no space — while every city in the
 * database is written with one: 'Ha Noi', 'Da Nang', 'Nha Trang', 'Phu Quoc', 'Hai Phong'. Not one
 * of them matched, so EVERY listing without a stored coordinate fell through to the Ho Chi Minh
 * City default. Measured on production 2026-08-24: seventeen partner tickets in Phu Quoc, Nha
 * Trang, Hoi An, Hai Phong, Nghe An and Ha Tinh were all pinned in Saigon, on top of the thirty
 * visa listings that genuinely are there. The map was confidently, invisibly wrong.
 *
 * ⚠️ KEYS ARE NORMALISED (see `normalizePlace`): lowercased, diacritics stripped, punctuation and
 * spaces removed. So one key 'hanoi' answers 'Ha Noi', 'Hà Nội', 'HANOI' and 'ha-noi' alike. That
 * is the whole reason the old chain failed, and matching on a normalised form is what stops the
 * next spelling from silently reintroducing it.
 *
 * ⚠️ PROVINCES AND THEIR CAPITALS SHARE AN ENTRY where a listing may carry either — a seller in
 * Vinh writes 'Nghe An' as often as 'Vinh'. The point is the city, which is what a map pin means.
 */
const PLACE_COORDS: Record<string, readonly [number, number]> = {
  hochiminhcity: [10.7769, 106.7009], hochiminh: [10.7769, 106.7009], saigon: [10.7769, 106.7009], tphcm: [10.7769, 106.7009],
  hanoi: [21.0285, 105.8542],
  danang: [16.0471, 108.2068],
  haiphong: [20.8449, 106.6881],
  cantho: [10.0452, 105.7469],
  nhatrang: [12.2388, 109.1967], khanhhoa: [12.2388, 109.1967],
  dalat: [11.9404, 108.4583], lamdong: [11.9404, 108.4583],
  hue: [16.4637, 107.5909], thuathienhue: [16.4637, 107.5909],
  hoian: [15.8801, 108.3380],
  quangnam: [15.5394, 108.0191],
  phuquoc: [10.2270, 103.9670], kiengiang: [10.0125, 105.0809],
  vungtau: [10.3460, 107.0843], bariavungtau: [10.3460, 107.0843],
  quynhon: [13.7829, 109.2196], binhdinh: [13.7829, 109.2196],
  vinh: [18.6733, 105.6922], nghean: [18.6733, 105.6922],
  hatinh: [18.3559, 105.8877],
  thanhhoa: [19.8067, 105.7852],
  quangninh: [20.9599, 107.0448], halong: [20.9599, 107.0448],
  hungyen: [20.6464, 106.0511],
  bacninh: [21.1861, 106.0763],
  binhduong: [11.0000, 106.6500], thudaumot: [11.0000, 106.6500],
  dongnai: [10.9453, 106.8133], bienhoa: [10.9453, 106.8133],
  buonmathuot: [12.6667, 108.0500], daklak: [12.6667, 108.0500],
  phanthiet: [10.9333, 108.1000], binhthuan: [10.9333, 108.1000],
  sapa: [22.3364, 103.8438], laocai: [22.4809, 103.9755],
  ninhbinh: [20.2506, 105.9744],
  camranh: [11.9214, 109.1591],
  conda: [8.6833, 106.6000], condao: [8.6833, 106.6000],
}

/**
 * Lowercase, strip Vietnamese diacritics, drop everything that is not a letter or digit.
 * 'Hà Nội', 'Ha Noi', 'ha-noi' and 'HANOI' all collapse to 'hanoi'.
 * ⚠️ đ/Đ NEEDS ITS OWN RULE — it is a distinct letter, not a d with a mark, so NFD leaves it
 * alone and 'Đà Nẵng' would normalise to 'đanang' and miss.
 */
export function normalizePlace(value: string | null | undefined): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * The point to plot a listing on when it has no stored coordinate, and whether we actually
 * recognised the place.
 *
 * ⚠️ `matched: false` MEANS THE PIN IS A GUESS. It is still Ho Chi Minh City — changing the
 * fallback to "no pin" would make listings vanish from the map, which is a product decision and
 * not this fix — but callers can now TELL, which they could not before, and a test can assert
 * that our own cities are all recognised.
 */
export function placeCoordinates(city: string | null | undefined, district?: string | null) {
  const cityKey = normalizePlace(city)
  const districtKey = normalizePlace(district)

  // District refinements, kept from the original: within the three biggest cities a district is
  // a materially better pin than the city centre.
  const DISTRICTS: Record<string, readonly [number, number]> = {
    tayho: [21.0718, 105.8152], hoankiem: [21.0285, 105.8522], caugiay: [21.0264, 105.7977],
    sontra: [16.0820, 108.2435], nguhanhson: [16.0279, 108.2494], haichau: [16.0594, 108.2199],
    district2: [10.8016, 106.7368], quan2: [10.8016, 106.7368], thaodien: [10.8016, 106.7368],
    binhthanh: [10.7981, 106.7061],
    district1: [10.7769, 106.7009], quan1: [10.7769, 106.7009],
    district7: [10.7226, 106.7271], quan7: [10.7226, 106.7271], phumyhung: [10.7226, 106.7271],
    thuduc: [10.8500, 106.7700],
  }
  const byDistrict = districtKey ? DISTRICTS[districtKey] : undefined
  const byCity = PLACE_COORDS[cityKey]
  // ⚠️ THE DISTRICT ONLY WINS INSIDE ITS OWN CITY. 'District 1' in Da Nang is not Saigon's
  // District 1, and a global district lookup would teleport the pin 600km.
  const districtBelongsHere = !byCity || !byDistrict ? false
    : Math.abs(byCity[0] - byDistrict[0]) < 0.6 && Math.abs(byCity[1] - byDistrict[1]) < 0.6
  const point = (districtBelongsHere ? byDistrict : byCity) ?? PLACE_COORDS.hochiminhcity
  return { lat: point[0], lng: point[1], matched: Boolean(byCity) }
}

export function getListingCoordinates(listing: Pick<SerializedListingCard, 'id' | 'lat' | 'lng' | 'city' | 'district'>) {
  if (hasRealCoords(listing.lat, listing.lng)) {
    return { lat: listing.lat as number, lng: listing.lng as number }
  }

  const { lat: baseLat, lng: baseLng } = placeCoordinates(listing.city, listing.district)

  // A deterministic per-listing offset (≈±1km) so several listings in one city do not stack into
  // a single unclickable pin. Derived from the id, so it never moves — in particular it does NOT
  // change when the feed is re-sorted, which is what makes a pin's position trustworthy.
  const idHash = listing.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  const latOffset = ((idHash % 20) - 10) * 0.0009
  const lngOffset = (((idHash >> 2) % 20) - 10) * 0.0009
  return { lat: baseLat + latOffset, lng: baseLng + lngOffset }
}

/** Great-circle distance in km between two {lat,lng} points (Haversine). */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const la1 = (a.lat * Math.PI) / 180
  const la2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
