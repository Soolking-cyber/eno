// ── e-Visa PROCESSING SPEED — operational facts, never money ──────────────────────
//
// A visa product is one (entry type × processing speed) pair sold as an ordinary
// marketplace listing. The PRICE of that pair lives on the listing the admin uploaded
// (Listing.price) and nowhere else; this file deliberately contains no prices and must
// never grow one. What it does contain is the part of a speed tier that is NOT a
// commercial decision: the provider's daily SUBMISSION CUTOFFS and the turnaround they
// promise. Those come from the visa provider, are the same for every seller and every
// price, and would be a lie if an admin could edit them — so they are code, not data.
//
// ⚠️ TIME ZONE. Cutoffs are wall-clock times in Asia/Ho_Chi_Minh. The app runs on Cloud
// Run in UTC and a developer's laptop is in whatever zone it is in, so nothing here may
// use the process time zone: every conversion goes through Intl with an EXPLICIT
// timeZone (see utcMsForWallClock). There is no `+ 7 * 3600e3` anywhere in this file and
// there must never be one — Vietnam's offset is a fact about the zone database, not a
// constant we get to restate.
//
// Pure module on purpose: no `server-only`, no imports, no I/O. `now` is an argument so
// every boundary is testable, and the answer is a function of the INSTANT alone.
//
// ⚠️ THIS FILE OWNS THE SPEED-TIER COPY. src/lib/taxonomy.ts builds the `visaSpeed` facet
// options BY IMPORTING VISA_SPEED_SPECS below — it does not restate the seven tiers. The
// direction is deliberate: the codes here are what parseVisaSpeedCode() accepts, i.e. what
// makes an already-posted product resolvable, so the catalogue of chips has to follow the
// parser rather than the other way round. (The reverse import would also drag the whole
// 880-line taxonomy into every server module that just wants a cutoff, and would break
// this module's "no imports" property.) Because taxonomy.ts reaches client components,
// keep this module free of module-scope side effects — see hcmFormatter().

export type VisaEntryType = 'single' | 'multiple'

export type VisaSpeedCode = '1H' | '2H' | '4H' | '1D' | '2D' | '3D' | 'normal'

/** The owner's reference grid order: fastest tier first, standard last. */
export const VISA_SPEED_CODES: readonly VisaSpeedCode[] = ['1H', '2H', '4H', '1D', '2D', '3D', 'normal'] as const

/**
 * Both e-visa entry types are 90-day (src/lib/visa/schema.ts, MAX_EVISA_VALIDITY_DAYS);
 * the entry type is the only axis the payload models. Order = catalogue order.
 */
export const VISA_ENTRY_TYPES: readonly VisaEntryType[] = ['single', 'multiple'] as const

/**
 * Operational tier facts — cutoffs and turnaround copy. NOT prices.
 *
 * `cutoffs` are "HH:MM" wall-clock times in Asia/Ho_Chi_Minh, ASCENDING: an application
 * handed in strictly BEFORE one of these times is worked in that batch. An empty array
 * means the tier has no cutoff at all (standard processing).
 */
export type VisaSpeedSpec = {
  code: VisaSpeedCode
  label: string
  labelVi: string
  cutoffs: string[]
  turnaround: string
  turnaroundVi: string
}

