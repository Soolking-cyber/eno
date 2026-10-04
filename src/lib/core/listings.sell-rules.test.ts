import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A5-SELL's two SERVER rules, against the real createListingCore / updateListingCore with a faked db
 * (the same dependency wall as listings.republish.test.ts), on the MARKETPLACE edition:
 *
 *   1. O-34 — an ordinary seller's listing on eno.vn carries no NEW e-visa product attribute
 *      (`visaEntryType`, `visaSpeed`), whatever a direct API call sends. An official partner's does
 *      (VietKite: dm-flow reads both), and an edit never strips one the listing already carries. The
 *      wizard applies the same rule to its chips (taxonomy.ts askableFacetsFor → visaProductKeyAllowed).
 *   2. The price unit follows the intent across the RENT boundary: a daily rental switched to
 *      "Cần thuê" (Wanted) states a budget, so it must not keep 'VND/day'; a Wanted switched to Rent
 *      takes the unit of its period instead of keeping a bare 'VND'.
 */

// ⚠️ BEFORE the import below: the edition is read once, when @/lib/edition first loads.
vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')

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
  PublishBlockedError: class PublishBlockedError extends Error {},
}))
vi.mock('@/lib/duplicate-guard', () => ({ findDuplicateListing: async () => null }))
vi.mock('@/lib/ai-moderation', () => ({ moderateListingById: async () => {} }))
vi.mock('@/lib/image-provenance', () => ({ indexAndCheckProvenance: async () => {} }))
vi.mock('@/lib/price-drop', () => ({ priceChangeEffects: async () => ({ data: {}, audit: null, notify: null }) }))
vi.mock('@/lib/urgent', () => ({ activateUrgentGate: async () => ({ ok: true }), urgentQuotaFree: async () => true, URGENT: {} }))

const { createListingCore, updateListingCore } = await import('@/lib/core/listings')
const { IS_MARKETPLACE } = await import('@/lib/edition')

const attrsOf = (json: unknown) => (typeof json === 'string' ? JSON.parse(json) : json) as Record<string, string> | null

function createVisaLegal(attributes: Record<string, string>) {
  return createListingCore({
    seller: { id: 'seller-1', ownerId: 'owner-1', trustTier: 'standard', trustScore: 100, phone: null },
    guestCreate: false,
    category: { id: 'c-services', slug: 'services', name: 'Services', nameVi: 'Dịch vụ' },
    title: 'Work permit and visa paperwork help',
    price: 500_000,
    body: { listingType: 'service', subcategorySlug: 'visa-legal', description: 'We prepare the paperwork with you, in English or Vietnamese.', attributes },
    headers: new Headers(),
  })
}

