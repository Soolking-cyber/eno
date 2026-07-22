import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  VISA_DM_STEP_FIELDS,
  VISA_DM_STEP_ISSUES,
  firstIncompleteVisaDmStep,
  validateVisaDmStep,
  visaDmStepPreview,
  type VisaDmStep,
} from './dm-steps'
import { validateVisaForReview, visaDateDefaultsForStart, visaPayloadSchema, type VisaPayload } from './schema'

// TOTALITY, the invariant the whole 5-step DM partition rests on: the union of
// VISA_DM_STEP_ISSUES must equal EVERY code validateVisaForReview can emit. A code owned
// by no step never reaches the applicant — they clear all five steps and only learn the
// case is incomplete at final submit (the live bug the 3-step map's own characterization
// test was written for, src/lib/visa/schema.step-issues.test.ts).
//
// Static extraction from the SOURCE, same idiom as that test, so this is
// self-maintaining: add an issue code to the validator and forget this map, and the root
// suite goes red.
//
// ⚠️ ROOT FILE ONLY. schema.step-issues.test.ts reads BOTH copies of the sync-pair
// because the 3-step map is duplicated in apps/forum. The DM partition is an eno.vn-only
// surface (CLAUDE.md "Visa ownership") and lives in an UNPAIRED file, so reading the
// forum copy here would invent a cross-app coupling that does not exist.
const SCHEMA_FILE = 'src/lib/visa/schema.ts'
const source = readFileSync(SCHEMA_FILE, 'utf8')

/** Every code validateVisaForReview can push onto `issues`. */
function emittableCodes(src: string): Set<string> {
  // 1. The `required` tuples: ['field', 'code_required']
  const required = [...src.matchAll(/\['[A-Za-z]+',\s*'([a-z0-9_]+_required)'\]/g)].map((m) => m[1])
  // 2. Conditional pushes: issues.push('code')
  const pushed = [...src.matchAll(/issues\.push\('([a-z0-9_]+)'\)/g)].map((m) => m[1])
  // 3. The document loop pushes VARIABLES (missingCode / qualityCode), so the two
  //    literals only exist in its tuple table: ['portrait', 'missing', 'quality'].
  //    Without this arm the four document codes read as un-emittable, and the totality
  //    assertion below would be satisfied by a partition that drops all of step 1.
  //    Sliced to that loop first — a bare triple regex also swallows the payload's own
  //    3-member z.enum literals ('self'/'organization'/'other', the payment methods).
  const loopStart = src.indexOf('missingCode, qualityCode] of [')
  const loopBlock = loopStart < 0 ? '' : src.slice(loopStart, src.indexOf('] as const)', loopStart))
  const documents = [...loopBlock.matchAll(/\['[a-z]+',\s*'([a-z0-9_]+)',\s*'([a-z0-9_]+)'\]/g)].flatMap((m) => [m[1], m[2]])
  return new Set([...required, ...pushed, ...documents])
}

/** The 3-step wizard's private STEP_ISSUES map, per index — the set this file re-partitions. */
function wizardStepIssues(src: string): Record<'0' | '1' | '2', Set<string>> {
  const block = src.slice(src.indexOf('const STEP_ISSUES'), src.indexOf('export function validateVisaStep'))
  const out: Record<string, Set<string>> = { 0: new Set(), 1: new Set(), 2: new Set() }
  for (const match of block.matchAll(/(\d):\s*new Set\(\[([\s\S]*?)\]\)/g)) {
    out[match[1]] = new Set([...match[2].matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]))
  }
  return out as Record<'0' | '1' | '2', Set<string>>
}

const STEPS = [1, 2, 3, 4, 5] as const
const union = (steps: readonly VisaDmStep[] = STEPS) =>
  new Set(steps.flatMap((step) => [...VISA_DM_STEP_ISSUES[step]]))
const sorted = (values: Iterable<string>) => [...values].sort()

describe('VISA_DM_STEP_ISSUES totality', () => {
  it('the union of the five DM steps is EXACTLY the emittable code set of validateVisaForReview', () => {
    const emittable = emittableCodes(source)
    // Sanity-check the extractor itself: if a refactor of schema.ts silently stops
    // matching, `emittable` shrinks and the equality below could pass vacuously.
    expect(emittable.size).toBeGreaterThan(50)
    expect(emittable.has('portrait_required')).toBe(true)
    expect(emittable.has('visa_period_exceeds_90_days')).toBe(true)
    expect(sorted(union())).toEqual(sorted(emittable))
  })

  it('re-partitions the wizard map rather than inventing a second code set', () => {
    const wizard = wizardStepIssues(source)
    expect(sorted(union())).toEqual(sorted(new Set([...wizard[0], ...wizard[1], ...wizard[2]])))
  })

  it('holds the FROZEN partition: 1 = wizard step 0, 2 ∪ 3 = wizard step 1, 4 = wizard step 2', () => {
    const wizard = wizardStepIssues(source)
    expect(sorted(VISA_DM_STEP_ISSUES[1])).toEqual(sorted(wizard[0]))
    expect(sorted(union([2, 3]))).toEqual(sorted(wizard[1]))
    expect(sorted(VISA_DM_STEP_ISSUES[4])).toEqual(sorted(wizard[2]))
  })

  it('assigns every code to exactly ONE step', () => {
    const seen = new Map<string, VisaDmStep>()
    for (const step of STEPS) {
      for (const code of VISA_DM_STEP_ISSUES[step]) {
        expect(seen.get(code), `${code} is owned by steps ${seen.get(code)} and ${step}`).toBeUndefined()
        seen.set(code, step)
      }
    }
  })

  it('leaves step 5 empty (consent + pay only)', () => {
    expect(VISA_DM_STEP_ISSUES[5].size).toBe(0)
  })
})

