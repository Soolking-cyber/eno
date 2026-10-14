import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A5-SELL's two SERVER rules, against the real createListingCore / updateListingCore with a faked db
 * (the same dependency wall as listings.republish.test.ts), on the MARKETPLACE edition:
 *
 *   1. The e-visa product attributes (`visaEntryType`, `visaSpeed`) are stored for EVERY poster since the owner
 *      opened the e-Visa subcategory (2026-10-14) — O-34's strip for ordinary sellers on eno.vn is retired.
 *   2. The price unit follows the intent across the RENT boundary: a daily rental switched to
 *      "Cần thuê" (Wanted) states a budget, so it must not keep 'VND/day'; a Wanted switched to Rent
 *      takes the unit of its period instead of keeping a bare 'VND'.
 *   3. THE LICENCE CHECK (owner, 2026-10-14: "Anyone posts, live after check" — taxonomy.ts licenceCheckHold) —
 *      a create that PICKS the e-Visa subcategory, or an edit that MOVES a listing into it, by a seller who is
 *      neither an official partner nor eno's desk is written UNPUBLISHED (verified=false); a keyword GUESS of it
 *      files such a poster under Services › Other instead; a post nobody filed falls back to Services › Other.
 *      Replaces O-34b's refusal. eno.forum: listings.visa-slot.forum.test.ts.
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
  /** The seller is eno's own desk (edition-scope.ts deskSellerIds). */
  desk: false,
  /** New prices the price-drop pipeline was asked about (priceChangeEffects). */
  dropCalls: [] as number[],
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
vi.mock('@/lib/price-drop', () => ({ priceChangeEffects: async (_c: unknown, p: number) => { h.dropCalls.push(p); return { data: { previousPrice: 999_999 }, audit: null, notify: null } } }))
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
  h.desk = false
  h.dropCalls = []
  h.current = row()
})

it('runs as the marketplace edition (eno.vn)', () => {
  expect(IS_MARKETPLACE).toBe(true)
})

describe('e-visa product attributes are stored for every poster (O-34 retired, 2026-10-14)', () => {
  it('an ordinary seller’s new e-Visa listing keeps visaEntryType + visaSpeed, and everything else', async () => {
    await createVisaLegal({ visaEntryType: 'single', visaSpeed: '1H', providerType: 'business' })
    expect(attrsOf(h.creates[0].attributes)).toMatchObject({ visaEntryType: 'single', visaSpeed: '1H' })
  })

  it('an edit may add them to an ordinary seller’s listing', async () => {
    h.current = row({ subcategorySlug: 'visa-legal', listingType: 'service', priceUnit: 'VND/service', attributes: null })
    await updateListingCore('listing-1', { attributes: { visaEntryType: 'multiple', visaSpeed: '1H' } })
    expect(attrsOf(h.updates[0].attributes)).toMatchObject({ visaEntryType: 'multiple', visaSpeed: '1H' })
  })
})

