// ── e-Visa DELIVERY PROMISE — pure working-time math, never a guess ────────────────
//
// "speed tier turnaround but accounts weekends since governments dont work on weekends"
// (owner, Phase 4) — and public holidays are NOT optional (external review): a promise
// computed across Tet is a missed flight. This module turns a tier's STRUCTURED
// turnaround (src/lib/visa/speed.ts) into the instant the applicant should have their
// visa by — batch-aware, weekend-aware, holiday-aware.
//
// ⚠️ THE CLOCK IS THE PROVIDER'S, NOT THE BUYER'S (external review #2): a tier's
// cutoffs decide WHICH BATCH a payment made. An hour tier's clock runs from the first
// cutoff the payment beat (paid 09:30, cutoff 10:00, "+1h" → 11:00 — never 10:30,
// which no desk ever promised); a payment past the day's LAST cutoff belongs to the
// next working day. Day tiers count the batch day as day 1 (the provider's own copy:
// '2D' = "the following afternoon"). Cutoffs are STRICT, exactly like
// submissionWindow: at 15:30:00 the 15:30 batch is gone.
//
// ⚠️ FAILS CLOSED, ALWAYS. No promise is infinitely better than a wrong one:
//   · unknown speed code, invalid date                       → null
//   · a date-time STRING without an explicit UTC offset      → null (bare
//     '2026-07-24T10:00' parses in the process TZ — the exact trap this module exists
//     to not have; external review #1)
//   · the span touching a year OUTSIDE the holiday table     → null, both directions
//     (external review #3: an uncovered year silently degrades to weekend-only math
//     and over-promises straight through Tet)
// The UI simply shows no ETA line for a null.
//
// Pure module on purpose: no imports outside ./speed, no server-only, no I/O, explicit
// Intl only — eta.test.ts pins the no-local-TZ-API rule on this SOURCE.

import {
  hcmUtcMsForWallClock,
  hcmWallClockAt,
  parseVisaSpeedCode,
  VISA_BUSINESS_HOURS,
  VISA_SPEED_SPECS,
  type VisaSpeedCode,
} from './speed'

/**
 * Official non-working days of Vietnam, 'YYYY-MM-DD' by the Asia/Ho_Chi_Minh calendar.
 *
 * Verified 2026-07-23 by two independent web researches, reconciled (sources: MOHA
 * Notice 9441/TB-BNV for the announced 2026 schedule; Labour Code 2019 Art. 111-112
 * for fixed/compensatory derivation; publicholidays.vn + ngaydep.com lunar projections
 * for 2027-2028). Where the state has not announced yet, the span is the INCLUSIVE
 * union of both researches' estimates and both candidates of a PM-decided adjacent day
 * — an extra skipped day under-promises by a day; a missed one promises a visa nobody
 * is at a desk to issue. Announced swap-Saturdays (worked weekends) are deliberately
 * NOT worked here: same safe direction.
 *
 * ⚠️ EXTEND THIS TABLE BEFORE ITS LAST YEAR ENDS. expectedVisaReadyAt refuses (null)
 * any computation touching a year outside [COVERED_FROM, COVERED_THROUGH], so an
 * un-extended table costs the ETA feature, never its honesty.
 */
