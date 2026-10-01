import { beforeEach, describe, expect, it, vi } from 'vitest'

// GET /api/v1/listings/{id}: a TOMBSTONE (status 'removed' — src/lib/listing-removed.ts) is "not found"
// to its own shop, as it is to every other owner-scoped read (listingOwnedBy, the list endpoint, MCP).
// The API reference says a deleted listing "can no longer be read, edited or restored through the API".

type Row = Record<string, any>

const h = vi.hoisted(() => ({ listing: null as Row | null }))

vi.mock('@/lib/api/auth', () => ({
  resolveApiKey: async () => ({ ok: true, auth: { keyId: 'k1', sellerId: 's1', profileId: 'p1', scopes: new Set(['listings:read']) }, rate: { limit: 600, remaining: 599, resetSec: 60, windowSec: 60 } }),
  listingOwnedBy: async () => true,
}))
vi.mock('@/lib/db', () => ({ db: { listing: { findUnique: async () => h.listing } } }))
vi.mock('@/lib/serialize', () => ({ serializeListing: (l: Row) => ({ id: l.id, status: l.status }) }))
vi.mock('@/lib/core/listings', () => ({ updateListingCore: async () => ({ ok: true }), deleteListingCore: async () => ({ ok: true, deleted: true }), DELETE_HOLD_MESSAGE: {} }))

const { GET } = await import('./route')
const get = async () => {
  const res = await GET(new Request('https://eno.vn/api/v1/listings/L1', { headers: { authorization: 'Bearer k' } }) as never, { params: Promise.resolve({ id: 'L1' }) })
  return { status: res.status, body: (await res.json()) as Row }
}

beforeEach(() => { h.listing = null })

describe('GET /api/v1/listings/{id}', () => {
  it.each(['active', 'sold', 'hidden'])('the shop reads its own %s listing', async (status) => {
    h.listing = { id: 'L1', sellerId: 's1', status }
    const r = await get()
    expect(r.status).toBe(200)
    expect(r.body.listing).toEqual({ id: 'L1', status })
  })

  it('⛔ a removed listing is 404 not_found to its own shop — the same answer as a missing one', async () => {
    h.listing = { id: 'L1', sellerId: 's1', status: 'removed' }
    const removed = await get()
    h.listing = null
    const missing = await get()
    expect(removed.status).toBe(404)
    expect(removed.body).toEqual(missing.body)
  })

  it("another shop's listing is 404 too (no cross-shop leak)", async () => {
    h.listing = { id: 'L1', sellerId: 'other', status: 'active' }
    expect((await get()).status).toBe(404)
  })
})
