import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * MCP `set_listing_status` — THE HOLD LEAK'S REFUSAL, IN WORDS (2026-09-24). setStatusCore refuses a
 * held or suspended shop's relist with `account_held` / `account_suspended`; the agent gets the code
 * AND a sentence it can relay to the seller (as `create_listing` does for postingGate), not the bare
 * code as its message. The rule itself is proved in src/lib/core/identity-gate.test.ts.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({ status: { ok: true, status: 'active' } as Row, createError: null as Error | null }))

vi.mock('@/lib/api/auth', () => ({ listingOwnedBy: async () => true }))
vi.mock('@/lib/core/listings', () => ({
  setStatusCore: async () => h.status,
  createListingCore: async () => { if (h.createError) throw h.createError; return { id: 'new', verified: true } },
  updateListingCore: async () => ({ ok: true }),
  deleteListingCore: async () => ({ ok: true, deleted: true }),
  DELETE_HOLD_MESSAGE: {},
}))
// The rest of the tool module's import graph — not exercised here.
vi.mock('@/lib/db', () => ({
  db: {
    // create_listing's reads (the released-charge cap case below).
    category: { findUnique: async () => ({ id: 'c1', slug: 'phones', name: 'Phones', nameVi: 'Điện thoại' }) },
    seller: { findUnique: async () => ({ id: 's1', ownerId: 'p1', trustTier: 'restricted', trustScore: 20, phone: null }) },
  },
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
const tool = TOOLS.find((t) => t.name === 'set_listing_status')!
const AUTH = { keyId: 'k1', sellerId: 's1', profileId: 'p1', scopes: new Set(['listings:write']) }
const run = () => tool.handler(AUTH as never, { id: 'L1', status: 'active' } as never)

beforeEach(() => { h.status = { ok: true, status: 'active' }; h.createError = null })

describe('set_listing_status', () => {
  for (const code of ['account_held', 'account_suspended']) {
    it(`${code}: a ToolError carrying the code and a sentence`, async () => {
      h.status = { ok: false, code: 403, error: code }
      const e = await run().catch((x: unknown) => x)
      expect(e).toBeInstanceOf(ToolError)
      expect(e).toMatchObject({ code, message: expect.stringMatching(/held or suspended, so its listings cannot be put back on sale/) })
    })
  }

  it('released_charge_listing_cap: a ToolError carrying the code and a sentence naming the limit', async () => {
    h.status = { ok: false, code: 403, error: 'released_charge_listing_cap' }
    await expect(run()).rejects.toMatchObject({ code: 'released_charge_listing_cap', message: expect.stringContaining('at most 10 active listings') })
  })

  it('other refusals keep the code as the message (unchanged)', async () => {
    h.status = { ok: false, code: 400, error: 'invalid_status' }
    await expect(run()).rejects.toMatchObject({ code: 'invalid_status', message: 'invalid_status' })
  })

  it('success is unchanged', async () => {
    expect(await run()).toEqual({ ok: true, status: 'active' })
  })
})

describe('create_listing — the released-charge cap is a coded tool error, not internal_error', () => {
  const create = TOOLS.find((t) => t.name === 'create_listing')!
  const go = () => create.handler(AUTH as never, { title: 'A phone', price: 100000, categorySlug: 'phones' } as never)

  it('released_charge_listing_cap → ToolError with the code and the sentence', async () => {
    const { PublishBlockedError } = await import('@/lib/publish-guard')
    h.createError = new PublishBlockedError('released_charge_listing_cap')
    const e = await go().catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ToolError)
    expect(e).toMatchObject({ code: 'released_charge_listing_cap', message: expect.stringContaining('at most 10 active listings') })
  })

  it('any other publish refusal is re-thrown as before (the MCP route maps it)', async () => {
    const { PublishBlockedError } = await import('@/lib/publish-guard')
    h.createError = new PublishBlockedError('photos_min')
    const e = await go().catch((x: unknown) => x)
    expect(e).not.toBeInstanceOf(ToolError)
    expect(e).toMatchObject({ code: 'photos_min' })
  })

  it('success is unchanged', async () => {
    expect(await go()).toEqual({ listing: { id: 'new', verified: true } })
  })
})
