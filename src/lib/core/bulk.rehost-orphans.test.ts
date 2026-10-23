import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ RE-HOSTED IMAGES ARE SETTLED, NEVER LEFT BEHIND (security review 2026-10-22, item 13). bulkImportCore stores a row's
 * remote photos in the public listings bucket BEFORE it creates the row, and a row refused after its photos used to leave
 * them there for good. Pinned here:
 *   · every image this code stores is tombstoned at once ('listing_image_rehost_pending');
 *   · a created row CLAIMS its fresh images (their tombstones are cleared);
 *   · a row refused for its photos DISCARDS them at once — and only the ones it stored: a first-party URL that came in
 *     already hosted (it may be a live listing's photo) is never touched;
 *   · the account caps run BEFORE any image is fetched ("re-host only after the gates").
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  creates: [] as Row[],
  fetched: [] as string[],
  written: [] as Array<{ refs: Row[]; reason: string }>,
  cleared: [] as Row[][],
  removed: [] as string[][],
  stored: 0,
  maxNewActive: null as number | null,
  events: [] as string[],
  tombstoneFails: false,
  uploadFails: false,
  createError: null as (Error & { code?: string }) | null,
  takenExternalIds: new Set<string>(),
}))

const HOST = 'https://sb.test'
const OURS = (path: string) => `${HOST}/storage/v1/object/public/listings/${path}`

vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('@/lib/db', () => ({
  db: {
    category: { findMany: async () => [{ id: 'c-electronics', slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' }] },
    listing: {
      findMany: async () => [],
      findFirst: async (a: Row) => (h.takenExternalIds.has(a.where.externalId) ? { id: 'taken' } : null),
      create: async (a: Row) => { if (h.createError) throw h.createError; h.creates.push(a.data); return { id: `new${h.creates.length}` } },
    },
  },
}))
vi.mock('@/lib/core/storage-tombstones', () => ({
  writeTombstones: async (_tx: unknown, refs: Row[], reason: string) => {
    if (h.tombstoneFails) throw new Error('db down')
    h.events.push(`tombstone ${refs.map((x) => x.path).join()}`)
    h.written.push({ refs, reason })
    return refs.length
  },
  clearTombstones: async (refs: Row[]) => { h.cleared.push(refs); return refs.length },
}))
vi.mock('@/lib/supabase-admin', () => ({
  LISTINGS_BUCKET: 'listings',
  getSupabaseAdmin: () => ({ storage: { from: () => ({ remove: async (paths: string[]) => { h.removed.push(paths); return { error: null } } }) } }),
}))
vi.mock('@/lib/listing-image', () => ({ isListingImageUrl: (u: string) => u.startsWith(OURS('')), isListingVideoUrl: () => false }))
vi.mock('@/lib/ssrf', () => ({ safeFetch: async (u: string) => { h.fetched.push(u); return new Response(new Uint8Array([1, 2, 3])) } }))
// The real storeListingImage's contract: beforeUpload(path) runs before a byte is stored, and its throw means no upload.
vi.mock('@/lib/core/media', () => ({
  storeListingImage: async (_buf: unknown, opts: { beforeUpload?: (path: string) => Promise<void> } = {}) => {
    const path = `bulk/${++h.stored}.webp`
    try { await opts.beforeUpload?.(path) } catch { return null }
    if (h.uploadFails) return null
    h.events.push(`upload ${path}`)
    return OURS(path)
  },
  IMG_MAX_BYTES: 1_000_000,
}))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/enforcement', () => ({ bulkPostingBudget: async () => ({ blocked: null, maxNewActive: h.maxNewActive }) }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ sellerPublishDecision: async () => ({ ok: true }) }))
vi.mock('@/lib/released-charge-gate', () => ({ releasedChargeGate: async () => null, releasedChargeStanding: async () => null, releasedChargeGateFor: async () => null }))
vi.mock('@/lib/duplicate-guard', () => ({ findDuplicateListing: async () => null }))
vi.mock('@/lib/translate', () => ({ warmTranslations: async () => {} }))
vi.mock('@/lib/listing-index', () => ({ reindexListing: async () => {}, removeFromIndex: async () => {} }))
vi.mock('@/lib/ai-moderation', () => ({ moderateListingById: async () => {} }))
vi.mock('@/lib/image-provenance', () => ({ indexAndCheckProvenance: async () => {} }))
vi.mock('@/lib/ranking', () => ({ browseRankScore: () => 0 }))

const { bulkImportCore } = await import('@/lib/core/bulk')

const SELLER = { id: 's1', ownerId: 'owner-1', trustTier: 'standard', trustScore: 70 }
const phone = (images: string[]) => ({ category_slug: 'electronics', title: 'iPhone 15 Pro 256GB', description: 'Pin 92%, máy đẹp.', price: 18_000_000, image_urls: images.join('|') })
const remote = (n: number) => Array.from({ length: n }, (_, i) => `https://shop.example/p${i}.jpg`)

beforeEach(() => {
  Object.assign(h, {
    creates: [], fetched: [], written: [], cleared: [], removed: [], stored: 0, maxNewActive: null,
    events: [], tombstoneFails: false, uploadFails: false, createError: null, takenExternalIds: new Set<string>(),
  })
})

describe('bulkImportCore — re-hosted images are settled', () => {
  it('each stored image is tombstoned at once; the created row claims them all', async () => {
    const r = await bulkImportCore(SELLER, [phone(remote(3))])
    expect(r.results).toEqual([{ row: 1, id: 'new1' }])
    expect(h.written.map((w) => w.reason)).toEqual(['listing_image_rehost_pending', 'listing_image_rehost_pending', 'listing_image_rehost_pending'])
    expect(h.written.flatMap((w) => w.refs)).toEqual([1, 2, 3].map((n) => ({ bucket: 'listings', path: `bulk/${n}.webp` })))
    expect(h.cleared).toEqual([[1, 2, 3].map((n) => ({ bucket: 'listings', path: `bulk/${n}.webp` }))])
    expect(h.removed).toEqual([])
  })

  it('⛔ a row refused for its photos deletes what it stored at once', async () => {
    const r = await bulkImportCore(SELLER, [phone(remote(1))]) // electronics needs three angles
    expect(r.results[0].error).toMatch(/Needs at least 3 photos/)
    expect(h.creates).toEqual([])
    expect(h.removed).toEqual([['bulk/1.webp']])
    expect(h.cleared).toEqual([[{ bucket: 'listings', path: 'bulk/1.webp' }]])
  })

  it('⛔ …and ONLY what it stored: a photo that came in already hosted (a live listing\'s, perhaps) is never deleted', async () => {
    const live = OURS('bulk/existing-live-photo.webp')
    const r = await bulkImportCore(SELLER, [phone([live, ...remote(1)])]) // two distinct, still short of three
    expect(r.results[0].error).toMatch(/Needs at least 3 photos/)
    expect(h.removed).toEqual([['bulk/1.webp']])
    expect(h.removed.flat()).not.toContain('bulk/existing-live-photo.webp')
    expect(h.written.flatMap((w) => w.refs).map((x) => x.path)).toEqual(['bulk/1.webp'])
  })

  it('the account cap is checked BEFORE any image is fetched — a capped row costs no fetch, decode or upload', async () => {
    h.maxNewActive = 0
    const r = await bulkImportCore(SELLER, [phone(remote(3))])
    expect(r.results).toEqual([{ row: 1, error: 'probation_listing_cap' }])
    expect(h.fetched).toEqual([])
    expect(h.written).toEqual([])
  })
})

// Refute review 2026-10-23: the tombstone must exist BEFORE the object, and a row the database refuses must not leave
// its photos to the sweep's ~1000-a-day queue.
describe('bulkImportCore — ordering and refused inserts', () => {
  it('⛔ each tombstone is written BEFORE its upload — a process killed in between leaves nothing untracked', async () => {
    await bulkImportCore(SELLER, [phone(remote(3))])
    expect(h.events).toEqual([1, 2, 3].flatMap((n) => [`tombstone bulk/${n}.webp`, `upload bulk/${n}.webp`]))
  })

  it('⛔ no tombstone, no upload: a failed tombstone write skips the image (fail closed)', async () => {
    h.tombstoneFails = true
    const r = await bulkImportCore(SELLER, [phone(remote(3))])
    expect(r.results[0].error).toMatch(/Needs at least 3 photos/)
    expect(h.events.filter((e) => e.startsWith('upload'))).toEqual([])
    expect(h.creates).toEqual([])
  })

  it('an upload that fails after its tombstone clears that tombstone', async () => {
    h.uploadFails = true
    await bulkImportCore(SELLER, [phone(remote(1))])
    expect(h.cleared).toEqual([[{ bucket: 'listings', path: 'bulk/1.webp' }]])
    expect(h.removed).toEqual([])
  })

  it('⛔ an external_id repeated in the file is refused BEFORE its images are fetched', async () => {
    const row = { ...phone(remote(3)), external_id: 'sku-1' }
    const r = await bulkImportCore(SELLER, [row, row])
    expect(r.results[1]).toEqual({ row: 2, external_id: 'sku-1', error: 'Duplicate external_id of row 1 in this file' })
    expect(h.fetched).toHaveLength(3) // row 1's three, none for row 2
  })

  it('⛔ an external_id one of the seller\'s listings already holds is refused BEFORE any fetch', async () => {
    h.takenExternalIds.add('sku-9')
    const r = await bulkImportCore(SELLER, [{ ...phone(remote(3)), external_id: 'sku-9' }])
    expect(r.results[0]).toMatchObject({ row: 1, external_id: 'sku-9' })
    expect(r.results[0].error).toMatch(/already used/)
    expect(h.fetched).toEqual([])
    expect(h.written).toEqual([])
  })

  it('⛔ an insert the database REFUSED (P2002) deletes the row\'s fresh images at once', async () => {
    h.createError = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
    const r = await bulkImportCore(SELLER, [phone(remote(3))])
    expect(r.results[0].error).toBe('Failed to create')
    expect(h.removed).toEqual([['bulk/1.webp', 'bulk/2.webp', 'bulk/3.webp']])
  })

  it('an ambiguous failure (it may have committed) deletes nothing — the sweep re-checks references first', async () => {
    h.createError = Object.assign(new Error('Server has closed the connection'), { code: 'P1017' })
    const r = await bulkImportCore(SELLER, [phone(remote(3))])
    expect(r.results[0].error).toBe('Failed to create')
    expect(h.removed).toEqual([])
    expect(h.written.flatMap((w) => w.refs)).toHaveLength(3) // still tombstoned
  })
})
