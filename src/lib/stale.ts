// Single source of truth for "a live listing needs an availability refresh".
// Used by the dashboard API/UI and the daily-reminder cron so the threshold and
// the rule never drift apart.
export const STALE_DAYS = 3
const STALE_MS = STALE_DAYS * 86_400_000

// Anti-gaming: a "bump" (confirm-availability refreshing feed recency) counts at
// most once per this window, so a seller can't re-confirm/repost daily to re-top.
export const BUMP_COOLDOWN_DAYS = 7
const BUMP_COOLDOWN_MS = BUMP_COOLDOWN_DAYS * 86_400_000

/** May this listing's feed recency be bumped now? (Not bumped within the cooldown.) */
export function canBump(postedAt: string | Date, now = Date.now()): boolean {
  return now - new Date(postedAt).getTime() >= BUMP_COOLDOWN_MS
}

/** Has this listing gone without an availability confirmation for too long?
 *  Falls back to postedAt when it was never confirmed. */
export function isStale(confirmedAt: string | Date | null | undefined, postedAt: string | Date, now = Date.now()): boolean {
  const ref = confirmedAt ?? postedAt
  return now - new Date(ref).getTime() > STALE_MS
}
