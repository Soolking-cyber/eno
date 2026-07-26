import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  TRIP_WIZARD_STEPS, TRIP_WIZARD_STEP_FIELDS, MAX_ROUTE_CITIES,
  answeredTripWizardFields, firstIncompleteTripWizardStep, isTripWizardFieldName,
  pickStepFields, tripWizardStepSchema, type TripWizardDraft,
} from './itinerary-wizard'
import { CITIES } from '../itinerary-data'

// The wizard is a PARTITION of the generate route's request body, not a second contract. These
// tests exist to keep that true: the partition must cover the body exactly, and every bound the
// wizard pre-validates with must still match the authority it is standing in for.

const ROUTE_SOURCE = readFileSync(
  join(process.cwd(), 'src/app/api/itineraries/generate/route.ts'),
  'utf8',
)
// Just the request schema — matching against the whole file would let a bound from the RESPONSE
// schema satisfy a check about the request.
const REQUEST_SCHEMA_SOURCE = ROUTE_SOURCE.slice(
  ROUTE_SOURCE.indexOf('const requestSchema'),
  ROUTE_SOURCE.indexOf('const activitySchema'),
)

const valid: Required<TripWizardDraft> = {
  cityIds: ['hanoi', 'hoian'],
  cityDays: [{ cityId: 'hanoi', days: 3 }],
  days: 7,
  startDate: '2030-01-01',
  travelers: 2,
  budgetId: 'comfort',
  pace: 'balanced',
  accommodation: 'hotel',
  interests: ['food', 'culture'],
  flight: { include: false, cabin: 'economy', maxStops: 'any', checkedBags: false },
  origin: '',
  notes: '',
}

describe('the partition covers the authority exactly', () => {
  it('assigns every request field to exactly one step, and locale to none', () => {
    // locale is filled from the language context at submit, like the dashboard builder does.
    const fromRoute = [...REQUEST_SCHEMA_SOURCE.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1])
    const collected = Object.values(TRIP_WIZARD_STEP_FIELDS).flat()
    expect(new Set(collected).size).toBe(collected.length) // no field in two steps
    expect([...collected].sort()).toEqual(fromRoute.filter((f) => f !== 'locale').sort())
  })

  it('has a schema for every step and no step without fields', () => {
    for (const step of TRIP_WIZARD_STEPS) {
      expect(TRIP_WIZARD_STEP_FIELDS[step].length).toBeGreaterThan(0)
      expect(tripWizardStepSchema(step)).toBeTruthy()
    }
  })
})

describe('drift guard — every bound still matches the route', () => {
  // Reading the authority's SOURCE rather than importing it, because requestSchema is
  // module-private and a route module cannot export extra symbols. If any of these fail, the
  // wizard has started pre-validating against a contract the server no longer enforces.
  it.each([
    ['days', /days: z\.number\(\)\.int\(\)\.min\(1\)\.max\(30\)/],
    ['travelers', /travelers: z\.number\(\)\.int\(\)\.min\(1\)\.max\(100\)/],
    ['cityIds', /cityIds: z\.array\(z\.enum\(cityIds\)\)\.min\(1\)\.max\(MAX_ROUTE_CITIES\)/],
    ['interests min/max', /interests: z\.array\([^)]*\)*\)\.min\(1\)\.max\(8\)/],
    ['origin', /origin: z\.string\(\)\.trim\(\)\.max\(120\)/],
    ['notes', /notes: z\.string\(\)\.trim\(\)\.max\(600\)/],
    ['startDate shape', /startDate: z\.string\(\)\.regex\(\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\)/],
  ])('%s', (_label, pattern) => {
    expect(REQUEST_SCHEMA_SOURCE).toMatch(pattern)
  })

  // ⚠️ THE ABOVE IS ONLY HALF A GUARD. Those assertions read the ROUTE's source, so they catch the
  // authority moving — but not MY copy being wrong in the first place. A mistyped bound here would
  // pass every one of them. So each bound is ALSO pinned behaviourally against the wizard's own
  // schema, on both sides of the boundary.
  it.each([
    ['days max 30', 1, (v: number) => ({ cityIds: ['hanoi'], cityDays: [], days: v }), 30, 31],
    ['days min 1', 1, (v: number) => ({ cityIds: ['hanoi'], cityDays: [], days: v }), 1, 0],
    ['travelers max 100', 2, (v: number) => ({ startDate: '2030-01-01', travelers: v }), 100, 101],
    ['travelers min 1', 2, (v: number) => ({ startDate: '2030-01-01', travelers: v }), 1, 0],
  ])('the wizard itself enforces %s', (_l, step, make, ok, bad) => {
    const schema = tripWizardStepSchema(step as 1 | 2)
    expect(schema.safeParse(make(ok)).success).toBe(true)
    expect(schema.safeParse(make(bad)).success).toBe(false)
  })

  it('the wizard itself enforces the text ceilings', () => {
    const base = { flight: valid.flight, origin: '', notes: '' }
    const s5 = tripWizardStepSchema(5)
    expect(s5.safeParse({ ...base, origin: 'x'.repeat(120) }).success).toBe(true)
    expect(s5.safeParse({ ...base, origin: 'x'.repeat(121) }).success).toBe(false)
    expect(s5.safeParse({ ...base, notes: 'x'.repeat(600) }).success).toBe(true)
    expect(s5.safeParse({ ...base, notes: 'x'.repeat(601) }).success).toBe(false)
  })

  it('the wizard itself enforces the interest count', () => {
    const s4 = tripWizardStepSchema(4)
    expect(s4.safeParse({ accommodation: 'hotel', interests: ['food'] }).success).toBe(true)
    expect(s4.safeParse({ accommodation: 'hotel', interests: [] }).success).toBe(false)
  })

  it('the wizard itself enforces the route ceiling', () => {
    const s1 = tripWizardStepSchema(1)
    const cities = CITIES.slice(0, MAX_ROUTE_CITIES).map((c) => c.id)
    expect(s1.safeParse({ cityIds: cities, cityDays: [], days: 30 }).success).toBe(true)
    expect(s1.safeParse({ cityIds: [...cities, CITIES[15].id], cityDays: [], days: 30 }).success).toBe(false)
  })

  it('MAX_ROUTE_CITIES is still 15 on both sides', () => {
    expect(MAX_ROUTE_CITIES).toBe(15)
    expect(ROUTE_SOURCE).toMatch(/const MAX_ROUTE_CITIES = 15/)
  })

  it('the cross-field rule the wizard duplicates still exists in the route', () => {
    // Step 1 enforces this early so a traveller is told on the step that asked. If the route ever
    // drops it, the wizard would be the STRICTER one — also drift, and also worth knowing.
    expect(REQUEST_SCHEMA_SOURCE).toMatch(/City day allocations exceed the total trip length/)
    expect(REQUEST_SCHEMA_SOURCE).toMatch(/Origin is required for flight research/)
  })
})

