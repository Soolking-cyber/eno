import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

// visa-cards.tsx is a client component; useLanguage is its only hook and nothing under
// test calls it. Stubbed so the module can be imported outside a React tree.
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en }),
}))

import { VISA_DM_STEP_FIELDS, type VisaDmStep } from '@/lib/visa/dm-steps'
import { MAX_EVISA_VALIDITY_DAYS, visaDateDefaultsForStart, visaEndDateFor90DayWindow } from '@/lib/visa/schema'
import {
  VISA_FIELD_LABEL, VISA_ISSUE_FIELD, VISA_STEP_FORM,
  applyVisaDraftEdit, visaDateBounds, visaStepFormFields, visaSubmitValue,
  type VisaFormField,
} from './visa-cards'

/**
 * THE CHAT MUST ASK EVERYTHING — and the auto-fill contract of the trip step.
 *
 * Two bugs live in this file.
 *
 * 1. THE SILENT DEFAULT (2026-07-22). A card rendered the OUTSTANDING issues, and a payload
 *    field carrying a schema default never produces one. religion ('None'), passportType
 *    ('ordinary'), every declaration ('no'), purposeOfEntry ('Tourism'), entryGate/exitGate
 *    ('Tan Son Nhat'), the 90-day stay, USD 1,000 by credit card — none of it was ever put to
 *    the applicant in the chat. The dashboard wizard was the only surface that asked, and the
 *    owner is retiring the dashboard wizard: "only 1 way should exist through the chat". Every
 *    application forwarded to an agent would then carry defaults where answers should be.
 *    The gate below is what makes deleting the other form safe, so it is written as a
 *    REACHABILITY proof over the real render path, not as a shape check on a table:
 *      · reachableFields() drives visaStepFormFields — the exact function the card maps over —
 *        with every combination of the answers the card is ALREADY showing, so a field only
 *        counts as asked if an applicant can get to it by answering visible questions;
 *      · the parity suite reads the dashboard form's own source and fails if it asks for a
 *        field the chat does not;
 *      · the render suite pins the card to that one field list, so the two cannot drift.
 *
 * 2. THE DATE CASCADE (2026-07-21). The owner picked a visa start date in the chat card and
 *    "Visa ends" / "Intended entry date" stayed EMPTY while the dashboard's TripStep had been
 *    filling both (and the length of stay) from the same date since the wizard shipped. Two
 *    forms writing one encrypted payload disagreed about what a start date implies — and a
 *    disagreement about the 90-day window is a rejected visa, not a cosmetic difference.
 */

const STEPS: readonly VisaDmStep[] = [1, 2, 3, 4, 5]
const SOURCE_FILE = 'src/components/marketplace/visa-cards.tsx'
const DASHBOARD_FORM_FILE = 'src/app/dashboard/visa/apply-client.tsx'
const UPLOAD_ROUTE_FILE = 'src/app/api/visa/applications/[id]/documents/route.ts'
const source = readFileSync(SOURCE_FILE, 'utf8')

/**
 * The ONE payload field the chat does not put a control on.
 *
 * aiDocumentProcessingConsent is not a question — it is the record that the applicant handed
 * us an image to read, and the upload route stamps it on the same request that stores the
 * photo. Step 1 IS that upload. The exemption is asserted against that route's source below,
 * so it cannot outlive the behaviour that justifies it, and it is pinned to exactly one name
 * so nobody can quietly park a second field in here.
 */
const STAMPED_BY_UPLOAD = new Set(['aiDocumentProcessingConsent'])

const optionValues = (entry: VisaFormField, draft: Record<string, string>): string[] => {
  if (entry.control === 'yesno') return ['yes', 'no']
  if (entry.control === 'sex') return ['male', 'female']
  const options = typeof entry.options === 'function' ? entry.options(draft) : entry.options
  return (options ?? []).map(([value]) => value)
}

/**
 * Every field an applicant can actually GET TO in this step.
 *
 * Starts from what the card shows with nothing answered, then enumerates every combination of
 * the enumerable answers among THOSE fields (yes/no, sex, the choice selects) and re-asks the
 * form what it renders. A follow-up hidden behind a question that is itself hidden therefore
 * never shows up here — which is the point: "reachable" means reachable by the applicant, not
 * reachable by a test that knows the magic draft.
 */
