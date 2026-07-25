import { describe, expect, it } from 'vitest'
import { buildItinerarySavePayload } from '@/lib/itinerary-save'
import type { ActivityPlan, GeneratedItineraryResponse } from '@/lib/itinerary-data'

// The bug this file guards: every field the generator produces per activity except time/title/
// details used to be thrown away at save time, so a saved trip could never be mapped. These
// tests assert the structured stops exist AND that the prose columns other readers still depend
// on are untouched — the fix is additive, and a future "cleanup" that drops the prose would
// break trip-card.tsx and both docx routes.

const activity = (over: Partial<ActivityPlan> = {}): ActivityPlan => ({
  time: '09:00',
  title: 'Breakfast and a first walk',
  place: 'Bến Thành Market',
  details: 'Bánh mì, then the side streets.',
  travelMinutes: 12,
  estimatedCostVnd: 150_000,
  bookingAdvice: 'No booking needed.',
  ...over,
})

const response = (over: Partial<ActivityPlan>[] = []): GeneratedItineraryResponse =>
  ({
    generatedAt: '2026-07-25T00:00:00.000Z',
    plan: {
      title: 'Three days in Saigon',
      summary: 'A short trip.',
      budget: { groupHighVnd: 9_000_000 },
      stays: [],
      days: [
        {
          dayNumber: 1,
          city: 'Ho Chi Minh City',
          title: 'Arrival',
          morning: activity(over[0]),
          afternoon: activity({ title: 'Museum', place: 'War Remnants Museum', ...over[1] }),
          evening: activity({ title: 'Dinner', place: 'Cô Liêng', ...over[2] }),
        },
      ],
    },
  }) as unknown as GeneratedItineraryResponse

const build = (over?: Partial<ActivityPlan>[]) =>
  buildItinerarySavePayload({
    result: response(over),
    cityIds: ['ho-chi-minh-city'] as never,
    days: 1,
    budgetId: 'comfort' as never,
    interests: [],
  })

describe('buildItinerarySavePayload — stops', () => {
  it('persists one stop per activity, in the day order the map draws', () => {
    const [day] = build().dayPlans
    expect(day.stops.create.map((s) => s.position)).toEqual([0, 1, 2])
    expect(day.stops.create.map((s) => s.place)).toEqual(['Bến Thành Market', 'War Remnants Museum', 'Cô Liêng'])
  })

  it('keeps every field the old flattening discarded', () => {
    const stop = build().dayPlans[0].stops.create[0]
    expect(stop).toMatchObject({
      name: 'Breakfast and a first walk',
      place: 'Bến Thành Market',
      time: '09:00',
      travelMinutes: 12,
      estimatedCostVnd: 150_000,
      bookingAdvice: 'No booking needed.',
    })
  })

  it('still writes the prose columns — the fix is additive, not a replacement', () => {
    const [day] = build().dayPlans
    expect(day.morning).toBe('09:00 · Breakfast and a first walk — Bánh mì, then the side streets.')
    expect(day.afternoon).toContain('Museum')
    expect(day.evening).toContain('Dinner')
  })

  it('writes stops with NULL coordinates rather than skipping them', () => {
    // A stop with no coordinate is still a real stop; only the map ignores it. Dropping such
    // stops would make "manage trips booked" cosmetic for every trip generated before
    // coordinates existed.
    const stop = build().dayPlans[0].stops.create[0]
    expect(stop.lat).toBeNull()
    expect(stop.lng).toBeNull()
  })

  it('carries coordinates through as soon as the generator emits them', () => {
    // The cross-lane seam: the generator gains lat/lng in a task that does not own this file.
    const [day] = build([{ lat: 10.7725, lng: 106.698 } as Partial<ActivityPlan>]).dayPlans
    expect(day.stops.create[0]).toMatchObject({ lat: 10.7725, lng: 106.698 })
  })

  it('drops Null Island — (0,0) is a recorded prod incident, not a hypothetical', () => {
    // A model with no idea where a place is emits (0,0), which passes every "is this a finite
    // number" check. Eight live listings once sat there and fitBounds spanned the planet.
    const [day] = build([{ lat: 0, lng: 0 } as Partial<ActivityPlan>]).dayPlans
    expect(day.stops.create[0].lat).toBeNull()
    expect(day.stops.create[0].lng).toBeNull()
  })

  it('keeps a legitimate zero on ONE axis', () => {
    // (0, 105) is on the equator in Sumatra — wrong for Vietnam, but that is the bbox
    // validator's call, not this file's. Only the exact (0,0) pair is treated as "no idea".
    const [day] = build([{ lat: 0, lng: 105 } as Partial<ActivityPlan>]).dayPlans
    expect(day.stops.create[0].lat).toBe(0)
    expect(day.stops.create[0].lng).toBe(105)
  })

  it('rejects coordinates outside the coordinate system', () => {
    const [day] = build([{ lat: 91, lng: 200 } as Partial<ActivityPlan>]).dayPlans
    expect(day.stops.create[0].lat).toBeNull()
    expect(day.stops.create[0].lng).toBeNull()
  })

  it('rounds fractional integers instead of failing the whole write', () => {
    // The generate route's auto-save does NOT pass through the POST zod schema, and Prisma
    // refuses a non-integer for an Int column — a `travelMinutes: 12.5` would otherwise fail
    // the nested write and lose every stop in the itinerary.
    const [day] = build([{ travelMinutes: 12.5, estimatedCostVnd: 149_999.6 }]).dayPlans
    expect(day.stops.create[0].travelMinutes).toBe(13)
    expect(day.stops.create[0].estimatedCostVnd).toBe(150_000)
  })

  it('nulls integers that are negative or absurdly large rather than clamping', () => {
    const [day] = build([{ travelMinutes: -5, estimatedCostVnd: 9_999_999_999 }]).dayPlans
    expect(day.stops.create[0].travelMinutes).toBeNull()
    expect(day.stops.create[0].estimatedCostVnd).toBeNull()
  })

  it('refuses coordinates that are not finite numbers', () => {
    const [day] = build([{ lat: Number.NaN, lng: 'x' } as unknown as Partial<ActivityPlan>]).dayPlans
    expect(day.stops.create[0].lat).toBeNull()
    expect(day.stops.create[0].lng).toBeNull()
  })

  it('never writes an empty place — it falls back to the activity title', () => {
    const [day] = build([{ place: '   ' }]).dayPlans
    expect(day.stops.create[0].place).toBe('Breakfast and a first walk')
  })

  it('normalises blank optional text to null instead of empty strings', () => {
    const [day] = build([{ bookingAdvice: '  ', details: '' }]).dayPlans
    expect(day.stops.create[0].bookingAdvice).toBeNull()
    expect(day.stops.create[0].details).toBeNull()
  })
})
