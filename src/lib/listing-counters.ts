import 'server-only'
import { db } from '@/lib/db'

/**
 * THE LISTING ENGAGEMENT COUNTERS — views, saves and contact reveals (SEO wave B, I3a). Every write
 * to `views`, `savedCount` and `contactCount` goes through here.
 *
 * ⛔ RAW SQL ON PURPOSE: A COUNTER IS NOT AN EDIT. `Listing.updatedAt` is `@updatedAt`, which the
 * Prisma CLIENT stamps on every `update` — so a Prisma `db.listing.update` that increments a counter
 * restamped the row as "modified" on every counted view, save and contact reveal. `updatedAt` is what
 * the listing sitemaps emit as <lastmod> (sitemaps/[file], and the per-category, per-district and
 * per-storefront `_max.updatedAt` in pages.xml), so a popular listing told crawlers it changed every
 * few hours when nothing a crawler reads had changed — the lastmod Google learns to ignore. Postgres
 * itself does not touch `updatedAt` (there is no trigger on "Listing"), so a plain UPDATE of the one
 * counter leaves it where the last real edit put it.
 *
 * Nothing is bypassed: `db` is a bare PrismaClient (src/lib/db.ts — no `$extends`, no middleware),
 * and edition scoping is a WHERE builder applied to reads, which these by-id writes never had.
 *
 * Each call returns the unawaited PrismaPromise, so it can sit inside a batch `$transaction([...])`
 * (the contact reveal commits its row and the counter together). A missing id updates 0 rows instead
 * of throwing P2025 — every caller has just read the row, and a counter is best-effort anyway.
 */
export type ListingCounter = 'views' | 'savedCount' | 'contactCount'

/** +1 on one counter. Identifiers are fixed per branch — the column name is never interpolated. */
export function bumpListingCounter(listingId: string, counter: ListingCounter) {
  switch (counter) {
    case 'views':
      return db.$executeRaw`UPDATE "Listing" SET "views" = "views" + 1 WHERE "id" = ${listingId}`
    case 'savedCount':
      return db.$executeRaw`UPDATE "Listing" SET "savedCount" = "savedCount" + 1 WHERE "id" = ${listingId}`
    case 'contactCount':
      return db.$executeRaw`UPDATE "Listing" SET "contactCount" = "contactCount" + 1 WHERE "id" = ${listingId}`
  }
}

/** −1 on savedCount, clamped at 0 so an unsave can never push it negative (a reseed can reset it). */
export function dropListingSave(listingId: string) {
  return db.$executeRaw`UPDATE "Listing" SET "savedCount" = GREATEST("savedCount" - 1, 0) WHERE "id" = ${listingId}`
}
