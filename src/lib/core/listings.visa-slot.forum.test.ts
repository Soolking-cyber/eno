import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE LICENCE CHECK ON eno.forum TOO (owner, 2026-10-14: the e-Visa subcategory on BOTH sites, "Anyone posts, live after
 * check" — the forum's own /prohibited page already said a visa service goes live only once its licence is shown — and
 * Legal & permits beside it, "Check them too"). Any seller may create in services/visa-legal or services/legal-permits
 * or move a listing into either; anyone but eno's own desk must give the provider's registered name and licence number
 * (provider-licence.ts) and is written unpublished until an admin approves them. A keyword guess counts as a pick (R3 of
 * the plan review); a Wanted ad never lands in either aisle. Same dependency wall as listings.sell-rules.test.ts (the
 * marketplace half, which also covers the edit rules in full), with the edition stubbed the other way.
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
  /** The seller is eno's own desk (edition-scope.ts deskSellerIds) — the forum's e-visa desk posts live. */
  desk: false,
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
      // withDerivedAttributes (owner.accountType); officialPartner is answered too, and must never matter.
      findUnique: async () => ({ officialPartner: h.partner, owner: { accountType: 'individual' } }),
    },
    priceChange: { create: () => ({}) },
    $transaction: async (ops: unknown[]) => ops,
  },
}))
vi.mock('@/lib/edition-scope', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  deskSellerIds: async () => (h.desk ? ['seller-1'] : []),
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
// The REAL module underneath (PublishBlockedError, and the contact / banned-word screens provider-licence.ts runs on the
// values through this same module); only the publish gates around the rules under test are stubbed.
vi.mock('@/lib/publish-guard', async (orig) => ({
  ...(await orig<typeof import('@/lib/publish-guard')>()),
  assertPublishable: () => {},
  assertCleanTexts: () => {},
  assertCleanContactName: () => {},
  assertEnoughAngles: () => {},
}))
vi.mock('@/lib/duplicate-guard', () => ({ findDuplicateListing: async () => null }))
vi.mock('@/lib/ai-moderation', () => ({ moderateListingById: async () => {} }))
vi.mock('@/lib/image-provenance', () => ({ indexAndCheckProvenance: async () => {} }))
vi.mock('@/lib/price-drop', () => ({ priceChangeEffects: async () => ({ data: {}, audit: null, notify: null }) }))
vi.mock('@/lib/urgent', () => ({ activateUrgentGate: async () => ({ ok: true }), urgentQuotaFree: async () => true, URGENT: {} }))

const { createListingCore, updateListingCore } = await import('@/lib/core/listings')
const { IS_MARKETPLACE } = await import('@/lib/edition')
// After the stub above: a static import would load the taxonomy (and the edition) first.
const { LICENCE_STAMP_CLEARED, licenceStampFor } = await import('@/lib/licence-stamp')
const { providerLicenceOf } = await import('@/lib/provider-licence')

const attrsOf = (json: unknown) => (typeof json === 'string' ? JSON.parse(json) : json) as Record<string, string> | null

const VISA = { providerLegalName: 'CÔNG TY TNHH VISA5S.VN', providerLicenceNo: '01-1234/2019/TCDL-GP LHQT' }
const LEGAL = { providerLegalName: 'CÔNG TY LUẬT TNHH HOÀNG PHI', providerLicenceNo: '0312345678' }

function createService(subcategorySlug: string, attributes: Record<string, string> = {}, title = 'Vietnam e-visa paperwork help', listingType = 'service') {
  return createListingCore({
    seller: { id: 'seller-1', ownerId: 'owner-1', trustTier: 'standard', trustScore: 100, phone: null },
    guestCreate: false,
    category: { id: 'c-services', slug: 'services', name: 'Services', nameVi: 'Dịch vụ' },
    title,
    price: 500_000,
    body: { listingType, subcategorySlug, description: 'We prepare the paperwork with you, in English or Vietnamese.', attributes },
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
    verificationMethod: null, verifiedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  h.updates = []
  h.creates = []
  h.partner = false
  h.desk = false
  h.current = row()
})

it('runs as the services edition (eno.forum)', () => {
  expect(IS_MARKETPLACE).toBe(false)
})

describe('the licence check on eno.forum — create', () => {
  it('⛔ an ordinary seller creates in e-Visa or Legal & permits WITH the values — unpublished, waiting for the check', async () => {
    expect(await createService('visa-legal', { ...VISA })).toEqual({ id: 'new-1', verified: false, held: true })
    expect(h.creates[0]).toMatchObject({ subcategorySlug: 'visa-legal', verified: false })
    expect(attrsOf(h.creates[0].attributes)).toMatchObject(VISA)
    // The bare 10-digit enterprise code is a Legal & permits number (never an e-Visa one).
    expect(await createService('legal-permits', { ...LEGAL }, 'Work permit renewal help')).toEqual({ id: 'new-1', verified: false, held: true })
    expect(attrsOf(h.creates[1].attributes)).toMatchObject(LEGAL)
  })

  it('⛔ …and WITHOUT them is refused (provider_licence_required); a value that cannot be accepted is provider_licence_invalid', async () => {
    await expect(createService('visa-legal')).rejects.toMatchObject({ code: 'provider_licence_required' })
    await expect(createService('visa-legal', { ...VISA, providerLicenceNo: '0312345678' }))
      .rejects.toMatchObject({ code: 'provider_licence_invalid', detail: 'providerLicenceNo:format' })
    expect(h.creates).toHaveLength(0)
  })

  it('eno’s e-visa desk posts there live, with no values; an official partner waits for the check like anyone', async () => {
    h.desk = true
    expect((await createService('visa-legal')).verified).toBe(true)
    h.desk = false
    h.partner = true
    expect((await createService('visa-legal', { ...VISA })).verified).toBe(false)
    expect(h.creates[1].subcategorySlug).toBe('visa-legal')
  })

  it('⛔ a keyword guess counts as a pick (R3): without the values it is refused, with them it waits; the desk’s stays live', async () => {
    await expect(createService('', {}, 'Vietnam e-visa, 1 hour')).rejects.toMatchObject({ code: 'provider_licence_required' })
    expect(await createService('', { ...VISA }, 'Vietnam e-visa, 1 hour')).toEqual({ id: 'new-1', verified: false, held: true })
    expect(h.creates[0]).toMatchObject({ subcategorySlug: 'visa-legal', verified: false })
    h.desk = true
    await createService('', {}, 'Vietnam e-visa, 1 hour')
    expect(h.creates[1]).toMatchObject({ subcategorySlug: 'visa-legal', verified: true })
  })

  it('a Wanted ad is never filed in either aisle — Services › Other, live, the values dropped', async () => {
    expect(await createService('visa-legal', { ...VISA }, 'Looking for a visa agent', 'wanted')).toEqual({ id: 'new-1', verified: true })
    expect(h.creates[0]).toMatchObject({ subcategorySlug: 'service-other', verified: true })
    expect(attrsOf(h.creates[0].attributes) ?? {}).not.toHaveProperty('providerLegalName')
  })
})

describe('the licence check on eno.forum — edit', () => {
  it('⛔ an ordinary seller’s move into the aisle needs the values, and unpublishes the listing with the move', async () => {
    expect(await updateListingCore('listing-1', { subcategorySlug: 'visa-legal' })).toEqual({ ok: false, code: 400, error: 'provider_licence_required' })
    expect(h.updates).toHaveLength(0)
    expect(await updateListingCore('listing-1', { subcategorySlug: 'visa-legal', attributes: { ...VISA } })).toEqual({ ok: true, held: true })
    expect(h.updates[0]).toMatchObject({ subcategorySlug: 'visa-legal', verified: false })
  })

  it('an approved listing stays live through an edit that keeps its values; a changed value sends it back', async () => {
    const attributes = JSON.stringify(VISA)
    h.current = row({ subcategorySlug: 'visa-legal', attributes, verificationMethod: licenceStampFor({ sellerId: 'seller-1', subcategorySlug: 'visa-legal' }, providerLicenceOf(attributes)!) })
    expect(await updateListingCore('listing-1', { title: 'e-Visa in 3 days' })).toEqual({ ok: true })
    expect(h.updates[0]).not.toHaveProperty('verified')
    expect(await updateListingCore('listing-1', { attributes: { ...VISA, providerLegalName: 'CÔNG TY TNHH VISA6S.VN' } })).toEqual({ ok: true, held: true })
    // It was live, so it goes down for its licence: the hold's mark (licence-stamp.ts LICENCE_HELD_NOTE).
    expect(h.updates[1]).toMatchObject({ verified: false, ...LICENCE_STAMP_CLEARED, verificationNotes: 'licence:held' })
  })
})
