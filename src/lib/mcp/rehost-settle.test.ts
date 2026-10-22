import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * MCP create_listing / update_listing SETTLE the images they re-host (security review 2026-10-22, item 13): claimed once
 * the listing holds them, discarded when the write is refused before it happens — and only the images THIS call stored,
 * never a first-party URL the agent passed (it came back unchanged, and may be another listing's photo). An unexpected
 * throw leaves them to the tombstone sweep, which keeps whatever a listing does hold.
 */

type Row = Record<string, any>
const OURS = 'https://sb.test/storage/v1/object/public/listings/'
const h = vi.hoisted(() => ({
  update: { ok: true } as Row,
  createError: null as Error | null,
  claimed: [] as string[][],
  discarded: [] as string[][],
}))

vi.mock('@/lib/api/auth', () => ({ listingOwnedBy: async () => true }))
vi.mock('@/lib/core/listings', () => ({
  setStatusCore: async () => ({ ok: true }),
  createListingCore: async () => { if (h.createError) throw h.createError; return { id: 'new', verified: true } },
  updateListingCore: async () => h.update,
  deleteListingCore: async () => ({ ok: true, deleted: true }),
  DELETE_HOLD_MESSAGE: {},
}))
vi.mock('@/lib/db', () => ({
  db: {
    category: { findUnique: async () => ({ id: 'c-electronics', slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' }) },
    seller: { findUnique: async () => ({ id: 's1', ownerId: 'p1', trustTier: 'standard', trustScore: 100, phone: null }) },
  },
}))
vi.mock('@/lib/serialize', () => ({ serializeListing: () => ({}) }))
vi.mock('@/lib/ssrf', () => ({ assertSafeUrl: async () => {} }))
vi.mock('@/lib/core/bulk', () => ({
  bulkImportCore: async () => ({}),
  // A first-party URL passes through unchanged; a remote one comes back as a new object in our bucket.
  rehostListingImage: async (u: string) => (u.startsWith(OURS) ? u : `${OURS}bulk/${u.split('/').pop()}.webp`),
  claimRehostedImages: async (fresh: string[]) => { h.claimed.push(fresh) },
  discardRehostedImages: async (fresh: string[]) => { h.discarded.push(fresh) },
  BULK_MAX_ROWS: 200,
}))
vi.mock('@/lib/core/sync', () => ({ syncListingsCore: async () => ({}), SYNC_MAX_ROWS: 200 }))
vi.mock('@/lib/core/seller', () => ({ updateSellerCore: async () => ({ ok: true }) }))
vi.mock('@/lib/enforcement', () => ({ postingGate: async () => null }))
vi.mock('@/lib/listing-analytics', () => ({ getListingAnalytics: async () => ({}) }))
vi.mock('@/lib/webhooks', () => ({ dispatchListingEventsBatch: async () => {}, generateWebhookSecret: () => 'x' }))
vi.mock('next/server', () => ({ after: () => {} }))

const { TOOLS } = await import('./tools')
const { PublishBlockedError } = await import('@/lib/publish-guard')
const AUTH = { keyId: 'k1', sellerId: 's1', profileId: 'p1', scopes: new Set(['listings:write']) }
const tool = (name: string) => TOOLS.find((t) => t.name === name)!
const LIVE = `${OURS}bulk/live-photo.webp`
const images = [LIVE, 'https://shop.example/a', 'https://shop.example/b']
const FRESH = [`${OURS}bulk/a.webp`, `${OURS}bulk/b.webp`]

beforeEach(() => {
  h.update = { ok: true }
  h.createError = null
  h.claimed = []
  h.discarded = []
})

describe('create_listing', () => {
  const run = () => tool('create_listing').handler(AUTH as never, { category: 'electronics', title: 'iPhone 15 Pro', price: 18_000_000, images } as never)

  it('a created listing claims exactly the images this call stored', async () => {
    await run()
    expect(h.claimed).toEqual([FRESH])
    expect(h.discarded).toEqual([])
  })

  it('⛔ a publish refusal discards them — never the first-party photo the agent passed', async () => {
    h.createError = new PublishBlockedError('photos_min')
    await expect(run()).rejects.toBeTruthy()
    expect(h.discarded).toEqual([FRESH])
    expect(h.discarded.flat()).not.toContain(LIVE)
    expect(h.claimed).toEqual([])
  })

  it('an unexpected throw discards nothing (the sweep re-checks references before it deletes)', async () => {
    h.createError = new Error('db down')
    await expect(run()).rejects.toThrow('db down')
    expect(h.discarded).toEqual([])
    expect(h.claimed).toEqual([])
  })
})

describe('update_listing', () => {
  const run = () => tool('update_listing').handler(AUTH as never, { id: 'L1', images } as never)

  it('an applied edit claims the fresh images', async () => {
    await run()
    expect(h.claimed).toEqual([FRESH])
  })

  it('⛔ a refused edit (nothing written) discards them, and only them', async () => {
    h.update = { ok: false, code: 400, error: 'photos_min' }
    await expect(run()).rejects.toBeTruthy()
    expect(h.discarded).toEqual([FRESH])
  })
})
