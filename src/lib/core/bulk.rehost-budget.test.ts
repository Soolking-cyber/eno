import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Security review 2026-10-22, item 13: remote image re-hosting (MCP create/update, bulk import, catalogue sync) is
 * charged against a per-seller hourly budget, and a remote body is read with a hard byte ceiling that ABORTS the
 * transfer, instead of buffering it whole and checking the size afterwards.
 */

const h = vi.hoisted(() => ({
  budgetOk: true,
  budgetCalls: [] as Array<{ name: string; key: string }>,
  fetched: [] as string[],
  body: new Uint8Array([1, 2, 3]) as Uint8Array<ArrayBuffer>,
  headers: {} as Record<string, string>,
  uploads: 0,
}))

vi.mock('server-only', () => ({}))
vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async (name: string, key: string) => { h.budgetCalls.push({ name, key }); return { success: h.budgetOk } },
}))
vi.mock('@/lib/listing-image', () => ({ isListingImageUrl: (u: string) => u.startsWith('https://cdn.eno.test/'), isListingVideoUrl: () => false }))
vi.mock('@/lib/ssrf', () => ({
  safeFetch: async (u: string) => { h.fetched.push(u); return new Response(h.body, { headers: h.headers }) },
}))
vi.mock('@/lib/core/media', () => ({ storeListingImage: async () => `https://cdn.eno.test/bulk/${++h.uploads}.webp`, IMG_MAX_BYTES: 1000 }))

const { rehostListingImage } = await import('./bulk')

beforeEach(() => {
  h.budgetOk = true
  h.budgetCalls = []
  h.fetched = []
  h.body = new Uint8Array([1, 2, 3])
  h.headers = {}
  h.uploads = 0
})

describe('rehostListingImage — per-seller budget and byte ceiling (item 13)', () => {
  it('re-hosts a remote image and charges the SELLER’s hourly budget', async () => {
    expect(await rehostListingImage('https://img.example/a.jpg', 'seller-9')).toBe('https://cdn.eno.test/bulk/1.webp')
    expect(h.budgetCalls).toEqual([{ name: 'rehost-images', key: 'seller-9' }])
  })

  it('over budget: the image is skipped WITHOUT fetching anything', async () => {
    h.budgetOk = false
    expect(await rehostListingImage('https://img.example/a.jpg', 'seller-9')).toBeNull()
    expect(h.fetched).toEqual([])
    expect(h.uploads).toBe(0)
  })

  it('an image already on our bucket passes through free — no budget charge, no fetch', async () => {
    expect(await rehostListingImage('https://cdn.eno.test/x.webp', 'seller-9')).toBe('https://cdn.eno.test/x.webp')
    expect(h.budgetCalls).toEqual([])
    expect(h.fetched).toEqual([])
  })

  it('a body over the ceiling is refused (streamed, not buffered whole)', async () => {
    h.body = new Uint8Array(5000) // ceiling is 1000 in this harness
    expect(await rehostListingImage('https://img.example/big.jpg', 'seller-9')).toBeNull()
    expect(h.uploads).toBe(0)
  })

  it('a declared Content-Length over the ceiling is refused before reading', async () => {
    h.headers = { 'content-length': '999999' }
    expect(await rehostListingImage('https://img.example/big.jpg', 'seller-9')).toBeNull()
    expect(h.uploads).toBe(0)
  })
})