function reachableFields(step: VisaDmStep): Set<string> {
  const base = visaStepFormFields(step, {})
  const found = new Set(base.map((entry) => entry.field))
  const gates = base
    .map((entry) => ({ field: entry.field, values: optionValues(entry, {}) }))
    .filter((gate) => gate.values.length > 0)

  let drafts: Array<Record<string, string>> = [{}]
  for (const gate of gates) {
    drafts = drafts.flatMap((draft) => gate.values.map((value) => ({ ...draft, [gate.field]: value })))
  }
  // A few hundred drafts per step — cheap, and exhaustive over what the card can be answered.
  expect(drafts.length).toBeLessThan(5000)
  for (const draft of drafts) {
    for (const entry of visaStepFormFields(step, draft)) found.add(entry.field)
  }
  return found
}

const everyFormField = STEPS.flatMap((step) => [...VISA_STEP_FORM[step]])

describe('THE GATE — every payload field the chat owns is askable in the chat', () => {
  it('renders every field of every step’s VISA_DM_STEP_FIELDS set', () => {
    for (const step of STEPS) {
      const reachable = reachableFields(step)
      for (const field of VISA_DM_STEP_FIELDS[step]) {
        if (STAMPED_BY_UPLOAD.has(field)) continue
        expect(
          reachable.has(field),
          `step ${step} owns "${field}" but the chat never renders it — the applicant would ship the schema default`,
        ).toBe(true)
      }
    }
  })

  it('asks for nothing it cannot write: each step’s form stays inside its own allowlist', () => {
    for (const step of STEPS) {
      const allowed = new Set<string>(VISA_DM_STEP_FIELDS[step])
      const rendered = [...reachableFields(step)]
      expect(rendered.filter((field) => !allowed.has(field)), `step ${step}`).toEqual([])
    }
  })

  it('the one exempt field is STAMPED by the upload this step performs, never left unasked', () => {
    expect([...STAMPED_BY_UPLOAD]).toEqual(['aiDocumentProcessingConsent'])
    // Step 1 owns that field and nothing else, and the upload route is what sets it.
    expect([...VISA_DM_STEP_FIELDS[1]]).toEqual(['aiDocumentProcessingConsent'])
    expect(readFileSync(UPLOAD_ROUTE_FILE, 'utf8')).toContain('payload.aiDocumentProcessingConsent = true')
    // Steps 1 and 5 are the only ones without a form: uploads, and consent + payment.
    expect(VISA_STEP_FORM[1]).toEqual([])
    expect(VISA_STEP_FORM[5]).toEqual([])
  })

  it('names every field it asks for — no humanised camelCase on a legal form', () => {
    for (const entry of everyFormField) {
      const label = VISA_FIELD_LABEL[entry.field]
      expect(label, `"${entry.field}" has no label`).toBeTruthy()
      expect(label[0].length, `"${entry.field}" English label`).toBeGreaterThan(1)
      expect(label[1].length, `"${entry.field}" Vietnamese label`).toBeGreaterThan(1)
      // Bilingual for real: an English string copied into the Vietnamese slot is not a
      // translation. (Email is the same word in both, hence the allowance.)
      if (entry.field !== 'email') expect(label[1], `"${entry.field}" is not translated`).not.toBe(label[0])
    }
  })

  it('renders each field exactly once, across all five steps', () => {
    const fields = everyFormField.map((entry) => entry.field)
    expect(new Set(fields).size).toBe(fields.length)
  })

  it('stays inside the act route’s 40-field ceiling even with every follow-up open', () => {
    // /api/visa/cards/[messageId]/act rejects a body carrying more than 40 fields. Only
    // CHANGED fields are sent, so this is slack — but a form that could not be saved in one
    // go would be discovered by an applicant, not by us.
    for (const step of STEPS) {
      expect(VISA_STEP_FORM[step].length, `step ${step}`).toBeLessThanOrEqual(40)
    }
  })
})

