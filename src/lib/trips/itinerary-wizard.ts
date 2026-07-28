import { z } from 'zod'
import {
  ACCOMMODATION_IDS, BUDGET_IDS, CABIN_IDS, CITY_IDS, INTEREST_IDS, PACE_IDS, STOPS_IDS,
} from '../itinerary-data'

/**
 * THE ITINERARY REQUEST CONTRACT, and the in-chat wizard's step machine over it.
 *
 * ⚠️ ONE SCHEMA, TWO VIEWS — and that is the whole point of this module. `itineraryRequestSchema`
 * below is THE authority: /api/itineraries/generate imports it and validates every body with it,
 * whether that body came from the dashboard builder or from the chat wizard. The per-step schemas
 * are a PARTITION of the very same field objects, so the wizard can tell a traveller about a bad
 * answer on the step that asked it instead of five taps later.
 *
 * It used to be two hand-written copies — the route owned a private `requestSchema` and this file
 * mirrored every bound, kept in step by a test that REGEX-SCRAPED the route's source. That guard
 * could only ever catch the authority moving; it could not catch both copies being wrong together,
 * and it broke on any reformatting of the file it was scraping. Deriving both views from one
 * `FIELD_SHAPE` makes the drift unrepresentable instead of merely detectable, so the scraping
 * tests are gone.
 *
 * ⚠️ ONE RULE IS DELIBERATELY NOT IN THE PARTITION: the start date must be in the future and
 * within two years. It is TIME-RELATIVE, so a per-step schema carrying it would give a wizard card
 * a different verdict depending on when it is re-rendered, and would make every fixture that uses
 * a fixed date rot. It stays on the whole-request schema, which is evaluated once, at submit.
 *
 * No 'server-only' and RELATIVE specifiers on purpose: this module is imported by BOTH the server
 * flow and the client card, and `@/…` does not resolve under vitest (the src/lib/visa/dm-steps.ts
 * idiom, which exists for exactly the same reason).
 */

export const TRIP_WIZARD_STEPS = [1, 2, 3, 4, 5] as const
export type TripWizardStep = (typeof TRIP_WIZARD_STEPS)[number]
export const LAST_TRIP_WIZARD_STEP: TripWizardStep = 5

/** The ceiling on route length. The generate route imports this rather than restating it. */
export const MAX_ROUTE_CITIES = 15

/** What the chip above the composer offers. */
export type TripWizardChip = 'none' | 'start' | 'resume'

/**
 * WHICH ENTRY POINT A TRIP THREAD OFFERS.
 *
 * ⚠️ A RUNNING WIZARD MUST NEVER HIDE THE CHIP. It did, and the whole feature became unreachable:
 * the launcher offered "Plan a trip" only while no wizard was running, on the reasoning that "a
 * running wizard renders its own card, and two entry points is how a traveller restarts the flow by
 * accident". But a wizard card is UPDATED IN PLACE — it keeps the timeline position it was created
 * at — so once a few messages land on top of it, the card is above the fold and the chip that could
 * bring it back has hidden itself precisely because the card exists. Measured on production
 * 2026-07-28: an active step-1 card from 09:01Z sat first in a thirteen-message thread while the
 * owner tapped the product page's CTA ten times and got ten lines of chat and no form.
 *
 * So the answer is never 'none' for a traveller on a trip thread. A live wizard changes the chip's
 * MEANING — resume, not start — never its existence. Extracted here, out of the component, because
 * the bug was in this one boolean and a component is where it stopped being reviewable.
 */
export function tripWizardChip(input: { eligible: boolean; liveWizardMessageId: string | null }): TripWizardChip {
  if (!input.eligible) return 'none'
  return input.liveWizardMessageId ? 'resume' : 'start'
}

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

// ── The shape ─────────────────────────────────────────────────────────────────────────────
// Every enum member is read from src/lib/itinerary-data.ts, never written out again here. The
// *_IDS arrays there are derived from Record<Id, …> label tables, so a member added to a union and
// not labelled is a COMPILE error at the source — it cannot reach this file as a silent omission.
//
// CITY_IDS is additionally drift-guarded against the route's private CITY_CATALOG (the prompt-side
// catalogue of names/airports) by itinerary-city-catalog.test.ts, so a renamed city fails a test
// rather than producing a wizard that offers a city the generator will reject.

const FIELD_SHAPE = {
  origin: z.string().trim().max(120).default(''),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  days: z.number().int().min(1).max(30),
  travelers: z.number().int().min(1).max(100),
  cityIds: z.array(z.enum(CITY_IDS)).min(1).max(MAX_ROUTE_CITIES),
  cityDays: z.array(z.object({
    cityId: z.enum(CITY_IDS),
    days: z.number().int().min(1).max(30),
  })).max(MAX_ROUTE_CITIES).default([]),
  budgetId: z.enum(BUDGET_IDS),
  pace: z.enum(PACE_IDS),
  interests: z.array(z.enum(INTEREST_IDS)).min(1).max(INTEREST_IDS.length),
  accommodation: z.enum(ACCOMMODATION_IDS),
  flight: z.object({
    include: z.boolean(),
    cabin: z.enum(CABIN_IDS),
    maxStops: z.enum(STOPS_IDS),
    checkedBags: z.boolean(),
  }),
  notes: z.string().trim().max(600).default(''),
} as const