describe('the licence check — the e-Visa subcategory is open to every poster, live after a check (2026-10-14)', () => {
  it('⛔ an ordinary seller who PICKS it: written UNPUBLISHED, and told so (verified: false)', async () => {
    const r = await createVisaLegal({})
    expect(r).toEqual({ id: 'new-1', verified: false, held: true })
    expect(h.creates[0]).toMatchObject({ subcategorySlug: 'visa-legal', verified: false })
  })

  it('eno’s own desk: live at once — an official partner (VietKite) waits for the check like anyone (gate, 2026-10-14)', async () => {
    h.desk = true
    expect(await createVisaLegal({})).toEqual({ id: 'new-1', verified: true })
    expect(h.creates[0]).toMatchObject({ subcategorySlug: 'visa-legal', verified: true })
    h.desk = false
    h.partner = true
    h.creates = []
    expect(await createVisaLegal({})).toEqual({ id: 'new-1', verified: false, held: true })
    expect(h.creates[0].verified).toBe(false)
  })

  it('⛔ a keyword GUESS never holds an ordinary post for a check it did not ask for — it files under Services › Other, live', async () => {
    const r = await createService('', {}, 'Vietnam e-visa, 1 hour')
    expect(h.creates[0]).toMatchObject({ subcategorySlug: 'service-other', verified: true })
    expect(r.verified).toBe(true)
  })

  it('keeps the desk’s keyword guess in the e-Visa subcategory, live; a partner’s guess files under Other like anyone’s', async () => {
    h.desk = true
    await createService('', {}, 'Vietnam e-visa, 1 hour')
    expect(h.creates[0]).toMatchObject({ subcategorySlug: 'visa-legal', verified: true })
    h.desk = false
    h.partner = true
    h.creates = []
    await createService('', {}, 'Vietnam e-visa, 1 hour')
    expect(h.creates[0]).toMatchObject({ subcategorySlug: 'service-other', verified: true })
  })

  it('a post nobody filed falls back to Services › Other — never the e-Visa subcategory (its first aisle)', async () => {
    await createService('', {}, 'Dog walking, two hours')
    expect(h.creates[0].subcategorySlug).toBe('service-other')
    h.creates = []
    await createService('not-a-subcategory', {}, 'Help in English')
    expect(h.creates[0].subcategorySlug).toBe('service-other')
  })

  it('work permits, tax and legal file under Legal & permits by their words', async () => {
    await createService('', {}, 'Work permit renewal help')
    expect(h.creates[0]).toMatchObject({ subcategorySlug: 'legal-permits', verified: true })
    h.creates = []
    await createService('', {}, 'Tax return help')
    expect(h.creates[0].subcategorySlug).toBe('legal-permits')
  })

  it('⛔ files by the TITLE first — a longer keyword in the description (the extras) does not win (gate, 2026-10-05)', async () => {
    await createListingCore({
      seller: { id: 'seller-1', ownerId: 'owner-1', trustTier: 'standard', trustScore: 100, phone: null },
      guestCreate: false,
      category: { id: 'c-services', slug: 'services', name: 'Services', nameVi: 'Dịch vụ' },
      title: 'Dọn dẹp nhà cửa theo giờ',
      price: 500_000,
      // 'work permit' (11) is longer than 'dọn dẹp' (7): read together, the description would file this cleaner
      // under Legal & permits.
      body: { listingType: 'service', subcategorySlug: '', description: 'Nhận dọn nhà cho chuyên gia, có thể hỗ trợ giấy tờ work permit.', attributes: {} },
      headers: new Headers(),
    })
    expect(h.creates[0].subcategorySlug).toBe('cleaning')
  })

  it('never reads the partner flag — the check exempts eno’s desk only', async () => {
    await createService('cleaning', { serviceLocation: 'online' }, 'Weekly flat cleaning')
    await createService('legal-permits', {}, 'Tax return help')
    await createVisaLegal({})
    expect(h.partnerReads).toBe(0)
  })

  it('⛔ an edit that MOVES an ordinary seller’s listing into it unpublishes it with the move, and says so (held)', async () => {
    h.current = row({ subcategorySlug: 'service-other', listingType: 'service', priceUnit: 'VND/service' })
    expect(await updateListingCore('listing-1', { subcategorySlug: 'visa-legal', title: 'Visa help' })).toEqual({ ok: true, held: true })
    expect(h.updates[0]).toMatchObject({ subcategorySlug: 'visa-legal', verified: false })
  })

  it('a move of a listing that is ALREADY unpublished (pulled) is no new hold — nothing claims the check pulled it', async () => {
    h.current = row({ subcategorySlug: 'service-other', listingType: 'service', priceUnit: 'VND/service', verified: false })
    expect(await updateListingCore('listing-1', { subcategorySlug: 'visa-legal' })).toEqual({ ok: true })
    expect(h.updates[0]).not.toHaveProperty('verified')
  })

  it('eno’s desk’s move stays live (no verified write); an official partner’s waits for the check like anyone’s', async () => {
    h.desk = true
    h.current = row({ subcategorySlug: 'service-other', listingType: 'service', priceUnit: 'VND/service' })
    expect(await updateListingCore('listing-1', { subcategorySlug: 'visa-legal' })).toEqual({ ok: true })
    expect(h.updates[0].subcategorySlug).toBe('visa-legal')
    expect(h.updates[0]).not.toHaveProperty('verified')
    h.updates = []
    h.desk = false
    h.current = row({ subcategorySlug: 'service-other', listingType: 'service', priceUnit: 'VND/service', seller: { trustTier: 'standard', officialPartner: true } })
    expect(await updateListingCore('listing-1', { subcategorySlug: 'visa-legal' })).toEqual({ ok: true, held: true })
    expect(h.updates[0].verified).toBe(false)
  })

  it('a listing ALREADY in it edits as usual (its own subcategory resent is not a move) and may move out — nothing published', async () => {
    h.current = row({ subcategorySlug: 'visa-legal', listingType: 'service', priceUnit: 'VND/service' })
    expect(await updateListingCore('listing-1', { subcategorySlug: 'visa-legal', title: 'e-Visa in 3 days' })).toEqual({ ok: true })
    expect(h.updates[0].title).toBe('e-Visa in 3 days')
    expect(h.updates[0]).not.toHaveProperty('verified')
    h.updates = []
    expect(await updateListingCore('listing-1', { subcategorySlug: 'service-other' })).toEqual({ ok: true })
    expect(h.updates[0].subcategorySlug).toBe('service-other')
    expect(h.updates[0]).not.toHaveProperty('verified')
  })

  it('an edit that does not touch the subcategory is unaffected', async () => {
    h.current = row({ subcategorySlug: 'visa-legal', listingType: 'service', priceUnit: 'VND/service' })
    expect(await updateListingCore('listing-1', { price: 600_000 })).toEqual({ ok: true })
    expect(h.updates[0]).not.toHaveProperty('verified')
  })
})

