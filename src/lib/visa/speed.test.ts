import { describe, expect, it } from 'vitest'
import {
  parseVisaEntryType,
  parseVisaSpeedCode,
  submissionWindow,
  VISA_ENTRY_TYPES,
  VISA_SPEED_CODES,
  VISA_SPEED_SPECS,
  type VisaSpeedCode,
} from './speed'

// ⚠️ EVERY expectation in this file is an ABSOLUTE INSTANT (…Z). That is the point: the
// suite is run under at least TZ=UTC and TZ=America/Los_Angeles, and not one number below
// may move between them. Asia/Ho_Chi_Minh is UTC+7 with no DST since 1975, so a 08:30
// Vietnamese cutoff is 01:30Z — in January and in July alike, from Cloud Run or a laptop.

/** Local Ho-Chi-Minh-City wall clock → the UTC instant, written out by hand so the test
 *  cannot inherit a bug from the module it is testing. */
const hcm = (isoLocal: string, offsetHours = 7) => {
  const at = new Date(`${isoLocal}Z`)
  return new Date(at.getTime() - offsetHours * 3_600_000)
}

describe('the speed tier table', () => {
  it('lists the owner grid in order, with no price anywhere in it', () => {
    expect(VISA_SPEED_CODES).toEqual(['1H', '2H', '4H', '1D', '2D', '3D', 'normal'])
    expect(VISA_ENTRY_TYPES).toEqual(['single', 'multiple'])
    for (const code of VISA_SPEED_CODES) {
      const spec = VISA_SPEED_SPECS[code]
      expect(spec.code).toBe(code)
      expect(spec.label.length).toBeGreaterThan(0)
      expect(spec.labelVi.length).toBeGreaterThan(0)
      expect(spec.turnaround.length).toBeGreaterThan(0)
      expect(spec.turnaroundVi.length).toBeGreaterThan(0)
      // The tier carries operational facts ONLY — a price on it would be a second source
      // of truth beside Listing.price.
      // Exactly ONE structured turnaround (Phase 4's ETA input) — still an operational
      // fact, still no price. The key pin keeps refusing any money-shaped field.
      const structured = spec.turnaroundBusinessHours !== undefined ? 'turnaroundBusinessHours' : 'turnaroundBusinessDays'
      expect(spec.turnaroundBusinessHours !== undefined && spec.turnaroundBusinessDays !== undefined).toBe(false)
      expect(Object.keys(spec).sort()).toEqual(['code', 'cutoffs', 'label', 'labelVi', structured, 'turnaround', 'turnaroundVi'].sort())
    }
  })

  it('carries the submission cutoffs from the provider grid, ascending', () => {
    expect(VISA_SPEED_SPECS['1H'].cutoffs).toEqual(['10:00', '16:00'])
    expect(VISA_SPEED_SPECS['2H'].cutoffs).toEqual(['10:00', '15:00'])
    expect(VISA_SPEED_SPECS['4H'].cutoffs).toEqual(['08:30', '14:30'])
    expect(VISA_SPEED_SPECS['1D'].cutoffs).toEqual(['09:00', '13:00'])
    expect(VISA_SPEED_SPECS['2D'].cutoffs).toEqual(['15:30'])
    expect(VISA_SPEED_SPECS['3D'].cutoffs).toEqual(['15:30'])
    expect(VISA_SPEED_SPECS.normal.cutoffs).toEqual([])
    for (const code of VISA_SPEED_CODES) {
      const cutoffs = VISA_SPEED_SPECS[code].cutoffs
      expect(cutoffs).toEqual([...cutoffs].sort())
      for (const cutoff of cutoffs) expect(cutoff).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/)
    }
  })
})