describe('step validation', () => {
  it('accepts a complete draft at every step', () => {
    for (const step of TRIP_WIZARD_STEPS) {
      expect(tripWizardStepSchema(step).safeParse(pickStepFields(valid, step)).success).toBe(true)
    }
  })

  it('REJECTS an unknown key — .strict(), so an improvised field cannot ride along', () => {
    expect(tripWizardStepSchema(2).safeParse({ startDate: '2030-01-01', travelers: 2, feeVnd: 1 }).success).toBe(false)
  })

  it('catches the cross-field rule ON STEP 1, not at submit', () => {
    // 5 allocated + 1 unallocated city > 3 days.
    const bad = { cityIds: ['hanoi', 'hoian'], cityDays: [{ cityId: 'hanoi', days: 5 }], days: 3 }
    expect(tripWizardStepSchema(1).safeParse(bad).success).toBe(false)
  })

  it('rejects an allocation for a city not on the route', () => {
    const bad = { cityIds: ['hanoi'], cityDays: [{ cityId: 'hoian', days: 1 }], days: 7 }
    expect(tripWizardStepSchema(1).safeParse(bad).success).toBe(false)
  })

  it('rejects duplicate cities', () => {
    expect(tripWizardStepSchema(1).safeParse({ cityIds: ['hanoi', 'hanoi'], cityDays: [], days: 7 }).success).toBe(false)
  })

  it('rejects a city that is not in the catalogue', () => {
    expect(tripWizardStepSchema(1).safeParse({ cityIds: ['atlantis'], cityDays: [], days: 7 }).success).toBe(false)
  })

  it('rejects more than the route ceiling of cities', () => {
    const tooMany = Array.from({ length: MAX_ROUTE_CITIES + 1 }, (_, i) => `c${i}`)
    expect(tripWizardStepSchema(1).safeParse({ cityIds: tooMany, cityDays: [], days: 30 }).success).toBe(false)
  })

  it('requires at least one interest', () => {
    expect(tripWizardStepSchema(4).safeParse({ accommodation: 'hotel', interests: [] }).success).toBe(false)
  })
})

describe('firstIncompleteTripWizardStep', () => {
  it('is step 1 for an empty draft', () => {
    expect(firstIncompleteTripWizardStep({})).toBe(1)
  })

  it('walks forward as steps are answered', () => {
    let draft: TripWizardDraft = {}
    const seen: Array<number | null> = []
    for (const step of TRIP_WIZARD_STEPS) {
      seen.push(firstIncompleteTripWizardStep(draft))
      draft = { ...draft, ...pickStepFields(valid, step) }
    }
    expect(seen).toEqual([1, 2, 3, 4, 5])
  })

  it('is null only when every step is answered', () => {
    expect(firstIncompleteTripWizardStep(valid)).toBeNull()
  })

  it('FAILS TOWARD ASKING AGAIN — a half-filled step is that step, not the next', () => {
    // Reporting complete too early fires a generation the route rejects, and a rejected
    // generation still spends rate-limit budget on the most expensive path in the app.
    const draft = { ...valid, interests: [] as string[] }
    expect(firstIncompleteTripWizardStep(draft)).toBe(4)
  })

  it('does not skip an earlier gap because a later step is answered', () => {
    const draft: TripWizardDraft = { ...pickStepFields(valid, 5), ...pickStepFields(valid, 4) }
    expect(firstIncompleteTripWizardStep(draft)).toBe(1)
  })
})

describe('field names — the receipt allowlist', () => {
  it('accepts exactly the collected fields', () => {
    for (const field of Object.values(TRIP_WIZARD_STEP_FIELDS).flat()) {
      expect(isTripWizardFieldName(field)).toBe(true)
    }
  })

  it('rejects anything else, including a value-shaped string', () => {
    for (const name of ['locale', 'feeVnd', 'passportNumber', 'Hanoi, 2 adults', '__proto__', '']) {
      expect(isTripWizardFieldName(name)).toBe(false)
    }
  })

  it('answeredTripWizardFields returns NAMES only — never a value', () => {
    const names = answeredTripWizardFields({ startDate: '2030-01-01', notes: 'honeymoon, wheelchair access' })
    expect(names.sort()).toEqual(['notes', 'startDate'])
    expect(JSON.stringify(names)).not.toContain('honeymoon')
    expect(JSON.stringify(names)).not.toContain('2030')
  })

  it('ignores keys that are not wizard fields', () => {
    expect(answeredTripWizardFields({ locale: 'en', days: 3 } as TripWizardDraft)).toEqual(['days'])
  })
})