export const VIETNAM_PUBLIC_HOLIDAYS: readonly string[] = [
  // ── 2026 (announced — MOHA Notice 9441/TB-BNV) ──
  '2026-01-01',
  // Tet, Year of the Horse (Mung 1 = Feb 17): announced 9-day break.
  '2026-02-14', '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18',
  '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22',
  // Hung Kings (10/3 lunar = Sun Apr 26; announced span incl. compensatory Mon).
  '2026-04-25', '2026-04-26', '2026-04-27',
  // Reunification + Labour Day, running through the natural weekend.
  '2026-04-30', '2026-05-01', '2026-05-02', '2026-05-03',
  // National Day: announced FIVE-day break (Aug 31 is a bridge day swapped against a
  // worked Saturday Aug 22 — the swap day stays non-working here, safe direction).
  '2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02',
  // Vietnam Culture Day — the NEW 12th public holiday (NA resolution 2026-04-24).
  '2026-11-24',
  // ── 2027 (fixed days derived; lunar spans = inclusive estimates) ──
  '2027-01-01',
  // Tet, Mung 1 = Sat Feb 6: inclusive estimated envelope (announcement due late 2026).
  '2027-02-04', '2027-02-05', '2027-02-06', '2027-02-07', '2027-02-08', '2027-02-09',
  '2027-02-10', '2027-02-11', '2027-02-12', '2027-02-13', '2027-02-14',
  // Hung Kings (10/3 lunar = Fri Apr 16).
  '2027-04-16',
  // Reunification + Labour Day (May 1 is a Saturday → compensatory Mon May 3).
  '2027-04-30', '2027-05-01', '2027-05-02', '2027-05-03',
  // National Day: Sep 2 fixed + BOTH candidates of the PM-decided adjacent day.
  '2027-09-01', '2027-09-02', '2027-09-03',
  '2027-11-24',
  // ── 2028 (fixed days derived; lunar spans = inclusive estimates) ──
  '2028-01-01', '2028-01-03',
  // Tet, Mung 1 = Wed Jan 26: inclusive estimated envelope.
  '2028-01-22', '2028-01-23', '2028-01-24', '2028-01-25', '2028-01-26', '2028-01-27',
  '2028-01-28', '2028-01-29', '2028-01-30', '2028-01-31', '2028-02-01',
  // Hung Kings (Tue Apr 4) + precedent-based Mon Apr 3 bridge.
  '2028-04-03', '2028-04-04',
  // Reunification (Sunday → compensatory Tue May 2) + Labour Day.
  '2028-04-30', '2028-05-01', '2028-05-02',
  // National Day: Sat Sep 2 fixed + projected adjacent/compensatory run.
  '2028-09-01', '2028-09-02', '2028-09-03', '2028-09-04',
  '2028-11-24',
]

/** The years the default table covers — computations outside them answer null. */
export const VIETNAM_HOLIDAYS_COVERED_FROM = 2026
export const VIETNAM_HOLIDAYS_COVERED_THROUGH = 2028

/** A date-time string without an explicit offset would parse in the PROCESS time zone. */
const OFFSET_RE = /([zZ]|[+-]\d{2}:?\d{2})$/

/**
 * Is the string's CIVIL date a real calendar day? JavaScript quietly normalizes overflow
 * ('2026-02-30' becomes Mar 2 — external review), which would mint a promise off a date
 * that never existed. Round-tripped through Date.UTC, which is calendar arithmetic only.
 */
const civilDateValid = (value: string): boolean => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ]/.exec(value.trim())
  if (!m) return false
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const d = new Date(Date.UTC(year, month - 1, day))
  return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month && d.getUTCDate() === day
}

const parseHm = (value: string): [number, number] => {
  const [h, m] = value.split(':').map(Number)
  return [h, m]
}

const dateKey = (year: number, month: number, day: number): string =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

/** Mon–Fri by the HCM calendar and not in the holiday set. Date.UTC here is calendar
 *  arithmetic on parts ALREADY read off the HCM wall — no process TZ involved. */
const isWorkingDay = (year: number, month: number, day: number, holidays: ReadonlySet<string>): boolean => {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  return !holidays.has(dateKey(year, month, day))
}

type DayCursor = { year: number; month: number; day: number }

/** The next calendar day, normalized through Date.UTC (month/year rollover). */
const nextDay = (c: DayCursor): DayCursor => {
  const d = new Date(Date.UTC(c.year, c.month - 1, c.day + 1))
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }
}

/**
 * When should this case's visa be ready?
 *
 * `startedAt` is the instant the DESK's clock starts — the payment capture (paid_at) —
 * as a Date or an ISO string WITH an explicit offset.
 *
 * `holidays` is overridable for TESTS; production callers omit it and inherit the
 * table + its coverage guard. A caller who overrides owns coverage.
 */
