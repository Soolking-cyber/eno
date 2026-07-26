import { describe, expect, it } from 'vitest'
import {
  ITINERARY_REQUEST_FIELDS, TRIP_WIZARD_STEPS, TRIP_WIZARD_STEP_FIELDS, MAX_ROUTE_CITIES,
  answeredTripWizardFields, firstIncompleteTripWizardStep, isTripWizardFieldName,
  itineraryRequestSchema, pickStepFields, tripWizardStepSchema, type TripWizardDraft,
} from './itinerary-wizard'
import { CITIES } from '../itinerary-data'

// The wizard is a PARTITION of the generate route's request body, not a second contract.
//
// ⚠️ THIS FILE USED TO REGEX-SCRAPE THE ROUTE'S SOURCE. The schema was declared twice — once in
// the route, once here — and a set of `expect(source).toMatch(/days: z.number\(\).int\(\)…/)`
// assertions tried to keep the copies aligned. That guard could only ever catch the authority
// moving; it could not catch both copies being wrong together, and it broke whenever the file it
// was reading got reformatted. There is now ONE schema (itineraryRequestSchema, in the module
// under test) which the route imports, so drift is unrepresentable rather than merely detectable.
//
// What replaced the scraping, on the reviewers' insistence that "derived from one object" is not
// by itself proof:
//   · structural — the five steps must cover the request's fields exactly, read from the shape;
//   · behavioural — every shared bound is asserted on BOTH views, so a step that stopped agreeing
//     with the authority fails here;
//   · route-level — src/app/api/itineraries/generate/route.test.ts proves the route actually
//     validates with this schema, refinements attached, before it spends any quota.

/** A start date that is always inside the authority's "future, within two years" window. */
function soonISO(daysAhead = 30): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + daysAhead)
  return date.toISOString().slice(0, 10)
}

const validRequest = {
  locale: 'en' as const,
  cityIds: ['hanoi', 'hoian'],
  cityDays: [{ cityId: 'hanoi', days: 3 }],
  days: 7,
  startDate: soonISO(),
  travelers: 2,
  budgetId: 'comfort',
  pace: 'balanced',
  accommodation: 'hotel',
  interests: ['food', 'culture'],
  flight: { include: false, cabin: 'economy', maxStops: 'any', checkedBags: false },
  origin: '',
  notes: '',
}

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
    // locale is filled from the language context at submit, like the dashboard builder does — so
    // it is the ONE field the authority has and no step collects. Read from the schema's own
    // field list, not from source text.
    const collected = Object.values(TRIP_WIZARD_STEP_FIELDS).flat()
    expect(new Set(collected).size).toBe(collected.length) // no field in two steps
    expect([...collected].sort()).toEqual([...ITINERARY_REQUEST_FIELDS].sort())
    expect(ITINERARY_REQUEST_FIELDS).not.toContain('locale')
    expect(itineraryRequestSchema.safeParse({ ...validRequest, locale: undefined }).success).toBe(true)
  })

  it('has a schema for every step and no step without fields', () => {
    for (const step of TRIP_WIZARD_STEPS) {
      expect(TRIP_WIZARD_STEP_FIELDS[step].length).toBeGreaterThan(0)
      expect(tripWizardStepSchema(step)).toBeTruthy()
    }
  })

  it('the authority accepts a complete, valid request', () => {
    // The floor for every rejection test below: if this ever fails, the negatives prove nothing.
    expect(itineraryRequestSchema.safeParse(validRequest).success).toBe(true)
  })
})

