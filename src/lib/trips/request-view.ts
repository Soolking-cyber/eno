import { db } from '@/lib/db'
import { getCurrentProfile } from '@/lib/admin'
import { getTripDeskOperator } from '@/lib/desk-operator'
import { CITY_MAP } from '@/lib/itinerary-data'

/**
 * THE ITINERARY BEHIND A BOOKING REQUEST — what the desk needs in order to actually book.
 *
 * ⛔ THIS IS A SEPARATE READ FROM `viewAssistance` ON PURPOSE. That one is the quote card's live
 * handle and is fetched on every render of every quote card in a thread; folding a whole
 * day-by-day itinerary into it would make every one of those renders drag the trip along. The two
 * cards want different things — a quote wants money and status, a request wants the plan — so they
 * get different reads, and neither pays for the other.
 *
 * ⚠️ SAME AUTHORISATION AS viewAssistance, INCLUDING ITS ORACLE FIX. Missing and forbidden answer
 * identically: returning a 404 for an id that does not exist and a 403 for one that does lets a
 * signed-in stranger enumerate real case ids by comparing the two. codex found that on the sibling
 * endpoint against a comment claiming it could not happen; it is not going to be reintroduced here
 * by a new endpoint that forgot.
 *
 * ⚠️ VISIBLE TO THE TRAVELLER AND THE DESK OPERATOR, AND NOBODY ELSE — `getTripDeskOperator()` is
 * the desk's own operator, not a site admin (see desk-operator.ts). An itinerary is a person's
 * movements, dated: where they will be and when. It is exactly the shape of data that must not
 * widen its audience by accident, so the check is the narrow one.
 */
export type TripRequestView = {
  requestId: string
  status: string
  /** True for the traveller whose trip it is — the desk sees the same plan, not the same buttons. */
  mine: boolean
  itinerary: {
    title: string
    /** Trip length in days. ⚠️ There are no DATES on Itinerary — only a length — so the card must
     *  not invent an arrival. If the traveller named dates, they said so in the thread. */
    days: number
    /** The city's NAME, resolved from Itinerary.destinationId. */
    destination: string
    destinationVi: string | null
    /** IATA codes for that city — the desk books flights, so this is the field that saves them a
     *  lookup. Empty when the destination is not in the catalogue. */
    airports: string[]
    /** Null until the traveller has picked a budget band, and null-safe on the card. */
    estimatedBudget: number | null
    currency: string
    dayPlans: {
      dayNumber: number
      area: string
      areaVi: string | null
      title: string
      titleVi: string | null
      morning: string
      morningVi: string | null
      afternoon: string
      afternoonVi: string | null
      evening: string
      eveningVi: string | null
    }[]
  } | null
}

export async function viewTripRequest(
  input: { requestId: string },
): Promise<{ ok: true; data: TripRequestView } | { ok: false; error: 'not_signed_in' | 'forbidden' }> {
  const profile = await getCurrentProfile()
  if (!profile) return { ok: false, error: 'not_signed_in' }

  const request = await db.tripAssistanceRequest.findUnique({
    where: { id: input.requestId },
    select: { id: true, profileId: true, status: true, itineraryId: true },
  })
  const mine = request?.profileId === profile.id
  // Missing and forbidden are ONE answer — see the header. Do not split these.
  if (!request || (!mine && !(await getTripDeskOperator()))) return { ok: false, error: 'forbidden' }

  const itinerary = await db.itinerary.findUnique({
    where: { id: request.itineraryId },
    select: {
      title: true,
      days: true,
      destinationId: true,
      estimatedBudget: true,
      currency: true,
      dayPlans: {
        // The day number IS the order the traveller reads it in; anything else would renumber
        // their trip in front of the person booking it.
        orderBy: { dayNumber: 'asc' },
        select: {
          dayNumber: true, area: true, areaVi: true, title: true, titleVi: true,
          morning: true, morningVi: true, afternoon: true, afternoonVi: true,
          evening: true, eveningVi: true,
        },
      },
    },
  })

  return {
    ok: true,
    data: {
      requestId: request.id,
      status: request.status,
      mine,
      // ⚠️ NULL RATHER THAN A THROW. A case whose itinerary was deleted still has to render — the
      // desk needs to see that a request exists even when the plan behind it is gone, otherwise a
      // deleted trip silently removes a booking request from their inbox.
      itinerary: itinerary
        ? {
            title: itinerary.title,
            days: itinerary.days,
            /**
             * ⛔ THE NAME, NOT THE ID. This returned `destinationId` in the first cut, so the card
             * showed the booker "5 days · danang" — an internal slug, on the one surface whose whole
             * job is to be actionable by a human arranging travel. Reviewer-caught.
             * ⚠️ Falls back to the raw id rather than to an empty string: an unknown destination is
             * still information, and a blank line reads as a bug.
             */
            ...(() => {
              // ⚠️ ONE LOOKUP, AND THE CAST IS AT THE BOUNDARY. `destinationId` is a plain column,
              // so it is a `string` however narrow CityId is; narrowing here (rather than asserting
              // three times inline) keeps the "database value may not be in the catalogue" case in
              // one place, which is exactly the case the fallbacks below exist for.
              const city = CITY_MAP.get(itinerary.destinationId as Parameters<typeof CITY_MAP.get>[0])
              return {
                destination: city?.name ?? itinerary.destinationId,
                destinationVi: city?.nameVi ?? null,
                airports: city?.airports ?? [],
              }
            })(),
            estimatedBudget: itinerary.estimatedBudget,
            currency: itinerary.currency,
            dayPlans: itinerary.dayPlans,
          }
        : null,
    },
  }
}
