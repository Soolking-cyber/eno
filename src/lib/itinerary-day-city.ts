import { CITIES, CITY_MAP, type CityId } from './itinerary-data'
import { fold } from './fold'

/**
 * WHICH CATALOGUE CITY A SAVED DAY IS IN.
 *
 * ⚠️ THE DAY'S `area` IS AUTHORITATIVE, NOT THE ITINERARY'S `destinationId`, and getting that
 * backwards is what left a third of production's stops unpinned. An `Itinerary` stores ONE
 * `destinationId`; a multi-city trip's days each carry their own free-text `area` ("Ho Chi Minh
 * City", "Da Lat", "Phu Quoc"). Scoping every stop to the itinerary's single destination means a
 * Hoi An restaurant is looked up near Hanoi and then correctly REFUSED by `isNearCity` — the
 * coordinate was right and the question was wrong. Measured 2026-07-28: 23 of 69 stops unmapped,
 * and `scripts/backfill-stop-coords.ts` reported every one of them as `[Hoi An → hanoi]`,
 * `[Phu Quoc → hanoi]`, `[Ho Chi Minh City → hanoi]`.
 *
 * The app's own generation pass (`fillMissingStopCoordinates`) always resolved per day; the script
 * did not, and its SQL comment asserted the opposite — "the day's free-text area is only a label".
 * This module exists so there is one answer both can import.
 *
 * ⚠️ A trip-SCOPED resolver also exists (`makeCityResolver` in api/itineraries/generate), and it is
 * deliberately different: at generation time the trip's own city list is known, and restricting to
 * it prevents a same-named place in another province winning. Here — a saved trip, read back later
 * — that list is not stored, so this matches the whole catalogue and leans on the uniqueness rule
 * below instead. Do not merge them without solving that.
 */
/**
 * Which catalogue city is this day in?
 *
 * The day's `area` is the generator's own free text ("Hoi An", "Hội An", "Hoi An (Quang Nam)"), and
 * a saved itinerary records only ONE structured city (`destinationId`), so both are tried.
 *
 * ⚠️ A UNIQUE MATCH OR NOTHING, the same rule the generator's resolver follows. Falling back to a
 * first-wins guess is how a place uncatalogued in Hoi An resolves to a same-named entry in Hue and
 * gets a confident pin 100km away. Returning null is a fine outcome: the candidate is still offered,
 * just unmapped.
 *
 * ⚠️ CONTAINMENT NEEDS BOTH SIDES TO BE AT LEAST `MIN_CONTAINMENT` LONG, and that guard is not
 * cosmetic — agy refuted the "cannot produce a confidently wrong city" claim and measuring it made
 * the case worse than the one described. Without the length floor, three characters resolve
 * UNIQUELY: `Mui` → mui ne, `Cao` → cao bang, `Phu` → phu quoc, `Con` → con dao, `Can` → can tho.
 * Most of those happen to be right prefixes, which is exactly what makes the pattern dangerous: `Mui`
 * for Mũi Cà Mau (500km away, and not a catalogue city at all) is indistinguishable to this function
 * from `Mui` for Mui Ne, and would put a confident pin in the wrong province.
 *
 * The floor is 5 because containment exists for two real shapes and both clear it: a qualified area
 * ("Hoi An (Quang Nam)" ⊃ "hoi an") and a shortened one ("Ben Tre" ⊂ "ben tre & mekong delta").
 * The shortest folded catalogue name that needs containment at all is "hoi an" (6).
 */
const MIN_CONTAINMENT = 5

export function cityForDay(area: string, destinationId: string): CityId | null {
  const key = fold(area ?? '')
  if (key) {
    const names = new Map<string, CityId>()
    for (const city of CITIES) {
      names.set(fold(city.name), city.id)
      names.set(fold(city.nameVi), city.id)
      names.set(fold(city.id), city.id)
    }
    const exact = names.get(key)
    if (exact) return exact
    const hits = key.length < MIN_CONTAINMENT
      ? []
      : [...names.entries()].filter(([name]) =>
        name.length >= MIN_CONTAINMENT && (key.includes(name) || name.includes(key)))
    const unique = [...new Set(hits.map(([, id]) => id))]
    if (unique.length === 1) return unique[0]
  }
  // The trip's own single destination. Equivalent to fillMissingStopCoordinates' one-city fallback:
  // with nothing else to go on, the itinerary's own city beats no city at all.
  return CITY_MAP.has(destinationId as CityId) ? (destinationId as CityId) : null
}
