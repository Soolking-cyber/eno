import { describe, expect, it, vi } from 'vitest'

// Inputs that are described strings since 2026-11-15 (no enum in the schema): the handlers refuse anything else before they
// touch a row, and the published schema carries no ±2^53 integer bounds.
vi.mock('@/lib/db', () => ({ db: { seller: { findUnique: async () => ({ id: 's1', ownerId: 'p1', trustTier: 'standard', trustScore: 100 }) }, webhookEndpoint: { count: async () => 0 } } }))
vi.mock('@/lib/core/sync', () => ({ syncListingsCore: async () => { throw new Error('must not run') }, SYNC_MAX_ROWS: 200 }))
vi.mock('@/lib/ssrf', () => ({ assertSafeUrl: async () => {} }))
vi.mock('next/server', () => ({ after: () => {} }))
const { TOOLS, toolDescriptors, ToolError } = await import('./tools')
const AUTH = { keyId: 'k1', sellerId: 's1', profileId: 'p1', scopes: new Set(['listings:write']) } as never
const tool = (n: string) => TOOLS.find((t) => t.name === n)!

describe('described-string inputs are checked by the handler', () => {
  it('sync_catalogue refuses a mode that is not partial or full, before any row is synced', async () => {
    const row = { categorySlug: 'electronics', title: 'A phone', price: 1, externalId: 'a' }
    await expect(tool('sync_catalogue').handler(AUTH, { mode: 'Full', listings: [row] })).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(tool('sync_catalogue').handler(AUTH, { mode: 'mirror', listings: [row] })).rejects.toBeInstanceOf(ToolError)
  })
  it('register_webhook refuses an event name it does not send', async () => {
    await expect(tool('register_webhook').handler(AUTH, { url: 'https://x.example/h', events: ['listing.sold'] })).rejects.toMatchObject({ code: 'invalid_input' })
  })
  it('list_listings refuses a status filter that is not active, sold or hidden', async () => {
    for (const status of ['Sold', 'removed', 'expired', '']) {
      await expect(tool('list_listings').handler(AUTH, { status })).rejects.toMatchObject({ code: 'invalid_input', message: 'status must be active, sold or hidden.' })
    }
  })
  it('sync_catalogue refuses a row status it does not know, naming the row, before any row is synced', async () => {
    const ok = { categorySlug: 'electronics', title: 'A phone', price: 1, externalId: 'a', status: 'sold' }
    const bad = { ...ok, externalId: 'b', status: 'out_of_stock' }
    await expect(tool('sync_catalogue').handler(AUTH, { listings: [ok, bad] })).rejects.toMatchObject({ code: 'invalid_input', message: 'Row 2: status must be active, sold or hidden.' })
  })
  it('create_listing and update_listing refuse a salaryM that is not a whole number of millions, 0 or more', async () => {
    for (const salaryM of [2.5, -1, Number.NaN, 151, 25_000_000, 1e300]) {
      await expect(tool('create_listing').handler(AUTH, { categorySlug: 'jobs', title: 'English teacher', salaryM })).rejects.toMatchObject({ code: 'invalid_input' })
      await expect(tool('update_listing').handler(AUTH, { id: 'L1', salaryM })).rejects.toMatchObject({ code: 'invalid_input' })
    }
  })
  it('no published input carries a minimum or an integer type, and the only enum is list_listings\' status filter', () => {
    const json = JSON.stringify(toolDescriptors().map((d) => d.inputSchema))
    expect(JSON.stringify(toolDescriptors().filter((d) => d.name !== 'list_listings').map((d) => d.inputSchema))).not.toContain('"enum"')
    expect(JSON.stringify(toolDescriptors().find((d) => d.name === 'list_listings')!.inputSchema)).toContain('"enum":["active","sold","hidden"]')
    expect(json).not.toContain('"minimum"')
    expect(json).not.toContain('"integer"')
  })
  it('bulk_create_listings and sync_catalogue refuse no rows or more than 200, before anything is read; the schema carries no item bounds', async () => {
    const row = { categorySlug: 'electronics', title: 'A phone', price: 1, externalId: 'a' }
    for (const name of ['bulk_create_listings', 'sync_catalogue']) {
      await expect(tool(name).handler(AUTH, { listings: [] })).rejects.toMatchObject({ code: 'invalid_input', message: 'Send at least one row in `listings`.' })
      await expect(tool(name).handler(AUTH, { listings: Array.from({ length: 201 }, () => row) })).rejects.toMatchObject({ code: 'invalid_input', message: 'Send at most 200 rows in one call; send the rest in further calls.' })
    }
    // bulk_create_listings keeps its schema bounds (they scored better, round 4); no other input publishes item bounds.
    const bulk = toolDescriptors().find((d) => d.name === 'bulk_create_listings')!.inputSchema as { properties: { listings: { minItems?: number; maxItems?: number } } }
    expect([bulk.properties.listings.minItems, bulk.properties.listings.maxItems]).toEqual([1, 200])
    const others = JSON.stringify(toolDescriptors().filter((d) => d.name !== 'bulk_create_listings').map((d) => d.inputSchema))
    expect(others).not.toContain('"minItems"')
    expect(others).not.toContain('"maxItems"')
  })
  it('no published input carries the ±2^53 bounds of zod .int()', () => {
    expect(JSON.stringify(toolDescriptors().map((d) => d.inputSchema))).not.toContain(String(Number.MAX_SAFE_INTEGER))
  })
})
