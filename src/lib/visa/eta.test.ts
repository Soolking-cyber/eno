import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  expectedVisaReadyAt,
  VIETNAM_HOLIDAYS_COVERED_FROM,
  VIETNAM_HOLIDAYS_COVERED_THROUGH,
  VIETNAM_PUBLIC_HOLIDAYS,
} from './eta'
import { VISA_SPEED_CODES, VISA_SPEED_SPECS, type VisaSpeedCode } from './speed'

// ── The delivery promise: working-time math a traveller books a flight against ─────
//
// Fixtures are UTC ISO instants (Asia/Ho_Chi_Minh = UTC+7, no DST since 1975), so every
// expectation is process-TZ-independent by construction. The SOURCE test below is what
// makes that a guarantee rather than a habit: the handoff demanded the suite hold under
// TZ=UTC and TZ=America/Los_Angeles, and the only way a pure Intl-explicit module can
// fail that is by someone introducing a local-TZ API — which the pin refuses at review
// time instead of at 3am in a different zone.
//
// THE MODEL UNDER TEST (external review): the clock is the PROVIDER'S — a payment joins
// the first BATCH (cutoff) it strictly beat; hour tiers run from that batch instant and
// spill across the 17:00 close into the next working morning; day tiers count the batch
// day as day 1 and resolve to 17:00 of the Nth working day.

const at = (iso: string) => new Date(iso)
const ready = (startedAt: string, speed: VisaSpeedCode, holidays?: readonly string[]) =>
  expectedVisaReadyAt({ startedAt: at(startedAt), speed, ...(holidays ? { holidays } : {}) })?.toISOString() ?? null

