/**
 * The pure rules scripts/import-partners.ts applies to a staged product — here, because that script
 * imports the database at module scope and so cannot be unit-tested (the same reason feed-taxonomy.ts and
 * feed-model.ts left the importers).
 *
 * Second-hand focus (owner, 2026-10-03): see the header of scripts/import-partners.ts.
 */

/**
 * ⛔ ONLY A LIVE ROW IS REFRESHED. `hidden` is a journaled hide (ad-ban, import screen, the 2026-10-03
 * new-goods retirement) or a moderator's decision, `stale` / `expired` are their own retirements, and
 * `removed` is a tombstone kept as evidence. A refresh is a Prisma write that bumps `updatedAt`, and a row
 * touched after its hide is one the hide's rollback refuses — so anything but active|sold is left alone.
 */
export function isLiveForRefresh(status: string | null | undefined): boolean {
  return status === 'active' || status === 'sold'
}

/**
 * ⛔ A `refreshOnly` shop (new AND used stock) gets no NEW listing — only its existing live rows refresh.
 * True when this staged product would be a create there.
 */
export function blockedCreate(store: { refreshOnly?: string }, existing: unknown): boolean {
  return !existing && !!store.refreshOnly
}
