import 'server-only'
import { db } from '@/lib/db'
import { isServicesDeskListing } from '@/lib/edition-scope'
import { vertexConfigured, upsertListingDocument, deleteListingDocument, listingToDoc } from '@/lib/vertex-search'

// Keep the Vertex AI Search index in sync with Postgres after a listing mutation.
// Both are no-ops when Vertex isn't configured, and they swallow errors — call them
// from `after()` so they never block or break the request.
//
// ⚠️ THE DESK IS EXCLUDED HERE ON BOTH EDITIONS, AND THAT IS NOT THE SAME RULE AS A PAGE READ.
// eno.vn and eno.forum write into ONE Vertex datastore (`eno-listings`) and eno.vn's AI concierge
// is what reads it, so the question is never "may MY edition show the desk" — it is "may the
// READER show it", and the reader is the licensed sàn TMĐT either way. This file used to have no
// exclusion at all: eno.forum creating or editing an e-Visa listing indexed it straight into the
// store eno.vn searches, one `after()` at a time. Measured 2026-08-01, a reconcile found 34
// documents where 18 belonged.
//
// ⚠️ IT CANNOT BE FIXED ANYWHERE ELSE. `ListingDoc` carries neither sellerId nor subcategorySlug,
// so no Vertex-side filter can express the exclusion after the fact and no query-time guard can
// unsee a document that is already in the branch. Ingest is the only place it can be done — see
// the shared-destination note at the foot of src/lib/edition-scope.ts.

/**
 * Should this row be in the index? "No" for a desk listing, and "no" when we could not find out.
 *
 * ⚠️ NEVER THROWS, AND FAILS CLOSED. `isServicesDeskListing()` throws when the desk cannot be
 * resolved (an unset VISA_SHOP_OWNER_EMAIL, a missing Profile row, a database blip) because
 * "no desk" and "could not tell" must not collapse into the same `false`. But this runs inside
 * `after()` on an ordinary listing mutation, where an exception is not an option — it would
 * surface as a failed post or edit for a seller who did nothing wrong.
 *
 * So an unresolved desk is treated as "this IS the desk": the document is removed rather than
 * written. The two costs are not symmetric. Removing a legitimate listing's document costs the
 * concierge one search result until `scripts/vertex-backfill.mjs` runs — visible in
 * `scripts/vertex-reconcile.mjs`, which prints a "missing from the index" warning for exactly
 * this — while writing a desk listing puts an e-visa product in the licensed marketplace's AI
 * answers with nothing downstream able to take it out.
 */
async function excludedFromIndex(listing: { id: string; sellerId: string }): Promise<boolean> {
  try {
    return await isServicesDeskListing(listing)
  } catch (e) {
    console.error('[listing-index] desk unresolved — removing', listing.id, 'from the index rather than indexing it', e)
    return true
  }
}

// Reindex one listing: upsert if it's PUBLIC (verified + active) and not the services desk's,
// else remove it — so editing, marking sold/hidden, (re)publishing, or bumping all do the right
// thing. A desk listing takes the REMOVE branch rather than merely skipping the upsert, so a
// document that is already in the index (from a build that predates this guard, or from the
// backfill route) is actively deleted the next time its listing is touched.
export async function reindexListing(id: string): Promise<void> {
  if (!vertexConfigured()) return
  try {
    const l = await db.listing.findUnique({ where: { id }, include: { category: true, seller: true } })
    if (l && l.verified && l.status === 'active' && !(await excludedFromIndex(l))) await upsertListingDocument(listingToDoc(l))
    else await deleteListingDocument(id)
  } catch (e) { console.error('[listing-index] reindex', id, e) }
}

// Delete-only, so it needs no desk check: removing a document can never leak one.
export async function removeFromIndex(id: string): Promise<void> {
  if (!vertexConfigured()) return
  try { await deleteListingDocument(id) } catch (e) { console.error('[listing-index] remove', id, e) }
}
