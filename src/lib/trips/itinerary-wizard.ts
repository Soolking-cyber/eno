import { z } from 'zod'
import { CITIES, BUDGETS, type AccommodationId, type CabinId, type InterestId, type PaceId, type StopsId } from '../itinerary-data'

/**
 * The in-chat itinerary wizard's STEP MACHINE.
 *
 * ⚠️ THIS IS NOT A SECOND CONTRACT. The one enforcer is `requestSchema` in
 * src/app/api/itineraries/generate/route.ts:51, and it stays the only one — the wizard does not
 * generate server-side, it fires the SAME client request the dashboard builder fires, so every
 * body it produces is validated there or nowhere. What lives here is a PARTITION of that body
 * into five questions, plus per-step validation so a traveller learns about a bad answer on the
 * step that asked it instead of five taps later.
 *
 * That distinction is what keeps this honest against the task's rule ("the wizard must not invent
 * a second, looser one"): looser is impossible, because nothing here is trusted. A drift test
 * (itinerary-wizard.test.ts) reads the route's source and asserts every bound below still matches,
 * so the advisory copy cannot quietly fall behind the authority — the same posture the repo took
 * for the duplicated visa transition map.
 *
 * No 'server-only' and RELATIVE specifiers on purpose: this module is imported by BOTH the server
 * flow and the client card, and `@/…` does not resolve under vitest (the src/lib/visa/dm-steps.ts
 * idiom, which exists for exactly the same reason).
 */

export const TRIP_WIZARD_STEPS = [1, 2, 3, 4, 5] as const
export type TripWizardStep = (typeof TRIP_WIZARD_STEPS)[number]
export const LAST_TRIP_WIZARD_STEP: TripWizardStep = 5

/** The route's own ceiling on route length (generate/route.ts:49). */
export const MAX_ROUTE_CITIES = 15

/**
 * WHICH STEP OWNS WHICH FIELD. A partition — every key of the generate body appears exactly once,
 * except `locale`, which no step collects because it is read from the language context at submit
 * (the builder does the same).
 *
 * The grouping is not cosmetic, and two choices carry weight:
 *
 *   · Step 1 holds cityIds + cityDays + days TOGETHER because the only cross-field rule in the
 *     whole contract — allocated days plus unallocated cities must not exceed the trip length —
 *     relates exactly those three. Splitting them would make that rule unvalidatable until submit,
 *     which is the failure mode this partition exists to prevent.
 *   · Step 5 holds `origin` and `notes`, the ONLY free-text fields, and is also the step that
 *     fires generation. Free text therefore never has to survive a card boundary: it is typed and
 *     spent in one action, and never persists anywhere on our side. See the PII note below.
 */
export const TRIP_WIZARD_STEP_FIELDS: Record<TripWizardStep, readonly string[]> = {
  1: ['cityIds', 'cityDays', 'days'],
  2: ['startDate', 'travelers'],
  3: ['budgetId', 'pace'],
  4: ['accommodation', 'interests'],
  5: ['flight', 'origin', 'notes'],
}

const ALL_WIZARD_FIELDS = new Set(Object.values(TRIP_WIZARD_STEP_FIELDS).flat())

/**
 * The allowlist for a step RECEIPT — the field NAMES a card may record as answered.
 *
 * ⚠️ NAMES, NEVER VALUES. Nothing a traveller types may be written to a card, an event row, or an
 * inbox preview: not a city, not a date, not the notes field where somebody writes "honeymoon" or
 * "my daughter's allergy". This mirrors VisaStepMeta.needsReview, which is restricted to payload
 * FIELD NAMES for the same reason.
 */
export const isTripWizardFieldName = (name: string): boolean => ALL_WIZARD_FIELDS.has(name)

// ── The shape, mirrored field-for-field from the authority ────────────────────────────────
// Enum members come from src/lib/itinerary-data.ts, which the route's own city catalogue is
// already drift-guarded against (itinerary-city-catalog.test.ts). So a renamed city is a
// compile-time or test-time failure on both sides rather than a wizard that offers a city the
// generator will reject.

// Cities and budgets have a canonical ARRAY in the data module, so read it — CITIES is already
// drift-guarded against the route's private CITY_CATALOG by itinerary-city-catalog.test.ts.
const cityIdValues = CITIES.map((city) => city.id) as [string, ...string[]]
const budgetValues = BUDGETS.map((budget) => budget.id) as [string, ...string[]]

// The rest exist only as TYPE unions, so the literal lists are written out here — and then checked
// BOTH WAYS at compile time. `satisfies` catches a member that is not real; Complete<> catches a
// real member that is missing. Without the second half, adding a pace to the union would silently
// leave the wizard unable to offer it, which is the quiet half of drift.
type Complete<Union extends string, Listed extends string> = Exclude<Union, Listed> extends never ? true : ['missing', Exclude<Union, Listed>]

const paceValues = ['slow', 'balanced', 'full'] as const satisfies readonly PaceId[]
const interestValues = ['food', 'culture', 'nature', 'beaches', 'adventure', 'nightlife', 'wellness', 'family'] as const satisfies readonly InterestId[]
const accommodationValues = ['hotel', 'boutique', 'resort', 'apartment', 'homestay', 'hostel'] as const satisfies readonly AccommodationId[]
const cabinValues = ['economy', 'premium_economy', 'business'] as const satisfies readonly CabinId[]
const stopsValues = ['direct', 'one_stop', 'any'] as const satisfies readonly StopsId[]

