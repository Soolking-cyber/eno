import { describe, expect, it } from 'vitest'
import { BUDGETS } from '@/lib/itinerary-data'
import { ITINERARY_REQUEST_FIELDS, TRIP_WIZARD_STEP_FIELDS, itineraryRequestSchema } from '@/lib/trips/itinerary-wizard'
import { vndPerUsd } from '@/context/currency-context'

/**
 * The traveller's own daily budget (owner, 2026-07-29). Two things are pinned: the FIELD's bounds,
 * because it becomes the model's spending target, and the fact that it stays OPTIONAL — the three
 * tiers must keep working untouched for everyone who does not name a number.
 */

const base = {
  origin: 'London', startDate: '2027-01-01', days: 5, travelers: 2,
  cityIds: ['hanoi'], cityDays: [], budgetId: 'comfort', pace: 'balanced',
  interests: ['food'], accommodation: 'hotel',
  flight: { include: false, cabin: 'economy', maxStops: 'any', checkedBags: false },
  notes: '',
} as const

describe('budgetDailyVnd', () => {
  it('is optional — the three tiers still validate on their own', () => {
    const parsed = itineraryRequestSchema.safeParse(base)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.budgetDailyVnd).toBeUndefined()
  })

  it('accepts a realistic daily amount', () => {
    const parsed = itineraryRequestSchema.safeParse({ ...base, budgetDailyVnd: 3_000_000 })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.budgetDailyVnd).toBe(3_000_000)
  })

  it.each([
    ['below the floor', 99_999],
    ['above the ceiling', 100_000_001],
    ['not an integer', 3_000_000.5],
    ['negative', -1],
    ['zero', 0],
  ])('refuses a value %s', (_label, value) => {
    // This number is handed to the model as a spending target, so a mistyped figure must fail at
    // the schema rather than quietly plan a $0.04-a-day trip.
    expect(itineraryRequestSchema.safeParse({ ...base, budgetDailyVnd: value }).success).toBe(false)
  })

  it('is assigned to exactly one wizard step, beside the tier it overrides', () => {
    // The partition test asserts every request field belongs to one step; this one names WHICH,
    // because a budget amount collected on a different card from the budget tier would be absurd.
    const steps = Object.entries(TRIP_WIZARD_STEP_FIELDS)
      .filter(([, fields]) => (fields as readonly string[]).includes('budgetDailyVnd'))
      .map(([step]) => step)
    expect(steps).toHaveLength(1)
    expect(TRIP_WIZARD_STEP_FIELDS[Number(steps[0]) as 1 | 2 | 3]).toContain('budgetId')
  })

  it('is part of the request contract the generator reads', () => {
    expect(ITINERARY_REQUEST_FIELDS).toContain('budgetDailyVnd')
  })

  it('the tiers it competes with are all inside its bounds', () => {
    // If a tier's daily figure fell outside the custom band, "my own budget" could not express the
    // very amounts the presets offer — a contradiction the traveller would find immediately.
    for (const tier of BUDGETS) {
      expect(tier.daily).toBeGreaterThanOrEqual(100_000)
      expect(tier.daily).toBeLessThanOrEqual(100_000_000)
    }
  })
})

describe('⚠️ vndPerUsd — the plausibility band', () => {
  // The upstream publishes "currency per 1 VND", so every way of getting the direction or the
  // scale wrong lands far outside the tens of thousands. A bare `> 0` check caught none of them.
  it('accepts a real rate and returns đồng per dollar', () => {
    expect(vndPerUsd({ USD: 1 / 26_316 })).toBeCloseTo(26_316, 0)
  })

  it.each([
    ['missing', {}],
    ['zero', { USD: 0 }],
    ['negative', { USD: -0.0000383 }],
    ['NaN', { USD: Number.NaN }],
    ['Infinity', { USD: Number.POSITIVE_INFINITY }],
    ['un-inverted (26 316 read as per-VND)', { USD: 26_316 }],
    ['quoted in thousands (26.1)', { USD: 1 / 26.1 }],
    ['absurdly high đồng-per-dollar', { USD: 1 / 5_000_000 }],
  ])('refuses a rate that is %s', (_label, rates) => {
    expect(vndPerUsd(rates as Record<string, number>)).toBeNull()
  })
})
