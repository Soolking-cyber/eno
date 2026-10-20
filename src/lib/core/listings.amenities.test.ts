import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ A SELLER'S APARTMENT AMENITIES, WRITTEN BY THE REAL CORES (owner, 2026-10-20: "also add those filter chips when someone
 * posts in our app"). The post form asks the rentals › apartment-rental `amenities` facet (multi-select, optional); the picks
 * travel in `attributes` and are stored as `facetTokens` through the one public writer (multi-facet.ts sellerFacetTokens) —
 * never as an attribute. Against the real createListingCore / updateListingCore with a faked db (the dependency wall of
 * listings.sell-rules.test.ts):
 *   · VALIDATED to the options of the listing's OWN (category, subcategory) facet — anything else dropped, no typed
 *     character reaching a token; a listing in a subcategory without the facet writes none, and so does a "Looking to
 *     rent" ad (its page lists no amenities); an edit to Wanted drops them;
 *   · a pick an older write left in `attributes` survives an untouched edit — moved into the tokens;
 *   · an edit REPLACES ONLY the amenities tokens and keeps every other token; it touches them only when `attributes` names
 *     the facet; a move to a shelf that does not ask it drops them;
 *   · sanitizeAttributes never stores an amenities key in `attributes`.
 * The pure rules: multi-facet.test.ts and facet-tokens.test.ts. The form's chips: post-wizard.amenities.test.tsx.
 */

// ⚠️ BEFORE the import below: the edition is read once, when @/lib/edition first loads.
vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  updates: [] as Row[],
  creates: [] as Row[],
  current: {} as Row,
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
    seller: { findUnique: async () => ({ officialPartner: false, owner: { accountType: 'individual' } }) },
    priceChange: { create: () => ({}) },
    $transaction: async (ops: unknown[]) => ops,
  },
}))
vi.mock('@/lib/edition-scope', async (orig) => ({ ...(await orig<Record<string, unknown>>()), deskSellerIds: async () => [] }))
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
// The REAL module underneath; only the publish gates around the rule under test are stubbed (photos, place, contact).
vi.mock('@/lib/publish-guard', async (orig) => ({
  ...(await orig<typeof import('@/lib/publish-guard')>()),
  assertPublishable: () => {},
  assertCleanContactName: () => {},
  assertEnoughAngles: () => {},
}))
vi.mock('@/lib/duplicate-guard', () => ({ findDuplicateListing: async () => null }))
vi.mock('@/lib/ai-moderation', () => ({ moderateListingById: async () => {} }))
vi.mock('@/lib/image-provenance', () => ({ indexAndCheckProvenance: async () => {} }))
vi.mock('@/lib/price-drop', () => ({ priceChangeEffects: async () => ({ data: {}, audit: null, notify: null }) }))
vi.mock('@/lib/urgent', () => ({ activateUrgentGate: async () => ({ ok: true }), urgentQuotaFree: async () => true, URGENT: {} }))

const { createListingCore, updateListingCore, sanitizeAttributes } = await import('@/lib/core/listings')
const { parseFacetTokens } = await import('@/lib/facet-tokens')
// The two READERS of what is written: the listing page's Amenities list and the browse filter (feed + chip counts).
const { amenityOptions } = await import('@/lib/rental-facts')
const { attrRowMatches } = await import('@/lib/attr-match')
// The edit screen's half of a save: what the form opens on, and what it sends.
const { editFormAttributes } = await import('@/lib/multi-facet')
const { attributesPayload } = await import('@/components/marketplace/post-wizard-payload')
const { askableFacetsFor } = await import('@/lib/taxonomy')

const RENTALS = { id: 'c-rentals', slug: 'rentals', name: 'Rentals', nameVi: 'Cho thuê' }
const SELLER = { id: 'seller-1', ownerId: 'owner-1', trustTier: 'standard', trustScore: 100, phone: null }
const attrsOf = (json: unknown) => (typeof json === 'string' ? JSON.parse(json) : json) as Record<string, string> | null
const pairs = (t: unknown) => parseFacetTokens(t as string | null).map((p) => `${p.key}:${p.value}`)

/** A rentals post as the post form sends it — an apartment for rent unless told otherwise. */
function createRental(attributes: Record<string, unknown>, subcategorySlug = 'apartment-rental', listingType = 'rent') {
  return createListingCore({
    seller: SELLER,
    guestCreate: false,
    category: RENTALS,
    title: 'Bright 1-bedroom flat near the river',
    price: 9_000_000,
    body: {
      listingType, subcategorySlug, description: 'Quiet street, ten minutes from the centre, available next month.',
      district: 'Quận 2', images: ['https://cdn.eno.vn/a.jpg', 'https://cdn.eno.vn/b.jpg', 'https://cdn.eno.vn/c.jpg'],
      attributes,
    },
    headers: new Headers(),
  })
}