export function expectedVisaReadyAt(input: {
  startedAt: Date | string
  speed: VisaSpeedCode
  holidays?: readonly string[]
}): Date | null {
  const spec = parseVisaSpeedCode(input.speed) ? VISA_SPEED_SPECS[input.speed] : null
  if (!spec) return null
  if (typeof input.startedAt === 'string' && (!OFFSET_RE.test(input.startedAt.trim()) || !civilDateValid(input.startedAt))) return null
  const started = input.startedAt instanceof Date ? input.startedAt : new Date(input.startedAt)
  const startMs = started.getTime()
  if (!Number.isFinite(startMs)) return null

  const usingDefaultTable = input.holidays === undefined
  const holidays = new Set(input.holidays ?? VIETNAM_PUBLIC_HOLIDAYS)
  const inCoverage = (year: number) =>
    !usingDefaultTable || (year >= VIETNAM_HOLIDAYS_COVERED_FROM && year <= VIETNAM_HOLIDAYS_COVERED_THROUGH)
  const [openH, openM] = parseHm(VISA_BUSINESS_HOURS.start)
  const [closeH, closeM] = parseHm(VISA_BUSINESS_HOURS.end)
  // The tiers' batch times; a tier with no cutoffs (normal) batches at the close —
  // i.e. anything paid inside the working day counts that day.
  const cutoffs = (spec.cutoffs.length ? spec.cutoffs : [VISA_BUSINESS_HOURS.end]).map(parseHm)
  const lastCutoff = cutoffs[cutoffs.length - 1]

  const openMsOn = (c: DayCursor) => hcmUtcMsForWallClock(c.year, c.month, c.day, openH, openM)
  const closeMsOn = (c: DayCursor) => hcmUtcMsForWallClock(c.year, c.month, c.day, closeH, closeM)
  const atMsOn = (c: DayCursor, [h, m]: [number, number]) => hcmUtcMsForWallClock(c.year, c.month, c.day, h, m)

  const wall = hcmWallClockAt(started)
  let cursor: DayCursor = { year: wall.year, month: wall.month, day: wall.day }
  let guard = 0
  const advanceToWorkingDay = (): boolean => {
    while (!isWorkingDay(cursor.year, cursor.month, cursor.day, holidays)) {
      cursor = nextDay(cursor)
      // A promise 60+ days of closures out is not one this module should be making.
      if (++guard > 60) return false
    }
    return inCoverage(cursor.year)
  }

  // ── Which BATCH did the payment make? ────────────────────────────────────────────
  // The first working day whose last cutoff the payment still beat; the batch instant
  // is that day's first cutoff STRICTLY after the payment. (STRICT: at the cutoff the
  // batch is gone — submissionWindow's own rule.)
  if (!advanceToWorkingDay()) return null
  if (startMs >= atMsOn(cursor, lastCutoff)) {
    cursor = nextDay(cursor)
    if (!advanceToWorkingDay()) return null
  }
  const batchMs = Math.max(startMs, atMsOn(cursor, cutoffs.find((c) => atMsOn(cursor, c) > startMs) ?? lastCutoff))

  // ── Day tiers: business END of the Nth working day, batch day = day 1 ────────────
  if (spec.turnaroundBusinessDays) {
    for (let remaining = spec.turnaroundBusinessDays - 1; remaining > 0; remaining--) {
      cursor = nextDay(cursor)
      if (!advanceToWorkingDay()) return null
    }
    if (!inCoverage(cursor.year)) return null
    return new Date(closeMsOn(cursor))
  }

  // ── Hour tiers: consume business hours from the batch, spilling across close ─────
  if (spec.turnaroundBusinessHours) {
    let cursorMs = batchMs
    let remainingMs = spec.turnaroundBusinessHours * 3_600_000
    while (remainingMs > 0) {
      const available = closeMsOn(cursor) - cursorMs
      if (available >= remainingMs) {
        cursorMs += remainingMs
        remainingMs = 0
      } else {
        remainingMs -= Math.max(available, 0)
        cursor = nextDay(cursor)
        if (!advanceToWorkingDay()) return null
        cursorMs = openMsOn(cursor)
      }
      if (++guard > 90) return null
    }
    if (!inCoverage(cursor.year)) return null
    return new Date(cursorMs)
  }

  // A spec with neither structured field (should not exist — the type promises one).
  return null
}
