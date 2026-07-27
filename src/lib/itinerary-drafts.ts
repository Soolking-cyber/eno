import 'server-only'
// Relative specifier, same idiom as thread-kind.ts and the DM modules: `@/…` does not resolve under
// vitest, and the cap arithmetic here is worth unit-testing directly.
import { db } from './db'

/**
 * How many trips a traveller may keep saved at once.
 *
 * ⚠️ MIRRORS THE VISA CAP, WHICH ALREADY WORKS — it does not replace or duplicate it.
 * `MAX_ACTIVE_VISA_APPLICATIONS = 10` (src/lib/visa/dm-flow.ts) bounds how many visa cases can be
 * open; this bounds how many itineraries can be saved. Same shape, different resource, and the two
 * numbers are deliberately independent: a traveller planning three trips is normal, ten open
 * government applications is not.
 *
 * ⚠️ 3 BREAKS NOBODY TODAY, and that was checked rather than assumed: the busiest profile in prod
 * holds 2 itineraries. Nothing existing has to be deleted for this to ship, which is why the copy
 * says "you have reached the limit" rather than anything implying data was removed.
 */
export const MAX_SAVED_ITINERARIES = 3

/**
 * How many saved trips this traveller has, and whether there is room for another.
 *
 * ⚠️ THERE ARE TWO CREATE PATHS and a cap on one leaks through the other: POST /api/itineraries
 * (the explicit Save) and POST /api/itineraries/generate (which saves the plan it just produced).
 * Both call this. Putting the number and the query in one place is the only reason they cannot
 * drift into enforcing two different limits — which is exactly how the visa side would have gone
 * wrong if its ceiling had been written out at each call site.
 *
 * DELETING FREES A SLOT for free: this counts rows, so a removed itinerary stops occupying one with
 * no extra bookkeeping. That is a property of counting rather than of a stored counter, and it is
 * the reason not to cache a count anywhere.
 */
export async function itineraryQuota(profileId: string): Promise<{
  used: number
  limit: number
  remaining: number
  full: boolean
}> {
  const used = await db.itinerary.count({ where: { profileId } })
  const remaining = Math.max(0, MAX_SAVED_ITINERARIES - used)
  return { used, limit: MAX_SAVED_ITINERARIES, remaining, full: used >= MAX_SAVED_ITINERARIES }
}

/**
 * What the drafts picker renders. Read-only, and scoped to ONE traveller by the caller passing a
 * session-resolved profile id — this function never takes an id from a request body.
 *
 * ⚠️ NO STOP CONTENT. The summary is built from columns the traveller already sees in the list
 * (title, destination, day count), not from the itinerary's text, so nothing here can widen what a
 * thread-adjacent surface exposes.
 */
export async function listItineraryDrafts(profileId: string): Promise<{
  drafts: { id: string; title: string; destinationId: string; days: number; updatedAt: string; summary: string }[]
  used: number
  limit: number
  remaining: number
}> {
  const [rows, quota] = await Promise.all([
    db.itinerary.findMany({
      where: { profileId },
      // Newest first: the picker's first row should be the one just worked on.
      orderBy: { updatedAt: 'desc' },
      // Bounded by the cap itself — a traveller cannot have more, and asking for more than the
      // ceiling would quietly hide a bug in the cap rather than surface it.
      take: MAX_SAVED_ITINERARIES,
      select: { id: true, title: true, destinationId: true, days: true, updatedAt: true },
    }),
    itineraryQuota(profileId),
  ])
  return {
    drafts: rows.map((row) => ({
      id: row.id,
      title: row.title,
      destinationId: row.destinationId,
      days: row.days,
      updatedAt: row.updatedAt.toISOString(),
      // One line, built from what the list already shows. Plural handled here so the two surfaces
      // that render this cannot disagree about "1 days".
      summary: `${row.destinationId} · ${row.days} ${row.days === 1 ? 'day' : 'days'}`,
    })),
    used: quota.used,
    limit: quota.limit,
    remaining: quota.remaining,
  }
}