/** A live apartment rental as updateListingCore reads it. */
function apartment(overrides: Row = {}): Row {
  return {
    title: 'Bright 1-bedroom flat near the river', description: 'Quiet street, ten minutes from the centre.', district: 'Quận 2', location: 'Quận 2', city: 'Hồ Chí Minh',
    brandSlug: null, model: null, subcategorySlug: 'apartment-rental', verified: true, images: [], video: null,
    condition: null, year: null, listingType: 'rent', titleVi: null, descriptionVi: null,
    price: 9_000_000, createdAt: new Date('2026-10-01'), sellerId: 'seller-1', previousPrice: null, priceDropAt: null,
    lowestNotifiedPrice: null, priceDropNotifiedAt: null, urgentUntil: null,
    negotiable: true, salaryM: null, affiliateUrl: null, priceUnit: 'VND/month',
    attributes: JSON.stringify({ rentalPeriod: 'monthly', furnishing: 'fully', bedrooms: '1' }),
    facetTokens: null,
    seller: { trustTier: 'standard' },
    category: { slug: 'rentals', name: 'Rentals', nameVi: 'Cho thuê' },
    status: 'active',
    verificationMethod: null, verifiedAt: null, verificationNotes: null, identityHold: false,
    ...overrides,
  }
}

beforeEach(() => {
  h.updates = []
  h.creates = []
  h.current = apartment()
})

describe('sanitizeAttributes — a multi-select facet never lives in `attributes`', () => {
  it('⛔ drops the amenities key, as a string, a comma list or a list — and keeps everything else', () => {
    expect(attrsOf(sanitizeAttributes({ bedrooms: '2', amenities: 'no-landlord' }))).toEqual({ bedrooms: '2' })
    expect(attrsOf(sanitizeAttributes({ bedrooms: '2', amenities: 'no-landlord,car-alley' }))).toEqual({ bedrooms: '2' })
    expect(attrsOf(sanitizeAttributes({ bedrooms: '2', amenities: ['pool'] }))).toEqual({ bedrooms: '2' })
    expect(sanitizeAttributes({ amenities: 'pool' })).toBeNull()
  })
})