// Payload FIELD names are the only strings a visa card's metaJson may carry
// (needsReview, src/lib/messages.ts) — a name that is not a schema key is rejected at the
// write, so an unroutable entry here would be an un-sendable card.
describe('VISA_DM_STEP_FIELDS', () => {
  const shapeKeys = new Set(Object.keys(visaPayloadSchema.shape))
  // Owned by the system/admin, never by an applicant-facing DM step.
  const SYSTEM_FIELDS = new Set(['schemaVersion', 'adminMessage', 'governmentRegistrationCode', 'governmentApplicationStatus'])

  it('every entry is a key of visaPayloadSchema.shape', () => {
    for (const step of STEPS) {
      for (const field of VISA_DM_STEP_FIELDS[step]) {
        expect(shapeKeys.has(field), `step ${step} routes "${field}", which is not a payload field`).toBe(true)
      }
    }
  })

  it('routes each field to exactly one step, and covers every non-system payload field', () => {
    const routed = STEPS.flatMap((step) => [...VISA_DM_STEP_FIELDS[step]])
    expect(sorted(new Set(routed))).toEqual(sorted(routed)) // no duplicates across steps
    expect(sorted(new Set(routed))).toEqual(sorted([...shapeKeys].filter((key) => !SYSTEM_FIELDS.has(key))))
  })
})

// ── Runtime behaviour ─────────────────────────────────────────────────────────────
const PASSED_DOCS = [
  { kind: 'portrait', validation_status: 'passed' },
  { kind: 'passport', validation_status: 'passed' },
]

/** A payload that clears validateVisaForReview outright — the "all five steps done" state. */
function completePayload(): VisaPayload {
  const dates = visaDateDefaultsForStart('2026-09-01')
  return visaPayloadSchema.parse({
    surname: 'Nguyen', givenNames: 'An Minh', dateOfBirth: '1990-01-02', sex: 'male',
    nationality: 'Australia', placeOfBirth: 'Sydney', email: 'applicant@example.com',
    passportNumber: 'PA1234567', passportIssuingAuthority: 'DFAT',
    passportIssueDate: '2020-01-01', passportExpiryDate: '2030-01-01',
    permanentAddress: '1 Test Street, Sydney', phone: '+61400000000',
    emergencyName: 'Jane Doe', emergencyRelationship: 'Sister', emergencyPhone: '+61400000001',
    occupation: 'Engineer',
    ...dates,
    purposeOfEntry: 'Tourism',
    temporaryAddress: 'Hotel Test, District 1', temporaryProvince: 'Ho Chi Minh City',
  })
}

describe('validateVisaDmStep', () => {
  it('partitions the validator output across the five steps with nothing lost', () => {
    const payload = visaPayloadSchema.parse({})
    const all = validateVisaForReview(payload, [])
    const perStep = STEPS.flatMap((step) => validateVisaDmStep(payload, [], step))
    expect(sorted(new Set(perStep))).toEqual(sorted(new Set(all)))
    expect(perStep.length).toBe(new Set(perStep).size) // each issue reported by ONE step
  })

  it('reports only the codes its own step owns', () => {
    const payload = visaPayloadSchema.parse({})
    expect(validateVisaDmStep(payload, [], 1)).toEqual(['portrait_required', 'passport_image_required'])
    expect(validateVisaDmStep(payload, PASSED_DOCS, 1)).toEqual([])
    expect(validateVisaDmStep(payload, PASSED_DOCS, 2)).toContain('passport_number_required')
    expect(validateVisaDmStep(payload, PASSED_DOCS, 2)).not.toContain('occupation_required')
    expect(validateVisaDmStep(payload, PASSED_DOCS, 5)).toEqual([])
  })

  it('surfaces a failed document as a quality issue, not a missing one', () => {
    const payload = visaPayloadSchema.parse({})
    const docs = [{ kind: 'portrait', validation_status: 'failed' }, { kind: 'passport', validation_status: 'passed' }]
    expect(validateVisaDmStep(payload, docs, 1)).toEqual(['portrait_image_not_verified'])
  })
})