describe('submissionWindow — Asia/Ho_Chi_Minh boundaries', () => {
  it('accepts up to, but not at, a cutoff minute', () => {
    // 08:29:59.999 local — the 08:30 batch is still catchable.
    expect(submissionWindow('4H', hcm('2026-07-21T08:29:59.999'))).toEqual({
      acceptingNow: true,
      nextCutoffIso: '2026-07-21T01:30:00.000Z',
      nextOpensIso: null,
    })
    // EXACTLY 08:30 local — that batch is gone; the day's later cutoff is next.
    expect(submissionWindow('4H', hcm('2026-07-21T08:30:00.000'))).toEqual({
      acceptingNow: true,
      nextCutoffIso: '2026-07-21T07:30:00.000Z',
      nextOpensIso: null,
    })
    // One millisecond before the last cutoff — still open.
    expect(submissionWindow('4H', hcm('2026-07-21T14:29:59.999'))).toEqual({
      acceptingNow: true,
      nextCutoffIso: '2026-07-21T07:30:00.000Z',
      nextOpensIso: null,
    })
  })

  it('rolls to the next day once the last cutoff has passed', () => {
    // EXACTLY 14:30 local — the day is done.
    const atLastCutoff = submissionWindow('4H', hcm('2026-07-21T14:30:00.000'))
    expect(atLastCutoff).toEqual({
      acceptingNow: false,
      nextCutoffIso: '2026-07-22T01:30:00.000Z', // tomorrow 08:30 local
      nextOpensIso: '2026-07-21T17:00:00.000Z', // tomorrow 00:00 local
    })
    // …and it stays that way right up to local midnight.
    expect(submissionWindow('4H', hcm('2026-07-21T23:59:59.999'))).toEqual(atLastCutoff)
    // Local midnight itself reopens the desk.
    expect(submissionWindow('4H', hcm('2026-07-22T00:00:00.000'))).toEqual({
      acceptingNow: true,
      nextCutoffIso: '2026-07-22T01:30:00.000Z',
      nextOpensIso: null,
    })
  })

  it('rolls across a month and a year boundary', () => {
    // 31 July → 1 August (Date.UTC normalises the day overflow).
    expect(submissionWindow('4H', hcm('2026-07-31T23:00:00.000'))).toEqual({
      acceptingNow: false,
      nextCutoffIso: '2026-08-01T01:30:00.000Z',
      nextOpensIso: '2026-07-31T17:00:00.000Z',
    })
    // 31 December → 1 January.
    expect(submissionWindow('4H', hcm('2026-12-31T23:30:00.000'))).toEqual({
      acceptingNow: false,
      nextCutoffIso: '2027-01-01T01:30:00.000Z',
      nextOpensIso: '2026-12-31T17:00:00.000Z',
    })
  })

  it('is the same in January as in July — Vietnam has no DST', () => {
    expect(submissionWindow('4H', hcm('2026-01-15T08:29:00.000'))).toEqual({
      acceptingNow: true,
      nextCutoffIso: '2026-01-15T01:30:00.000Z',
      nextOpensIso: null,
    })
    expect(submissionWindow('4H', hcm('2026-01-15T14:30:00.000'))).toEqual({
      acceptingNow: false,
      nextCutoffIso: '2026-01-16T01:30:00.000Z',
      nextOpensIso: '2026-01-15T17:00:00.000Z',
    })
  })

  it('handles the single-cutoff tiers', () => {
    // 2D and 3D share one 15:30 cutoff (= 08:30Z).
    for (const code of ['2D', '3D'] as const) {
      expect(submissionWindow(code, hcm('2026-07-21T15:29:59.999'))).toEqual({
        acceptingNow: true,
        nextCutoffIso: '2026-07-21T08:30:00.000Z',
        nextOpensIso: null,
      })
      expect(submissionWindow(code, hcm('2026-07-21T15:30:00.000'))).toEqual({
        acceptingNow: false,
        nextCutoffIso: '2026-07-22T08:30:00.000Z',
        nextOpensIso: '2026-07-21T17:00:00.000Z',
      })
    }
  })

  it('handles the other multi-cutoff tiers', () => {
    // 1H: 10:00 (03:00Z) and 16:00 (09:00Z).
    expect(submissionWindow('1H', hcm('2026-07-21T09:59:00.000')).nextCutoffIso).toBe('2026-07-21T03:00:00.000Z')
    expect(submissionWindow('1H', hcm('2026-07-21T10:00:00.000')).nextCutoffIso).toBe('2026-07-21T09:00:00.000Z')
    expect(submissionWindow('1H', hcm('2026-07-21T16:00:00.000')).acceptingNow).toBe(false)
    // 2H: 10:00 and 15:00 (08:00Z).
    expect(submissionWindow('2H', hcm('2026-07-21T10:00:00.000')).nextCutoffIso).toBe('2026-07-21T08:00:00.000Z')
    // 1D: 09:00 (02:00Z) and 13:00 (06:00Z).
    expect(submissionWindow('1D', hcm('2026-07-21T08:59:00.000')).nextCutoffIso).toBe('2026-07-21T02:00:00.000Z')
    expect(submissionWindow('1D', hcm('2026-07-21T09:00:00.000')).nextCutoffIso).toBe('2026-07-21T06:00:00.000Z')
    expect(submissionWindow('1D', hcm('2026-07-21T13:00:00.000')).acceptingNow).toBe(false)
  })

  it('never schedules a cutoff in the past', () => {
    // A full sweep of the day, every 7 minutes, for every cutoff tier.
    for (const code of VISA_SPEED_CODES) {
      if (!VISA_SPEED_SPECS[code].cutoffs.length) continue
      for (let minute = 0; minute < 24 * 60; minute += 7) {
        const now = new Date(hcm('2026-07-21T00:00:00.000').getTime() + minute * 60_000)
        const window = submissionWindow(code, now)
        expect(window.nextCutoffIso).not.toBeNull()
        expect(new Date(window.nextCutoffIso!).getTime()).toBeGreaterThan(now.getTime())
        if (window.acceptingNow) {
          expect(window.nextOpensIso).toBeNull()
        } else {
          expect(new Date(window.nextOpensIso!).getTime()).toBeGreaterThan(now.getTime())
          // Reopening never happens after the batch it lets you make.
          expect(new Date(window.nextOpensIso!).getTime()).toBeLessThan(new Date(window.nextCutoffIso!).getTime())
        }
      }
    }
  })

  it('treats "normal" as always open, with nothing to count down to', () => {
    for (const at of ['2026-07-21T00:00:00.000', '2026-07-21T12:00:00.000', '2026-07-21T23:59:59.999']) {
      expect(submissionWindow('normal', hcm(at))).toEqual({ acceptingNow: true, nextCutoffIso: null, nextOpensIso: null })
    }
  })

  it('fails closed on garbage instead of throwing', () => {
    expect(submissionWindow('4H', new Date(NaN))).toEqual({ acceptingNow: false, nextCutoffIso: null, nextOpensIso: null })
    expect(submissionWindow('4H', undefined as unknown as Date)).toEqual({ acceptingNow: false, nextCutoffIso: null, nextOpensIso: null })
    expect(submissionWindow('overnight' as VisaSpeedCode, new Date())).toEqual({ acceptingNow: false, nextCutoffIso: null, nextOpensIso: null })
    // A prototype key must not resolve to a spec.
    expect(submissionWindow('constructor' as VisaSpeedCode, new Date())).toEqual({ acceptingNow: false, nextCutoffIso: null, nextOpensIso: null })
  })
})

describe('attribute parsers', () => {
  it('accepts only the declared codes, and never guesses a default', () => {
    for (const code of VISA_SPEED_CODES) expect(parseVisaSpeedCode(code)).toBe(code)
    for (const value of ['5H', '1h', 'NORMAL', '', ' 1H', null, undefined, 1, {}, ['1H'], true]) {
      expect(parseVisaSpeedCode(value)).toBeNull()
    }
    for (const entry of VISA_ENTRY_TYPES) expect(parseVisaEntryType(entry)).toBe(entry)
    for (const value of ['Single', 'triple', '', null, undefined, 2, {}, ['single']]) {
      expect(parseVisaEntryType(value)).toBeNull()
    }
  })
})
