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
 *   3. O-34b (owner, 2026-10-05) — the VISA SLOT (services/visa-legal) takes an official partner's listings
 *      only: a non-partner's create that PICKS it is refused (`subcategory_partner_only`), a keyword guess
 *      that lands there is re-filed to Services › Other, and an edit that MOVES a listing into it is refused;
 *      a listing already there edits as usual. eno.forum: listings.visa-slot.forum.test.ts.
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

const attrsOf = (json: unknown) => (typeof json === 'string' ? JSON.parse(json) : json) as Record<string, string> | null

/** A services create — into `subcategorySlug` ('' = none picked, the server guesses from the words). */
function createService(subcategorySlug: string, attributes: Record<string, string> = {}, title = 'Work permit and visa paperwork help') {
  return createListingCore({
    seller: { id: 'seller-1', ownerId: 'owner-1', trustTier: 'standard', trustScore: 100, phone: null },
    guestCreate: false,
    category: { id: 'c-services', slug: 'services', name: 'Services', nameVi: 'Dịch vụ' },
    title,
    price: 500_000,
    body: { listingType: 'service', subcategorySlug, description: 'We prepare the paperwork with you, in English or Vietnamese.', attributes },
    headers: new Headers(),
  })
}
const createVisaLegal = (attributes: Record<string, string>) => createService('visa-legal', attributes)

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
  // (An ordinary seller cannot create INTO the visa slot at all since O-34b — below — so the stripping is
  // proven on another services aisle: the attributes are whitelisted by key, not by aisle.)
  it('⛔ a NEW post by an ordinary seller loses visaEntryType + visaSpeed, and keeps everything else', async () => {
    await createService('service-other', { visaEntryType: 'single', visaSpeed: '1H', serviceLocation: 'online' }, 'Tax paperwork help')
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

  it('asks for the partner flag only when an answer depends on it — an ordinary create costs no extra read', async () => {
    await createService('cleaning', { serviceLocation: 'online' }, 'Weekly flat cleaning')
    expect(h.partnerReads).toBe(0)
    await createService('cleaning', { visaSpeed: '1H' }, 'Weekly flat cleaning')
    expect(h.partnerReads).toBe(1)
    // A partner's create into the slot WITH e-visa keys reads the flag ONCE: the slot check and the attribute
    // rule share it.
    h.partner = true
    h.partnerReads = 0
    await createVisaLegal({ visaEntryType: 'single', visaSpeed: '1H' })
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

describe('O-34b on the server — the visa slot is an official partner’s on eno.vn', () => {
  it('⛔ refuses a non-partner’s create that PICKS the slot — nothing is written', async () => {
    await expect(createVisaLegal({ serviceLocation: 'online' })).rejects.toThrow('subcategory_partner_only')
    expect(h.creates).toHaveLength(0)
    expect(h.partnerReads).toBe(1)
  })

  it('lets an official partner (VietKite) create in it', async () => {
    h.partner = true
    const r = await createVisaLegal({})
    expect(r.id).toBe('new-1')
    expect(h.creates[0].subcategorySlug).toBe('visa-legal')
  })

  it('re-files a non-partner’s keyword GUESS of the slot to Services › Other — the seller never picked it', async () => {
    // No subcategory sent: "work permit" / "visa" are the slot's keywords, so the server's guess lands there.
    await createService('', {}, 'Work permit and visa paperwork help')
    expect(h.creates[0].subcategorySlug).toBe('service-other')
    // …and an invalid pick falls back the same way (subcategoriesFor would have put services' first aisle — the slot).
    h.creates = []
    await createService('not-a-subcategory', {}, 'Paperwork help, in English')
    expect(h.creates[0].subcategorySlug).toBe('service-other')
  })

  it('keeps a partner’s keyword guess in the slot', async () => {
    h.partner = true
    await createService('', {}, 'Vietnam e-visa, 1 hour')
    expect(h.creates[0].subcategorySlug).toBe('visa-legal')
  })

  it('leaves every other services aisle alone, with no partner read', async () => {
    await createService('service-other', {}, 'Tax return help')
    expect(h.creates[0].subcategorySlug).toBe('service-other')
    expect(h.partnerReads).toBe(0)
  })

  it('⛔ refuses an edit that MOVES a non-partner’s listing into the slot — nothing is written', async () => {
    h.current = row({ subcategorySlug: 'service-other', listingType: 'service', priceUnit: 'VND/service' })
    const r = await updateListingCore('listing-1', { subcategorySlug: 'visa-legal', title: 'Visa help' })
    expect(r).toEqual({ ok: false, code: 400, error: 'subcategory_partner_only' })
    expect(h.updates).toHaveLength(0)
  })

  it('lets a partner move a listing into the slot', async () => {
    h.current = row({ subcategorySlug: 'service-other', listingType: 'service', priceUnit: 'VND/service', seller: { trustTier: 'standard', officialPartner: true } })
    expect(await updateListingCore('listing-1', { subcategorySlug: 'visa-legal' })).toEqual({ ok: true })
    expect(h.updates[0].subcategorySlug).toBe('visa-legal')
  })

  it('a listing ALREADY in the slot edits as usual (its own subcategory resent is not a move) and may move out', async () => {
    h.current = row({ subcategorySlug: 'visa-legal', listingType: 'service', priceUnit: 'VND/service' })
    expect(await updateListingCore('listing-1', { subcategorySlug: 'visa-legal', title: 'Work permit renewal help' })).toEqual({ ok: true })
    expect(h.updates[0].title).toBe('Work permit renewal help')
    h.updates = []
    expect(await updateListingCore('listing-1', { subcategorySlug: 'service-other' })).toEqual({ ok: true })
    expect(h.updates[0].subcategorySlug).toBe('service-other')
  })

  it('an edit that does not touch the subcategory is unaffected', async () => {
    h.current = row({ subcategorySlug: 'visa-legal', listingType: 'service', priceUnit: 'VND/service' })
    expect(await updateListingCore('listing-1', { price: 600_000 })).toEqual({ ok: true })
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
