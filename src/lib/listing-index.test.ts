import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The incremental Vertex ingest — the `after()` path that runs on every listing mutation.
 *
 * ⚠️ WHAT THESE TESTS PIN IS THAT THE EXCLUSION IS EDITION-INDEPENDENT, which is the whole bug.
 * eno.vn and eno.forum write into ONE Vertex datastore and eno.vn's AI concierge reads it, so a
 * guard that starts `if (IS_SERVICES) return {}` — which is every page-read guard in
 * edition-scope.ts, correctly — excludes nothing on the build that actually owns the desk. Every
 * assertion below therefore runs TWICE, once per edition, and asserts the SAME outcome; a
 * regression that reintroduces an edition test would pass the marketplace half and fail here.
 *
 * The desk is resolved for real (through edition-scope → db.seller.findMany on the owner emails)
 * rather than stubbed, so the wiring between the two modules is under test and not just mocked.
 */

const h = vi.hoisted(() => ({
  services: true,
  configured: true,
  /** The Seller rows the desk emails resolve to. Empty = "the desk cannot be resolved". */
  sellers: [] as Array<{ id: string }>,
  throwOnSellerQuery: null as null | Error,
  listing: null as null | Record<string, unknown>,
  upserted: [] as string[],
  deleted: [] as string[],
}))

vi.mock('@/lib/edition', () => ({
  get IS_SERVICES() { return h.services },
  get IS_MARKETPLACE() { return !h.services },
  get EDITION() { return h.services ? 'services' : 'marketplace' },
}))
vi.mock('@/lib/visa-shop', () => ({ VISA_SHOP_OWNER_EMAILS: ['support@eno.forum'] }))
vi.mock('@/lib/trips/dm-thread', () => ({ TRIP_DESK_OWNER_EMAILS: ['support@eno.forum'] }))
vi.mock('@/lib/db', () => ({
  db: {
    seller: {
      findMany: async () => {
        if (h.throwOnSellerQuery) throw h.throwOnSellerQuery
        return h.sellers
      },
    },
    listing: { findUnique: async () => h.listing },
  },
}))
vi.mock('@/lib/vertex-search', () => ({
  vertexConfigured: () => h.configured,
  listingToDoc: (l: { id: string }) => ({ id: l.id }),
  upsertListingDocument: async (doc: { id: string }) => { h.upserted.push(doc.id) },
  deleteListingDocument: async (id: string) => { h.deleted.push(id) },
}))
// react's cache() is identity outside a request; unwrap it so each test resolves its own desk
// fixture instead of the first one that ran.
vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), cache: (f: unknown) => f }))

const { reindexListing, removeFromIndex } = await import('./listing-index')

const DESK_SELLER = 'desk-seller-1'
const listingRow = (over: Record<string, unknown> = {}) => ({
  id: 'listing-1', sellerId: 'ordinary-seller', verified: true, status: 'active', ...over,
})

beforeEach(() => {
  h.services = true
  h.configured = true
  h.sellers = [{ id: DESK_SELLER }]
  h.throwOnSellerQuery = null
  h.listing = listingRow()
  h.upserted = []
  h.deleted = []
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

// The edition must make NO difference to any of this. Both halves of the table are the contract.
describe.each([
  ['services (eno.forum)', true],
  ['marketplace (eno.vn)', false],
])('reindexListing on the %s edition', (_name, isServices) => {
  beforeEach(() => { h.services = isServices })

  it('indexes an ordinary public listing', async () => {
    await reindexListing('listing-1')
    expect(h.upserted).toEqual(['listing-1'])
    expect(h.deleted).toEqual([])
  })

  /**
   * ⚠️ THE TEST THIS FILE EXISTS FOR. eno.forum creating or editing an e-Visa SKU used to index it
   * straight into the store eno.vn's concierge searches — no gate, no error, no failing test.
   */
  it('never upserts a desk-owned listing, and DELETES it instead', async () => {
    h.listing = listingRow({ id: 'evisa-1', sellerId: DESK_SELLER })
    await reindexListing('evisa-1')
    expect(h.upserted).toEqual([])
    // Deleted, not merely skipped: a document written before this guard existed has to be actively
    // removed, and this is the only path that touches it after a mutation.
    expect(h.deleted).toEqual(['evisa-1'])
  })

  it('removes a listing that is no longer public', async () => {
    h.listing = listingRow({ status: 'sold' })
    await reindexListing('listing-1')
    expect(h.upserted).toEqual([])
    expect(h.deleted).toEqual(['listing-1'])
  })

  it('removes a listing that no longer exists', async () => {
    h.listing = null
    await reindexListing('listing-1')
    expect(h.upserted).toEqual([])
    expect(h.deleted).toEqual(['listing-1'])
  })

  /**
   * ⚠️ FAIL CLOSED, AND NEVER THROW. isServicesDeskListing() throws when the desk cannot be
   * resolved — "no desk" and "could not tell" must not be the same answer — but this runs in
   * `after()` on a seller's own post/edit, so the error is caught and read as "assume it IS the
   * desk". One missing search result until the backfill runs, versus an e-visa product in the
   * licensed marketplace's AI answers that nothing downstream can remove.
   */
  it('does not index anything when the desk cannot be resolved, and removes instead', async () => {
    h.sellers = []
    await expect(reindexListing('listing-1')).resolves.toBeUndefined()
    expect(h.upserted).toEqual([])
    expect(h.deleted).toEqual(['listing-1'])
  })

  it('does not index anything when the desk lookup errors', async () => {
    h.throwOnSellerQuery = new Error('connection reset')
    await expect(reindexListing('listing-1')).resolves.toBeUndefined()
    expect(h.upserted).toEqual([])
    expect(h.deleted).toEqual(['listing-1'])
  })

  it('is a no-op when Vertex is not configured — no desk lookup, no writes', async () => {
    h.configured = false
    h.throwOnSellerQuery = new Error('would have been queried')
    await reindexListing('listing-1')
    expect(h.upserted).toEqual([])
    expect(h.deleted).toEqual([])
  })

  it('matches the desk by seller id resolved from the owner email, not by the listing id', async () => {
    // A reseed changes seller ids, so the desk is resolved by email every time; a listing that
    // merely LOOKS like a visa product but sits on another storefront is still indexed.
    h.sellers = [{ id: 'desk-after-reseed' }]
    h.listing = listingRow({ id: 'evisa-1', sellerId: DESK_SELLER })
    await reindexListing('evisa-1')
    expect(h.upserted).toEqual(['evisa-1'])

    h.listing = listingRow({ id: 'evisa-2', sellerId: 'desk-after-reseed' })
    await reindexListing('evisa-2')
    expect(h.upserted).toEqual(['evisa-1'])
    expect(h.deleted).toEqual(['evisa-2'])
  })
})

describe('removeFromIndex', () => {
  it('deletes without consulting the desk — removing a document can never leak one', async () => {
    // Proven by making the desk lookup explode: if removeFromIndex touched it, the delete would
    // still have to happen, and asserting that here would be asserting the catch block instead.
    h.throwOnSellerQuery = new Error('desk lookup must not be on this path')
    await removeFromIndex('listing-1')
    expect(h.deleted).toEqual(['listing-1'])
  })
})