describe('services › Pricing stamps the unit — on create, and on EVERY edit of a service (2026-10-14)', () => {
  it('a new hourly service is stored per hour; a one-time or unanswered one per service', async () => {
    await createService('cleaning', { priceBasis: 'hourly', serviceLocation: 'at-customer' }, 'House cleaning')
    expect(h.creates[0].priceUnit).toBe('VND/hour')
    h.creates = []
    await createService('cleaning', { priceBasis: 'one-time' }, 'House cleaning')
    expect(h.creates[0].priceUnit).toBe('VND/service')
    h.creates = []
    await createService('cleaning', {}, 'House cleaning')
    expect(h.creates[0].priceUnit).toBe('VND/service')
  })

  it('⛔ a stray hourly answer on an e-Visa product is not a rate', async () => {
    await createVisaLegal({ priceBasis: 'hourly' })
    expect(h.creates[0].priceUnit).toBe('VND/service')
  })

  it('an edit that changes the basis re-stamps the unit', async () => {
    h.current = row({ subcategorySlug: 'cleaning', listingType: 'service', priceUnit: 'VND/service', attributes: JSON.stringify({ priceBasis: 'one-time' }) })
    await updateListingCore('listing-1', { attributes: { priceBasis: 'hourly', serviceLocation: 'online' } })
    expect(h.updates[0].priceUnit).toBe('VND/hour')
  })

  it('⛔ a sparse move of an hourly service into eSIM (no attributes sent) drops the rate', async () => {
    h.current = row({ subcategorySlug: 'cleaning', listingType: 'service', priceUnit: 'VND/hour', attributes: JSON.stringify({ priceBasis: 'hourly' }) })
    await updateListingCore('listing-1', { subcategorySlug: 'esim' })
    expect(h.updates[0]).toMatchObject({ subcategorySlug: 'esim', priceUnit: 'VND/service' })
  })

  it('a Wanted switched to Service, or a legacy bare-VND service edited at all, settles on the service unit', async () => {
    h.current = row({ subcategorySlug: 'cleaning', listingType: 'wanted', priceUnit: 'VND' })
    await updateListingCore('listing-1', { listingType: 'service' })
    expect(h.updates[0].priceUnit).toBe('VND/service')
    h.updates = []
    h.current = row({ subcategorySlug: 'cleaning', listingType: 'service', priceUnit: 'VND' })
    await updateListingCore('listing-1', { title: 'Weekly cleaning, Thao Dien' })
    expect(h.updates[0].priceUnit).toBe('VND/service')
  })

  it('⛔ an edit whose attributes omit the basis (an API client, an older form) keeps the hourly unit it has', async () => {
    h.current = row({ subcategorySlug: 'cleaning', listingType: 'service', priceUnit: 'VND/hour', attributes: JSON.stringify({ priceBasis: 'hourly' }) })
    await updateListingCore('listing-1', { attributes: { serviceLocation: 'online' } })
    expect(h.updates[0]).not.toHaveProperty('priceUnit')
  })

  it('⛔ a stale hourly answer left on an e-Visa row does not become a rate when the row moves to an aisle that asks', async () => {
    h.desk = true // no licence check in the way: this is about the unit
    h.current = row({ subcategorySlug: 'visa-legal', listingType: 'service', priceUnit: 'VND/service', attributes: JSON.stringify({ priceBasis: 'hourly' }) })
    await updateListingCore('listing-1', { subcategorySlug: 'cleaning' })
    expect(h.updates[0].subcategorySlug).toBe('cleaning')
    expect(h.updates[0]).not.toHaveProperty('priceUnit')
    // …and the answer is rewritten to what the unit says, so specs and the Pricing filter agree with the price.
    expect(attrsOf(h.updates[0].attributes)?.priceBasis).toBe('one-time')
  })

  it('the stored answer always mirrors the unit: an omitted one is added, a contradicting one corrected', async () => {
    await createService('cleaning', {}, 'House cleaning')
    expect(attrsOf(h.creates[0].attributes)?.priceBasis).toBe('one-time')
    h.current = row({ subcategorySlug: 'cleaning', listingType: 'service', priceUnit: 'VND/hour', attributes: null })
    await updateListingCore('listing-1', { title: 'Cleaning, by the hour' })
    expect(attrsOf(h.updates[0].attributes)?.priceBasis).toBe('hourly')
  })

  it('a unit the services rule does not own (an import stamped per month) is left alone, answer and all', async () => {
    h.current = row({ subcategorySlug: 'service-other', listingType: 'service', priceUnit: 'VND/month', attributes: null })
    await updateListingCore('listing-1', { title: 'Monthly retainer' })
    expect(h.updates[0]).not.toHaveProperty('priceUnit')
    expect(h.updates[0]).not.toHaveProperty('attributes')
  })

  it('a services row with another intent (a bulk sell row) is not re-stamped', async () => {
    h.current = row({ subcategorySlug: null, listingType: 'sell', priceUnit: '' })
    await updateListingCore('listing-1', { title: 'Old bulk row' })
    expect(h.updates[0]).not.toHaveProperty('priceUnit')
  })

  it('⛔ a basis switch is no price drop: one-time 1,000,000 đ → 150,000 đ an hour is recorded, but no badge (or alert)', async () => {
    h.current = row({ subcategorySlug: 'cleaning', listingType: 'service', price: 1_000_000, priceUnit: 'VND/service', previousPrice: 1_200_000, priceDropAt: new Date('2026-10-01'), attributes: JSON.stringify({ priceBasis: 'one-time' }) })
    await updateListingCore('listing-1', { price: 150_000, attributes: { priceBasis: 'hourly' } })
    expect(h.dropCalls).toEqual([150_000]) // asked — for the price history
    expect(h.updates[0]).toMatchObject({ priceUnit: 'VND/hour', price: 150_000, previousPrice: null, priceDropAt: null })
    // …while a price change in the same unit takes the drop rules' result.
    h.updates = []
    h.current = row({ subcategorySlug: 'cleaning', listingType: 'service', price: 150_000, priceUnit: 'VND/hour', attributes: JSON.stringify({ priceBasis: 'hourly' }) })
    await updateListingCore('listing-1', { price: 120_000 })
    expect(h.updates[0].previousPrice).toBe(999_999)
    // …and a legacy bare-VND service settling on 'VND/service' is no change of unit: its drop counts.
    h.updates = []
    h.current = row({ subcategorySlug: 'cleaning', listingType: 'service', price: 200_000, priceUnit: 'VND' })
    await updateListingCore('listing-1', { price: 150_000 })
    expect(h.updates[0]).toMatchObject({ priceUnit: 'VND/service', previousPrice: 999_999 })
  })

  it('a Pricing answer is not stored where the aisle does not ask one (e-Visa, eSIM)', async () => {
    await createService('esim', { priceBasis: 'hourly', planType: 'data' }, 'Travel eSIM')
    expect(JSON.parse(h.creates[0].attributes)).not.toHaveProperty('priceBasis')
    h.current = row({ subcategorySlug: 'esim', listingType: 'service', priceUnit: 'VND/service' })
    await updateListingCore('listing-1', { attributes: { priceBasis: 'hourly', planType: 'data' } })
    expect(JSON.parse(h.updates[0].attributes)).not.toHaveProperty('priceBasis')
  })

  it('an edit that leaves the unit as it is writes no unit', async () => {
    h.current = row({ subcategorySlug: 'cleaning', listingType: 'service', priceUnit: 'VND/hour', attributes: JSON.stringify({ priceBasis: 'hourly' }) })
    await updateListingCore('listing-1', { title: 'Cleaning by the hour' })
    expect(h.updates[0]).not.toHaveProperty('priceUnit')
  })
})