describe('process-TZ independence is pinned on the source', () => {
  it('eta.ts never touches a local-time API', () => {
    const source = readFileSync(new URL('./eta.ts', import.meta.url), 'utf8')
    // Local-TZ readers (the getUTC* family is fine — it is calendar arithmetic).
    for (const forbidden of [
      /\.getHours\(/, /\.getMinutes\(/, /\.getDay\(/, /\.getDate\(/, /\.getMonth\(/, /\.getFullYear\(/,
      /toLocaleString\(/, /toLocaleDateString\(/, /toLocaleTimeString\(/,
      // The multi-argument Date constructor builds a LOCAL instant.
      /new Date\(\s*\d{4}\s*,/,
      /process\.env\.TZ/,
    ]) {
      expect(source).not.toMatch(forbidden)
    }
  })

  it('every tier carries exactly one structured turnaround', () => {
    for (const code of VISA_SPEED_CODES) {
      const spec = VISA_SPEED_SPECS[code]
      expect(!!spec.turnaroundBusinessHours !== !!spec.turnaroundBusinessDays, code).toBe(true)
    }
  })
})

describe('hour tiers run from the BATCH the payment made', () => {
  it('paid before a cutoff → the cutoff + N hours, never payment + N (Fri 09:30, 1H → 11:00 ICT)', () => {
    // 2026-07-24 is a Friday. 09:30 ICT = 02:30Z; the 10:00 batch → 11:00 ICT = 04:00Z.
    expect(ready('2026-07-24T02:30:00Z', '1H')).toBe('2026-07-24T04:00:00.000Z')
  })

  it('paid between batches joins the LATER one (Mon 10:30, 1H → 16:00 batch → 17:00)', () => {
    expect(ready('2026-07-27T03:30:00Z', '1H')).toBe('2026-07-27T10:00:00.000Z')
  })

  it("paid past the day's LAST cutoff belongs to the next working day (Fri 16:45, 1H → Mon 11:00)", () => {
    expect(ready('2026-07-24T09:45:00Z', '1H')).toBe('2026-07-27T04:00:00.000Z')
  })

  it('cutoffs are STRICT — at 16:00:00 sharp the 16:00 batch is gone', () => {
    expect(ready('2026-07-24T09:00:00Z', '1H')).toBe('2026-07-27T04:00:00.000Z')
  })

  it('the end-of-day remainder SPILLS to the next working morning (Fri 14:00, 4H → Mon 09:30)', () => {
    // Batch 14:30 → 2.5h before the 17:00 close, the other 1.5h from Monday 08:00.
    expect(ready('2026-07-24T07:00:00Z', '4H')).toBe('2026-07-27T02:30:00.000Z')
  })

  it('a weekend payment waits for Monday’s first batch (Sat, 1H → Mon 11:00)', () => {
    expect(ready('2026-07-25T03:00:00Z', '1H')).toBe('2026-07-27T04:00:00.000Z')
  })

  it('a before-opening payment still waits for its batch (Mon 07:00, 2H → 12:00 ICT)', () => {
    expect(ready('2026-07-27T00:00:00Z', '2H')).toBe('2026-07-27T05:00:00.000Z')
  })
})

describe('day tiers count the batch day as day 1, ready at end of business', () => {
  it('2D paid before the 15:30 cutoff on Thursday = Friday 17:00 ICT', () => {
    // 2026-07-23 is a Thursday; 17:00 ICT = 10:00Z.
    expect(ready('2026-07-23T03:00:00Z', '2D')).toBe('2026-07-24T10:00:00.000Z')
  })

  it('2D paid AT 15:30 sharp missed the batch — day 1 is Friday, ready Monday (external review)', () => {
    expect(ready('2026-07-23T08:30:00Z', '2D')).toBe('2026-07-27T10:00:00.000Z')
  })

  it('1D past its 13:00 cutoff rolls a full day (Thu 14:00 → Friday 17:00)', () => {
    expect(ready('2026-07-23T07:00:00Z', '1D')).toBe('2026-07-24T10:00:00.000Z')
  })

  it('1D inside its window = the same day 17:00', () => {
    expect(ready('2026-07-23T03:00:00Z', '1D')).toBe('2026-07-23T10:00:00.000Z')
  })

  it('3D from a Thursday = the weekend is skipped → Monday 17:00', () => {
    expect(ready('2026-07-23T03:00:00Z', '3D')).toBe('2026-07-27T10:00:00.000Z')
  })

  it('normal (5 working days) from Monday = Friday 17:00 — not the following week', () => {
    // External review: the day-1 convention makes Mon..Fri exactly five working days.
    expect(ready('2026-07-27T02:00:00Z', 'normal')).toBe('2026-07-31T10:00:00.000Z')
  })
})

describe('Vietnamese public holidays are non-working (verified table)', () => {
  it('a payment during Tet starts at the first working day after the whole span', () => {
    // 2026-02-14..22 is the announced Tet break; Feb 23 is the Monday after.
    expect(ready('2026-02-14T03:00:00Z', '1D')).toBe('2026-02-23T10:00:00.000Z')
  })

  it('a 2D case straddling Tet resumes after the span (Fri 13th → Mon 23rd EOD)', () => {
    expect(ready('2026-02-13T03:00:00Z', '2D')).toBe('2026-02-23T10:00:00.000Z')
  })

  it('the FIVE-day National Day break (Aug 29–Sep 2, bridge day included) is skipped whole', () => {
    // 2D paid Friday Aug 28 before cutoff: day 1 = Aug 28, day 2 = Thursday Sep 3.
    expect(ready('2026-08-28T03:00:00Z', '2D')).toBe('2026-09-03T10:00:00.000Z')
    expect(ready('2026-09-02T03:00:00Z', '1D')).toBe('2026-09-03T10:00:00.000Z')
  })

  it('Vietnam Culture Day (the NEW 12th holiday, Nov 24) is non-working from 2026', () => {
    expect(ready('2026-11-24T03:00:00Z', '1D')).toBe('2026-11-25T10:00:00.000Z')
  })

  it('the holidays override is honoured (and owns its own coverage)', () => {
    // The same National-Day instant with an explicit empty table: an ordinary Wednesday.
    expect(ready('2026-09-02T03:00:00Z', '1D', [])).toBe('2026-09-02T10:00:00.000Z')
    // Beyond the default table's coverage, an explicit table re-enables the promise.
    expect(ready('2029-03-05T03:00:00Z', '1D', [])).toBe('2029-03-05T10:00:00.000Z')
  })
})

describe('fails closed — no promise beats a wrong one', () => {
  it('refuses computations past the holiday table (silent weekend-only math would over-promise through Tet)', () => {
    expect(VIETNAM_HOLIDAYS_COVERED_THROUGH).toBe(2028)
    expect(ready('2029-03-05T03:00:00Z', '1D')).toBeNull()
    // A late-December case whose roll crosses into the uncovered year refuses too:
    // 2028-12-29 is a Friday; 16:45 is past the 1H tier's last cutoff.
    expect(ready('2028-12-29T09:45:00Z', '1H')).toBeNull()
    // …while one that stays inside 2028 still answers (09:30 → 10:00 batch → 11:00).
    expect(ready('2028-12-29T02:30:00Z', '1H')).toBe('2028-12-29T04:00:00.000Z')
  })

  it('refuses anchors BEFORE the table too (external review: pre-coverage years have unlisted holidays)', () => {
    expect(VIETNAM_HOLIDAYS_COVERED_FROM).toBe(2026)
    expect(ready('2025-06-10T03:00:00Z', '1D')).toBeNull()
  })

  it('refuses a date-time STRING without an explicit offset (it would parse in the process TZ — external review)', () => {
    expect(expectedVisaReadyAt({ startedAt: '2026-07-24T10:00:00', speed: '1H' })).toBeNull()
    expect(expectedVisaReadyAt({ startedAt: '2026-07-24T10:00:00+07:00', speed: '1D' })).not.toBeNull()
  })

  it('refuses an unknown code and an invalid date', () => {
    expect(expectedVisaReadyAt({ startedAt: new Date('nonsense'), speed: '1H' })).toBeNull()
    expect(expectedVisaReadyAt({ startedAt: new Date(), speed: 'warp' as VisaSpeedCode })).toBeNull()
  })

  it('refuses an overflow civil date that JavaScript would quietly normalize (external review)', () => {
    // '2026-02-30' parses as March 2 — a promise minted off a day that never existed.
    expect(expectedVisaReadyAt({ startedAt: '2026-02-30T10:00:00+07:00', speed: '1D' })).toBeNull()
    expect(expectedVisaReadyAt({ startedAt: '2026-04-31T10:00:00+07:00', speed: '1D' })).toBeNull()
  })

  it('the holiday table is well-formed and inside its declared coverage', () => {
    for (const day of VIETNAM_PUBLIC_HOLIDAYS) {
      expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      const year = Number(day.slice(0, 4))
      expect(year).toBeGreaterThanOrEqual(VIETNAM_HOLIDAYS_COVERED_FROM)
      expect(year).toBeLessThanOrEqual(VIETNAM_HOLIDAYS_COVERED_THROUGH)
    }
  })
})
