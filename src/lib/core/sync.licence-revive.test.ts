import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── THE CATALOGUE SYNC'S REVIVE OF A LICENCE-AISLE ROW (R1, plan review 2026-10-14) ──────────────────────────────────
//
// A sync never creates in e-Visa or Legal & permits (bulk rows carry no subcategory) and sends no subcategory on an
// update — but a row it created can be MOVED there in the dashboard editor, and re-sending it as 'active' would put an
// unchecked listing back on sale. setStatusCore refuses that itself (listings.licence-revive.test.ts); the sync asks
// FIRST, in one read for the whole call, so the refused row fails before ANY write — its edits included — exactly as a
// refused identity revive does. Only revives of rows filed in an aisle are asked about.

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  existing: [] as Row[],
  blocked: new Set<string>(),
  asked: [] as string[][],
  edits: [] as Array<{ id: string; body: Row }>,
  statuses: [] as Array<{ id: string; status: string }>,
}))

vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      findMany: async () => h.existing,
      updateMany: async () => ({ count: 0 }),
    },
  },
}))
vi.mock('@/lib/core/licence-check', () => ({
  licenceBlockedIds: async (ids: string[]) => { h.asked.push(ids); return new Set(ids.filter((id) => h.blocked.has(id))) },
}))
vi.mock('@/lib/core/listings', () => ({
  updateListingCore: async (id: string, body: Row) => { h.edits.push({ id, body }); return { ok: true } },
  setStatusCore: async (id: string, status: string) => { h.statuses.push({ id, status }); return { ok: true, status } },
}))
vi.mock('@/lib/core/bulk', () => ({ bulkImportCore: async () => ({ results: [] }), rehostListingImage: async () => null, claimRehostedImages: async () => {}, discardRehostedImages: async () => {}, BULK_MAX_ROWS: 200 }))
vi.mock('@/lib/enforcement', () => ({ bulkPostingBudget: async () => ({ blocked: null, maxNewActive: null }) }))
vi.mock('@/lib/released-charge-gate', () => ({ releasedChargeStanding: async () => null, releasedChargeGateFor: async () => ({ remaining: 99 }) }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ sellerPublishDecision: async () => ({ ok: true }) }))
vi.mock('@/lib/listing-index', () => ({ removeFromIndex: async () => {} }))
vi.mock('@/lib/webhooks', () => ({ dispatchListingEventsBatch: async () => {} }))
vi.mock('next/server', () => ({ after: () => {} }))

const { syncListingsCore } = await import('@/lib/core/sync')

const SELLER = { id: 's1', ownerId: 'owner-1', trustTier: 'standard', trustScore: 100 }
/** A synced row as the sync reads it — published (`verified: true`) unless a case says otherwise. */
const existing = (id: string, externalId: string, status: string, subcategorySlug: string | null, verified = true) => ({ id, externalId, status, subcategorySlug, verified })

beforeEach(() => {
  h.existing = []
  h.blocked = new Set()
  h.asked = []
  h.edits = []
  h.statuses = []
})

describe('syncListingsCore — a revive of an unchecked e-Visa / Legal & permits row', () => {
  it('⛔ fails with licence_check_required BEFORE any write — neither its edits nor its status are applied', async () => {
    h.existing = [existing('L1', 'sku-1', 'hidden', 'visa-legal')]
    h.blocked = new Set(['L1'])
    const out = await syncListingsCore(SELLER, [{ externalId: 'sku-1', title: 'e-Visa, 1 hour', status: 'active' }], 'partial')
    expect(out.results).toEqual([{ external_id: 'sku-1', id: 'L1', action: 'failed', error: 'licence_check_required' }])
    expect(out.failed).toBe(1)
    expect(h.edits).toEqual([])
    expect(h.statuses).toEqual([])
  })

  it('asks ONCE, and only about revives of rows filed in an aisle; everything else syncs as before', async () => {
    h.existing = [
      existing('L1', 'sku-1', 'hidden', 'visa-legal'), // revive, aisle, cleared → asked, goes through
      existing('L2', 'sku-2', 'sold', 'legal-permits'), // revive, aisle, blocked → asked, refused
      existing('L3', 'sku-3', 'hidden', 'cleaning'), // revive outside the aisles → not asked
      existing('L4', 'sku-4', 'active', 'visa-legal'), // active → active: no revive → not asked
      existing('L5', 'sku-5', 'hidden', 'visa-legal'), // a hide: no revive → not asked
    ]
    h.blocked = new Set(['L2'])
    const out = await syncListingsCore(SELLER, [
      { externalId: 'sku-1', status: 'active' },
      { externalId: 'sku-2', status: 'active' },
      { externalId: 'sku-3', status: 'active' },
      { externalId: 'sku-4', status: 'active' },
      { externalId: 'sku-5', status: 'hidden' },
    ], 'partial')
    expect(h.asked).toEqual([['L1', 'L2']])
    expect(out.results.find((r) => r.id === 'L2')).toMatchObject({ action: 'failed', error: 'licence_check_required' })
    expect(h.statuses.map((s) => s.id)).toEqual(['L1', 'L3', 'L4', 'L5'])
    expect(out.updated).toBe(4)
  })

  // Commit gate, 2026-10-14: as setStatusCore — a row still WAITING for the check (unverified) does not become public by
  // going active, so the sync un-hides it like any held listing; only verified rows are asked about.
  it('an unverified aisle row (still waiting for the check) is not asked about — it is un-hidden like any held listing', async () => {
    h.existing = [existing('L6', 'sku-6', 'hidden', 'visa-legal', false)]
    h.blocked = new Set(['L6'])
    const out = await syncListingsCore(SELLER, [{ externalId: 'sku-6', status: 'active' }], 'partial')
    expect(h.asked).toEqual([[]])
    expect(out.results.find((r) => r.id === 'L6')?.action).not.toBe('failed')
    expect(h.statuses).toEqual([{ id: 'L6', status: 'active' }])
  })

  it('a sync with no revive in an aisle asks about nothing (the empty ask reads nothing)', async () => {
    h.existing = [existing('L3', 'sku-3', 'hidden', null)]
    await syncListingsCore(SELLER, [{ externalId: 'sku-3', status: 'active' }], 'partial')
    expect(h.asked).toEqual([[]])
    expect(h.statuses).toEqual([{ id: 'L3', status: 'active' }])
  })
})
