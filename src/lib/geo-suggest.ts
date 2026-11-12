/**
 * PLACES AS YOU TYPE, FROM OUR OWN SERVER (owner, 2026-11-12: "when typing addresses show suggestions like macdonalds thao
 * dien show exact address of that place similar to shoppee address or grab address suggestion"; chose "Free OpenStreetMap",
 * run on our own server). Photon (komoot's OpenStreetMap search, built for search-as-you-type) runs in the `eno-photon`
 * container on the box with OpenStreetMap's Vietnam data (infra/vn-node/photon/README.md). Measured on Photon's public
 * instance the same day: "mcdonalds thao dien" → "McDonald's, 159-161 Đường Võ Nguyên Giáp, An Khánh, Thủ Đức".
 *
 * ⛔ NOT Nominatim: its usage policy forbids autocomplete, which is why /api/geocode/search runs on Enter only. That route
 * stays as the fallback: while this server is missing or down, the picker says "press Enter" and searches the old way.
 * ⛔ The typed text never leaves eno: the container is on the box's private network with no published port.
 */

/** One suggestion as the picker draws it: the place (or the street address), then where it is. */
export type PlaceSuggestion = { title: string; detail: string; lat: number; lng: number }

// Vietnam with its islands: Hoàng Sa and Trường Sa run east to ~117.5°E and south to ~6.5°N (commit gate, opus). The index
// itself is OpenStreetMap's Vietnam extract, so the wider box lets in nothing from a neighbour's mainland.
const VN = { minLat: 6, maxLat: 23.6, minLng: 102, maxLng: 117.5 }

/** The `eno-photon` container on supabase_default (the same network as the app); PHOTON_URL overrides it for a local run. */
export function photonBase(): string {
  return (process.env.PHOTON_URL || 'http://eno-photon:2322').replace(/\/+$/, '')
}

type PhotonFeature = { geometry?: { coordinates?: unknown }; properties?: Record<string, unknown> }

const text = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase()
/**
 * One CITY under its two languages' words: "Ho Chi Minh City", "Thành phố Hồ Chí Minh" and "TP. Hồ Chí Minh" are one city.
 * Measured on eno-photon 11-12 (English answers): `city` came back English and `state` Vietnamese, so every HCMC row read
 * "Ho Chi Minh City, Thành phố Hồ Chí Minh". City words only — "Tỉnh Thanh Hóa" (the province) and "Thanh Hóa City" are two
 * places and both stay (commit gate, codex).
 */
// Spacing ignored: OpenStreetMap's English "Hanoi" / "Haiphong" are "Hà Nội" / "Hải Phòng" run together (agy + opus).
const cityKey = (s: string) => fold(s).replace(/^(thanh pho\s+|tp\.\s*|tp\s+)/, '').replace(/\s+city$/, '').replace(/\s+/g, '')

/**
 * A Photon result as a suggestion: the place's name, or its house number and street; then the street (under a named
 * place), the ward, the city and the province — each once, in that order. Measured fields for Vietnam: `district` is
 * the ward ("An Khánh"), `city` the city or old district ("Thành phố Thủ Đức"), `state` the province. `locality` (the
 * "Khu phố 4" neighbourhood block) is left out: Grab and Shopee do not show it either. Null for a result outside Vietnam
 * or without a name.
 */
