import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NON_POSTING_CATEGORIES } from '@/lib/taxonomy'

// ── A CATEGORY NOBODY POSTS INTO CANNOT BE BULK-IMPORTED EITHER (2026-10-09) ────────────────────────────
//
// `teachers` rows are written ONLY by the teacher form (src/lib/teachers/publish.ts), which writes the
// TeacherProfile beside the listing. The single create path refuses the category (createListingCore →
// isPostableCategory → `category_not_postable`), but the bulk core creates with a `db.listing.create` of its
// own and never asked — so a CSV, /api/v1/listings/bulk, the MCP bulk tool or a partner sync's create made a
// LIVE, verified teachers listing with no profile: a broken public page and a row the teacher pipeline
// cannot read. Pinned here:
//   1. the refusal is per row, with the single path's code, BEFORE anything is read or written for that row
//      (no duplicate lookup, no image fetch or upload, no create) — and the rest of the batch imports;
//   2. the rule is taxonomy's `isPostableCategory`, the function the single path calls — not a slug list of
//      bulk's own (faked below to refuse one more slug, which bulk must then refuse too);
//   3. a partner sync's creates, which run through the same core, are refused the same way.

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  categories: [] as Row[],
  /** `data` of every db.listing.create. */
  creates: [] as Row[],
  /** Remote image URLs the core fetched (each one is then UPLOADED to our storage — a write). */
  fetched: [] as string[],
  uploads: 0,
  /** Rows the duplicate guard was asked about (a DB read per row). */
  dupChecks: [] as Row[],
  /** Slugs the faked taxonomy refuses ON TOP of the real NON_POSTING_CATEGORIES. */
  alsoNotPostable: new Set<string>(),
}))

vi.mock('@/lib/taxonomy', async (orig) => {
  const real = await orig<typeof import('@/lib/taxonomy')>()
  return { ...real, isPostableCategory: (slug: string | null | undefined) => !h.alsoNotPostable.has(String(slug)) && real.isPostableCategory(slug) }
})
vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('@/lib/db', () => ({
  db: {
    category: { findMany: async (a: Row) => h.categories.filter((c) => (a.where.slug.in as string[]).includes(c.slug)) },
    listing: {
      // The sync's externalId lookup: every row in this file is new, so the sync sends them all to create.
      findMany: async () => [],
      create: async (a: Row) => { h.creates.push(a.data); return { id: `new${h.creates.length}` } },
    },
  },
}))
vi.mock('@/lib/enforcement', () => ({ bulkPostingBudget: async () => ({ blocked: null, maxNewActive: null }) }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ sellerPublishDecision: async () => ({ ok: true }) }))
vi.mock('@/lib/released-charge-gate', () => ({ releasedChargeGate: async () => null, releasedChargeStanding: async () => null, releasedChargeGateFor: async () => null }))
vi.mock('@/lib/duplicate-guard', () => ({ findDuplicateListing: async (a: Row) => { h.dupChecks.push(a); return null } }))
// Only our own CDN counts as hosted, so every image below is fetched and re-uploaded — the work a refused
// row must never cost.
vi.mock('@/lib/listing-image', () => ({ isListingImageUrl: (u: string) => u.startsWith('https://cdn.eno.test/'), isListingVideoUrl: () => false }))
vi.mock('@/lib/ssrf', () => ({ safeFetch: async (u: string) => { h.fetched.push(u); return new Response(new Uint8Array([1, 2, 3])) } }))
vi.mock('@/lib/core/media', () => ({ storeListingImage: async () => `https://cdn.eno.test/bulk/${++h.uploads}.webp`, IMG_MAX_BYTES: 1_000_000 }))
vi.mock('@/lib/translate', () => ({ warmTranslations: async () => {} }))
vi.mock('@/lib/listing-index', () => ({ reindexListing: async () => {}, removeFromIndex: async () => {} }))
vi.mock('@/lib/ai-moderation', () => ({ moderateListingById: async () => {} }))
vi.mock('@/lib/image-provenance', () => ({ indexAndCheckProvenance: async () => {} }))
vi.mock('@/lib/ranking', () => ({ browseRankScore: () => 0 }))
vi.mock('@/lib/webhooks', () => ({ dispatchListingEventsBatch: async () => {} }))
// The sync's UPDATE half is never reached here (no row exists yet); stubbed so its import graph stays out.
vi.mock('@/lib/core/listings', () => ({ updateListingCore: async () => ({ ok: true }), setStatusCore: async () => ({ ok: true }) }))

const { bulkImportCore } = await import('@/lib/core/bulk')
const { syncListingsCore } = await import('@/lib/core/sync')

