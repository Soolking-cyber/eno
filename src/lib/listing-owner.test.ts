import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * checkListingOwner — the authorisation every listing-mutating SESSION route runs (edit, status, sold,
 * confirm, buyers, delete). Pinned here: a TOMBSTONE (src/lib/listing-removed.ts) answers not-found to
 * its own owner, so no route can edit, relist, sell or confirm a removed listing.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({ profile: { id: 'p1' } as Row | null, seller: { id: 's1' } as Row | null, listing: null as Row | null }))

vi.mock('./admin', () => ({ getCurrentProfile: async () => h.profile }))
vi.mock('./db', () => ({
  db: {
    seller: { findUnique: async () => h.seller },
    listing: { findUnique: async () => h.listing },
  },
}))

const { checkListingOwner } = await import('./listing-owner')

beforeEach(() => {
  h.profile = { id: 'p1' }
  h.seller = { id: 's1' }
  h.listing = { sellerId: 's1', status: 'active' }
})

describe('checkListingOwner', () => {
  it('the owner of a live, sold or hidden listing is authorised', async () => {
    for (const status of ['active', 'sold', 'hidden']) {
      h.listing = { sellerId: 's1', status }
      expect(await checkListingOwner('L1')).toEqual({ ok: true, sellerId: 's1', profileId: 'p1' })
    }
  })

  it('⛔ a removed listing is NOT FOUND, even to its owner', async () => {
    h.listing = { sellerId: 's1', status: 'removed' }
    expect(await checkListingOwner('L1')).toEqual({ ok: false, code: 404, error: 'not_found' })
  })

  it('keeps its other answers: guest 401, no shop 403, missing 404, someone else\'s 403', async () => {
    h.profile = null
    expect(await checkListingOwner('L1')).toMatchObject({ code: 401, error: 'auth_required' })
    h.profile = { id: 'p1' }; h.seller = null
    expect(await checkListingOwner('L1')).toMatchObject({ code: 403, error: 'no_storefront' })
    h.seller = { id: 's1' }; h.listing = null
    expect(await checkListingOwner('L1')).toMatchObject({ code: 404, error: 'not_found' })
    h.listing = { sellerId: 's2', status: 'active' }
    expect(await checkListingOwner('L1')).toMatchObject({ code: 403, error: 'forbidden' })
  })
})