export const VISA_SPEED_SPECS: Record<VisaSpeedCode, VisaSpeedSpec> = {
  '1H': {
    code: '1H',
    label: 'Within 1 hour',
    labelVi: 'Trong vòng 1 giờ',
    cutoffs: ['10:00', '16:00'],
    turnaround: 'Result within 1 hour of submission.',
    turnaroundVi: 'Có kết quả trong vòng 1 giờ sau khi nộp hồ sơ.',
  },
  '2H': {
    code: '2H',
    label: 'Within 2 hours',
    labelVi: 'Trong vòng 2 giờ',
    cutoffs: ['10:00', '15:00'],
    turnaround: 'Result within 2 hours of submission.',
    turnaroundVi: 'Có kết quả trong vòng 2 giờ sau khi nộp hồ sơ.',
  },
  '4H': {
    code: '4H',
    label: 'Within 4 hours',
    labelVi: 'Trong vòng 4 giờ',
    cutoffs: ['08:30', '14:30'],
    turnaround: 'Result within 4 hours of submission.',
    turnaroundVi: 'Có kết quả trong vòng 4 giờ sau khi nộp hồ sơ.',
  },
  '1D': {
    code: '1D',
    label: '1 working day',
    labelVi: '1 ngày làm việc',
    // The grid words these as "morning before 09:00, afternoon before 13:00".
    cutoffs: ['09:00', '13:00'],
    turnaround: 'Result within one working day of submission.',
    turnaroundVi: 'Có kết quả trong vòng một ngày làm việc sau khi nộp hồ sơ.',
  },
  '2D': {
    code: '2D',
    label: '2 working days',
    labelVi: '2 ngày làm việc',
    cutoffs: ['15:30'],
    turnaround: 'Submitted before 15:30 — result the following afternoon.',
    turnaroundVi: 'Nộp trước 15:30 — có kết quả vào chiều hôm sau.',
  },
  '3D': {
    code: '3D',
    label: '3 working days',
    labelVi: '3 ngày làm việc',
    cutoffs: ['15:30'],
    turnaround: 'Submitted before 15:30 — result on the afternoon of the second day after submission.',
    turnaroundVi: 'Nộp trước 15:30 — có kết quả vào chiều ngày thứ hai sau khi nộp hồ sơ.',
  },
  normal: {
    code: 'normal',
    label: 'Standard',
    labelVi: 'Tiêu chuẩn',
    cutoffs: [],
    turnaround: 'Standard processing — submit at any time, no daily cutoff.',
    turnaroundVi: 'Xử lý tiêu chuẩn — nộp bất cứ lúc nào, không có giờ chốt.',
  },
}

/**
 * Where "now" sits against a tier's cutoffs.
 *
 *  · `acceptingNow` — there is still a cutoff LATER TODAY (Ho Chi Minh City wall clock)
 *    that an application handed in right now could make. A tier with no cutoffs is
 *    always accepting.
 *  · `nextCutoffIso` — the instant of the next cutoff an application could still be
 *    aimed at: today's next one while the desk is open, otherwise tomorrow's first.
 *    null only for a tier that has no cutoffs (nothing to count down to).
 *  · `nextOpensIso` — null while accepting; otherwise the instant the next intake day
 *    begins (local midnight), i.e. when `acceptingNow` flips back to true.
 */
export type VisaWindow = { acceptingNow: boolean; nextCutoffIso: string | null; nextOpensIso: string | null }

const HCM_TIME_ZONE = 'Asia/Ho_Chi_Minh'

// One formatter, built once — constructing an Intl.DateTimeFormat is the expensive part —
// but built LAZILY, on the first cutoff question rather than on import. src/lib/taxonomy.ts
// imports this module for the tier labels and taxonomy.ts is itself imported by client
// components, so a module-scope constructor would run in every browser bundle that renders
// a facet chip and would never be used there (nothing on the client asks for a window).
let hcmParts: Intl.DateTimeFormat | null = null
function hcmFormatter(): Intl.DateTimeFormat {
  hcmParts ??= new Intl.DateTimeFormat('en-US', {
    timeZone: HCM_TIME_ZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  return hcmParts
}

type WallClock = { year: number; month: number; day: number; hour: number; minute: number; second: number }

/** The Ho-Chi-Minh-City wall clock at an instant. Independent of process.env.TZ. */
function wallClockAt(instant: Date): WallClock {
  const parts = hcmFormatter().formatToParts(instant)
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value)
  // Some ICU builds render midnight as hour "24" under hour12:false — normalise it, or
  // every cutoff computed on an intake day would land 24 hours out.
  const hour = read('hour')
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: hour === 24 ? 0 : hour,
    minute: read('minute'),
    second: read('second'),
  }
}

/**
 * The zone's UTC offset (ms) AT a given instant — read from the zone database through
 * Intl, never assumed. Positive east of Greenwich (Vietnam: +7h = 25_200_000).
 */
function zoneOffsetMsAt(instant: Date): number {
  const ms = instant.getTime()
  const w = wallClockAt(instant)
  // Milliseconds are not in the formatted parts, so carry them across explicitly;
  // otherwise the offset would be wrong by the instant's sub-second component.
  const subSecond = ((ms % 1000) + 1000) % 1000
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second, subSecond) - ms
}

/**
 * The UTC instant (ms) of a Ho-Chi-Minh-City wall-clock time.
 *
 * Two-pass fixed point (the date-fns-tz technique): take the offset at the naive instant,
 * correct, then re-read the offset AT the corrected instant in case the first guess
 * landed on the other side of a transition. Vietnam has had no DST since 1975, so the
 * second pass is belt-and-braces — but it costs one Intl format and makes the function
 * correct for any zone, which is cheaper than a comment promising it will never matter.
 *
 * `day` may overflow its month (day + 1 on the 31st): Date.UTC normalises that, which is
 * exactly the "roll to tomorrow" behaviour submissionWindow needs.
 */