const SELLER = { id: 's1', ownerId: 'owner-1', trustTier: 'standard', trustScore: 70 }
const ELECTRONICS = { id: 'c-electronics', slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' }
const NOT_POSTABLE = 'category_not_postable'
/** Three distinct remote photos, tagged so a fetch can be traced back to its row. */
const photos = (tag: string) => ['front', 'side', 'back'].map((a) => `https://img.example/${tag}-${a}.jpg`)
const bulkRow = (category_slug: string, tag: string, title: string) => ({ category_slug, title, price: 1_500_000, image_urls: photos(tag).join('|') })

beforeEach(() => {
  h.categories = [ELECTRONICS, ...[...NON_POSTING_CATEGORIES].map((slug) => ({ id: `c-${slug}`, slug, name: slug, nameVi: slug }))]
  h.creates = []
  h.fetched = []
  h.uploads = 0
  h.dupChecks = []
  h.alsoNotPostable = new Set()
})

describe('bulkImportCore — a non-postable category is refused per row, before any work', () => {
  it('⛔ a teachers row fails with the single path\'s code; nothing is read, fetched, uploaded or created for it — the rows around it import', async () => {
    const r = await bulkImportCore(SELLER, [
      bulkRow('electronics', 'desk', 'Oak writing desk'),
      bulkRow('teachers', 'teacher', 'Native English teacher, IELTS'),
      bulkRow('electronics', 'shelf', 'Steel bookshelf'),
    ])
    expect(r.results).toEqual([
      { row: 1, id: 'new1' },
      { row: 2, error: NOT_POSTABLE },
      { row: 3, id: 'new2' },
    ])
    expect(r).toMatchObject({ created: 2, failed: 1 })
    expect(h.creates.map((d) => d.categoryId)).toEqual(['c-electronics', 'c-electronics'])
    // Refused BEFORE the per-row work: no duplicate lookup, and none of its photos fetched or uploaded.
    expect(h.dupChecks.map((d) => d.categoryId)).toEqual(['c-electronics', 'c-electronics'])
    expect(h.fetched.filter((u) => u.includes('/teacher-'))).toEqual([])
    expect(h.uploads).toBe(6)
  })

  it('every slug in taxonomy.ts NON_POSTING_CATEGORIES is refused, an ad-hoc row and a partner row (external_id) alike', async () => {
    const slugs = [...NON_POSTING_CATEGORIES]
    expect(slugs.length).toBeGreaterThan(0)
    for (const slug of slugs) {
      const r = await bulkImportCore(SELLER, [
        bulkRow(slug, `${slug}-a`, 'A profile row'),
        { ...bulkRow(slug, `${slug}-b`, 'A partner profile row'), external_id: 'SKU-9' },
      ])
      expect(r.results.map((x) => x.error), slug).toEqual([NOT_POSTABLE, NOT_POSTABLE])
    }
    expect(h.creates).toEqual([])
    expect(h.fetched).toEqual([])
  })

  it('ONE RULE: the refusal is taxonomy\'s isPostableCategory — a slug it refuses is refused here, with no list of bulk\'s own', async () => {
    h.alsoNotPostable = new Set(['electronics'])
    const r = await bulkImportCore(SELLER, [bulkRow('electronics', 'desk', 'Oak writing desk')])
    expect(r.results).toEqual([{ row: 1, error: NOT_POSTABLE }])
    expect(h.creates).toEqual([])
  })

  it('an unknown slug is still "Unknown category" — the refusal is for a category that EXISTS and takes no posts', async () => {
    const r = await bulkImportCore(SELLER, [bulkRow('nope', 'x', 'Some thing')])
    expect(r.results).toEqual([{ row: 1, error: 'Unknown category "nope"' }])
  })
})

describe('syncListingsCore — its creates run through the bulk core, so a sync cannot create one either', () => {
  it('the teachers create fails on its row with the same code; the other create goes through', async () => {
    const out = await syncListingsCore(SELLER, [
      { externalId: 'T-1', categorySlug: 'teachers', title: 'Native English teacher', price: 0, images: photos('teacher') },
      { externalId: 'E-1', categorySlug: 'electronics', title: 'Oak writing desk', price: 1_500_000, images: photos('desk') },
    ], 'partial')
    expect(out.results).toEqual([
      { external_id: 'T-1', action: 'failed', error: NOT_POSTABLE },
      { external_id: 'E-1', id: 'new1', action: 'created' },
    ])
    expect(out).toMatchObject({ created: 1, failed: 1 })
    expect(h.creates.map((d) => d.categoryId)).toEqual(['c-electronics'])
  })
})
