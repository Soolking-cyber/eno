import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── A REVIEW SEAT'S IMPORTED LISTINGS ARE NEVER PUBLIC (round 3, 2026-11-14 — src/lib/review-seat-accounts.ts) ─────────
//
// The bulk core creates with its own db.listing.create — the CSV, /api/v1/listings/bulk, MCP bulk_create_listings and a
// partner sync's creates (core/sync.ts) all land here — so createListingCore's hold never runs for them. Pinned:
//   1. a seat-owned storefront's rows are written verified:false with the seat's mark, never identityHold — whatever
//      the case or the stray whitespace of the address its Profile holds;
//   2. a sync's creates take the same hold (they run through this core);
//   3. CONTROL: an ordinary owner, an ownerless platform seller (no read at all) and a no-email owner import verified:true,
//      exactly as before;
//   4. the owner read is the real one (review-seat-listings.ts ownerIsReviewSeat), and a failure of it fails CLOSED:
//      nothing is created.

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  /** `data` of every db.listing.create. */
  creates: [] as Row[],
  /** Profile id → its email, as the faked db answers the owner read. */
  emails: {} as Record<string, string | null>,
  /** Every Profile id the owner read asked for. */
  profileReads: [] as string[],
  profileDown: false,
  uploads: 0,
}))

vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/db', () => ({
  db: {
    category: { findMany: async () => [{ id: 'c-electronics', slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' }] },
    profile: {
      findUnique: async (a: Row) => {
        h.profileReads.push(a.where.id)
        if (h.profileDown) throw new Error('db down')
        return a.where.id in h.emails ? { email: h.emails[a.where.id] } : null
      },
    },
    listing: {
      findMany: async () => [], // the sync's externalId lookup: every row is new
      findFirst: async () => null, // bulk core's external_id pre-check
      create: async (a: Row) => { h.creates.push(a.data); return { id: `new${h.creates.length}` } },
    },
  },
}))
vi.mock('@/lib/enforcement', () => ({ bulkPostingBudget: async () => ({ blocked: null, maxNewActive: null }) }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ sellerPublishDecision: async () => ({ ok: true }) }))
vi.mock('@/lib/released-charge-gate', () => ({ releasedChargeGate: async () => null, releasedChargeStanding: async () => null, releasedChargeGateFor: async () => null }))
vi.mock('@/lib/duplicate-guard', () => ({ findDuplicateListing: async () => null }))
vi.mock('@/lib/listing-image', () => ({ isListingImageUrl: (u: string) => u.startsWith('https://cdn.eno.test/'), isListingVideoUrl: () => false }))
vi.mock('@/lib/ssrf', () => ({ safeFetch: async () => new Response(new Uint8Array([1, 2, 3])) }))
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
const { STORE_REVIEW_SEAT_EMAILS, REVIEW_SEAT_HELD_NOTE } = await import('@/lib/review-seat-accounts')

const seller = (ownerId: string | null) => ({ id: 's1', ownerId, trustTier: 'standard', trustScore: 70 })
const photos = (tag: string) => ['front', 'side', 'back'].map((a) => `https://img.example/${tag}-${a}.jpg`)
const row = (tag: string, title: string) => ({ category_slug: 'electronics', title, price: 1_500_000, image_urls: photos(tag).join('|') })
const HELD = { verified: false, verificationNotes: REVIEW_SEAT_HELD_NOTE }

beforeEach(() => {
  h.creates = []
  h.emails = { 'seat-owner': 'ai-review@eno.vn', 'shop-owner': 'shop@example.com', 'phone-owner': null, 'lawyer-owner': 'lawyer-review@eno.vn' }
  h.profileReads = []
  h.profileDown = false
  h.uploads = 0
})

describe('bulkImportCore — a review seat\'s rows are stored unpublished', () => {
  it('⛔ every row of a seat\'s import: verified:false with the seat\'s mark, never identityHold — and the owner is read ONCE', async () => {
    const r = await bulkImportCore(seller('seat-owner'), [row('desk', 'Oak writing desk'), row('shelf', 'Steel bookshelf')])
    expect(r).toMatchObject({ created: 2, failed: 0 })
    expect(h.creates).toHaveLength(2)
    for (const d of h.creates) {
      expect(d).toMatchObject(HELD)
      expect(d.identityHold).toBeUndefined()
    }
    expect(h.profileReads).toEqual(['seat-owner'])
  })

  it('⛔ every seat, whatever the case or stray whitespace its Profile holds', async () => {
    for (const email of STORE_REVIEW_SEAT_EMAILS) {
      h.creates = []
      h.emails['seat-owner'] = ` ${email.toUpperCase()} `
      await bulkImportCore(seller('seat-owner'), [row(email, 'Oak writing desk')])
      expect(h.creates, email).toHaveLength(1)
      expect(h.creates[0], email).toMatchObject(HELD)
    }
  })

  it('CONTROL: an ordinary owner, an ownerless platform seller, a no-email owner and the lawyer\'s seat import live, as before', async () => {
    await bulkImportCore(seller('shop-owner'), [row('a', 'Oak writing desk')])
    await bulkImportCore(seller(null), [row('b', 'Oak writing desk')])
    await bulkImportCore(seller('phone-owner'), [row('c', 'Oak writing desk')])
    // Luật Hoàng Phi's storefront: no store seat (round 4, review-seat-accounts.ts).
    await bulkImportCore(seller('lawyer-owner'), [row('d', 'Oak writing desk')])
    expect(h.creates).toHaveLength(4)
    for (const d of h.creates) {
      expect(d.verified).toBe(true)
      expect(d.verificationNotes).toBeUndefined()
    }
    // An ownerless seller costs no read.
    expect(h.profileReads).toEqual(['shop-owner', 'phone-owner', 'lawyer-owner'])
  })

  it('⛔ fails CLOSED: an owner read that fails creates nothing', async () => {
    h.profileDown = true
    await expect(bulkImportCore(seller('seat-owner'), [row('desk', 'Oak writing desk')])).rejects.toThrow('db down')
    expect(h.creates).toEqual([])
    expect(h.uploads).toBe(0)
  })
})

describe('syncListingsCore — a seat\'s sync creates run through the bulk core, so they are held too', () => {
  it('⛔ a seat\'s new external ids are created unpublished; an ordinary shop\'s live', async () => {
    const seat = await syncListingsCore(seller('seat-owner'), [{ externalId: 'E-1', categorySlug: 'electronics', title: 'Oak writing desk', price: 1_500_000, images: photos('desk') }], 'partial')
    expect(seat.results).toEqual([{ external_id: 'E-1', id: 'new1', action: 'created' }])
    expect(h.creates[0]).toMatchObject({ ...HELD, externalId: 'E-1' })
    const shop = await syncListingsCore(seller('shop-owner'), [{ externalId: 'E-2', categorySlug: 'electronics', title: 'Oak writing desk', price: 1_500_000, images: photos('desk2') }], 'partial')
    expect(shop.results).toEqual([{ external_id: 'E-2', id: 'new2', action: 'created' }])
    expect(h.creates[1]).toMatchObject({ verified: true, externalId: 'E-2' })
    expect(h.creates[1].verificationNotes).toBeUndefined()
  })
})
