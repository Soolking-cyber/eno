import 'server-only'
import { db } from '@/lib/db'
import { vertexConfigured, upsertListingDocument, deleteListingDocument, listingToDoc } from '@/lib/vertex-search'

// Keep the Vertex AI Search index in sync with Postgres after a listing mutation.
// Both are no-ops when Vertex isn't configured, and they swallow errors — call them
// from `after()` so they never block or break the request.

// Reindex one listing: upsert if it's PUBLIC (verified + active), else remove it — so
// editing, marking sold/hidden, (re)publishing, or bumping all do the right thing.
export async function reindexListing(id: string): Promise<void> {
  if (!vertexConfigured()) return
  try {
    const l = await db.listing.findUnique({ where: { id }, include: { category: true, seller: true } })
    if (l && l.verified && l.status === 'active') await upsertListingDocument(listingToDoc(l))
    else await deleteListingDocument(id)
  } catch (e) { console.error('[listing-index] reindex', id, e) }
}

export async function removeFromIndex(id: string): Promise<void> {
  if (!vertexConfigured()) return
  try { await deleteListingDocument(id) } catch (e) { console.error('[listing-index] remove', id, e) }
}