describe('createListingCore — a seller’s amenities become facetTokens', () => {
  it('stores the picks as tokens of the facet’s own values, in taxonomy order — never in attributes', async () => {
    await createRental({ rentalPeriod: 'monthly', furnishing: 'fully', bedrooms: '1', amenities: ['car-alley', 'no-landlord', 'pets'] })
    expect(h.creates[0].facetTokens).toBe('|amenities:no-landlord|amenities:car-alley|amenities:pets|')
    expect(attrsOf(h.creates[0].attributes)).toEqual({ rentalPeriod: 'monthly', furnishing: 'fully', bedrooms: '1' })
  })

  it('takes a comma list as well (an API client’s shape)', async () => {
    await createRental({ rentalPeriod: 'monthly', amenities: 'wifi, elevator' })
    expect(h.creates[0].facetTokens).toBe('|amenities:wifi|amenities:elevator|')
  })

  it('⛔ VALIDATED: free text, a smuggled delimiter, another facet’s value — dropped, never an error; nothing left → no column', async () => {
    await createRental({ rentalPeriod: 'monthly', amenities: ['pool', 'jacuzzi', 'gym|coverArea:quan-1', 'size:m', 'Wifi', 42] })
    expect(h.creates[0].facetTokens).toBe('|amenities:pool|')
    await createRental({ rentalPeriod: 'monthly', amenities: ['jacuzzi', 'x|y'] })
    expect(h.creates[1]).not.toHaveProperty('facetTokens')
  })

  it('optional: a post that picks none publishes exactly as before — no facetTokens written', async () => {
    expect(await createRental({ rentalPeriod: 'monthly', furnishing: 'fully', bedrooms: '1' })).toEqual({ id: 'new-1', verified: true })
    expect(h.creates[0]).not.toHaveProperty('facetTokens')
    await createRental({ rentalPeriod: 'monthly', amenities: [] })
    expect(h.creates[1]).not.toHaveProperty('facetTokens')
  })

  it('what the seller picked is what the listing page lists and what the browse filter finds (every pick, AND-ed)', async () => {
    await createRental({ rentalPeriod: 'monthly', furnishing: 'fully', bedrooms: '1', amenities: ['car-alley', 'no-landlord'] })
    const stored = { attributes: h.creates[0].attributes as string, facetTokens: h.creates[0].facetTokens as string }
    expect(amenityOptions(stored.facetTokens, 'rentals', 'apartment-rental').map((o) => o.label)).toEqual(['No live-in landlord', 'Car access'])
    expect(attrRowMatches(stored, 'amenities', 'no-landlord,car-alley')).toBe(true)
    expect(attrRowMatches(stored, 'amenities', 'car-alley')).toBe(true)
    expect(attrRowMatches(stored, 'amenities', 'no-landlord,pets')).toBe(false)
  })

  it('⛔ a listing in a subcategory without the facet writes none (and still keeps it out of attributes)', async () => {
    await createRental({ rentalPeriod: 'monthly', bedrooms: '3', amenities: ['pool', 'no-landlord'] }, 'house-rental')
    expect(h.creates[0].subcategorySlug).toBe('house-rental')
    expect(h.creates[0]).not.toHaveProperty('facetTokens')
    expect(attrsOf(h.creates[0].attributes)).toEqual({ rentalPeriod: 'monthly', bedrooms: '3' })
  })

  // Reviewer's catch, 2026-10-20 (measured with a probe against this core): a Wanted apartment stored
  // `|amenities:no-landlord|amenities:pool|amenities:gym|`, the "Pool" chip found it, and its page listed nothing.
  it('⛔ a "Looking to rent" apartment stores none — browse cannot find it by an amenity its page never lists', async () => {
    await createRental({ rentalPeriod: 'monthly', furnishing: 'fully', bedrooms: '1', amenities: ['pool', 'gym', 'no-landlord'] }, 'apartment-rental', 'wanted')
    const row = h.creates[0]
    expect(row).toMatchObject({ listingType: 'wanted', subcategorySlug: 'apartment-rental' })
    expect(row).not.toHaveProperty('facetTokens')
    expect(attrsOf(row.attributes)).toEqual({ rentalPeriod: 'monthly', furnishing: 'fully', bedrooms: '1' })
    expect(attrRowMatches({ attributes: row.attributes as string, facetTokens: null }, 'amenities', 'pool')).toBe(false)
  })
})