const _paceComplete: Complete<PaceId, (typeof paceValues)[number]> = true
const _interestComplete: Complete<InterestId, (typeof interestValues)[number]> = true
const _accommodationComplete: Complete<AccommodationId, (typeof accommodationValues)[number]> = true
const _cabinComplete: Complete<CabinId, (typeof cabinValues)[number]> = true
const _stopsComplete: Complete<StopsId, (typeof stopsValues)[number]> = true
void _paceComplete; void _interestComplete; void _accommodationComplete; void _cabinComplete; void _stopsComplete

const FIELD_SHAPE = {
  origin: z.string().trim().max(120).default(''),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.number().int().min(1).max(30),
  travelers: z.number().int().min(1).max(100),
  cityIds: z.array(z.enum(cityIdValues)).min(1).max(MAX_ROUTE_CITIES),
  cityDays: z.array(z.object({
    cityId: z.enum(cityIdValues),
    days: z.number().int().min(1).max(30),
  })).max(MAX_ROUTE_CITIES).default([]),
  budgetId: z.enum(budgetValues),
  pace: z.enum(paceValues),
  interests: z.array(z.enum(interestValues)).min(1).max(interestValues.length),
  accommodation: z.enum(accommodationValues),
  flight: z.object({
    include: z.boolean(),
    cabin: z.enum(cabinValues),
    maxStops: z.enum(stopsValues),
    checkedBags: z.boolean(),
  }),
  notes: z.string().trim().max(600).default(''),
} as const

export type TripWizardDraft = Partial<{
  origin: string
  startDate: string
  days: number
  travelers: number
  cityIds: string[]
  cityDays: Array<{ cityId: string; days: number }>
  budgetId: string
  pace: string
  interests: string[]
  accommodation: string
  flight: { include: boolean; cabin: string; maxStops: string; checkedBags: boolean }
  notes: string
}>

/** Validate ONLY the fields a given step owns. Unknown keys are rejected. */
export function tripWizardStepSchema(step: TripWizardStep): z.ZodType {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const field of TRIP_WIZARD_STEP_FIELDS[step]) {
    shape[field] = FIELD_SHAPE[field as keyof typeof FIELD_SHAPE]
  }
  const base = z.object(shape).strict()
  // Step 1 owns the only cross-field rule, so it can enforce it here rather than at submit.
  if (step !== 1) return base
  return base.superRefine((value, context) => {
    const draft = value as { cityIds?: string[]; cityDays?: Array<{ cityId: string; days: number }>; days?: number }
    const cityIds = draft.cityIds ?? []
    const cityDays = draft.cityDays ?? []
    if (new Set(cityIds).size !== cityIds.length) {
      context.addIssue({ code: 'custom', path: ['cityIds'], message: 'Cities must be unique' })
    }
    const allocated = cityDays.map(({ cityId }) => cityId)
    if (new Set(allocated).size !== allocated.length) {
      context.addIssue({ code: 'custom', path: ['cityDays'], message: 'City day allocations must be unique' })
    }
    for (const [index, allocation] of cityDays.entries()) {
      if (!cityIds.includes(allocation.cityId)) {
        context.addIssue({ code: 'custom', path: ['cityDays', index, 'cityId'], message: 'Allocated city must be in the selected route' })
      }
    }
    const allocatedDays = cityDays.reduce((sum, allocation) => sum + allocation.days, 0)
    const flexible = cityIds.filter((cityId) => !allocated.includes(cityId)).length
    if (allocatedDays + flexible > (draft.days ?? 0)) {
      context.addIssue({ code: 'custom', path: ['cityDays'], message: 'City day allocations exceed the total trip length' })
    }
  })
}

/**
 * The step a traveller is on: the FIRST one whose fields are not all present, or null when every
 * step is answered and the draft is ready to submit.
 *
 * ⚠️ FAILS TOWARD ASKING AGAIN. An unrecognised or half-filled field resolves to the step that
 * collects it rather than being skipped, because reporting "complete" too early would fire a
 * generation that the route rejects — and a rejected generation still consumes rate-limit budget
 * on the most expensive path in the app. Re-asking costs a tap; guessing costs a quota token.
 */
export function firstIncompleteTripWizardStep(draft: TripWizardDraft): TripWizardStep | null {
  for (const step of TRIP_WIZARD_STEPS) {
    if (!tripWizardStepSchema(step).safeParse(pickStepFields(draft, step)).success) return step
  }
  return null
}

/** The subset of a draft a given step owns, for validating or for posting an answer. */
export function pickStepFields(draft: TripWizardDraft, step: TripWizardStep): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of TRIP_WIZARD_STEP_FIELDS[step]) {
    const value = (draft as Record<string, unknown>)[field]
    if (value !== undefined) out[field] = value
  }
  return out
}

/** Field NAMES answered so far — what a receipt may record. Never their values. */
export function answeredTripWizardFields(draft: TripWizardDraft): string[] {
  return Object.keys(draft).filter((key) => isTripWizardFieldName(key) && (draft as Record<string, unknown>)[key] !== undefined)
}
