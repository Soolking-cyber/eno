import { db } from '@/lib/db'
import type { Prisma } from '@/generated/prisma/client'
import { scopedListingWhere } from '@/lib/edition-scope'
import { SAVED_KEEPABLE_STATUSES } from '@/lib/listing-ids'
export { SAVED_IDS_PER_WRITE, SAVED_LISTING_ID_RE } from '@/lib/listing-ids'

/**
 * A SIGNED-IN PERSON'S SAVED LISTINGS, ON THE ACCOUNT (owner, 2026-11-09: "3 ok" to "Saved listings across devices: needs one
 * new database table"). The table is `SavedListing` (scripts/saved-listings-ddl.mjs); the browser side is
 * src/lib/saved-sync.ts, through /api/saved-listings.
 *
 * ⛔ ONLY WHAT THE PUBLIC SAVED-IDS PATH SHOWS, IN THIS EDITION — stored AND returned (`visibleSavedWhere`): verified, in a
 * kept status (live, sold, expired, stale — SAVED_KEEPABLE_STATUSES), inside this edition's scope (teacher profiles
 * included: a recruiter's saved teachers come back). An id outside it is never stored and never answered:
 *   · nothing here can confirm that a hidden or removed listing exists — the public path deliberately makes a takedown
 *     read like an id that never existed (feed-query.ts `gone`), and storing hidden ids would let the cap count them
 *     (plan review, 2026-11-09: a capacity probe);
 *   · a device's own self-heal already deletes such an id (favorites-context.tsx), so the account never keeps more than
 *     the device would.
 * A row whose listing is hidden LATER stays (only a hard delete cascades) and simply stops being returned; it comes back
 * if the listing does. eno.vn and eno.forum share the database, so each edition answers its own visible part.
 */

/** The most rows one account holds. Rows of listings hidden since they were saved still count (they are rare). */
export const SAVED_LISTINGS_CAP = 5000

/** The listings the public saved-ids path keeps for THIS edition — see the header. */
export function visibleSavedWhere(extra: Prisma.ListingWhereInput = {}): Promise<Prisma.ListingWhereInput> {
  return scopedListingWhere({ ...extra, verified: true, status: { in: [...SAVED_KEEPABLE_STATUSES] } }, { teachers: true })
}

/** The account's saved listing ids that are visible here, newest saved first. */
export async function savedListingIds(profileId: string): Promise<string[]> {
  const listing = await visibleSavedWhere()
  const rows = await db.savedListing.findMany({
    where: { profileId, listing: { is: listing } },
    orderBy: [{ createdAt: 'desc' }, { listingId: 'asc' }],
    take: SAVED_LISTINGS_CAP,
    select: { listingId: true },
  })
  return rows.map((r) => r.listingId)
}

/**
 * Save and unsave, for one account, ALL OR NOTHING. `remove` takes any of the account's rows. `add` stores only listings
 * visible here (the header) — the rest come back in `notStored`, so a browser can put a heart back instead of showing a
 * save the account does not hold — with `createdAt` staggered so the LAST id named is the newest save (a device's list is
 * oldest first).
 * ⛔ ONE WRITER PER ACCOUNT AT A TIME (a transaction-scoped advisory lock), and the cap is checked BEFORE anything changes:
 * two devices at 4,999 cannot both add, and a write refused at the cap has removed nothing either (commit review,
 * 2026-11-09). The visibility read stays outside: it reads only public listing state.
 */
export type SavedWrite = { result: 'ok' | 'limit_reached'; notStored: string[] }
export async function writeSavedListings(
  profileId: string,
  { add = [], remove = [] }: { add?: readonly string[]; remove?: readonly string[] },
  now = Date.now(),
): Promise<SavedWrite> {
  const wanted = [...new Set(add)]
  const visible = wanted.length
    ? new Set((await db.listing.findMany({ where: await visibleSavedWhere({ id: { in: wanted } }), select: { id: true } })).map((r) => r.id))
    : new Set<string>()
  const storable = wanted.filter((id) => visible.has(id))
  const notStored = wanted.filter((id) => !visible.has(id))
  // An id both added and removed stays (the route refuses such a write; this keeps the library safe without it).
  const leaving = [...new Set(remove)].filter((id) => !storable.includes(id))
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`saved-listings:${profileId}`}))`
    if (storable.length) {
      const [held, already, gone] = await Promise.all([
        tx.savedListing.count({ where: { profileId } }),
        tx.savedListing.count({ where: { profileId, listingId: { in: storable } } }),
        leaving.length ? tx.savedListing.count({ where: { profileId, listingId: { in: leaving } } }) : Promise.resolve(0),
      ])
      if (held - gone + (storable.length - already) > SAVED_LISTINGS_CAP) return { result: 'limit_reached' as const, notStored }
    }
    if (leaving.length) await tx.savedListing.deleteMany({ where: { profileId, listingId: { in: leaving } } })
    if (storable.length) {
      await tx.savedListing.createMany({
        data: storable.map((listingId, i) => ({ profileId, listingId, createdAt: new Date(now - (storable.length - 1 - i)) })),
        skipDuplicates: true,
      })
    }
    return { result: 'ok' as const, notStored }
  })
}
