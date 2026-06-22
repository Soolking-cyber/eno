// Single source of truth for "a live listing needs an availability refresh".
// Used by the dashboard API/UI and the daily-reminder cron so the threshold and
// the rule never drift apart.
export const STALE_DAYS = 7
const STALE_MS = STALE_DAYS * 86_400_000

/** Has this listing gone without an availability confirmation for too long?
 *  Falls back to postedAt when it was never confirmed. */
export function isStale(confirmedAt: string | Date | null | undefined, postedAt: string | Date, now = Date.now()): boolean {
  const ref = confirmedAt ?? postedAt
  return now - new Date(ref).getTime() > STALE_MS
}