describe('firstIncompleteVisaDmStep', () => {
  it('walks 1 → 2 → 3 → 4 as each step is satisfied, then answers null', () => {
    const empty = visaPayloadSchema.parse({})
    expect(firstIncompleteVisaDmStep(empty, [])).toBe(1)
    expect(firstIncompleteVisaDmStep(empty, PASSED_DOCS)).toBe(2)

    const complete = completePayload()
    expect(validateVisaForReview(complete, PASSED_DOCS)).toEqual([])
    expect(firstIncompleteVisaDmStep(complete, PASSED_DOCS)).toBeNull()

    // Knock out one step-3 field and one step-4 field: the LOWEST outstanding step wins.
    const noOccupation = { ...complete, occupation: '' }
    expect(firstIncompleteVisaDmStep(noOccupation, PASSED_DOCS)).toBe(3)
    const noTrip = { ...complete, occupation: '', temporaryProvince: '' }
    expect(firstIncompleteVisaDmStep(noTrip, PASSED_DOCS)).toBe(3)
    expect(firstIncompleteVisaDmStep({ ...complete, temporaryProvince: '' }, PASSED_DOCS)).toBe(4)
  })

  it('never returns 5 — step 5 owns no payload issues', () => {
    const complete = completePayload()
    for (const broken of [{}, { surname: '' }, { occupation: '' }, { entryGate: '' }]) {
      expect(firstIncompleteVisaDmStep({ ...complete, ...broken }, PASSED_DOCS)).not.toBe(5)
    }
  })
})

// Every applicant-shaped value in completePayload(), plus the document-number and
// date shapes an interpolated preview would most likely leak. If any of these — or any
// digit that is not the step marker — ever appears in a preview, applicant data has
// reached the PLAINTEXT Conversation.lastMessageText column that both inboxes read.
const SENTINELS = [
  'Nguyen', 'An Minh', 'Sydney', 'Australia', 'PA1234567', 'DFAT', 'Engineer', 'Jane Doe',
  'applicant@example.com', '1990-01-02', '+61400000000', '1 Test Street',
  'Hotel Test, District 1', 'Ho Chi Minh City', 'Tourism',
]

/**
 * Why a line is not PII-free, or null. THE ONLY DIGITS ALLOWED ARE THE STEP MARKER —
 * a passport number, a date of birth, a phone or an amount interpolated into the preview
 * all show up as extra digits, whatever their wording. Both spellings of the marker
 * count: "1/5" (vi) and "1 of 5" (en).
 */
function previewLeak(preview: string, step: number): string | null {
  const withoutMarker = preview.replace(new RegExp(`${step}(?:/| of )5`, 'g'), '')
  const digit = withoutMarker.match(/\d/)
  if (digit) return `digit "${digit[0]}" outside the step marker`
  const leaked = SENTINELS.find((value) => preview.toLowerCase().includes(value.toLowerCase()))
  return leaked ? `applicant value "${leaked}"` : null
}

describe('visaDmStepPreview', () => {
  // Sanity-check the DETECTOR first (the emittableCodes idiom above): an assertion that
  // cannot fail proves nothing, and the previous version of this test called the same
  // pure function twice with the same argument and called that a PII property.
  it('the leak detector catches a preview that DOES interpolate applicant data', () => {
    expect(previewLeak('Bước 2/5: Xác nhận hộ chiếu · Step 2 of 5: Confirm passport', 2)).toBeNull()
    expect(previewLeak('Bước 2/5 · Step 2 of 5: passport PA1234567', 2)).toContain('digit')
    expect(previewLeak('Bước 2/5 · Step 2 of 5: Nguyen An Minh', 2)).toContain('applicant value')
    expect(previewLeak('Bước 2/5 · Step 2 of 5 — applicant@example.com', 2)).toContain('applicant value')
  })

  it('is a constant bilingual line — no applicant data can reach lastMessageText through it', () => {
    for (const step of STEPS) {
      const preview = visaDmStepPreview(step)
      expect(preview).toContain('·') // Vietnamese · English composite
      expect(preview).toContain(`${step}/5`)
      // Conversation.lastMessageText is sliced to 140 in insertMessage.
      expect(preview.length).toBeLessThanOrEqual(140)
      expect(previewLeak(preview, step), `step ${step} preview`).toBeNull()
    }
    expect(new Set(STEPS.map(visaDmStepPreview)).size).toBe(5)
  })

  it('falls back to step 1’s line for a step outside the partition (never undefined)', () => {
    // The `?? VISA_DM_STEP_PREVIEW[1]` arm: a widened number from a persisted card must
    // still yield a real inbox line, not the string "undefined".
    for (const bogus of [0, 6, -1, 99, Number.NaN]) {
      expect(visaDmStepPreview(bogus as VisaDmStep)).toBe(visaDmStepPreview(1))
    }
  })
})
