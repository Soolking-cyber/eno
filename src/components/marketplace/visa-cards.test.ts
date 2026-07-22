import { describe, expect, it, vi } from 'vitest'

// visa-cards.tsx is a client component; useLanguage is its only hook and nothing under
// test calls it. Stubbed so the module can be imported outside a React tree.
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en }),
}))

import { VISA_DM_STEP_FIELDS } from '@/lib/visa/dm-steps'
import { MAX_EVISA_VALIDITY_DAYS, visaDateDefaultsForStart, visaEndDateFor90DayWindow } from '@/lib/visa/schema'
import { applyVisaDraftEdit, visaDateBounds, visaSubmitValue, VISA_TRIP_FORM } from './visa-cards'

/**
 * THE AUTO-FILL CONTRACT OF THE IN-CHAT TRIP STEP.
 *
 * The bug this file exists for: on 2026-07-21 the owner picked a visa start date in the
 * chat card and "Visa ends" and "Intended entry date" stayed EMPTY, while the dashboard's
 * TripStep had been filling both (and the length of stay) from the same start date since
 * the wizard shipped. Two forms writing the same encrypted payload disagreed about what a
 * start date implies — and a disagreement about the 90-day window is a rejected visa, not
 * a cosmetic difference.
 *
 * So what is fenced here is not "some dates appear". It is:
 *   1. picking a start date fills the OTHER THREE fields (the exact regression);
 *   2. it fills them with EXACTLY what the shared helper says — the assertions compare
 *      against visaDateDefaultsForStart / visaEndDateFor90DayWindow themselves, so a
 *      re-derived, drifted copy of the window inside the card fails even if it happens to
 *      look plausible;
 *   3. the reverse order (entry date first) still ends up inside a legal window;
 *   4. the control bounds move with the draft, so an out-of-window date cannot be typed;
 *   5. the trip form can only ever write fields step 4 owns.
 */

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

describe('applyVisaDraftEdit — the rest of the trip page', () => {
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

describe('VISA_TRIP_FORM — the trip page the chat card renders', () => {
  const fields = VISA_TRIP_FORM.map((entry) => entry.field)

  it('can only write fields step 4 owns', () => {
    const allowed = new Set<string>(VISA_DM_STEP_FIELDS[4])
    expect(fields.filter((field) => !allowed.has(field))).toEqual([])
  })

  it('renders each field exactly once', () => {
    expect(new Set(fields).size).toBe(fields.length)
  })

  it('stays inside the act route’s 40-field ceiling even with every follow-up open', () => {
    // /api/visa/cards/[messageId]/act rejects a body carrying more than 40 fields. Only
    // CHANGED fields are sent, so this is slack — but a form that could not be saved in one
    // go would be discovered by an applicant, not by us.
    expect(fields.length).toBeLessThanOrEqual(40)
  })

  it('carries the four dates the cascade fills, so the auto-fill is visible', () => {
    for (const field of ['visaValidFrom', 'visaValidTo', 'intendedEntryDate', 'stayLengthDays']) {
      expect(fields).toContain(field)
    }
  })

  it('picks the border gates from the official checkpoint list, not free text', () => {
    for (const field of ['entryGate', 'exitGate']) {
      expect(VISA_TRIP_FORM.find((entry) => entry.field === field)?.control).toBe('checkpoint')
    }
  })

  it('hides each follow-up until its answer is yes', () => {
    for (const [answer, detail] of [
      ['visitedVietnamLastYear', 'previousVisitDetails'],
      ['hasRelativesInVietnam', 'relativesInVietnamDetails'],
      ['hasChildrenOnPassport', 'childrenOnPassportDetails'],
      ['hasTravelInsurance', 'insuranceDetails'],
    ] as const) {
      const entry = VISA_TRIP_FORM.find((item) => item.field === detail)
      expect(entry?.when).toBeTypeOf('function')
      expect(entry?.when?.({ [answer]: 'no' })).toBe(false)
      expect(entry?.when?.({ [answer]: 'yes' })).toBe(true)
    }
  })

  it('asks who is paying only when it is not the applicant', () => {
    for (const field of ['payerName', 'payerAddress', 'payerPhone']) {
      const entry = VISA_TRIP_FORM.find((item) => item.field === field)
      expect(entry?.when?.({ expensesPayer: 'self' })).toBe(false)
      expect(entry?.when?.({ expensesPayer: 'organization' })).toBe(true)
    }
  })
})
