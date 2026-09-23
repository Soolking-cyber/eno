/**
 * THE PICTOGRAM A MAP PIN CARRIES, DERIVED FROM `subcategorySlug`.
 *
 * The map had one pin shape for everything: a price pill for a listing, a `name + count` pill for a
 * building. At city zoom the named pills tile into an unreadable pile — 30 buildings sharing ~31
 * coordinates, each drawing a variable-width label — which is the mess this exists to fix. A glyph
 * plus a count is FIXED WIDTH, so it tiles; a name is not, so it cannot.
 *
 * ⛔ THE GLYPHS ARE DRAWN HERE RATHER THAN TAKEN FROM THE SPRITE, AND THAT IS MEASURED, NOT LAZY.
 * `src/components/ui/icons.tsx` splits the sprite in two: `glyphs-core.svg` (39 glyphs, ~113KB)
 * carries what the busiest routes paint on arrival, and `glyphs-rest.svg` (~697KB) carries the rest.
 * The map today imports only `Heart` and `Info`, and BOTH are in core — so the map surface never
 * fetches the big sprite. `House`, `Briefcase`, `BedDouble` and friends are rest-only, so pointing a
 * pin at them would pull ~697KB onto the one screen that is already loading tiles. On top of that
 * those are Solar glyphs of 0.5–1.8KB of path data each, drawn for 20–24px; at the 13px a pin can
 * spare, that detail collapses into a smudge. These are deliberately 2–4 strokes, drawn for the size
 * they are actually rendered at.
 *
 * ⚠️ VEHICLES ARE THEIR OWN BUCKET, NOT "other" (reviewer). `rentals` holds motorbike/car/bicycle/
 * ebike alongside the four property kinds, and ~446 imported rows carry `subcategorySlug: null`.
 * Folding vehicles into the same fallback as those nulls would pin a scooter with the same mark as a
 * home — on a map whose whole job is telling a house from a tower at a glance.
 */

/** The buckets a pin can draw. Deliberately coarse: a pin is 13px, not a taxonomy browser. */
export type MapGlyph = 'apartment' | 'house' | 'office' | 'room' | 'land' | 'vehicle' | 'other'

/**
 * ⛔ AN ALLOW-LIST, NEVER A PREFIX MATCH. `apartment-rental` and `apartment` are both apartments,
 * but `moving-sale` lives in the same `property` category and is a box of furniture, and
 * `office-retail` must not be reached by a `.startsWith('office')` that would also catch a future
 * `office-supplies`. Every slug is named, and anything unrecognised falls to `other` rather than
 * guessing — the same reason `conditionWhere` in listing-condition.ts is an allow-list.
 */
const BY_SLUG: Record<string, MapGlyph> = Object.assign(Object.create(null) as Record<string, MapGlyph>, {
  // rentals
  'apartment-rental': 'apartment',
  'house-rental': 'house',
  'room-rental': 'room',
  'hotel-short-stay': 'room',
  'homestay-serviced': 'room',
  'office-rental': 'office',
  'motorbike-rental': 'vehicle',
  'car-rental': 'vehicle',
  'bicycle-rental': 'vehicle',
  'ebike-rental': 'vehicle',
  // property (buy/sell)
  apartment: 'apartment',
  house: 'house',
  land: 'land',
  'office-retail': 'office',
})

/**
 * ⚠️ `house-rental` CARRIES VILLAS AND TOWNHOUSES TOO, and that is the data, not a simplification.
 * The Rever importer collapses "Nhà phố / Biệt thự" into this one slug, and Rentals has no
 * `houseType` facet to tell them apart (Property does — `biet-thu` etc. — but only for sale
 * listings). So one house mark covers all three; splitting it would need a facet the rental rows do
 * not carry.
 */
export function mapGlyphFor(subcategorySlug: string | null | undefined): MapGlyph {
  if (!subcategorySlug) return 'other'
  /**
   * ⛔ NULL-PROTOTYPE TABLE, AND A TEST CAUGHT WHY. `subcategorySlug` is a plain column that
   * ultimately comes from an importer and from `?subcategory=` on the feed, so it is attacker-
   * influenced. On an ordinary object literal `BY_SLUG['constructor']` resolves up the prototype
   * chain and returns a FUNCTION — truthy, so `?? 'other'` never fires and a function was handed
   * back as a MapGlyph, to be used as a key into the path table. `Object.create(null)` has no chain
   * to walk, so a lookup can only ever find a glyph that was actually declared.
   */
  return BY_SLUG[subcategorySlug] ?? 'other'
}

/**
 * 24×24 path data, stroked (never filled) so one `stroke` colour flips the whole mark between the
 * idle and active pin. `stroke-linecap:round` is set by the caller on the `<svg>`, not per path.
 *
 * ⚠️ WHAT A PIN CAN ACTUALLY SHOW AT 13px is about three strokes. These are drawn to read as a
 * SILHOUETTE — tower vs pitched roof vs case vs bed — not as detailed icons. Anything finer
 * (windows, door handles, wheel spokes) turns to grey mush at this size and costs bytes per marker.
 */
export const MAP_GLYPH_PATH: Record<MapGlyph, string> = {
  // A tower: tall block, a lower neighbour, two window rows to read as "many homes".
  apartment: 'M4 21V5h9v16M13 21V11h7v10M7 9h3M7 13h3M16 15h1M16 18h1',
  // A pitched roof over a single body — the universal "one home".
  house: 'M3 11.5 12 4l9 7.5M5.5 10v11h13V10',
  // A case with a handle: the office/retail mark everywhere.
  office: 'M3.5 8.5h17v11h-17zM9 8.5V6h6v2.5M3.5 13.5h17',
  // A bed: headboard, mattress, pillow — a room rather than a whole home.
  room: 'M3 19v-7h18v7M3 12V7M7 12v-2.5h10V12',
  // A plot: a bounded parcel with a corner stake.
  land: 'M3.5 7.5 12 4l8.5 3.5v9L12 20l-8.5-3.5zM12 4v16',
  // A scooter/car silhouette, enough to say "not a home".
  vehicle: 'M4 15.5h16M6 15.5 7.5 10h9l1.5 5.5M8 18.5h.5M16 18.5h.5',
  // The generic place mark — used for nulls and anything unrecognised.
  other: 'M12 21s6.5-6.1 6.5-10.5a6.5 6.5 0 1 0-13 0C5.5 14.9 12 21 12 21ZM12 10.5v.01',
}

/**
 * The accessible name for a pin, since a stroked path has none (reviewer). Pins are `L.divIcon`
 * HTML, so this is what goes on the marker's `alt` — the only thing a screen reader gets, because
 * the visible content is a number and a picture.
 */
export const MAP_GLYPH_LABEL: Record<MapGlyph, { en: string; vi: string }> = {
  apartment: { en: 'Apartment', vi: 'Căn hộ' },
  house: { en: 'House', vi: 'Nhà' },
  office: { en: 'Office', vi: 'Văn phòng' },
  room: { en: 'Room', vi: 'Phòng' },
  land: { en: 'Land', vi: 'Đất' },
  vehicle: { en: 'Vehicle', vi: 'Xe' },
  other: { en: 'Listing', vi: 'Tin đăng' },
}