describe('THE GATE — a prefilled answer is declared, never passed off as the applicant’s', () => {
  /** Fields some validation issue can require. Everything else can ship exactly as it loads. */
  const issueBacked = new Set(Object.values(VISA_ISSUE_FIELD).map((mapped) => mapped.field))

  it('marks every field no validation issue can ever demand', () => {
    for (const entry of everyFormField) {
      if (issueBacked.has(entry.field)) continue
      expect(
        entry.note,
        `"${entry.field}" is never required by the validator, so the card must say whether it is optional or prefilled`,
      ).toBeTruthy()
    }
  })

  it('declares the defaults that are a GUESS ABOUT THE APPLICANT as prefilled', () => {
    // The dangerous ones, named individually: each of these arrives from visaPayloadSchema
    // holding a real answer, so an unannounced control reads as something the applicant chose.
    // entryGate/exitGate are the sharpest — an e-Visa naming the wrong border gate is a
    // refused entry.
    for (const field of [
      'passportType', 'religion', 'entryType', 'purposeOfEntry', 'stayLengthDays',
      'entryGate', 'exitGate', 'estimatedExpenses', 'expensesCurrency', 'expensesPayer', 'paymentMethod',
    ]) {
      const entry = everyFormField.find((item) => item.field === field)
      expect(entry?.note, `"${field}" carries a schema default`).toBe('prefilled')
    }
  })

  it('never blocks on one: the notes are copy, and the validator alone decides completeness', () => {
    // Launch lenience — a defaulted field is VISIBLE, not required. Nothing in the form model
    // can gate a step: the card's issue list comes from validateVisaDmStep, and no `note`
    // value appears in it.
    for (const entry of everyFormField) {
      if (!entry.note) continue
      expect(['optional', 'prefilled']).toContain(entry.note)
    }
  })
})

