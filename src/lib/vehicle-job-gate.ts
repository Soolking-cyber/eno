/**
 * IS THE VEHICLE REFRESH DUE? — the every-3-days gate, pure (scripts/vehicle-job-gate.ts reads the stamp file).
 *
 * Owner, 2026-10-13: "every 3 days it should check and update". launchd has no "every N days", so the LaunchAgent
 * fires DAILY (04:30) and scripts/vehicle-rentals-weekly.sh asks this first: run only when the last SUCCESSFUL run
 * is at least SUCCESS_GATE_HOURS old. The stamp is written only after a fully successful --apply run, so:
 *   · a run that failed (or stopped at a guard) leaves the old stamp → the next day's trigger runs again;
 *   · a trigger missed while the Mac slept fires on wake (launchd's StartCalendarInterval), and the gate decides;
 *   · 66 h, not 72: a run that started at 04:30 and finished ~08:00 leaves a stamp the third morning's 04:30
 *     trigger must already pass (72 h would wait for the FOURTH morning). 66 h keeps every-third-day while a slow
 *     run (up to ~6 h) still clears it.
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
