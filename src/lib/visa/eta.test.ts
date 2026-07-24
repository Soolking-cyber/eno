import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  expectedVisaReadyAt,
  submissionGate,
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

// ── submissionGate — the working-day-aware "can I apply right now?" ────────────────
//
// Same TZ discipline as above: `now` is an HCM wall clock converted to a UTC instant by
// hand, and every expected reopening is an absolute …Z, so nothing moves under a
// different process TZ. The owner's rule (2026-07-24): only the HOUR tiers can close;
// standard + day tiers are always submittable; a closed hour tier reopens on the NEXT
// WORKING day (never a weekend or a public holiday) — the exact defect the plan review
// caught: a Friday-evening close must point at Monday, not Saturday.
//
// Reference dates: 2026-07-24 Fri, -25 Sat, -26 Sun, -27 Mon (all ordinary working/rest
// days). Holidays used: 2026-01-01 Thu (New Year) → 2026-01-02 Fri working; Tet
// 2026-02-14..22 → first working day 2026-02-23 Mon.
const hcm = (isoLocal: string, offsetHours = 7) =>
  new Date(new Date(`${isoLocal}Z`).getTime() - offsetHours * 3_600_000)

describe('submissionGate — fails closed', () => {
  it('refuses an unknown code (a bad attributes.speed is never sellable)', () => {
    for (const bad of ['5H', '1h', 'NORMAL', 'constructor', '']) {
      expect(submissionGate(bad as VisaSpeedCode, hcm('2026-07-24T10:00'))).toEqual({
        acceptingNow: false, nextCutoffIso: null, nextOpensIso: null,
      })
    }
  })
  it('refuses an invalid instant', () => {
    expect(submissionGate('normal', new Date('nonsense'))).toEqual({
      acceptingNow: false, nextCutoffIso: null, nextOpensIso: null,
    })
  })
})

describe('submissionGate — standard + day tiers are ALWAYS open (apply any time, any day)', () => {
  // The heart of the owner's ask: none of these may EVER close, whatever the clock says.
  const instants = [
    '2026-07-24T09:00', // Fri, mid-morning
    '2026-07-24T23:30', // Fri, late night
    '2026-07-25T10:00', // Sat
    '2026-07-26T10:00', // Sun
    '2026-01-01T10:00', // New Year holiday
    '2026-02-17T10:00', // Tet holiday
  ]
  for (const code of ['normal', '1D', '2D', '3D'] as const) {
    it(`${code} accepts at every instant, with nothing to count down to`, () => {
      for (const local of instants) {
        expect(submissionGate(code, hcm(local))).toEqual({
          acceptingNow: true, nextCutoffIso: null, nextOpensIso: null,
        })
      }
    })
  }
})

describe('submissionGate — hour tiers gate on a working day AND a cutoff window', () => {
  it('4H open before the first cutoff on a working day == the raw time-of-day window', () => {
    // Fri 08:29:59.999 — the 08:30 batch is still catchable.
    expect(submissionGate('4H', hcm('2026-07-24T08:29:59.999'))).toEqual({
      acceptingNow: true, nextCutoffIso: '2026-07-24T01:30:00.000Z', nextOpensIso: null,
    })
    // Between cutoffs (08:30..14:30): still open, the 14:30 batch is next.
    expect(submissionGate('4H', hcm('2026-07-24T12:00'))).toEqual({
      acceptingNow: true, nextCutoffIso: '2026-07-24T07:30:00.000Z', nextOpensIso: null,
    })
  })

  it('4H past the last cutoff on a FRIDAY reopens MONDAY, not Saturday (the review defect)', () => {
    // Fri 15:00, past 14:30 → closed. Next working day is Mon 2026-07-27; first cutoff 08:30.
    expect(submissionGate('4H', hcm('2026-07-24T15:00'))).toEqual({
      acceptingNow: false,
      nextCutoffIso: '2026-07-27T01:30:00.000Z',        // Mon 08:30 HCM
      nextOpensIso: '2026-07-26T17:00:00.000Z',         // Mon 00:00 HCM
    })
  })

  it('4H is CLOSED all day Saturday and Sunday even before a cutoff time', () => {
    // Sat 10:00 is before the 14:30 cutoff by the clock, but the desk is shut.
    for (const local of ['2026-07-25T10:00', '2026-07-25T08:00', '2026-07-26T09:00']) {
      expect(submissionGate('4H', hcm(local))).toEqual({
        acceptingNow: false,
        nextCutoffIso: '2026-07-27T01:30:00.000Z',      // reopens Mon 08:30
        nextOpensIso: '2026-07-26T17:00:00.000Z',
      })
    }
  })

  it('1H is CLOSED on a public holiday, reopening the next working day', () => {
    // Thu 2026-01-01 (New Year) → next working day Fri 2026-01-02; 1H first cutoff 10:00.
    expect(submissionGate('1H', hcm('2026-01-01T10:30'))).toEqual({
      acceptingNow: false,
      nextCutoffIso: '2026-01-02T03:00:00.000Z',        // Fri 10:00 HCM
      nextOpensIso: '2026-01-01T17:00:00.000Z',         // Fri 00:00 HCM
    })
  })

  it('2H stays closed through the whole Tet break, reopening the first working day after', () => {
    // Tet 2026-02-14..22 all non-working; first working day is Mon 2026-02-23. 2H cutoff 10:00.
    expect(submissionGate('2H', hcm('2026-02-17T09:00'))).toEqual({
      acceptingNow: false,
      nextCutoffIso: '2026-02-23T03:00:00.000Z',        // Mon 2026-02-23 10:00 HCM
      nextOpensIso: '2026-02-22T17:00:00.000Z',
    })
  })

  it('fails CLOSED for an hour tier outside the holiday table coverage (no false working-day)', () => {
    // 2029 is past VIETNAM_HOLIDAYS_COVERED_THROUGH (2028). Even on what LOOKS like a working
    // weekday, we cannot verify the calendar, so an hour tier must NOT be offered — mirroring
    // expectedVisaReadyAt, which returns null past coverage (a same-day visa with no honest
    // delivery date can't be sold). Day/standard tiers stay open (they don't need the calendar).
    const uncovered = hcm(`${VIETNAM_HOLIDAYS_COVERED_THROUGH + 1}-06-06T09:00`) // 2029-06-06, a Wednesday
    expect(submissionGate('1H', uncovered)).toEqual({ acceptingNow: false, nextCutoffIso: null, nextOpensIso: null })
    expect(submissionGate('normal', uncovered).acceptingNow).toBe(true)
    expect(submissionGate('2D', uncovered).acceptingNow).toBe(true)
    // A caller who OWNS coverage (explicit holidays) opts out of the guard, like the ETA.
    expect(submissionGate('1H', uncovered, []).acceptingNow).toBe(true)
  })

  it('honours a caller-supplied holiday set (turns an ordinary working day into a closed one)', () => {
    // Mon 2026-07-27 is normally a working day → 4H open at 09:00.
    expect(submissionGate('4H', hcm('2026-07-27T09:00')).acceptingNow).toBe(true)
    // Declare it a holiday → closed, reopening Tue 2026-07-28.
    const gated = submissionGate('4H', hcm('2026-07-27T09:00'), ['2026-07-27'])
    expect(gated.acceptingNow).toBe(false)
    expect(gated.nextCutoffIso).toBe('2026-07-28T01:30:00.000Z') // Tue 08:30 HCM
  })
})