describe('THE GATE — the chat asks everything the dashboard form asks', () => {
  // ⚠️ THIS IS THE TEST THAT LICENSES DELETING /dashboard/visa/apply. It reads the other
  // form's own source and fails if that form collects a field the chat cannot. Once the
  // dashboard form is gone the check has done its job and stands down — hence existsSync
  // rather than a hard read, which would otherwise turn its deletion into a red suite.
  const dashboardFields = (): string[] => {
    if (!existsSync(DASHBOARD_FORM_FILE)) return []
    const src = readFileSync(DASHBOARD_FORM_FILE, 'utf8')
    const start = src.indexOf('function PersonalStep')
    const end = src.indexOf('function ReviewGrid')
    if (start < 0 || end < 0) return []
    // Every `set('field', …)` inside PersonalStep + TripStep — the wizard's own write verb.
    return [...new Set([...src.slice(start, end).matchAll(/\bset\('([A-Za-z]+)'/g)].map((match) => match[1]))]
  }

  it('the extractor really reads the other form (guards against a vacuous pass)', () => {
    if (!existsSync(DASHBOARD_FORM_FILE)) return
    const fields = dashboardFields()
    expect(fields.length).toBeGreaterThan(40)
    // The exact fields the chat used to be blind to, so this cannot pass by reading nothing.
    for (const field of ['religion', 'passportType', 'identityNumber', 'emergencyAddress', 'employerPhone', 'entryGate']) {
      expect(fields, `the dashboard form asks for ${field}`).toContain(field)
    }
  })

  it('leaves nothing behind on the form being retired', () => {
    const asked = new Set(everyFormField.map((entry) => entry.field))
    const missing = dashboardFields().filter((field) => !asked.has(field) && !STAMPED_BY_UPLOAD.has(field))
    expect(missing, 'the dashboard form collects these and the chat does not').toEqual([])
  })
})

describe('THE GATE — the card renders that field list and nothing else', () => {
  // Static, like dm-steps.test.ts reading schema.ts: the reachability proof above is only
  // worth anything if the COMPONENT is wired to the same function. These three pins are what
  // stop a future edit from quietly re-introducing a second, issue-driven field source.
  /**
   * ⚠️ THESE PIN `view`, NOT `meta.step`, SINCE 2026-07-28 — and the distinction is the whole
   * reason the next assertion exists. The go-back rail (owner: "make so user can go back and check
   * or edit previously given answers in cards") lets the applicant open an EARLIER step, so the
   * card renders `view = reviewStep ?? meta.step`. The invariant these two guard is unchanged: the
   * form is built by visaStepFormFields and seeded from the WHOLE step form, for whichever step is
   * on screen. Only the name of that step moved.
   */
  it('builds its edit form from visaStepFormFields', () => {
    expect(source).toMatch(/const editFields = useMemo\(\(\): FormSpec\[\] => \(\s*\n\s*visaStepFormFields\(view, draft\)/)
  })

  it('seeds the draft from the WHOLE step form, hidden follow-ups included', () => {
    expect(source).toContain('for (const entry of VISA_STEP_FORM[view] ?? []) next[entry.field] = fieldValue(kase, entry.field)')
  })

  it('`view` is the server step unless an EARLIER one is being reviewed', () => {
    // Without this, the two pins above could be satisfied by a `view` that had drifted to mean
    // something else entirely — they only assert that the form follows `view`, not what `view` is.
    expect(source).toContain('const view: VisaDmStep = reviewStep ?? meta.step')
  })

  it('an edit tells the server WHICH step it is for', () => {
    // The server bounds this against the card's own step and refuses anything ahead of it, so
    // omitting it would silently write earlier-step answers against the CURRENT step's allowlist
    // and be refused as field_not_in_step.
    expect(source).toContain("onAct('edit', fields, view)")
  })

  it('reviewing an earlier step never sends an advancing verb', () => {
    // acknowledge/skip move the flow on. Offering them while looking BACK would turn "let me check
    // what I put" into "confirm and continue" — see the note at the call site.
    expect(source).toContain('if (reviewing) { setEditing(false); setReviewStep(null); return }')
  })

  it('has exactly one field-control call site', () => {
    expect(source.match(/<VisaFieldControl/g)?.length).toBe(1)
  })

  it('renders every control kind the form uses', () => {
    // The renderer plus its two keyboard tables — a kind is "rendered" if it is branched on
    // (checkpoint / yesno / sex / choice / long) or mapped to an input type (date / number /
    // email / tel / text). A form entry naming a kind nobody handles would silently fall
    // through to a plain text box, which is how a checkpoint picker becomes free text.
    const control = source.slice(source.indexOf('const INPUT_TYPE'), source.indexOf('// ── The checkout card'))
    expect(control.length).toBeGreaterThan(500)
    for (const kind of new Set(everyFormField.map((entry) => entry.control))) {
      expect(control.includes(`'${kind}'`), `VisaFieldControl does not render a "${kind}" field`).toBe(true)
    }
  })
})

describe('the trip step keeps the dashboard’s pickers and reveals', () => {
  const trip = VISA_STEP_FORM[4]

  it('picks the border gates from the official checkpoint list, not free text', () => {
    for (const field of ['entryGate', 'exitGate']) {
      expect(trip.find((entry) => entry.field === field)?.control).toBe('checkpoint')
    }
  })

  it('carries the four dates the cascade fills, so the auto-fill is visible', () => {
    const fields = trip.map((entry) => entry.field)
    for (const field of ['visaValidFrom', 'visaValidTo', 'intendedEntryDate', 'stayLengthDays']) {
      expect(fields).toContain(field)
    }
  })

  it('hides each follow-up until its answer is yes', () => {
    for (const [answer, detail] of [
      ['visitedVietnamLastYear', 'previousVisitDetails'],
      ['hasRelativesInVietnam', 'relativesInVietnamDetails'],
      ['hasChildrenOnPassport', 'childrenOnPassportDetails'],
      ['hasTravelInsurance', 'insuranceDetails'],
      ['hasOtherNationalities', 'otherNationalities'],
      ['hasOtherPassports', 'otherPassportDetails'],
      ['usedOtherPassportsForVietnam', 'usedOtherPassportDetails'],
      ['hasVietnamLawViolation', 'vietnamLawViolationDetails'],
    ] as const) {
      const entry = everyFormField.find((item) => item.field === detail)
      expect(entry?.when, detail).toBeTypeOf('function')
      expect(entry?.when?.({ [answer]: 'no' }), detail).toBe(false)
      expect(entry?.when?.({ [answer]: 'yes' }), detail).toBe(true)
    }
  })

  it('asks who is paying only when it is not the applicant', () => {
    for (const field of ['payerName', 'payerAddress', 'payerPhone', 'payerDetails']) {
      const entry = trip.find((item) => item.field === field)
      expect(entry?.when?.({ expensesPayer: 'self' }), field).toBe(false)
      expect(entry?.when?.({ expensesPayer: 'organization' }), field).toBe(true)
    }
  })

  it('drops traveller’s cheques the moment somebody else is paying', () => {
    const method = trip.find((entry) => entry.field === 'paymentMethod')
    const options = (draft: Record<string, string>) =>
      (typeof method?.options === 'function' ? method.options(draft) : method?.options ?? []).map(([value]) => value)
    expect(options({ expensesPayer: 'self' })).toContain('travellers_cheques')
    expect(options({ expensesPayer: 'organization' })).not.toContain('travellers_cheques')
  })

  it('gives the phone fields a phone keyboard, and autofill only to the applicant’s OWN', () => {
    const byField = new Map(everyFormField.map((entry) => [entry.field, entry]))
    for (const field of ['phone', 'emergencyPhone', 'employerPhone', 'localContactPhone', 'payerPhone']) {
      expect(byField.get(field)?.control, field).toBe('tel')
    }
    expect(byField.get('phone')?.autoComplete).toBe('tel')
    expect(byField.get('email')?.autoComplete).toBe('email')
    // Somebody ELSE'S number must never invite the browser to offer the applicant's own.
    for (const field of ['emergencyPhone', 'employerPhone', 'localContactPhone', 'payerPhone']) {
      expect(byField.get(field)?.autoComplete, field).toBeUndefined()
    }
  })
})

// ── The auto-fill contract ────────────────────────────────────────────────────────
//
// What is fenced below is not "some dates appear". It is:
//   1. picking a start date fills the OTHER THREE fields (the exact regression);
//   2. it fills them with EXACTLY what the shared helper says — the assertions compare
//      against visaDateDefaultsForStart / visaEndDateFor90DayWindow themselves, so a
//      re-derived, drifted copy of the window inside the card fails even if it happens to
//      look plausible;
//   3. the reverse order (entry date first) still ends up inside a legal window;
//   4. the control bounds move with the draft, so an out-of-window date cannot be typed.

const START = '2026-07-23'

describe('applyVisaDraftEdit — the start-date cascade', () => {
  it('fills visa end, intended entry date and length of stay from the start date', () => {
    const next = applyVisaDraftEdit({}, 'visaValidFrom', START)

    // ⚠️ THE REGRESSION. If any of these three stops being filled, this fails.
    expect(next.visaValidFrom).toBe(START)
    expect(next.visaValidTo).toBe(visaEndDateFor90DayWindow(START))
    expect(next.intendedEntryDate).toBe(START)
    expect(next.stayLengthDays).toBe(String(MAX_EVISA_VALIDITY_DAYS))
  })

  it('fills them from the SHARED helper, never from its own arithmetic', () => {
    const defaults = visaDateDefaultsForStart(START)
    const next = applyVisaDraftEdit({}, 'visaValidFrom', START)

    expect(next.visaValidFrom).toBe(defaults.visaValidFrom)
    expect(next.visaValidTo).toBe(defaults.visaValidTo)
    expect(next.intendedEntryDate).toBe(defaults.intendedEntryDate)
    expect(next.stayLengthDays).toBe(String(defaults.stayLengthDays))
    // Pinned independently of the helper too, so "both drifted together" is also caught:
    // 90 days INCLUSIVE of the start day, i.e. start + 89.
    expect(next.visaValidTo).toBe('2026-10-20')
  })

  it('overwrites a window that was already there, so the four dates stay one window', () => {
    const next = applyVisaDraftEdit(
      { visaValidFrom: '2026-01-01', visaValidTo: '2026-03-31', intendedEntryDate: '2026-01-05', stayLengthDays: '30' },
      'visaValidFrom',
      START,
    )
    expect(next.visaValidTo).toBe(visaEndDateFor90DayWindow(START))
    expect(next.intendedEntryDate).toBe(START)
    expect(next.stayLengthDays).toBe(String(MAX_EVISA_VALIDITY_DAYS))
  })

  it('clearing the start date clears the window it implied, and leaves the stay alone', () => {
    const next = applyVisaDraftEdit(
      { visaValidFrom: START, visaValidTo: '2026-10-20', intendedEntryDate: START, stayLengthDays: '90' },
      'visaValidFrom',
      '',
    )
    expect(next.visaValidFrom).toBe('')
    expect(next.visaValidTo).toBe('')
    expect(next.intendedEntryDate).toBe('')
    // The dashboard only rewrites the stay for a REAL date — an empty box must not silently
    // reset a number the applicant chose.
    expect(next.stayLengthDays).toBe('90')
  })

  it('refuses a malformed start date rather than inventing an end date for it', () => {
    const next = applyVisaDraftEdit({}, 'visaValidFrom', '2026-13-45')
    expect(next.visaValidTo).toBe('')
  })
})

describe('applyVisaDraftEdit — entry date first', () => {
  it('back-fills the visa window when no start date has been chosen', () => {
    const next = applyVisaDraftEdit({}, 'intendedEntryDate', START)
    expect(next.intendedEntryDate).toBe(START)
    expect(next.visaValidFrom).toBe(START)
    expect(next.visaValidTo).toBe(visaEndDateFor90DayWindow(START))
  })

  it('never overwrites a start date the applicant already chose', () => {
    const next = applyVisaDraftEdit(
      { visaValidFrom: '2026-08-01', visaValidTo: '2026-10-29' },
      'intendedEntryDate',
      '2026-08-10',
    )
    expect(next.visaValidFrom).toBe('2026-08-01')
    expect(next.visaValidTo).toBe('2026-10-29')
    expect(next.intendedEntryDate).toBe('2026-08-10')
  })
})

describe('applyVisaDraftEdit — the rest of the form', () => {
  it('clamps the length of stay to the schema range and keeps an empty box empty', () => {
    expect(applyVisaDraftEdit({}, 'stayLengthDays', '120').stayLengthDays).toBe('90')
    expect(applyVisaDraftEdit({}, 'stayLengthDays', '-4').stayLengthDays).toBe('0')
    expect(applyVisaDraftEdit({}, 'stayLengthDays', '').stayLengthDays).toBe('')
    expect(applyVisaDraftEdit({ stayLengthDays: '30' }, 'stayLengthDays', 'abc').stayLengthDays).toBe('30')
  })

  it('moves the payment method off traveller’s cheques when somebody else is paying', () => {
    const next = applyVisaDraftEdit({ paymentMethod: 'travellers_cheques' }, 'expensesPayer', 'organization')
    expect(next.expensesPayer).toBe('organization')
    expect(next.paymentMethod).toBe('credit_card')
    // …and leaves it alone while the applicant is paying their own way.
    expect(applyVisaDraftEdit({ paymentMethod: 'travellers_cheques' }, 'expensesPayer', 'self').paymentMethod)
      .toBe('travellers_cheques')
  })

  it('leaves an ordinary field an ordinary write', () => {
    const next = applyVisaDraftEdit({ visaValidFrom: START }, 'temporaryProvince', 'Da Nang')
    expect(next.temporaryProvince).toBe('Da Nang')
    expect(next.visaValidFrom).toBe(START)
  })

  it('never mutates the draft it was handed', () => {
    const draft = { visaValidFrom: '' }
    applyVisaDraftEdit(draft, 'visaValidFrom', START)
    expect(draft).toEqual({ visaValidFrom: '' })
  })
})

describe('visaDateBounds — an illegal date cannot be typed', () => {
  it('bounds the visa end date by the start date and the 90-day ceiling', () => {
    expect(visaDateBounds('visaValidTo', { visaValidFrom: START })).toEqual({
      min: START,
      max: visaEndDateFor90DayWindow(START),
    })
  })

  it('bounds the intended entry date by the window itself', () => {
    expect(visaDateBounds('intendedEntryDate', { visaValidFrom: START, visaValidTo: '2026-10-20' })).toEqual({
      min: START,
      max: '2026-10-20',
    })
  })

  it('keeps the passport pair in order — expiry after issue, the validator’s own rule', () => {
    expect(visaDateBounds('passportExpiryDate', { passportIssueDate: '2020-01-01' })).toEqual({ min: '2020-01-01' })
    expect(visaDateBounds('passportIssueDate', { passportExpiryDate: '2030-01-01' })).toEqual({ max: '2030-01-01' })
  })

  it('carries no bounds before a start date exists, and none for other fields', () => {
    expect(visaDateBounds('visaValidTo', {})).toEqual({ min: undefined, max: undefined })
    expect(visaDateBounds('dateOfBirth', { visaValidFrom: START })).toEqual({})
  })
})

describe('visaSubmitValue', () => {
  it('sends an emptied number box as 0 — the value the payload schema spells', () => {
    expect(visaSubmitValue('stayLengthDays', '')).toBe('0')
    expect(visaSubmitValue('estimatedExpenses', '  ')).toBe('0')
  })

  it('passes everything else through untouched', () => {
    expect(visaSubmitValue('stayLengthDays', '45')).toBe('45')
    expect(visaSubmitValue('temporaryProvince', '')).toBe('')
  })
})