describe('updateListingCore — replaces ONLY the amenities tokens', () => {
  it('⛔ replaces the amenities and keeps every other token (an importer’s periods, a teacher-style place token)', async () => {
    h.current = apartment({ facetTokens: '|rentalPeriod:weekly|amenities:pool|coverArea:quan-1|amenities:gym|' })
    expect(await updateListingCore('listing-1', { attributes: { rentalPeriod: 'monthly', amenities: ['car-alley', 'no-landlord', 'jacuzzi'] } })).toEqual({ ok: true })
    expect(pairs(h.updates[0].facetTokens)).toEqual(['rentalPeriod:weekly', 'coverArea:quan-1', 'amenities:no-landlord', 'amenities:car-alley'])
    expect(attrsOf(h.updates[0].attributes)).toEqual({ rentalPeriod: 'monthly' })
  })

  it('un-picking every chip clears the amenities only', async () => {
    h.current = apartment({ facetTokens: '|amenities:pool|rentalPeriod:weekly|' })
    await updateListingCore('listing-1', { attributes: { rentalPeriod: 'monthly', amenities: [] } })
    expect(h.updates[0].facetTokens).toBe('|rentalPeriod:weekly|')
    h.current = apartment({ facetTokens: '|amenities:pool|' })
    await updateListingCore('listing-1', { attributes: { rentalPeriod: 'monthly', amenities: [] } })
    expect(h.updates[1].facetTokens).toBeNull()
  })

  it('⛔ an edit that does not NAME the facet leaves the column alone — a title fix, or attributes without it', async () => {
    h.current = apartment({ facetTokens: '|amenities:pool|amenities:no-landlord|' })
    await updateListingCore('listing-1', { title: 'Bright 1-bedroom flat by the river' })
    await updateListingCore('listing-1', { attributes: { rentalPeriod: 'monthly', bedrooms: '2' } })
    expect(h.updates).toHaveLength(2)
    for (const u of h.updates) expect(u).not.toHaveProperty('facetTokens')
  })

  it('the same picks re-sent (the form’s every save) write nothing new', async () => {
    h.current = apartment({ facetTokens: '|amenities:no-landlord|amenities:pool|' })
    await updateListingCore('listing-1', { title: 'Bright 1-bedroom flat by the river', attributes: { rentalPeriod: 'monthly', amenities: 'pool,no-landlord' } })
    expect(h.updates[0]).not.toHaveProperty('facetTokens')
  })

  it('⛔ a move to a shelf that does not ask the facet drops the picks — other tokens stay', async () => {
    h.current = apartment({ facetTokens: '|amenities:pool|rentalPeriod:weekly|' })
    await updateListingCore('listing-1', { subcategorySlug: 'house-rental' })
    expect(h.updates[0]).toMatchObject({ subcategorySlug: 'house-rental', facetTokens: '|rentalPeriod:weekly|' })
    // Named on the way out: still none — the new shelf does not ask it.
    h.current = apartment({ facetTokens: '|amenities:pool|' })
    await updateListingCore('listing-1', { subcategorySlug: 'house-rental', attributes: { rentalPeriod: 'monthly', amenities: ['gym'] } })
    expect(h.updates[1].facetTokens).toBeNull()
  })

  it('a row on a shelf without the facet: amenities sent are dropped, its tokens untouched', async () => {
    h.current = apartment({ subcategorySlug: 'house-rental', facetTokens: '|rentalPeriod:weekly|' })
    await updateListingCore('listing-1', { attributes: { rentalPeriod: 'monthly', amenities: ['pool'] } })
    expect(h.updates[0]).not.toHaveProperty('facetTokens')
    expect(attrsOf(h.updates[0].attributes)).toEqual({ rentalPeriod: 'monthly' })
  })

  it('⛔ an edit to "Looking to rent" drops the picks, named or not — other tokens stay; back to Rent stores what is named', async () => {
    h.current = apartment({ facetTokens: '|amenities:pool|rentalPeriod:weekly|' })
    await updateListingCore('listing-1', { listingType: 'wanted', attributes: { rentalPeriod: 'monthly' } })
    expect(h.updates[0]).toMatchObject({ listingType: 'wanted', facetTokens: '|rentalPeriod:weekly|' })
    h.current = apartment({ facetTokens: '|amenities:pool|' })
    await updateListingCore('listing-1', { listingType: 'wanted', attributes: { rentalPeriod: 'monthly', amenities: ['pool', 'gym'] } })
    expect(h.updates[1].facetTokens).toBeNull()
    // A Wanted row turned back into a rent ad: the picks named are stored.
    h.current = apartment({ listingType: 'wanted', priceUnit: 'VND', facetTokens: null })
    await updateListingCore('listing-1', { listingType: 'rent', attributes: { rentalPeriod: 'monthly', amenities: ['gym', 'no-landlord'] } })
    expect(h.updates[2]).toMatchObject({ listingType: 'rent', facetTokens: '|amenities:no-landlord|amenities:gym|' })
  })

  // Reviewer's catch, 2026-10-20 (none on production that day — `attributes LIKE '%"amenities":%'` counted 0, read-only):
  // a row whose amenity an older client wrote into `attributes` matched the filter there; the form opened with no chip
  // pressed, sent `amenities: []`, and one untouched save un-matched it. The form now opens on it, and the save MOVES it.
  it('⛔ an untouched save of a row whose amenity sits in `attributes` moves it into the tokens — it still matches', async () => {
    const stored = JSON.stringify({ rentalPeriod: 'monthly', furnishing: 'fully', bedrooms: '1', amenities: 'pool' })
    expect(attrRowMatches({ attributes: stored, facetTokens: null }, 'amenities', 'pool')).toBe(true)
    // The edit page, then the wizard's submit (post-wizard.tsx: attributesPayload over the facets it asks on a rent ad).
    const form = editFormAttributes(JSON.parse(stored), null, 'rentals', 'apartment-rental', 'rent')
    const sent = attributesPayload(form, askableFacetsFor('rentals', 'apartment-rental').filter((f) => f.key !== 'condition'))
    expect(sent).toMatchObject({ amenities: ['pool'] })
    h.current = apartment({ attributes: stored })
    await updateListingCore('listing-1', { attributes: sent })
    const u = h.updates[0]
    expect(u.facetTokens).toBe('|amenities:pool|')
    expect(attrsOf(u.attributes)).toEqual({ rentalPeriod: 'monthly', furnishing: 'fully', bedrooms: '1' })
    expect(attrRowMatches({ attributes: u.attributes as string, facetTokens: u.facetTokens as string }, 'amenities', 'pool')).toBe(true)
    expect(amenityOptions(u.facetTokens as string, 'rentals', 'apartment-rental').map((o) => o.value)).toEqual(['pool'])
  })
})