function utcMsForWallClock(year: number, month: number, day: number, hour: number, minute: number): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0)
  const firstPass = naive - zoneOffsetMsAt(new Date(naive))
  return naive - zoneOffsetMsAt(new Date(firstPass))
}

/** "HH:MM" → [hour, minute], or null for anything that is not one. */
function parseCutoff(value: string): [number, number] | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return [hour, minute]
}

// FACTORIES, not shared constants: a VisaWindow is handed out on every product in the
// catalogue, and one shared object would let a single caller's mutation rewrite the
// answer for every other product in the same request.
const closedWindow = (): VisaWindow => ({ acceptingNow: false, nextCutoffIso: null, nextOpensIso: null })
const alwaysOpenWindow = (): VisaWindow => ({ acceptingNow: true, nextCutoffIso: null, nextOpensIso: null })

/** The fail-closed window: nothing accepted, nothing scheduled. Exported so a caller with
 *  no speed to ask about (an unconfigured product) uses the same answer this module does. */
export const closedVisaWindow = closedWindow

/**
 * Asia/Ho_Chi_Minh regardless of server TZ (Cloud Run is UTC). `now` injectable for tests.
 *
 * Fails CLOSED, never throws: an unknown code or an invalid Date answers "not accepting,
 * nothing scheduled" rather than guessing a window a buyer might rely on.
 *
 * A cutoff is a STRICT deadline — at exactly 10:00 the 10:00 batch is gone and the next
 * one is the day's later cutoff (or tomorrow's first).
 */
export function submissionWindow(code: VisaSpeedCode, now: Date): VisaWindow {
  // Through the parser, NOT a bare index: VISA_SPEED_SPECS is an object literal, so
  // VISA_SPEED_SPECS['constructor'] is truthy and a bare lookup would sail past a
  // `if (!spec)` guard straight into reading `.cutoffs` off Object.
  const spec = parseVisaSpeedCode(code) ? VISA_SPEED_SPECS[code] : null
  if (!spec) return closedWindow()
  const t = now instanceof Date ? now.getTime() : NaN
  if (!Number.isFinite(t)) return closedWindow()
  // No cutoff at all → always accepting, and nothing to count down to.
  if (!spec.cutoffs.length) return alwaysOpenWindow()

  // Sorted defensively: "HH:MM" is zero-padded, so lexical order IS chronological order.
  const cutoffs = [...spec.cutoffs].sort().map(parseCutoff).filter((c): c is [number, number] => c !== null)
  if (!cutoffs.length) return closedWindow()

  const today = wallClockAt(now)
  for (const [hour, minute] of cutoffs) {
    const at = utcMsForWallClock(today.year, today.month, today.day, hour, minute)
    if (at > t) return { acceptingNow: true, nextCutoffIso: new Date(at).toISOString(), nextOpensIso: null }
  }

  // Past the last cutoff of the day: intake reopens at local midnight, and the earliest
  // batch anyone can still aim at is tomorrow's first cutoff.
  const [firstHour, firstMinute] = cutoffs[0]
  return {
    acceptingNow: false,
    nextCutoffIso: new Date(utcMsForWallClock(today.year, today.month, today.day + 1, firstHour, firstMinute)).toISOString(),
    nextOpensIso: new Date(utcMsForWallClock(today.year, today.month, today.day + 1, 0, 0)).toISOString(),
  }
}

// ── Defensive parsers (the shop's `attributes` blob is admin-typed JSON) ───────────

/**
 * A speed code, or null. NEVER a guessed default: a product whose speed the admin has
 * not set yet is unusable, and pretending it is 'normal' would sell the wrong service.
 */
export function parseVisaSpeedCode(value: unknown): VisaSpeedCode | null {
  return typeof value === 'string' && (VISA_SPEED_CODES as readonly string[]).includes(value)
    ? (value as VisaSpeedCode)
    : null
}

/** An entry type, or null. Same no-default rule as parseVisaSpeedCode. */
export function parseVisaEntryType(value: unknown): VisaEntryType | null {
  return typeof value === 'string' && (VISA_ENTRY_TYPES as readonly string[]).includes(value)
    ? (value as VisaEntryType)
    : null
}
