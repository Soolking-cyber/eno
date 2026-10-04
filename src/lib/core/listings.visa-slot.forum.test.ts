import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * O-34b on eno.forum — UNCHANGED (owner, 2026-10-05: the visa slot is an official partner's on eno.vn only).
 * The services edition sells the e-visa through its desk and has no visa-slot rule: any seller may create in
 * services/visa-legal or move a listing into it, exactly as before. Same dependency wall as
 * listings.sell-rules.test.ts (the marketplace half), with the edition stubbed the other way.
 */

// ⚠️ BEFORE the import below: the edition is read once, when @/lib/edition first loads.
vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'services')

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  updates: [] as Row[],
  creates: [] as Row[],
  current: {} as Row,
  /** Seller.officialPartner as the faked db answers it. */
  partner: false,
  /** How often createListingCore asked for the seller's partner flag. */
  partnerReads: 0,
}))

vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      findUnique: async () => h.current,
      update: async ({ data }: Row) => { h.updates.push(data); return { id: 'listing-1' } },
      create: async ({ data }: Row) => { h.creates.push(data); return { id: 'new-1', ...data } },
      count: async () => 0,
    },
    seller: {
      // One fake for both reads: withDerivedAttributes (owner.accountType) and the O-34 partner check.
      findUnique: async ({ select }: Row) => {
        if (select?.officialPartner) h.partnerReads++
        return { officialPartner: h.partner, owner: { accountType: 'individual' } }
      },
    },
    priceChange: { create: () => ({}) },
    $transaction: async (ops: unknown[]) => ops,
  },
}))
vi.mock('@/lib/listing-index', () => ({ reindexListing: async () => {}, removeFromIndex: async () => {} }))
vi.mock('@/lib/trust', () => ({ recordEngagement: async () => {} }))
vi.mock('@/lib/stale', () => ({ canBump: () => false }))
vi.mock('@/lib/translate', () => ({ warmTranslations: async () => {} }))
vi.mock('@/lib/listing-image', () => ({ isListingImageUrl: () => true }))
vi.mock('@/lib/core/media', () => ({ isCanonicalVideoUrl: () => true, removeListingVideoByUrl: async () => {} }))
vi.mock('@/lib/brand', () => ({
  categoryHasBrand: () => false,
  resolveBrand: async () => null,
  bumpBrandCount: async () => {},
  enrichBrandLogoIfMissing: async () => {},
}))
vi.mock('@/lib/syndicate', () => ({ syndicateListing: async () => {}, syndicateListingIfPublic: async () => {} }))
vi.mock('@/lib/meta-capi', () => ({ sendMetaCapiEvent: async () => {}, metaUserDataFromHeaders: () => ({}) }))
vi.mock('@/lib/webhooks', () => ({ dispatchListingEvent: async () => {} }))
vi.mock('@/lib/ranking', () => ({ browseRankScore: () => 0, recomputeRankScoreForListing: async () => {} }))
vi.mock('@/lib/compliance/account-state', () => ({ identityGateEnforced: () => false }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ assertSellerMayPublish: async () => {}, sellerPublishDecision: async () => ({ ok: true }) }))
vi.mock('@/lib/released-charge-gate', () => ({ releasedChargeGate: async () => null }))
vi.mock('@/lib/publish-guard', () => ({
  assertPublishable: () => {},
  assertCleanTexts: async () => {},
  assertCleanContactName: () => {},
  assertEnoughAngles: () => {},
  // The real class's shape: the message IS the code (publish-guard.ts), which is what the refusals assert on.
  PublishBlockedError: class PublishBlockedError extends Error { code: string; constructor(code: string) { super(code); this.code = code } },
}))
vi.mock('@/lib/duplicate-guard', () => ({ findDuplicateListing: async () => null }))
vi.mock('@/lib/ai-moderation', () => ({ moderateListingById: async () => {} }))
vi.mock('@/lib/image-provenance', () => ({ indexAndCheckProvenance: async () => {} }))
vi.mock('@/lib/price-drop', () => ({ priceChangeEffects: async () => ({ data: {}, audit: null, notify: null }) }))
vi.mock('@/lib/urgent', () => ({ activateUrgentGate: async () => ({ ok: true }), urgentQuotaFree: async () => true, URGENT: {} }))

const { createListingCore, updateListingCore } = await import('@/lib/core/listings')
const { IS_MARKETPLACE } = await import('@/lib/edition')


function createService(subcategorySlug: string, title = 'Vietnam e-visa paperwork help') {
  return createListingCore({
    seller: { id: 'seller-1', ownerId: 'owner-1', trustTier: 'standard', trustScore: 100, phone: null },
    guestCreate: false,
    category: { id: 'c-services', slug: 'services', name: 'Services', nameVi: 'Dịch vụ' },
    title,
    price: 500_000,
    body: { listingType: 'service', subcategorySlug, description: 'We prepare the paperwork with you, in English or Vietnamese.', attributes: {} },
    headers: new Headers(),
  })
}

function row(overrides: Row = {}): Row {
  return {
    title: 'Old title', description: 'Old description that is long enough', district: 'Quận 1', location: 'Quận 1',
    brandSlug: null, model: null, subcategorySlug: 'service-other', verified: true, images: [], video: null,
    condition: null, year: null, listingType: 'service', titleVi: null, descriptionVi: null,
    price: 150_000, createdAt: new Date('2026-09-01'), sellerId: 'seller-1', previousPrice: null, priceDropAt: null,
    lowestNotifiedPrice: null, priceDropNotifiedAt: null, urgentUntil: null,
    negotiable: false, salaryM: null, affiliateUrl: null, priceUnit: 'VND/service', attributes: null,
    seller: { trustTier: 'standard', officialPartner: false },
    category: { slug: 'services', name: 'Services', nameVi: 'Dịch vụ' },
    status: 'active',
    ...overrides,
  }
}

beforeEach(() => {
  h.updates = []
  h.creates = []
  h.partner = false
  h.partnerReads = 0
  h.current = row()
})

it('runs as the services edition (eno.forum)', () => {
  expect(IS_MARKETPLACE).toBe(false)
})

describe('O-34b leaves eno.forum alone', () => {
  it('an ordinary seller creates in services/visa-legal, with no partner read', async () => {
    const r = await createService('visa-legal')
    expect(r.id).toBe('new-1')
    expect(h.creates[0].subcategorySlug).toBe('visa-legal')
    expect(h.partnerReads).toBe(0)
  })

  it('a keyword guess still lands in the slot', async () => {
    await createService('', 'Vietnam e-visa, 1 hour')
    expect(h.creates[0].subcategorySlug).toBe('visa-legal')
  })

  it('an official partner creates there too', async () => {
    h.partner = true
    await createService('visa-legal')
    expect(h.creates[0].subcategorySlug).toBe('visa-legal')
  })

  it('an ordinary seller may move a listing into the slot', async () => {
    expect(await updateListingCore('listing-1', { subcategorySlug: 'visa-legal' })).toEqual({ ok: true })
    expect(h.updates[0].subcategorySlug).toBe('visa-legal')
  })
})
