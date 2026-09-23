import { describe, expect, it } from 'vitest'
import { defaultOverturnPick, overturnSubmission } from './enforcement-client'

/**
 * The overturn dialog's starting selection (review, 2026-09-24). An overturn tells every chosen report's
 * reporter "no violation", so the dialog must never start with a report ticked that the admin did not
 * look at: the action's own trigger report when it still stands, the only charge when there is exactly
 * one — and otherwise nothing, so the admin chooses.
 */
const c = (reportId: string | null, stage: 'held' | 'released' = 'held') => ({
  reportId, stage, confirmedAt: '2026-09-01T00:00:00.000Z', listingId: null, reason: null, reportStatus: 'confirmed',
})

describe('defaultOverturnPick', () => {
  it('the trigger report, when it is a standing charge', () => {
    expect(defaultOverturnPick([c('r1'), c('r2')], 'r2')).toEqual(['r2'])
  })

  it('⛔ two charges and no (standing) trigger → nothing ticked', () => {
    expect(defaultOverturnPick([c('r1'), c('r2')], null)).toEqual([])
    expect(defaultOverturnPick([c('r1'), c('r2')], 'gone')).toEqual([])
  })

  it('exactly one charge → that one', () => {
    expect(defaultOverturnPick([c('r1', 'released')], null)).toEqual(['r1'])
  })

  it('a legacy charge (no report) is never ticked, and does not make another the "only" one', () => {
    expect(defaultOverturnPick([c(null)], null)).toEqual([])
    expect(defaultOverturnPick([c(null), c('r1')], null)).toEqual([])
  })
})

describe('overturnSubmission — what the dialog may send (review, 2026-09-24)', () => {
  it('nothing while the charges are still loading', () => {
    expect(overturnSubmission(null, new Set(['r1']))).toEqual({ ok: false })
  })

  it('with charges standing: only once something is ticked, and exactly the ticks', () => {
    expect(overturnSubmission([c('r1'), c('r2')], new Set())).toEqual({ ok: false })
    expect(overturnSubmission([c('r1'), c('r2')], new Set(['r2']))).toEqual({ ok: true, reportIds: ['r2'] })
  })

  it('⛔ with NO charge standing (a stale row) it can still be sent — without a selection, so the server ends the row', () => {
    expect(overturnSubmission([], new Set())).toEqual({ ok: true })
  })
})