/**
 * The request body as a plain object, before the cross-field rules are attached. Declared
 * separately so the field list below can be read off THE SCHEMA rather than off FIELD_SHAPE.
 *
 * ⚠️ THE DISTINCTION IS THE GUARD. Listing `Object.keys(FIELD_SHAPE)` looks equivalent and is not:
 * a field added here beside `locale` would be part of the contract and yet invisible to the
 * partition test, so the wizard would silently stop collecting a field the server accepts. Reading
 * the assembled shape means any new field must be assigned to a step or fail the test. (Raised by
 * codex against the first cut, which did read FIELD_SHAPE.)
 */
const itineraryRequestObject = z.object({
  locale: z.enum(['en', 'vi', 'zh-Hans', 'ko', 'ja', 'ru', 'km', 'ms', 'th', 'fr', 'hi']).default('en'),
  ...FIELD_SHAPE,
})

/** Every field a step must account for: the request's own keys, minus the one nobody asks for. */
export const ITINERARY_REQUEST_FIELDS: readonly string[] =
  Object.keys(itineraryRequestObject.shape).filter((field) => field !== 'locale')

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

// ── Cross-field rules ─────────────────────────────────────────────────────────────────────
// Written once and applied BOTH to the whole request and to the single step that owns every field
// the rule mentions. That is the reason the partition groups fields the way it does: a rule the
// wizard could not evaluate until submit would be a rule the traveller only learns about after
// five taps, and a body rejected at submit still costs a rate-limit token on the most expensive
// path in the app.

type RouteFields = { cityIds?: string[]; cityDays?: Array<{ cityId: string; days: number }>; days?: number }
type FlightFields = { flight?: { include?: boolean }; origin?: string }

function refineRoute(value: unknown, context: z.RefinementCtx): void {
  const draft = value as RouteFields
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
}

function refineFlightOrigin(value: unknown, context: z.RefinementCtx): void {
  const draft = value as FlightFields
  if (draft.flight?.include && (draft.origin ?? '').length < 2) {
    context.addIssue({ code: 'custom', path: ['origin'], message: 'Origin is required for flight research' })
  }
}

/**
 * The start date must be real, not in the past, and within two years.
 *
 * ⚠️ WHOLE-REQUEST ONLY, never a step. It is the one rule whose verdict depends on WHEN it runs,
 * so pinning it to a step would mean a rendered wizard card that was valid this morning is invalid
 * tonight, and every fixture with a fixed date would rot. Evaluated once, at submit.
 */
function refineStartDate(value: unknown, context: z.RefinementCtx): void {
  const { startDate } = value as { startDate: string }
  const start = new Date(`${startDate}T00:00:00.000Z`)
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const latestStart = new Date(today)
  latestStart.setUTCFullYear(latestStart.getUTCFullYear() + 2)
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== startDate) {
    context.addIssue({ code: 'custom', path: ['startDate'], message: 'Invalid date' })
  } else if (start < today) {
    context.addIssue({ code: 'custom', path: ['startDate'], message: 'Start date cannot be in the past' })
  } else if (start > latestStart) {
    context.addIssue({ code: 'custom', path: ['startDate'], message: 'Start date must be within two years' })
  }
}

/**
 * THE AUTHORITY. /api/itineraries/generate validates every body with exactly this, and both
 * clients — the dashboard builder and the chat wizard — post bodies shaped by it.
 *
 * `locale` is the only field no step collects: it is read from the language context at submit
 * rather than asked for, on both surfaces.
 */
export const itineraryRequestSchema = itineraryRequestObject.superRefine((value, context) => {
  refineStartDate(value, context)
  refineRoute(value, context)
  refineFlightOrigin(value, context)
})

export type ItineraryRequest = z.infer<typeof itineraryRequestSchema>

/**
 * Validate ONLY the fields a given step owns. Unknown keys are rejected.
 *
 * The field objects are the SAME objects the authority is built from — not copies of them — so a
 * bound can only be changed in one place. The step schemas differ from the authority in exactly
 * two sanctioned ways: they cover a subset of the fields, and they omit the time-relative start
 * date rule (see refineStartDate).
 */
export function tripWizardStepSchema(step: TripWizardStep): z.ZodType {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const field of TRIP_WIZARD_STEP_FIELDS[step]) {
    shape[field] = FIELD_SHAPE[field as keyof typeof FIELD_SHAPE]
  }
  const base = z.object(shape).strict()
  // A cross-field rule is applied by the one step that owns every field it mentions.
  if (step === 1) return base.superRefine(refineRoute)
  if (step === 5) return base.superRefine(refineFlightOrigin)
  return base
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

// ── Labels ────────────────────────────────────────────────────────────────────────────────
// Moved to src/lib/itinerary-data.ts (INTEREST_LABELS / ACCOMMODATION_LABELS / PACE_LABELS /
// CABIN_LABELS / STOPS_LABELS), next to the unions they name, so every surface that offers these
// choices reads one table. The *_IDS arrays this file's schema uses are derived from those same
// tables — the labels and the accepted values cannot disagree.
