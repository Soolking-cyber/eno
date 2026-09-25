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

/**
 * WHEN A LISTING APPEARED ON ENO — which is what the UI means by "Posted", and what an offer's
 * validity is anchored to. It is `postedAt` for every listing a person posts (a "still available"
 * bump moves `postedAt` forward, past `createdAt`), so for them this changes nothing.
 *
 * ⛔ IT EXISTS BECAUSE `postedAt` NOW CARRIES A MERCHANT'S PUBLISH DATE FOR IMPORTED CATALOGUES
 * (scripts/import-supersports.ts, 2026-09-17), BACKDATED BY UP TO ~6 YEARS. That is the right value
 * for RANKING — it stops one import from burying the whole feed — and the wrong value for two
 * readers a reviewer found: the "Posted X ago" line, which printed "a year ago" on new stock added
 * today, and the PDP's `priceValidUntil` (postedAt + 90 days), which told Google the price had
 * EXPIRED on more than half the catalogue. `createdAt` is the row's real arrival, and the later of
 * the two is the honest answer to both questions.
 */
export function listedAt(l: { postedAt: Date; createdAt?: Date | null; listingType?: string | null }): Date {
  // ⚠️ A JOB IS THE EXCEPTION: its freshness IS the posting date. A linked job (scripts/import-jobs.ts)
  // carries the board's posting date in `postedAt`, at most 30 days back, and "Posted 3m ago" on a job
  // posted last week misleads the one reader who acts on age. An employer's own job post has
  // postedAt >= createdAt anyway, so for them nothing changes.
  if (l.listingType === 'job') return l.postedAt
  return l.createdAt && l.createdAt.getTime() > l.postedAt.getTime() ? l.createdAt : l.postedAt
}