/** A Jobs create — `listingType` 'job' (hiring) or 'wanted' (looking for work), into `subcategorySlug` ('' = the server guesses). */
function createJob(listingType: 'job' | 'wanted', subcategorySlug: string, title = 'ESL teacher') {
  return createListingCore({
    seller: { id: 'seller-1', ownerId: 'owner-1', trustTier: 'standard', trustScore: 100, phone: null },
    guestCreate: false,
    category: { id: 'c-jobs', slug: 'jobs', name: 'Jobs', nameVi: 'Việc làm' },
    title,
    price: 450_000,
    body: { listingType, subcategorySlug, description: 'TEFL-certified English teacher with 4+ years of teaching experience.', attributes: {} },
    headers: new Headers(),
  })
}

describe('a teacher looking for work is a teacher profile, never a Jobs post (owner, 2026-10-12)', () => {
  it('⛔ refuses Jobs › Teaching + "looking for work" when PICKED — nothing is written', async () => {
    await expect(createJob('wanted', 'teaching')).rejects.toThrow('teacher_profile_instead')
    expect(h.creates).toHaveLength(0)
  })

  it('⛔ refuses it on a keyword GUESS too — "ESL teacher" files under Teaching from the poster\'s own words', async () => {
    await expect(createJob('wanted', '')).rejects.toThrow('teacher_profile_instead')
    expect(h.creates).toHaveLength(0)
  })

  it('keeps hiring in Teaching, and "looking for work" in every other Jobs aisle', async () => {
    await createJob('job', 'teaching', 'English teacher wanted, District 7')
    expect(h.creates[0]).toMatchObject({ listingType: 'job', subcategorySlug: 'teaching' })
    h.creates = []
    await createJob('wanted', 'hospitality', 'Barista looking for weekend shifts')
    expect(h.creates[0]).toMatchObject({ listingType: 'wanted', subcategorySlug: 'hospitality' })
  })

  it('⛔ refuses an edit that MOVES a listing into the pair — by subcategory or by intent; nothing is written', async () => {
    h.current = row({ category: { slug: 'jobs', name: 'Jobs', nameVi: 'Việc làm' }, listingType: 'wanted', subcategorySlug: 'remote-freelance' })
    expect(await updateListingCore('listing-1', { subcategorySlug: 'teaching' })).toEqual({ ok: false, code: 400, error: 'teacher_profile_instead' })
    h.current = row({ category: { slug: 'jobs', name: 'Jobs', nameVi: 'Việc làm' }, listingType: 'job', subcategorySlug: 'teaching', priceUnit: 'VND/month' })
    expect(await updateListingCore('listing-1', { listingType: 'wanted' })).toEqual({ ok: false, code: 400, error: 'teacher_profile_instead' })
    expect(h.updates).toHaveLength(0)
  })

  it('a listing ALREADY in the pair (posted before the rule) edits as usual, and may move out', async () => {
    h.current = row({ category: { slug: 'jobs', name: 'Jobs', nameVi: 'Việc làm' }, listingType: 'wanted', subcategorySlug: 'teaching' })
    expect(await updateListingCore('listing-1', { subcategorySlug: 'teaching', title: 'ESL teacher, evenings' })).toEqual({ ok: true })
    h.updates = []
    expect(await updateListingCore('listing-1', { subcategorySlug: 'job-other' })).toEqual({ ok: true })
    expect(h.updates[0].subcategorySlug).toBe('job-other')
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