describe('every shared bound holds on BOTH views', () => {
  // One object, two views — so a bound must bite identically whether it arrives a step at a time
  // or as a whole request. Each case asserts the step schema AND the authority, which is what the
  // old source-scraping was reaching for and could not actually check.
  it.each([
    ['days max 30', 1, { cityIds: ['hanoi'], cityDays: [], days: 30 }, { cityIds: ['hanoi'], cityDays: [], days: 31 }],
    ['days min 1', 1, { cityIds: ['hanoi'], cityDays: [], days: 1 }, { cityIds: ['hanoi'], cityDays: [], days: 0 }],
    ['travelers max 100', 2, { startDate: soonISO(), travelers: 100 }, { startDate: soonISO(), travelers: 101 }],
    ['travelers min 1', 2, { startDate: soonISO(), travelers: 1 }, { startDate: soonISO(), travelers: 0 }],
    ['interests at least one', 4, { accommodation: 'hotel', interests: ['food'] }, { accommodation: 'hotel', interests: [] }],
    ['origin max 120', 5, { flight: validRequest.flight, origin: 'x'.repeat(120), notes: '' }, { flight: validRequest.flight, origin: 'x'.repeat(121), notes: '' }],
    ['notes max 600', 5, { flight: validRequest.flight, origin: '', notes: 'x'.repeat(600) }, { flight: validRequest.flight, origin: '', notes: 'x'.repeat(601) }],
  ])('%s', (_label, step, ok, bad) => {
    const schema = tripWizardStepSchema(step as 1 | 2 | 4 | 5)
    expect({ view: 'step', ok: schema.safeParse(ok).success, bad: schema.safeParse(bad).success })
      .toEqual({ view: 'step', ok: true, bad: false })
    expect({
      view: 'request',
      ok: itineraryRequestSchema.safeParse({ ...validRequest, ...ok }).success,
      bad: itineraryRequestSchema.safeParse({ ...validRequest, ...bad }).success,
    }).toEqual({ view: 'request', ok: true, bad: false })
  })

  it('the route ceiling is 15 cities, on both views', () => {
    expect(MAX_ROUTE_CITIES).toBe(15)
    const cities = CITIES.slice(0, MAX_ROUTE_CITIES).map((c) => c.id)
    const tooMany = [...cities, CITIES[15].id]
    const s1 = tripWizardStepSchema(1)
    expect(s1.safeParse({ cityIds: cities, cityDays: [], days: 30 }).success).toBe(true)
    expect(s1.safeParse({ cityIds: tooMany, cityDays: [], days: 30 }).success).toBe(false)
    expect(itineraryRequestSchema.safeParse({ ...validRequest, cityIds: tooMany, cityDays: [], days: 30 }).success).toBe(false)
  })

  it('the cross-field day-allocation rule bites on step 1 AND on the whole request', () => {
    // 5 allocated + 1 unallocated city > 3 days. Enforced on the step that asked, so the traveller
    // is told there — a body rejected at submit still costs a rate-limit token.
    const bad = { cityIds: ['hanoi', 'hoian'], cityDays: [{ cityId: 'hanoi', days: 5 }], days: 3 }
    expect(tripWizardStepSchema(1).safeParse(bad).success).toBe(false)
    expect(itineraryRequestSchema.safeParse({ ...validRequest, ...bad }).success).toBe(false)
  })

  it('flights require an origin, on step 5 AND on the whole request', () => {
    const withFlights = { flight: { include: true, cabin: 'economy', maxStops: 'any', checkedBags: false } }
    const s5 = tripWizardStepSchema(5)
    expect(s5.safeParse({ ...withFlights, origin: 'a', notes: '' }).success).toBe(false)
    expect(s5.safeParse({ ...withFlights, origin: 'Seoul', notes: '' }).success).toBe(true)
    expect(itineraryRequestSchema.safeParse({ ...validRequest, ...withFlights, origin: 'a' }).success).toBe(false)
    expect(itineraryRequestSchema.safeParse({ ...validRequest, ...withFlights, origin: 'Seoul' }).success).toBe(true)
  })
})

describe('the start-date rule is on the authority only, and that is deliberate', () => {
  // ⚠️ TIME-RELATIVE. A step schema carrying this would give a rendered wizard card a different
  // verdict tonight than it gave this morning, and would rot every fixture with a fixed date. It
  // is evaluated once, at submit, where the answer is acted on immediately.
  it.each([
    ['yesterday', soonISO(-1), false],
    ['today', soonISO(0), true],
    ['in a month', soonISO(30), true],
    ['just inside two years', soonISO(720), true],
    ['beyond two years', soonISO(760), false],
  ])('%s → %s', (_label, startDate, accepted) => {
    expect(itineraryRequestSchema.safeParse({ ...validRequest, startDate }).success).toBe(accepted)
  })

  it('a nonexistent calendar date is refused even though it matches the pattern', () => {
    expect(itineraryRequestSchema.safeParse({ ...validRequest, startDate: '2027-02-31' }).success).toBe(false)
  })

  it('step 2 does NOT carry it — a past date is a step-2 answer the authority rejects at submit', () => {
    expect(tripWizardStepSchema(2).safeParse({ startDate: soonISO(-1), travelers: 2 }).success).toBe(true)
    expect(itineraryRequestSchema.safeParse({ ...validRequest, startDate: soonISO(-1) }).success).toBe(false)
  })
})

describe('the locale enum', () => {
  it('defaults to en and refuses a language the generator cannot write', () => {
    const parsed = itineraryRequestSchema.safeParse({ ...validRequest, locale: undefined })
    expect(parsed.success && parsed.data.locale).toBe('en')
    expect(itineraryRequestSchema.safeParse({ ...validRequest, locale: 'klingon' }).success).toBe(false)
    expect(itineraryRequestSchema.safeParse({ ...validRequest, locale: 'vi' }).success).toBe(true)
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