export function toSuggestion(f: PhotonFeature): PlaceSuggestion | null {
  const c = Array.isArray(f.geometry?.coordinates) ? (f.geometry!.coordinates as unknown[]) : []
  const lng = Number(c[0]), lat = Number(c[1])
  if (!(lat >= VN.minLat && lat <= VN.maxLat && lng >= VN.minLng && lng <= VN.maxLng)) return null
  const p = f.properties ?? {}
  const street = [text(p.housenumber), text(p.street)].filter(Boolean).join(' ')
  const name = text(p.name)
  const title = name || street || text(p.district) || text(p.city) || text(p.state)
  if (!title) return null
  // The title is compared as written (a shop called "Huế City" keeps its city — commit gate, opus); the address parts among
  // themselves also as cities. A result that IS the city (its name is one of its own address parts) counts as that city.
  const seen = new Set([fold(title)])
  // Only a result that IS a place (a city, a province) counts as its own city, matched across languages; a shop called
  // "Huế City" or a road called "Hồ Chí Minh" is compared as written and keeps the city after it (agy + opus).
  const isPlace = p.osm_key === 'place' || p.osm_key === 'boundary'
  const cities = new Set<string>(isPlace && [text(p.city), text(p.county), text(p.state)].some((x) => x && cityKey(x) === cityKey(title)) ? [cityKey(title)] : [])
  // Only the city, county and province fields are compared as cities: a street or ward that happens to share a city's name
  // ("Hồ Chí Minh" street) never hides the city after it (agy).
  const parts: [string, boolean][] = [[name ? street : '', false], [text(p.district), false], [text(p.city), true], [text(p.county), true], [text(p.state), true]]
  const detail = parts
    .filter(([x, isCity]) => {
      if (!x || seen.has(fold(x)) || (isCity && cities.has(cityKey(x)))) return false
      seen.add(fold(x)); if (isCity) cities.add(cityKey(x)); return true
    })
    .map(([x]) => x)
    .join(', ')
  return { title: title.slice(0, 120), detail: detail.slice(0, 200), lat, lng }
}

/**
 * The suggestions in Photon's order, each place once: one shop is often two OpenStreetMap objects (the node and its
 * building) a few metres apart. Only NEAR twins merge — two branches with the same name and ward a kilometre apart are two
 * places (commit gate, codex). ⛔ A ROAD IN PIECES IS LEFT AS IT COMES: "Nguyễn Văn Hưởng, An Khánh" shows twice (two
 * OpenStreetMap ways ~300 m apart, measured on eno-photon 11-12), but two different "Đường số 7" in neighbouring estates
 * read the same and can sit as close — no distance tells them apart, and a merged one pins the seller to the wrong street.
 * A repeated row is the safe miss (commit gate, codex + opus).
 */
export function toSuggestions(features: unknown): PlaceSuggestion[] {
  const out: PlaceSuggestion[] = []
  for (const f of Array.isArray(features) ? (features as PhotonFeature[]) : []) {
    const s = toSuggestion(f)
    if (!s) continue
    const key = fold(`${s.title}|${s.detail}`)
    // ~50 m: a node and its building outline; two branches of one chain on the same street are further apart (commit gate, codex).
    if (out.some((o) => fold(`${o.title}|${o.detail}`) === key && Math.abs(o.lat - s.lat) < 0.0005 && Math.abs(o.lng - s.lng) < 0.0005)) continue
    out.push(s)
  }
  return out
}

/**
 * The Photon request: Vietnam's box, a bias toward `near` (the pin, else central Ho Chi Minh City — the live market) that
 * still lets a better match elsewhere win, and no bus stops (a stop named after the mall it serves is a second "Vincom
 * Thảo Điền" pointing at the kerb). English names where OpenStreetMap has them ("Ben Thanh Market"); Vietnamese is
 * Photon's default, the local name.
 */
export function photonUrl(base: string, q: string, lang: 'en' | 'vi', near: { lat: number; lng: number } | null, limit = 8): string {
  const u = new URL(`${base}/api`)
  u.searchParams.set('q', q)
  u.searchParams.set('limit', String(limit))
  u.searchParams.set('bbox', `${VN.minLng},${VN.minLat},${VN.maxLng},${VN.maxLat}`)
  if (lang === 'en') u.searchParams.set('lang', 'en')
  const at = near ?? { lat: 10.7769, lng: 106.7009 }
  u.searchParams.set('lat', at.lat.toFixed(4))
  u.searchParams.set('lon', at.lng.toFixed(4))
  u.searchParams.set('zoom', '12')
  u.searchParams.set('location_bias_scale', '0.3')
  u.searchParams.append('osm_tag', '!highway:bus_stop')
  u.searchParams.append('osm_tag', '!public_transport')
  return u.toString()
}
