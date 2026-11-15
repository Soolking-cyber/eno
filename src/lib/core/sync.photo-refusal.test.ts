import { describe, expect, it, vi } from 'vitest'

// ⛔ A SYNC ROW NEVER FAILS ON A PHOTO (listing photo check, plan amendment A6): its edit goes through updateListingCore
// with the save-time photo screen off, so a price or stock update is never lost to a flyer — the pass strips it instead.

type Row = Record<string, any>

const h = vi.hoisted(() => ({ edits: [] as Array<{ id: string; body: Row; opts: Row | undefined }> }))

vi.mock('@/lib/db', () => ({
  db: { listing: { findMany: async () => [{ id: 'L1', externalId: 'p-1', status: 'active', subcategorySlug: 'phones-tablets', verified: true }], updateMany: async () => ({ count: 0 }) } },
}))
vi.mock('@/lib/core/licence-check', () => ({ licenceBlockedIds: async () => new Set<string>() }))
vi.mock('@/lib/core/listings', () => ({
  updateListingCore: async (id: string, body: Row, opts?: Row) => { h.edits.push({ id, body, opts }); return { ok: true } },
  setStatusCore: async (_id: string, status: string) => ({ ok: true, status }),
}))
vi.mock('@/lib/core/bulk', () => ({ bulkImportCore: async () => ({ results: [] }), rehostListingImage: async (src: string) => src, claimRehostedImages: async () => {}, discardRehostedImages: async () => {}, BULK_MAX_ROWS: 200 }))
vi.mock('@/lib/enforcement', () => ({ bulkPostingBudget: async () => ({ blocked: null, maxNewActive: null }) }))
vi.mock('@/lib/released-charge-gate', () => ({ releasedChargeStanding: async () => null, releasedChargeGateFor: async () => ({ remaining: 99 }) }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ sellerPublishDecision: async () => ({ ok: true }) }))
vi.mock('@/lib/listing-index', () => ({ removeFromIndex: async () => {} }))
vi.mock('@/lib/webhooks', () => ({ dispatchListingEventsBatch: async () => {} }))
vi.mock('next/server', () => ({ after: () => {} }))

const { syncListingsCore } = await import('@/lib/core/sync')

describe('syncListingsCore — photos', () => {
  it('⛔ updates with the photo screen off', async () => {
    const out = await syncListingsCore({ id: 's1', ownerId: 'o1', trustTier: 'standard', trustScore: 100 }, [{ externalId: 'p-1', price: 9_000_000, images: ['https://cdn.test/a.jpg'] }], 'partial')
    expect(out.failed).toBe(0)
    expect(h.edits).toEqual([{ id: 'L1', body: expect.objectContaining({ images: ['https://cdn.test/a.jpg'] }), opts: { photoRefusal: false } }])
  })
})
