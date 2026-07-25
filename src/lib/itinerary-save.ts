import type { ActivityPlan, BudgetId, CityId, GeneratedItineraryResponse, InterestId } from '@/lib/itinerary-data'

// ⚠️ CROSS-LANE SEAM. The generator does not emit coordinates yet — resolving place names to
// lat/lng is a separate task that owns generate/route.ts, NOT this file. So this reads lat/lng
// off the activity OPTIONALLY: the moment the generator starts emitting them they persist with
// no further change here, and until then every stop is written with null coordinates. Without
// this, coordinate support would need a second edit to a file outside that task's scope.
type ActivityWithCoords = ActivityPlan & { lat?: number | null; lng?: number | null }

// ⚠️ This file is the LAST gate before persistence on the generate route's auto-save path,
// which does NOT pass through the POST endpoint's zod schema. So the bounds below deliberately
// mirror that schema's, rather than trusting the model's output — otherwise the two write paths
// would enforce different rules and the unvalidated one would be the AI's.

/** A coordinate, or null. Bounds match the POST schema; anything else is not a coordinate. */
const coord = (value: unknown, limit: number): number | null =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit ? value : null

/**
 * A Prisma `Int`, or null. ROUNDS rather than rejecting a fraction: the model returns things
 * like `travelMinutes: 12.5`, and Prisma refuses a non-integer for an Int column — that would
 * fail the whole nested write, losing every stop in the itinerary to a half-minute. Out-of-range
 * values are nulled rather than clamped, because a number that large is not a real measurement,
 * and `max` also keeps it inside Postgres int4.
 */
const int = (value: unknown, max: number): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const rounded = Math.round(value)
  return rounded < 0 || rounded > max ? null : rounded
}

/**
 * Resolve one activity's coordinates, dropping Null Island.
 *
 * ⚠️ (0,0) is a REAL recorded incident here, not a hypothetical: eight live listings once sat
 * at (0,0) and a map's fitBounds spanned the planet. It is what a model emits when it has no
 * idea where a place is, and it passes every "is this a finite number" check. The full Vietnam
 * bounding box belongs to the geo validator, which owns the resolve step; this is only the
 * cheap last line of defence on the one write path that skips request validation.
 */
function coordsOf(activity: { lat?: unknown; lng?: unknown }) {
  const lat = coord(activity.lat, 90)
  const lng = coord(activity.lng, 180)
  if (lat === 0 && lng === 0) return { lat: null, lng: null }
  return { lat, lng }
}

const nonEmpty = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? null : trimmed
}

/** One generated activity → one persisted, mappable stop. */
function toStop(activity: ActivityPlan, position: number) {
  const a = activity as ActivityWithCoords
  return {
    position,
    // `place` is what a coordinate gets resolved from; fall back to the activity title so a
    // stop is never nameless (the column is required, and an empty pin label is worse than a
    // slightly redundant one).
    place: nonEmpty(a.place) ?? a.title,
    name: a.title,
    time: nonEmpty(a.time),
    details: nonEmpty(a.details),
    ...coordsOf(a),
    // Bounds mirror the POST schema's exactly, so both write paths agree.
    travelMinutes: int(a.travelMinutes, 10_000),
    estimatedCostVnd: int(a.estimatedCostVnd, 1_000_000_000),
    bookingAdvice: nonEmpty(a.bookingAdvice),
  }
}

export function buildItinerarySavePayload(input: {
  result: GeneratedItineraryResponse
  cityIds: CityId[]
  days: number
  budgetId: BudgetId
  interests: Iterable<InterestId>
}) {
  const { result, cityIds, days, budgetId } = input
  const plan = result.plan
  const destinationId = cityIds[0]
  if (!destinationId) throw new Error('itinerary_destination_required')
  return {
    title: plan.title,
    destinationId,
    days,
    budgetId,
    interests: Array.from(input.interests),
    status: 'ready' as const,
    estimatedBudget: plan.budget.groupHighVnd,
    currency: 'VND',
    generatedAt: result.generatedAt,
    dayPlans: plan.days.map((day) => ({
      dayNumber: day.dayNumber,
      area: day.city,
      areaVi: null,
      title: day.title,
      titleVi: null,
      morning: `${day.morning.time} · ${day.morning.title} — ${day.morning.details}`.slice(0, 1000),
      morningVi: null,
      afternoon: `${day.afternoon.time} · ${day.afternoon.title} — ${day.afternoon.details}`.slice(0, 1000),
      afternoonVi: null,
      evening: `${day.evening.time} · ${day.evening.title} — ${day.evening.details}`.slice(0, 1000),
      eveningVi: null,
      // The same three activities, kept STRUCTURED alongside the prose above rather than
      // instead of it. Position is the day's running order, which is what the map's per-day
      // polyline is drawn in.
      //
      // ⚠️ Shaped as Prisma's nested `{ create: [...] }`, not a bare array, because this ONE
      // payload is consumed two ways: `api/itineraries/generate` spreads it straight into
      // `db.itinerary.create({ data: { dayPlans: { create: payload.dayPlans } } })`, while both
      // itinerary builders `JSON.stringify` it to `POST /api/itineraries`. A bare array is
      // valid JSON but not assignable to Prisma's day-create input, so the generate route
      // would fail to type-check — and that route belongs to another task. This shape
      // satisfies both, and the POST schema accepts either form on the wire.
      stops: { create: [day.morning, day.afternoon, day.evening].map(toStop) },
    })),
    stays: plan.stays.map((stay, index) => ({
      position: index,
      name: stay.name,
      nameVi: null,
      area: `${stay.city} · ${stay.area}`.slice(0, 120),
      areaVi: null,
      note: stay.why,
      noteVi: null,
      estimatedNightly: stay.nightlyLowVnd,
      currency: 'VND',
    })),
  }
}
