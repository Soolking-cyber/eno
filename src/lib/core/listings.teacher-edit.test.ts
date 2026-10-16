import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⚖️ THE NAME THE "IDENTITY VERIFIED" TICK VOUCHES FOR (2026-10-16). A teacher card draws the tick (serialize.ts) beside
 * the row's own `title`, and the mark was judged on TeacherProfile.fullName — which the teacher save writes into that
 * title in the transaction that re-derives the card's cache (teachers/publish.ts). So no generic editor may change a
 * teacher row's title: updateListingCore — the dashboard PATCH, /api/v1's PATCH, the catalogue sync and MCP's
 * update_listing all end there — refuses a teacher row with the 404 a missing row gets, BEFORE anything is written, by
 * its category AND by its type (the tick's own predicate), so a row filed anywhere else is refused all the same.
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  row: null as Row | null,
  writes: [] as Array<{ op: string; args: Row }>,
}))

vi.mock('@/lib/db', () => {
  const write = (op: string) => async (args: Row) => { h.writes.push({ op, args }); return { count: 1, id: 'L1' } }
  return {
    db: {
      listing: { findUnique: async () => (h.row ? { ...h.row } : null), update: write('listing.update'), updateMany: write('listing.updateMany') },
      seller: { findUnique: async () => ({ officialPartner: false, owner: { accountType: 'individual' } }), update: write('seller.update') },
      priceChange: { create: write('priceChange.create') },
      $transaction: async (ops: unknown) => (typeof ops === 'function' ? (ops as (tx: unknown) => unknown)({}) : ops),
    },
  }
})
vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: () => {} }))
vi.mock('@/lib/log', () => ({ logError: () => {}, logWarn: () => {} }))
vi.mock('@/lib/compliance/account-state', async (orig) => ({
  ...(await orig<typeof import('@/lib/compliance/account-state')>()),
  identityGateEnforced: () => false,
}))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ sellerPublishDecision: async () => ({ ok: true }), assertSellerMayPublish: async () => {} }))
vi.mock('@/lib/released-charge-gate', () => ({ releasedChargeGate: async () => null, releasedChargeStanding: async () => null, releasedChargeGateFor: async () => null }))
vi.mock('@/lib/listing-index', () => ({ reindexListing: async () => {}, removeFromIndex: async () => {} }))
vi.mock('@/lib/trust', () => ({ recordEngagement: async () => {} }))
vi.mock('@/lib/stale', () => ({ canBump: () => false }))
vi.mock('@/lib/translate', () => ({ warmTranslations: async () => {} }))
vi.mock('@/lib/listing-image', () => ({ isListingImageUrl: () => true, isListingVideoUrl: () => true, listingObjectKey: () => null }))
vi.mock('@/lib/core/media', () => ({ isCanonicalVideoUrl: () => true, removeListingVideoByUrl: async () => {} }))
vi.mock('@/lib/brand', () => ({ categoryHasBrand: () => false, resolveBrand: async () => null, bumpBrandCount: async () => {}, enrichBrandLogoIfMissing: async () => {} }))
vi.mock('@/lib/syndicate', () => ({ syndicateListingIfPublic: async () => {} }))
vi.mock('@/lib/meta-capi', () => ({ sendMetaCapiEvent: async () => {}, metaUserDataFromHeaders: () => ({}) }))
vi.mock('@/lib/webhooks', () => ({ dispatchListingEvent: async () => {} }))
vi.mock('@/lib/ranking', () => ({ browseRankScore: () => 0, recomputeRankScoreForListing: async () => {} }))
vi.mock('@/lib/duplicate-guard', () => ({ findDuplicateListing: async () => null }))
vi.mock('@/lib/ai-moderation', () => ({ moderateListingById: async () => {} }))
vi.mock('@/lib/image-provenance', () => ({ indexAndCheckProvenance: async () => {} }))
vi.mock('@/lib/price-drop', () => ({ priceChangeEffects: async () => ({ data: {}, audit: null, notify: null }) }))
vi.mock('@/lib/urgent', () => ({ activateUrgentGate: async () => ({ ok: true }), urgentQuotaFree: () => true, URGENT: {} }))

const { updateListingCore } = await import('@/lib/core/listings')

/** A listing as updateListingCore reads it. */
const listing = (over: Row = {}): Row => ({
  title: 'Anna Eriksson', description: 'CELTA teacher', district: null, location: 'Thủ Đức, Hồ Chí Minh', brandSlug: null, model: null,
  subcategorySlug: 'english', verified: true, images: '[]', video: null, condition: null, year: null, listingType: 'teacher',
  titleVi: null, descriptionVi: null, price: 35_000_000, createdAt: new Date('2026-10-01'), sellerId: 's1', previousPrice: null,
  priceDropAt: null, lowestNotifiedPrice: null, priceDropNotifiedAt: null, urgentUntil: null, negotiable: false, salaryM: 35,
  affiliateUrl: null, priceUnit: 'VND/month', attributes: null, seller: { trustTier: 'standard' },
  category: { slug: 'teachers', name: 'Teachers', nameVi: 'Giáo viên' }, status: 'active',
  verificationMethod: null, verifiedAt: null, verificationNotes: null, identityHold: false,
  ...over,
})

beforeEach(() => { h.row = null; h.writes = [] })

describe('updateListingCore — a teacher row is not a generic editor\'s to rename', () => {
  it('⛔ a title edit of a teacher listing: 404 not_found, and NOTHING is written', async () => {
    h.row = listing()
    for (const body of [{ title: 'Dr Anna Eriksson' }, { title: 'Someone Else', description: 'x'.repeat(40) }, {}]) {
      expect(await updateListingCore('L1', body)).toEqual({ ok: false, code: 404, error: 'not_found' })
    }
    expect(h.writes).toEqual([])
  })

  it('⛔ refused by its TYPE too: a teacher-typed row filed in an ordinary category is refused the same way', async () => {
    h.row = listing({ category: { slug: 'services', name: 'Services', nameVi: 'Dịch vụ' }, subcategorySlug: 'other' })
    expect(await updateListingCore('L1', { title: 'Someone Else' })).toEqual({ ok: false, code: 404, error: 'not_found' })
    expect(h.writes).toEqual([])
  })

  it('…and by its category: a teachers-category row of any type', async () => {
    h.row = listing({ listingType: 'sell' })
    expect(await updateListingCore('L1', { title: 'Someone Else' })).toEqual({ ok: false, code: 404, error: 'not_found' })
    expect(h.writes).toEqual([])
  })
})
