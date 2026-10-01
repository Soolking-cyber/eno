import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * MCP and TOMBSTONES (src/lib/listing-removed.ts), 2026-10-01 review.
 *  · `list_listings` ANDs the not-removed guard with the caller's status filter — it used to SPREAD it
 *    (`{ ...NOT_REMOVED, status }`), so a caller's `status` replaced the guard.
 *  · `delete_listing` never answers a refused hide with a silent `{ ok: true }`.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({ finds: [] as Row[], del: { ok: true, deleted: true } as Row }))

vi.mock('@/lib/api/auth', () => ({ listingOwnedBy: async () => true }))
vi.mock('@/lib/core/listings', () => ({
  setStatusCore: async () => ({ ok: true, status: 'active' }),
  createListingCore: async () => ({ id: 'new', verified: true }),
  updateListingCore: async () => ({ ok: true }),
  deleteListingCore: async () => h.del,
  DELETE_HOLD_MESSAGE: {},
}))
vi.mock('@/lib/db', () => ({
  db: { listing: { findMany: async (a: Row) => { h.finds.push(a); return [] } } },
}))
vi.mock('@/lib/serialize', () => ({ serializeListing: () => ({}) }))
vi.mock('@/lib/ssrf', () => ({ assertSafeUrl: async () => {} }))
vi.mock('@/lib/core/bulk', () => ({ bulkImportCore: async () => ({}), rehostListingImage: async () => null, BULK_MAX_ROWS: 200 }))
vi.mock('@/lib/core/sync', () => ({ syncListingsCore: async () => ({}), SYNC_MAX_ROWS: 200 }))
vi.mock('@/lib/core/seller', () => ({ updateSellerCore: async () => ({ ok: true }) }))
vi.mock('@/lib/enforcement', () => ({ postingGate: async () => null }))
vi.mock('@/lib/listing-analytics', () => ({ getListingAnalytics: async () => ({}) }))
vi.mock('@/lib/webhooks', () => ({ dispatchListingEventsBatch: async () => {}, generateWebhookSecret: () => 'x' }))
vi.mock('next/server', () => ({ after: () => {} }))

const { TOOLS, ToolError } = await import('./tools')
const { NOT_REMOVED } = await import('@/lib/listing-removed')
const AUTH = { keyId: 'k1', sellerId: 's1', profileId: 'p1', scopes: new Set(['listings:read', 'listings:write']) }
const tool = (name: string) => TOOLS.find((t) => t.name === name)!

beforeEach(() => { h.finds = []; h.del = { ok: true, deleted: true } })

/** Every status constraint a Prisma where would apply, top level and under AND. */
const statusConstraints = (w: Row): Row[] => [
  ...(w.status !== undefined ? [w.status] : []),
  ...((w.AND as Row[] | undefined) ?? []).flatMap(statusConstraints),
]

describe('list_listings', () => {
  it.each([undefined, 'active', 'sold', 'hidden', 'removed'])('status %s → the not-removed guard is still in the where', async (status) => {
    // 'removed' cannot pass the zod enum over the wire; the handler is called directly here on purpose.
    await tool('list_listings').handler(AUTH as never, (status ? { status } : {}) as never)
    const where = h.finds[0].where
    expect(statusConstraints(where)).toContainEqual(NOT_REMOVED.status)
    expect(where.AND).toContainEqual({ sellerId: 's1' })
    if (status) expect(where.AND).toContainEqual({ status })
  })

  it('the wire still refuses status "removed" (zod enum)', () => {
    expect(tool('list_listings').input.safeParse({ status: 'removed' }).success).toBe(false)
  })
})

describe('delete_listing', () => {
  it('a refused hide (not "already gone") is an error with its own code, never { ok: true }', async () => {
    h.del = { ok: false, code: 403, error: 'account_held' }
    await expect(tool('delete_listing').handler(AUTH as never, { id: 'L1' } as never)).rejects.toMatchObject({ code: 'account_held' })
    await expect(tool('delete_listing').handler(AUTH as never, { id: 'L1' } as never)).rejects.toBeInstanceOf(ToolError)
  })

  it('a 404 (already gone or removed) stays the idempotent { ok: true }', async () => {
    h.del = { ok: false, code: 404, error: 'not_found' }
    expect(await tool('delete_listing').handler(AUTH as never, { id: 'L1' } as never)).toEqual({ ok: true })
  })
})