/** A listing as updateListingCore reads it. */
function row(overrides: Row = {}): Row {
  return {
    title: 'Old title', description: 'Old description that is long enough', district: 'Quận 1', location: 'Quận 1',
    brandSlug: null, model: null, subcategorySlug: null, verified: true, images: [], video: null,
    condition: null, year: null, listingType: 'sell', titleVi: null, descriptionVi: null,
    price: 150_000, createdAt: new Date('2026-09-01'), sellerId: 'seller-1', previousPrice: null, priceDropAt: null,
    lowestNotifiedPrice: null, priceDropNotifiedAt: null, urgentUntil: null,
    negotiable: true, salaryM: null, affiliateUrl: null, priceUnit: 'VND', attributes: null,
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

it('runs as the marketplace edition (eno.vn)', () => {
  expect(IS_MARKETPLACE).toBe(true)
})

describe('O-34 on the server — e-visa product attributes on eno.vn', () => {
  it('⛔ a NEW post by an ordinary seller loses visaEntryType + visaSpeed, and keeps everything else', async () => {
    await createVisaLegal({ visaEntryType: 'single', visaSpeed: '1H', serviceLocation: 'online' })
    const stored = attrsOf(h.creates[0].attributes)
    expect(stored).not.toHaveProperty('visaEntryType')
    expect(stored).not.toHaveProperty('visaSpeed')
    expect(stored).toMatchObject({ serviceLocation: 'online' }) // the rest of the post is untouched
  })

  it('an official partner (VietKite) keeps both on a new post', async () => {
    h.partner = true
    await createVisaLegal({ visaEntryType: 'single', visaSpeed: '1H' })
    expect(attrsOf(h.creates[0].attributes)).toMatchObject({ visaEntryType: 'single', visaSpeed: '1H' })
  })

  it('asks for the partner flag only when such a key was sent — an ordinary create costs no extra read', async () => {
    await createVisaLegal({ serviceLocation: 'online' })
    expect(h.partnerReads).toBe(0)
    await createVisaLegal({ visaSpeed: '1H' })
    expect(h.partnerReads).toBe(1)
  })

  it('⛔ an EDIT cannot ADD one to an ordinary seller’s listing', async () => {
    h.current = row({ subcategorySlug: 'visa-legal', listingType: 'service', priceUnit: 'VND/service', attributes: null })
    await updateListingCore('listing-1', { attributes: { visaEntryType: 'multiple', visaSpeed: '1H' } })
    const stored = attrsOf(h.updates[0].attributes)
    expect(stored?.visaEntryType).toBeUndefined()
    expect(stored?.visaSpeed).toBeUndefined()
  })

  it('…but never strips one the listing already carries (the edit exemption)', async () => {
    h.current = row({ subcategorySlug: 'visa-legal', listingType: 'service', priceUnit: 'VND/service', attributes: JSON.stringify({ visaEntryType: 'single' }) })
    await updateListingCore('listing-1', { attributes: { visaEntryType: 'multiple', visaSpeed: '1H' } })
    const stored = attrsOf(h.updates[0].attributes)
    expect(stored?.visaEntryType).toBe('multiple') // a key it had: kept, and editable
    expect(stored?.visaSpeed).toBeUndefined() // a key it did not have: not added
  })

  it('an official partner’s listing takes both on an edit', async () => {
    h.current = row({ subcategorySlug: 'visa-legal', listingType: 'service', priceUnit: 'VND/service', seller: { trustTier: 'standard', officialPartner: true } })
    await updateListingCore('listing-1', { attributes: { visaEntryType: 'multiple', visaSpeed: '1H' } })
    expect(attrsOf(h.updates[0].attributes)).toMatchObject({ visaEntryType: 'multiple', visaSpeed: '1H' })
  })
})

describe('the price unit across the RENT boundary (updateListingCore)', () => {
  const rental = (overrides: Row = {}) => row({ category: { slug: 'rentals', name: 'Rentals', nameVi: 'Cho thuê' }, subcategorySlug: 'motorbike-rental', ...overrides })

  it('⛔ Rent → "Cần thuê" (Wanted): a daily rental’s budget is a bare VND, not "/ ngày"', async () => {
    h.current = rental({ listingType: 'rent', priceUnit: 'VND/day', attributes: JSON.stringify({ rentalPeriod: 'daily' }) })
    await updateListingCore('listing-1', { listingType: 'wanted' })
    expect(h.updates[0].listingType).toBe('wanted')
    expect(h.updates[0].priceUnit).toBe('VND')
  })

  it('⛔ Wanted → Rent: the unit of the period it carries, not a bare VND', async () => {
    h.current = rental({ listingType: 'wanted', priceUnit: 'VND', attributes: JSON.stringify({ rentalPeriod: 'weekly' }) })
    await updateListingCore('listing-1', { listingType: 'rent' })
    expect(h.updates[0].priceUnit).toBe('VND/week')
  })

  it('Wanted → Rent with the period sent in the same edit takes that period ("long-term" reads monthly)', async () => {
    h.current = rental({ listingType: 'wanted', priceUnit: 'VND' })
    await updateListingCore('listing-1', { listingType: 'rent', attributes: { rentalPeriod: 'daily' } })
    expect(h.updates[0].priceUnit).toBe('VND/day')
    h.updates = []
    await updateListingCore('listing-1', { listingType: 'rent', attributes: { rentalPeriod: 'long-term' } })
    expect(h.updates[0].priceUnit).toBe('VND/month')
  })

  it('a save that leaves the intent and the period alone never re-stamps the unit', async () => {
    h.current = rental({ listingType: 'rent', priceUnit: 'VND/day', attributes: JSON.stringify({ rentalPeriod: 'daily' }) })
    await updateListingCore('listing-1', { title: 'Honda Vision 2022 — helmet included', attributes: { rentalPeriod: 'daily' } })
    expect('priceUnit' in h.updates[0]).toBe(false)
  })
})
