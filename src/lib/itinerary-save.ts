import type { BudgetId, CityId, GeneratedItineraryResponse, InterestId } from '@/lib/itinerary-data'

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
