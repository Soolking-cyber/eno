import { isAlternativesName } from './itinerary-place-names'

/**
 * "Directions" without a Maps API: Google Maps URLs, which need no key, no quota and no billing.
 *
 * Leaflet stays. An embedded Google map would cost the granular-editing model — draggable, editable
 * stops — to save a rounding error in lifetime geocoding. This only complements it: the map shows
 * the day, these links hand a stop to the phone's own navigation.
 *
 * ⚠️ COORDINATES BEAT NAMES, ALWAYS, WHEN WE HAVE THEM. `destination=10.7772,106.6958` is a point;
 * `destination=Independence Palace, Ho Chi Minh City` is a QUESTION, and Google answers it with its
 * own resolver, which can land somewhere else entirely. That is the same failure class this codebase
 * keeps fighting — it is why the model is never asked for coordinates and why every cached
 * coordinate is gated. Handing a name to Google re-opens it at the last mile.
 *
 * ⚠️ AN AMBIGUOUS NAME NEVER GETS DIRECTIONS. "The Deck Saigon or Binh An Village" offers a CHOICE.
 * Directions to it would make Google silently pick one and start navigating — precisely the bug the
 * `or` refusal exists to prevent, reintroduced through a link. Those get a SEARCH url instead, which
 * shows the options and asserts nothing.
 *
 * ⚠️ AN UNMAPPED STOP STILL GETS A LINK, and that is the point of the feature rather than an edge
 * case. A place we deliberately refuse to PIN can still be handed to Google by name: our refusal is
 * about not drawing a false point on our own map, not about withholding the one tool that might
 * actually find it.
 */

/**
 * ⚠️ THREE, NOT NINE — verified against Google's Maps URLs documentation rather than guessed:
 * "The number of waypoints allowed varies by the platform where the link opens, with up to three
 * waypoints supported on mobile browsers, and a maximum of nine waypoints supported otherwise."
 *
 * eno is mobile-first and the Capacitor WebView IS a mobile browser, so nine would produce URLs
 * that work on a desktop and break on the primary surface. Taking the lower limit is not caution,
 * it is the only number that is correct everywhere this runs.
 */
export const MAX_INTERMEDIATE_WAYPOINTS = 3

/** origin + intermediates + destination. Five stops per route link. */
export const MAX_ROUTE_STOPS = MAX_INTERMEDIATE_WAYPOINTS + 2

export type MapsStop = {
  /** The searchable place name — what a coordinate was resolved FROM. */
  place: string
  lat?: number | null
  lng?: number | null
}

export type MapsLink = {
  url: string
  /** 'directions' navigates. 'search' only offers — see the ambiguity rule. */
  kind: 'directions' | 'search'
  /** Why this stop got a search instead of directions, for a UI that wants to explain itself. */
  reason?: 'ambiguous'
}

const hasCoords = (stop: MapsStop): boolean =>
  typeof stop.lat === 'number' && typeof stop.lng === 'number' && Number.isFinite(stop.lat) && Number.isFinite(stop.lng)

/** A point, exactly as Google's URL schema wants it. Trimmed to ~1m precision; more digits are
 *  noise and make the URL harder to read in a share sheet. */
const asPoint = (stop: MapsStop): string => `${Number(stop.lat).toFixed(5)},${Number(stop.lng).toFixed(5)}`

/**
 * A name, qualified so Google's resolver has something to narrow on.
 *
 * ⚠️ `|` IS STRIPPED, because it is Google's own waypoints separator. Found by agy: `dayRouteLink`
 * joins waypoints with `|`, so a place name containing one injects an extra waypoint BOUNDARY and
 * silently restructures the route. URLSearchParams does not save us — it percent-encodes the
 * joining `|` and an embedded `|` identically, so Google cannot tell them apart either.
 *
 * Stripped rather than escaped: there is no escape for this separator in Google's URL schema, and
 * `|` is not part of any real place name. Done HERE, at the one place a name becomes a URL segment,
 * so no caller can forget it. Stop names come from the generator, which bounds only length
 * (`place: z.string().min(1).max(180)`), so nothing upstream rules the character out.
 */
const asQuery = (stop: MapsStop, cityName: string): string =>
  [stop.place, cityName, 'Vietnam']
    .filter(Boolean)
    .join(', ')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * The link for ONE stop.
 *
 * Returns null only for a stop with no usable name and no coordinate — there is genuinely nothing
 * to hand over.
 */
export function stopMapsLink(stop: MapsStop, cityName: string): MapsLink | null {
  const named = (stop.place ?? '').trim()
  if (!named && !hasCoords(stop)) return null

  // A coordinate settles it: no name is sent, so Google has nothing to re-resolve — and this is
  // also why an ambiguous name with a coordinate is fine. The ambiguity was about WHICH place, and
  // that question is already answered.
  if (hasCoords(stop)) {
    return { url: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(asPoint(stop))}`, kind: 'directions' }
  }

  // No coordinate. If the name offers a choice, refuse to navigate and offer to look instead.
  if (isAlternativesName(named)) {
    return {
      url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(asQuery(stop, cityName))}`,
      kind: 'search',
      reason: 'ambiguous',
    }
  }
  return {
    url: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(asQuery(stop, cityName))}`,
    kind: 'directions',
  }
}

export type DayRouteLink = {
  url: string
  /** How many of the day's stops the route actually covers. */
  includedCount: number
  /** True when stops were left out because of the waypoint cap — so the UI can SAY so. */
  truncated: boolean
  /** Stops dropped because their name offers a choice; they keep their own per-stop link. */
  skippedAmbiguous: number
}

/**
 * One route through a day's stops, in order.
 *
 * ⚠️ AMBIGUOUS STOPS ARE EXCLUDED FROM THE ROUTE rather than sent by name. Inside a multi-stop
 * route a name Google picks for us is worse than on its own: it silently bends the whole path
 * around a place the traveller never chose, and there is no UI to notice it in.
 *
 * ⚠️ TRUNCATION IS REPORTED, NEVER SILENT. A day longer than the cap yields a route over the first
 * MAX_ROUTE_STOPS and says `truncated`, so the surface can label it. Emitting all of them would
 * produce a URL Google rejects; dropping the middle silently would produce a route that quietly
 * misses somewhere the traveller is going.
 */
export function dayRouteLink(stops: readonly MapsStop[], cityName: string): DayRouteLink | null {
  const usable = stops.filter((stop) => {
    const named = (stop.place ?? '').trim()
    if (hasCoords(stop)) return true
    return Boolean(named) && !isAlternativesName(named)
  })
  const skippedAmbiguous = stops.filter((stop) => !hasCoords(stop) && isAlternativesName((stop.place ?? '').trim())).length

  // A route needs somewhere to go and somewhere to come from. One stop is a per-stop link's job.
  if (usable.length < 2) return null

  const included = usable.slice(0, MAX_ROUTE_STOPS)
  const parts = included.map((stop) => (hasCoords(stop) ? asPoint(stop) : asQuery(stop, cityName)))
  const origin = parts[0]
  const destination = parts[parts.length - 1]
  const waypoints = parts.slice(1, -1)

  const params = new URLSearchParams({ api: '1', origin, destination })
  // Google's own separator for the waypoints list.
  if (waypoints.length) params.set('waypoints', waypoints.join('|'))
  params.set('travelmode', 'driving')

  return {
    url: `https://www.google.com/maps/dir/?${params.toString()}`,
    includedCount: included.length,
    truncated: usable.length > MAX_ROUTE_STOPS,
    skippedAmbiguous,
  }
}
