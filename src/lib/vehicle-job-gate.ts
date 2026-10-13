/**
 * IS THE VEHICLE REFRESH DUE? — the every-3-days gate, pure (scripts/vehicle-job-gate.ts reads the stamp file).
 *
 * Owner, 2026-10-13: "every 3 days it should check and update". launchd has no "every N days", so the LaunchAgent
 * fires DAILY (04:30) and scripts/vehicle-rentals-weekly.sh asks this first: run only when the last SUCCESSFUL run
 * STARTED at least SUCCESS_GATE_HOURS ago. The stamp — that run's START — is written only after a fully successful
 * --apply run, so:
 *   · a run that failed (or stopped at a guard) leaves the old stamp → the next day's trigger runs again;
 *   · a trigger missed while the Mac slept fires on wake (launchd's StartCalendarInterval), and the gate decides;
 *   · ⛔ THE START, NOT THE END (review 2026-10-13): stamped at its end, a run that finished after ~10:30 (a late start
 *     on wake, a 4–6 h scrape — 10-05's took 4 h 02 min) was not due at the third morning's 04:30 trigger, and the
 *     cadence slipped to 4 days (bikes then expired ~12 days after last seen). From its start, any run that STARTS by
 *     10:30 is due again at the third morning's 04:30;
 *   · 66 h, not 72: launchd's 04:30 and the stamp's few seconds after it must not push a 3-day cadence to the fourth
 *     morning.
 * ⛔ A STAMP THAT CANNOT BE TRUSTED NEVER BLOCKS. Missing, unreadable as a date, or in the future (a clock that went
 * backwards) all read as due: the gate exists to space runs out, not to stop them, and a corrupt stamp would
 * otherwise freeze the refresh forever while every day looked "not due".
 */
export const SUCCESS_GATE_HOURS = 66
/** A stamp this far ahead of the clock is a clock problem, not a recent run. */
const FUTURE_SKEW_MS = 10 * 60_000
const HOUR_MS = 3_600_000

export function successGate(stamp: string | null, now: number, minHours: number = SUCCESS_GATE_HOURS): { due: boolean; reason: string } {
  const raw = (stamp ?? '').trim()
  if (!raw) return { due: true, reason: 'no successful run recorded yet' }
  const at = Date.parse(raw)
  if (!Number.isFinite(at)) return { due: true, reason: `the success stamp ${JSON.stringify(raw.slice(0, 40))} is not a date — running` }
  if (at - now > FUTURE_SKEW_MS) return { due: true, reason: `the success stamp ${raw} is in the future — running` }
  const hours = Math.max(0, (now - at) / HOUR_MS)
  if (hours >= minHours) return { due: true, reason: `last success ${raw} (${hours.toFixed(1)} h ago ≥ ${minHours} h)` }
  return { due: false, reason: `last success ${raw} (${hours.toFixed(1)} h ago < ${minHours} h) — next run in ${(minHours - hours).toFixed(1)} h` }
}
