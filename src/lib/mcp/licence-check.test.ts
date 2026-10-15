import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE MCP TOOLS ON THE LICENCE CHECK (owner, 2026-10-14). e-Visa and Legal & permits listings from any shop but eno's own
 * wait for eno's licence check, and an agent must be told so in words it can relay — never a plain "ok" that reads as
 * live, never an internal_error:
 *   · update_listing answers `held: true` for a listing still waiting (the same flag as PATCH /api/v1/listings/{id}), and
 *     `listing_changed` — the edit raced eno's check, nothing written — with a sentence;
 *   · set_listing_status's `licence_check_required` gets a sentence, like the hold refusals beside it;
 *   · create_listing can send neither a subcategory nor attributes, so a service whose words file it in a licence aisle
 *     (a guess counts as a pick) is refused with a coded tool error naming the way that can post it.
 * The cores' rules are pinned in src/lib/core/listings.sell-rules.test.ts and listings.licence-revive.test.ts.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({
  update: { ok: true } as Row,
  status: { ok: true, status: 'active' } as Row,
  createError: null as Error | null,
}))

vi.mock('@/lib/api/auth', () => ({ listingOwnedBy: async () => true }))
vi.mock('@/lib/core/listings', () => ({
  setStatusCore: async () => h.status,
  createListingCore: async () => { if (h.createError) throw h.createError; return { id: 'new', verified: true } },
  updateListingCore: async () => h.update,
  deleteListingCore: async () => ({ ok: true, deleted: true }),
  DELETE_HOLD_MESSAGE: {},
}))
// The rest of the tool module's import graph — not exercised here.
vi.mock('@/lib/db', () => ({
  db: {
    category: { findUnique: async () => ({ id: 'c-services', slug: 'services', name: 'Services', nameVi: 'Dịch vụ' }) },
    seller: { findUnique: async () => ({ id: 's1', ownerId: 'p1', trustTier: 'standard', trustScore: 100, phone: null }) },
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
const { PublishBlockedError } = await import('@/lib/publish-guard')
const { LICENCE_CHECK_REQUIRED_COPY, LISTING_CHANGED_COPY } = await import('@/lib/licence-check-copy')
const AUTH = { keyId: 'k1', sellerId: 's1', profileId: 'p1', scopes: new Set(['listings:write']) }
const tool = (name: string) => TOOLS.find((t) => t.name === name)!

beforeEach(() => {
  h.update = { ok: true }
  h.status = { ok: true, status: 'active' }
  h.createError = null
})

describe('update_listing', () => {
  const run = () => tool('update_listing').handler(AUTH as never, { id: 'L1', title: 'e-Visa in 3 days' } as never)

  it('⛔ a listing still waiting for eno’s licence check answers held — an agent must not read "ok" as live', async () => {
    h.update = { ok: true, held: true }
    expect(await run()).toEqual({ ok: true, held: true })
    h.update = { ok: true }
    expect(await run()).toEqual({ ok: true })
  })

  it('the description says so, and that the tool cannot change a subcategory or the licence values', () => {
    expect(tool('update_listing').description).toMatch(/held: true/)
    expect(tool('update_listing').description).toMatch(/cannot change a subcategory or the licence values/)
  })

  it('listing_changed → a ToolError carrying the code and "reload and try again"', async () => {
    h.update = { ok: false, code: 409, error: 'listing_changed' }
    await expect(run()).rejects.toMatchObject({ code: 'listing_changed', message: LISTING_CHANGED_COPY.en })
  })

  it('other refusals keep the code as the message (unchanged)', async () => {
    h.update = { ok: false, code: 400, error: 'title_too_short' }
    await expect(run()).rejects.toMatchObject({ code: 'title_too_short', message: 'title_too_short' })
  })
})

describe('set_listing_status', () => {
  it('licence_check_required → a ToolError carrying the code and the sentence', async () => {
    h.status = { ok: false, code: 409, error: 'licence_check_required' }
    const e = await tool('set_listing_status').handler(AUTH as never, { id: 'L1', status: 'active' } as never).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ToolError)
    expect(e).toMatchObject({ code: 'licence_check_required', message: LICENCE_CHECK_REQUIRED_COPY.en })
  })
})

describe('create_listing', () => {
  const go = () => tool('create_listing').handler(AUTH as never, { title: 'Vietnam e-visa, 1 hour', price: 500000, categorySlug: 'services' } as never)

  it('⛔ provider_licence_required → a coded ToolError naming the way that can post it — not internal_error', async () => {
    h.createError = new PublishBlockedError('provider_licence_required')
    const e = await go().catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ToolError)
    expect(e).toMatchObject({ code: 'provider_licence_required', message: expect.stringContaining('POST /api/v1/listings') })
  })
})
