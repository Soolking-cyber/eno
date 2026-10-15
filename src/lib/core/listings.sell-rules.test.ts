import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A5-SELL's SERVER rules, against the real createListingCore / updateListingCore with a faked db (the same
 * dependency wall as listings.republish.test.ts), on the MARKETPLACE edition:
 *
 *   1. The e-visa product attributes (`visaEntryType`, `visaSpeed`) are stored for EVERY poster since the owner
 *      opened the e-Visa subcategory (2026-10-14) — O-34's strip for ordinary sellers on eno.vn is retired.
 *   2. The price unit follows the intent across the RENT boundary: a daily rental switched to
 *      "Cần thuê" (Wanted) states a budget, so it must not keep 'VND/day'; a Wanted switched to Rent
 *      takes the unit of its period instead of keeping a bare 'VND'.
 *   3. THE LICENCE CHECK (owner, 2026-10-14: "Anyone posts, live after check", then for Legal & permits "Check them
 *      too" — taxonomy.ts licenceCheckHold, provider-licence.ts, licence-stamp.ts). A listing in e-Visa or Legal &
 *      permits from anyone but eno's desk carries the provider's registered name and licence number and is written
 *      UNPUBLISHED (verified=false, `held`) until an admin approves exactly those values. A keyword GUESS of either
 *      aisle counts as a pick (R3 of the plan review); a Wanted ad never lands in one. An edit re-holds on a move into
 *      or between the aisles, on a changed value, and on any edit of a row still waiting; a move out strips the values
 *      and the stamp and never publishes; the final write is a compare-and-set on the licence facts it read (R2).
 *      eno.forum: listings.visa-slot.forum.test.ts.
 */

// ⚠️ BEFORE the import below: the edition is read once, when @/lib/edition first loads.
vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')

type Row = Record<string, any>

// The licence WHITELIST (src/lib/licence-whitelist.ts — owner, 2026-10-15) is switchable here: EMPTY by default, so the
// tests below pin the check as it runs for everyone else (VietKite's grandfather included); the whitelist's own tests
// turn it on.
const wl = vi.hoisted(() => ({ list: [] as Array<{ sellerId: string; name: string; aisles: string[] }> }))
vi.mock('@/lib/licence-whitelist', () => ({
  get LICENCE_WHITELIST() { return wl.list },
  isLicenceWhitelisted: (sellerId: string | null | undefined, sub: string | null | undefined) =>
    !!sellerId && !!sub && wl.list.some((w) => w.sellerId === sellerId && w.aisles.includes(sub)),
}))
const h = vi.hoisted(() => ({
  updates: [] as Row[],
  /** The WHERE of every db.listing.update — the edit's compare-and-set (R2). */
  wheres: [] as Row[],
  creates: [] as Row[],
  current: {} as Row,
  /** db.listing.findUnique calls: the first is the edit's own read; a later one is the P2025 re-read. */
  finds: 0,
  /** What a re-read after a missed write sees (undefined: the same row as the first read). */
  afterMiss: undefined as Row | null | undefined,
  /** The row the database holds when the WRITE arrives — the race (R2). null: every write lands. */
  dbRow: null as Row | null,
  /** Seller.officialPartner as the faked db answers it. */
  partner: false,
  /** How often createListingCore asked for the seller's partner flag. */
  partnerReads: 0,
  /** The seller is eno's own desk (edition-scope.ts deskSellerIds). */
  desk: false,
  /** New prices the price-drop pipeline was asked about (priceChangeEffects). */
  dropCalls: [] as number[],
  /** Every text the generic content screen (assertCleanTexts) was handed; `realScreen` also runs the real one. */
  screened: [] as Array<string | null | undefined>,
  realScreen: false,
  /** What the duplicate guard was asked to compare, and what translation warming was handed. */
  dupInputs: [] as Row[],
  warmed: [] as string[],
  afters: [] as Array<() => unknown>,
}))

/** Prisma's conditional-update semantics on the one row (the edit's where: id, not-removed, the licence facts). */
function casMatches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'id') return true
    if (k === 'status' && v && typeof v === 'object') return row.status !== (v as Row).not
    return (row[k] ?? null) === (v ?? null)
  })
}

vi.mock('next/server', () => ({ after: (fn: () => unknown) => { h.afters.push(fn) } }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      findUnique: async () => {
        h.finds++
        return h.finds > 1 && h.afterMiss !== undefined ? h.afterMiss : h.current
      },
      update: async ({ where, data }: Row) => {
        h.wheres.push(where)
        if (h.dbRow && !casMatches(h.dbRow, where)) throw Object.assign(new Error('No record was found for an update.'), { code: 'P2025' })
        h.updates.push(data)
        return { id: 'listing-1' }
      },
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
vi.mock('@/lib/translate', () => ({ warmTranslations: async (texts: string[]) => { h.warmed.push(...texts) } }))
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
// The REAL module underneath (PublishBlockedError, containsContactInfo, findBannedWord — provider-licence.ts screens the
// licence values with those, through this same module); only the publish gates around the rules under test are stubbed.
vi.mock('@/lib/publish-guard', async (orig) => {
  const actual = await orig<typeof import('@/lib/publish-guard')>()
  return {
    ...actual,
    assertPublishable: () => {},
    assertCleanTexts: (texts: Array<string | null | undefined>) => {
      h.screened.push(...texts)
      if (h.realScreen) actual.assertCleanTexts(texts)
    },
    assertCleanContactName: () => {},
    assertEnoughAngles: () => {},
  }
})
vi.mock('@/lib/duplicate-guard', () => ({ findDuplicateListing: async (input: Row) => { h.dupInputs.push(input); return null } }))
vi.mock('@/lib/ai-moderation', () => ({ moderateListingById: async () => {} }))
vi.mock('@/lib/image-provenance', () => ({ indexAndCheckProvenance: async () => {} }))
vi.mock('@/lib/price-drop', () => ({ priceChangeEffects: async (_c: unknown, p: number) => { h.dropCalls.push(p); return { data: { previousPrice: 999_999 }, audit: null, notify: null } } }))
vi.mock('@/lib/urgent', () => ({ activateUrgentGate: async () => ({ ok: true }), urgentQuotaFree: async () => true, URGENT: {} }))

const { createListingCore, updateListingCore } = await import('@/lib/core/listings')
const { IS_MARKETPLACE } = await import('@/lib/edition')
// Imported here, not at the top: a static import would load the taxonomy (and the edition) before the stub above.
const { LICENCE_STAMP_CLEARED, licenceStampFor } = await import('@/lib/licence-stamp')
const { providerLicenceOf } = await import('@/lib/provider-licence')

const attrsOf = (json: unknown) => (typeof json === 'string' ? JSON.parse(json) : json) as Record<string, string> | null

/** Real-shaped provider values (the plan's probe table): an international travel-service licence, and a law firm's. */
const VISA = { providerLegalName: 'CÔNG TY TNHH THƯƠNG MẠI DỊCH VỤ DU LỊCH VIETKITE', providerLicenceNo: '79-123/2019/TCDL-GP LHQT' }
const LEGAL = { providerLegalName: 'CÔNG TY LUẬT TNHH HOÀNG PHI VÀ CỘNG SỰ TẠI THÀNH PHỐ HỒ CHÍ MINH', providerLicenceNo: '01021234/TP/ĐKHĐ' }
const PROVIDER_KEYS = ['providerLegalName', 'providerLicenceNo']

/** A services create — into `subcategorySlug` ('' = none picked, the server guesses from the words). */
function createService(subcategorySlug: string, attributes: Record<string, string> = {}, title = 'Work permit and visa paperwork help', listingType = 'service') {
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
    verificationMethod: null, verifiedAt: null, verificationNotes: null, identityHold: false,
    ...overrides,
  }
}

/** An e-Visa service row carrying `values` (none: null attributes). */
const aisleRow = (overrides: Row = {}, values: Record<string, string> | null = VISA) =>
  row({ subcategorySlug: 'visa-legal', listingType: 'service', priceUnit: 'VND/service', attributes: values ? JSON.stringify(values) : null, ...overrides })

/** An e-Visa row an admin APPROVED: its stamp is the stamp of its own values, this seller and this aisle. */
function stampedRow(overrides: Row = {}): Row {
  const r = aisleRow(overrides)
  return { ...r, verificationMethod: licenceStampFor({ sellerId: r.sellerId, subcategorySlug: r.subcategorySlug }, providerLicenceOf(r.attributes)!), verifiedAt: new Date('2026-10-15') }
}

beforeEach(() => {
  wl.list = []
  h.updates = []
  h.wheres = []
  h.creates = []
  h.finds = 0
  h.afterMiss = undefined
  h.dbRow = null
  h.partner = false
  h.partnerReads = 0
  h.desk = false
  h.dropCalls = []
  h.screened = []
  h.realScreen = false
  h.dupInputs = []
  h.warmed = []
  h.afters = []
  h.current = row()
})

it('runs as the marketplace edition (eno.vn)', () => {
  expect(IS_MARKETPLACE).toBe(true)
})

describe('e-visa product attributes are stored for every poster (O-34 retired, 2026-10-14)', () => {
  it('an ordinary seller’s new e-Visa listing keeps visaEntryType + visaSpeed, and everything else', async () => {
    await createVisaLegal({ visaEntryType: 'single', visaSpeed: '1H', providerType: 'business', ...VISA })
    expect(attrsOf(h.creates[0].attributes)).toMatchObject({ visaEntryType: 'single', visaSpeed: '1H' })
  })

  it('an edit may add them to an ordinary seller’s listing (with the licence values the aisle needs)', async () => {
    h.current = aisleRow({}, null)
    await updateListingCore('listing-1', { attributes: { visaEntryType: 'multiple', visaSpeed: '1H', ...VISA } })
    expect(attrsOf(h.updates[0].attributes)).toMatchObject({ visaEntryType: 'multiple', visaSpeed: '1H' })
  })
})

describe('the licence check on CREATE — e-Visa and Legal & permits, open to every poster, live after a check (2026-10-14)', () => {
  it('⛔ an ordinary seller who picks e-Visa without the provider’s values: provider_licence_required, nothing written', async () => {
    await expect(createVisaLegal({})).rejects.toMatchObject({ code: 'provider_licence_required' })
    await expect(createVisaLegal({ providerLegalName: VISA.providerLegalName })).rejects.toMatchObject({ code: 'provider_licence_required' })
    await expect(createService('legal-permits', { providerLicenceNo: LEGAL.providerLicenceNo }, 'Work permit renewal help')).rejects.toMatchObject({ code: 'provider_licence_required' })
    expect(h.creates).toHaveLength(0)
  })

  it('⛔ a Legal & permits pick WITH valid values: written UNPUBLISHED and told so — the values stored normalised and uncut, no stamp', async () => {
    // NFD, doubled spaces and a copied "Số:" label in, NFC single-spaced and bare out — and a name far past the
    // generic 40-character cut, kept whole.
    const r = await createService('legal-permits', {
      providerLegalName: `  ${LEGAL.providerLegalName.normalize('NFD').replace(/ /g, '  ')} `,
      providerLicenceNo: `Số: ${LEGAL.providerLicenceNo}`,
    }, 'Work permit renewal help')
    expect(r).toEqual({ id: 'new-1', verified: false, held: true })
    expect(h.creates[0]).toMatchObject({ subcategorySlug: 'legal-permits', verified: false })
    expect(attrsOf(h.creates[0].attributes)).toMatchObject(LEGAL)
    expect(LEGAL.providerLegalName.length).toBeGreaterThan(40)
    // Only an admin's approval writes a stamp (licence-stamp.ts) — never a create. The create carries the licence hold's
    // mark instead (LICENCE_HELD_NOTE): the approval publishes it.
    for (const k of ['verificationMethod', 'verifiedAt', 'verifiedBy']) expect(h.creates[0]).not.toHaveProperty(k)
    expect(h.creates[0].verificationNotes).toBe('licence:held')
  })

  it('an e-Visa pick with valid values: held the same way', async () => {
    expect(await createVisaLegal({ ...VISA })).toEqual({ id: 'new-1', verified: false, held: true })
    expect(attrsOf(h.creates[0].attributes)).toMatchObject(VISA)
  })

  it('⛔ a value that cannot be accepted: provider_licence_invalid with detail "<field>:<reason>", nothing written', async () => {
    await expect(createVisaLegal({ providerLegalName: VISA.providerLegalName, providerLicenceNo: '079123456789' }))
      .rejects.toMatchObject({ code: 'provider_licence_invalid', detail: 'providerLicenceNo:personal_id' })
    await expect(createVisaLegal({ providerLegalName: 'Zalo 0903 123 456', providerLicenceNo: VISA.providerLicenceNo }))
      .rejects.toMatchObject({ code: 'provider_licence_invalid', detail: expect.stringMatching(/^providerLegalName:/) })
    expect(h.creates).toHaveLength(0)
  })

  it('eno’s own desk posts live WITHOUT values — and any value it does send is screened like anyone’s', async () => {
    h.desk = true
    expect(await createVisaLegal({})).toEqual({ id: 'new-1', verified: true })
    expect(h.creates[0]).toMatchObject({ subcategorySlug: 'visa-legal', verified: true })
    await expect(createVisaLegal({ providerLegalName: VISA.providerLegalName, providerLicenceNo: '0903123456' }))
      .rejects.toMatchObject({ code: 'provider_licence_invalid' })
  })

  it('an official partner (VietKite) waits for the check like anyone (gate, 2026-10-14) — the partner flag is never read', async () => {
    h.partner = true
    expect(await createVisaLegal({ ...VISA })).toEqual({ id: 'new-1', verified: false, held: true })
    expect(h.creates[0].verified).toBe(false)
    await createService('cleaning', { serviceLocation: 'online' }, 'Weekly flat cleaning')
    await createService('legal-permits', { ...LEGAL }, 'Tax return help')
    expect(h.partnerReads).toBe(0)
  })

  // ⛔ R3 (plan review, 2026-10-14): a guess used to file such a post under Services › Other, LIVE — an unchecked visa or
  // work-permit offer on the public feed, the thing /prohibited rule 1 forbids. The words are the poster's own.
  it.each([
    ['Work permit renewal help', 'legal-permits', LEGAL],
    ['Thẻ tạm trú cho người nước ngoài', 'legal-permits', LEGAL],
    ['Vietnam e-visa, 1 hour', 'visa-legal', VISA],
  ])('⛔ a keyword GUESS counts as a pick — "%s" needs the values (provider_licence_required), and with them waits in %s', async (title, aisle, values) => {
    await expect(createService('', {}, title)).rejects.toMatchObject({ code: 'provider_licence_required' })
    expect(h.creates).toHaveLength(0)
    expect(await createService('', { ...values }, title)).toEqual({ id: 'new-1', verified: false, held: true })
    expect(h.creates[0]).toMatchObject({ subcategorySlug: aisle, verified: false })
  })

  // The guess asks for a licence now, so Legal & permits guesses only on specific phrases (commit gate, 2026-10-14): a
  // translator or a tax-return helper is not filed there by a bare 'legal' / 'tax' and goes live under Other.
  it.each(['Legal document translation', 'Tax return help', 'Parking permit help'])('"%s" is not guessed into a licence aisle', async (title) => {
    expect(await createService('', {}, title)).toEqual({ id: 'new-1', verified: true })
    expect(h.creates[0].subcategorySlug).not.toMatch(/^(visa-legal|legal-permits)$/)
  })

  it('the desk’s keyword guess stays in the aisle, live; a partner’s guess waits like anyone’s', async () => {
    h.desk = true
    await createService('', {}, 'Vietnam e-visa, 1 hour')
    expect(h.creates[0]).toMatchObject({ subcategorySlug: 'visa-legal', verified: true })
    h.desk = false
    h.partner = true
    await expect(createService('', {}, 'Vietnam e-visa, 1 hour')).rejects.toMatchObject({ code: 'provider_licence_required' })
  })

  it('⛔ a WANTED ad never lands in a licence aisle — picked or guessed, it goes to Services › Other, live, the keys dropped', async () => {
    expect(await createService('visa-legal', { ...VISA }, 'Looking for a visa agent', 'wanted')).toEqual({ id: 'new-1', verified: true })
    expect(h.creates[0]).toMatchObject({ subcategorySlug: 'service-other', listingType: 'wanted', verified: true })
    for (const k of PROVIDER_KEYS) expect(attrsOf(h.creates[0].attributes) ?? {}).not.toHaveProperty(k)
    await createService('legal-permits', {}, 'Need help with a work permit', 'wanted')
    expect(h.creates[1]).toMatchObject({ subcategorySlug: 'service-other', verified: true })
    await createService('', {}, 'Work permit renewal help', 'wanted')
    expect(h.creates[2]).toMatchObject({ subcategorySlug: 'service-other', verified: true })
  })

  it('⛔ the keys sent on a post outside the aisles are dropped — the generic attribute path never stores them', async () => {
    await createService('cleaning', { serviceLocation: 'online', ...VISA }, 'Weekly flat cleaning')
    expect(h.creates[0]).toMatchObject({ subcategorySlug: 'cleaning', verified: true })
    for (const k of PROVIDER_KEYS) expect(attrsOf(h.creates[0].attributes)).not.toHaveProperty(k)
  })

  it('⛔ a bare enterprise code in Legal & permits raises no contact_in_text: the values have their own screen, not the generic one', async () => {
    h.realScreen = true
    const r = await createService('legal-permits', { providerLegalName: LEGAL.providerLegalName, providerLicenceNo: '0312345678' }, 'Work permit renewal help')
    expect(r).toEqual({ id: 'new-1', verified: false, held: true })
    expect(attrsOf(h.creates[0].attributes)?.providerLicenceNo).toBe('0312345678')
    expect(h.screened).not.toContain('0312345678')
    expect(h.screened).not.toContain(LEGAL.providerLegalName)
  })

  it('the duplicate guard’s facets and the translation warm leave both values out (a new licence number is no new offer)', async () => {
    await createVisaLegal({ visaEntryType: 'single', ...VISA })
    expect(h.dupInputs[0].attributes).toMatchObject({ visaEntryType: 'single' })
    for (const k of PROVIDER_KEYS) expect(h.dupInputs[0].attributes).not.toHaveProperty(k)
    for (const f of h.afters) await f()
    expect(h.warmed.length).toBeGreaterThan(0)
    expect(h.warmed).not.toContain(VISA.providerLegalName)
    expect(h.warmed).not.toContain(VISA.providerLicenceNo)
  })

  it('a post nobody filed falls back to Services › Other — never the e-Visa subcategory (its first aisle)', async () => {
    await createService('', {}, 'Help around the house, two hours') // no aisle's keyword
    expect(h.creates[0].subcategorySlug).toBe('service-other')
    h.creates = []
    await createService('not-a-subcategory', {}, 'Help in English')
    expect(h.creates[0].subcategorySlug).toBe('service-other')
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
})

// ⛔ Owner, 2026-10-15: "whitelist vietkite" (src/lib/licence-whitelist.ts) — a storefront whitelisted for e-Visa posts and
// edits there like the desk: no values asked, never held. Another aisle is checked like anyone's.
describe('the licence WHITELIST on create and edit (2026-10-15)', () => {
  beforeEach(() => { wl.list = [{ sellerId: 'seller-1', name: 'whitelisted', aisles: ['visa-legal'] }] })

  it('a whitelisted e-Visa post goes live with no values — not held, no mark', async () => {
    expect(await createService('visa-legal', {}, 'Vietnam e-visa in 3 days')).toEqual({ id: 'new-1', verified: true })
    expect(h.creates[0]).toMatchObject({ subcategorySlug: 'visa-legal', verified: true })
    expect(h.creates[0]).not.toHaveProperty('verificationNotes')
  })

  it('its Legal & permits post is checked like anyone’s — the values are required', async () => {
    await expect(createService('legal-permits', {}, 'Work permit renewal help')).rejects.toMatchObject({ code: 'provider_licence_required' })
  })

  it('an edit of its live e-Visa row with no values stays live — no hold, no verified write', async () => {
    h.current = aisleRow({ verified: true }, null)
    expect(await updateListingCore('listing-1', { title: 'e-Visa in 3 days, all nationalities' })).toEqual({ ok: true })
    expect(h.updates[0]).not.toHaveProperty('verified')
  })

  it('a move of it to Legal & permits needs the values, like anyone’s', async () => {
    h.current = aisleRow({ verified: true }, null)
    expect(await updateListingCore('listing-1', { subcategorySlug: 'legal-permits' })).toEqual({ ok: false, code: 400, error: 'provider_licence_required' })
    expect(h.updates).toHaveLength(0)
  })

  it('a move of it OUT of the aisles keeps it live — it was cleared', async () => {
    h.current = aisleRow({ verified: true }, null)
    expect(await updateListingCore('listing-1', { subcategorySlug: 'service-other' })).toEqual({ ok: true })
    expect(h.updates[0]).not.toHaveProperty('verified')
  })
})

describe('the licence check on EDIT (2026-10-14)', () => {
  it('⛔ an APPROVED row whose licence number changes → unpublished, the stamp cleared, `held` — live, hidden or sold alike', async () => {
    for (const status of ['active', 'hidden', 'sold']) {
      h.updates = []
      h.current = stampedRow({ status })
      const changed = { ...VISA, providerLicenceNo: '79-124/2019/TCDL-GP LHQT' }
      expect(await updateListingCore('listing-1', { attributes: changed }), status).toEqual({ ok: true, held: true })
      // It was live (verified), so it goes down for its licence: the hold's mark — approving the new number puts it back.
      expect(h.updates[0], status).toMatchObject({ verified: false, ...LICENCE_STAMP_CLEARED, verificationNotes: 'licence:held' })
      expect(attrsOf(h.updates[0].attributes), status).toMatchObject(changed)
    }
  })

  it('an approved row edited without touching its values or aisle stays live — no verified key, no stamp key', async () => {
    h.current = stampedRow()
    expect(await updateListingCore('listing-1', { title: 'e-Visa in 3 days' })).toEqual({ ok: true })
    // The wizard round-trips every attribute: the same values resent are no change.
    expect(await updateListingCore('listing-1', { subcategorySlug: 'visa-legal', attributes: { visaSpeed: '1H', ...VISA } })).toEqual({ ok: true })
    for (const u of h.updates) {
      expect(u).not.toHaveProperty('verified')
      for (const k of Object.keys(LICENCE_STAMP_CLEARED)) expect(u).not.toHaveProperty(k)
    }
    expect(attrsOf(h.updates[1].attributes)).toMatchObject({ visaSpeed: '1H', ...VISA })
  })

  it('values resent with other whitespace, in NFD or behind a copied label are the same values — no hold', async () => {
    h.current = stampedRow()
    const res = await updateListingCore('listing-1', {
      attributes: {
        providerLegalName: ` ${VISA.providerLegalName.normalize('NFD').replace(/ /g, '   ')}  `,
        providerLicenceNo: `Số:  ${VISA.providerLicenceNo.replace(' ', '    ')}`,
      },
    })
    expect(res).toEqual({ ok: true })
    expect(h.updates[0]).not.toHaveProperty('verified')
    expect(h.updates[0]).not.toHaveProperty('verificationMethod')
    expect(attrsOf(h.updates[0].attributes)).toMatchObject(VISA) // stored normalised
  })

  it('⛔ e-Visa → Legal & permits is a move: the values travel, the stamp is cleared, the row waits again', async () => {
    h.current = stampedRow()
    expect(await updateListingCore('listing-1', { subcategorySlug: 'legal-permits' })).toEqual({ ok: true, held: true })
    expect(h.updates[0]).toMatchObject({ subcategorySlug: 'legal-permits', verified: false, ...LICENCE_STAMP_CLEARED, verificationNotes: 'licence:held' })
    // The stored values were not re-sent; whatever this edit writes keeps them.
    if (h.updates[0].attributes !== undefined) expect(attrsOf(h.updates[0].attributes)).toMatchObject(VISA)
  })

  it('⛔ a move IN without the values — no attributes, or attributes without the keys — is provider_licence_required; nothing written', async () => {
    h.current = row({ subcategorySlug: 'service-other', listingType: 'service', priceUnit: 'VND/service' })
    const REQUIRED = { ok: false, code: 400, error: 'provider_licence_required' }
    expect(await updateListingCore('listing-1', { subcategorySlug: 'visa-legal' })).toEqual(REQUIRED)
    expect(await updateListingCore('listing-1', { subcategorySlug: 'legal-permits', attributes: { serviceLocation: 'online' } })).toEqual(REQUIRED)
    // …and attributes sent WITHOUT the keys on a row already in an aisle (a replace would drop them).
    h.current = stampedRow()
    expect(await updateListingCore('listing-1', { attributes: { visaSpeed: '1H' } })).toEqual(REQUIRED)
    expect(h.updates).toHaveLength(0)
  })

  it('a move IN with the values: written uncut, held, no stamp', async () => {
    h.current = row({ subcategorySlug: 'service-other', listingType: 'service', priceUnit: 'VND/service' })
    expect(await updateListingCore('listing-1', { subcategorySlug: 'legal-permits', attributes: { ...LEGAL } })).toEqual({ ok: true, held: true })
    expect(h.updates[0]).toMatchObject({ subcategorySlug: 'legal-permits', verified: false })
    expect(attrsOf(h.updates[0].attributes)).toMatchObject(LEGAL)
  })

  // Commit gate, 2026-10-14: stored, approved values are not re-judged on every edit — a later tightening of the screen
  // must not lock an approved listing out of a title fix. Only values the edit CHANGES (or a move) are screened.
  it('stored values the edit does not change are not re-screened — a title fix on a row whose stored number fails today’s screen saves', async () => {
    h.current = stampedRow({ attributes: JSON.stringify({ ...VISA, providerLicenceNo: 'CCCD 079123456789' }) })
    const r = await updateListingCore('listing-1', { title: 'e-Visa 1 hour — now with weekend processing' })
    expect(r).not.toMatchObject({ error: 'provider_licence_invalid' })
  })

  it('⛔ an invalid value on an edit: provider_licence_invalid with its detail; nothing written', async () => {
    h.current = stampedRow()
    expect(await updateListingCore('listing-1', { attributes: { ...VISA, providerLicenceNo: 'CCCD 079123456789' } }))
      .toEqual({ ok: false, code: 400, error: 'provider_licence_invalid', detail: 'providerLicenceNo:personal_id' })
    expect(h.updates).toHaveLength(0)
  })

  // ⛔ Commit gate, 2026-10-14: moving a LIVE row the check never cleared out of the aisles (a grandfathered or legacy
  // visa offer to Services › Other) must not keep it public — it goes to the admin's pending queue. An approved row
  // moves out live.
  it('⛔ a live UNCLEARED aisle row that moves out is unpublished (verified=false) — it cannot escape the check', async () => {
    h.current = aisleRow({ verified: true })
    // `held`: not public now, so the wizard goes to the dashboard rather than to a listing page that 404s.
    expect(await updateListingCore('listing-1', { subcategorySlug: 'service-other' })).toEqual({ ok: true, held: true })
    expect(h.updates[0]).toMatchObject({ subcategorySlug: 'service-other', verified: false, ...LICENCE_STAMP_CLEARED })
  })

  // ⛔ Commit gate, 2026-10-14: the licence hold's mark (licence-stamp.ts licenceHeldMark) is what 'licence-approve' publishes
  // by. A re-hold keeps it for a row that was LIVE or already held for the check — never for one something else had taken
  // down (an admin Unverify, a moderation Unpublish), which an approval must then leave down.
  it.each<[string, Row, string | null]>([
    ['a row still held for the check (marked), edited', { verified: false, verificationNotes: 'licence:held' }, 'licence:held'],
    ['an UNVERIFIED unmarked row (taken down by an admin), edited', { verified: false, verificationNotes: null }, null],
  ])('⛔ the re-hold of %s writes verificationNotes = %s', async (_label, over, mark) => {
    h.current = aisleRow(over)
    expect(await updateListingCore('listing-1', { title: 'e-Visa in 3 days, all nationalities' })).toEqual({ ok: true, held: true })
    expect(h.updates[0]).toMatchObject({ verified: false, verificationNotes: mark })
  })

  it('⛔ an APPROVED row an admin had unverified, whose number then changes: the stamp goes, and no mark — the approval leaves it down', async () => {
    h.current = stampedRow({ verified: false })
    expect(await updateListingCore('listing-1', { attributes: { ...VISA, providerLicenceNo: '79-124/2019/TCDL-GP LHQT' } })).toEqual({ ok: true, held: true })
    expect(h.updates[0]).toMatchObject({ verified: false, ...LICENCE_STAMP_CLEARED, verificationNotes: null })
  })

  it('an APPROVED live row moves out live — no verified write', async () => {
    h.current = stampedRow()
    expect(await updateListingCore('listing-1', { subcategorySlug: 'service-other' })).toEqual({ ok: true })
    expect(h.updates[0]).not.toHaveProperty('verified')
  })

  // ⛔ Commit gate, 2026-10-14: create's Wanted rule holds on an edit too — a Wanted ad is never in a licence aisle.
  it('⛔ an aisle service switched to Wanted goes to Services › Other — a move out: values and stamp dropped, never published', async () => {
    h.current = stampedRow()
    expect(await updateListingCore('listing-1', { listingType: 'wanted' })).toEqual({ ok: true })
    expect(h.updates[0]).toMatchObject({ listingType: 'wanted', subcategorySlug: 'service-other', ...LICENCE_STAMP_CLEARED })
    expect(h.updates[0]).not.toHaveProperty('verified')
    for (const k of PROVIDER_KEYS) expect(attrsOf(h.updates[0].attributes) ?? {}).not.toHaveProperty(k)
  })

  it('⛔ a Wanted ad moved INTO an aisle lands in Services › Other instead — no licence asked of a buyer', async () => {
    h.current = row({ subcategorySlug: 'service-other', listingType: 'wanted', priceUnit: 'VND' })
    expect(await updateListingCore('listing-1', { subcategorySlug: 'visa-legal' })).toEqual({ ok: true })
    expect(h.updates[0]?.subcategorySlug ?? 'service-other').toBe('service-other')
  })

  it('⛔ a move OUT strips both values and the stamp — and never publishes (no verified key)', async () => {
    h.current = stampedRow({ attributes: JSON.stringify({ visaSpeed: '1H', ...VISA }) })
    expect(await updateListingCore('listing-1', { subcategorySlug: 'service-other' })).toEqual({ ok: true })
    expect(h.updates[0]).toMatchObject({ subcategorySlug: 'service-other', ...LICENCE_STAMP_CLEARED })
    expect(h.updates[0]).not.toHaveProperty('verified')
    for (const k of PROVIDER_KEYS) expect(attrsOf(h.updates[0].attributes) ?? {}).not.toHaveProperty(k)
    // A held row (no stamp) moving out stays unpublished: nothing about verified or the stamp is written.
    h.updates = []
    h.current = aisleRow({ verified: false })
    expect(await updateListingCore('listing-1', { subcategorySlug: 'cleaning' })).toEqual({ ok: true })
    expect(h.updates[0]).not.toHaveProperty('verified')
    // All four stamp columns are cleared on any move out (commit gate) — null, never a stamp.
    expect(h.updates[0]).toMatchObject(LICENCE_STAMP_CLEARED)
  })

  it('⛔ VietKite’s grandfathered row (live, no values) is pulled by a title-only edit — an edit sends it to the check', async () => {
    h.current = aisleRow({ sellerId: 'b6b7b817-6af9-4d37-a762-cf54f6ec74e6' }, null)
    expect(await updateListingCore('listing-1', { title: 'Vietnam e-visa in 1 hour' })).toEqual({ ok: true, held: true })
    expect(h.updates[0]).toMatchObject({ title: 'Vietnam e-visa in 1 hour', verified: false })
  })

  it('a row ALREADY waiting: a title edit answers held; an empty body answers held with NO write (no 404 for the wizard)', async () => {
    h.current = aisleRow({ verified: false })
    expect(await updateListingCore('listing-1', { title: 'e-Visa, 2 days' })).toEqual({ ok: true, held: true })
    expect(h.updates[0]).toMatchObject({ title: 'e-Visa, 2 days', verified: false })
    h.updates = []
    expect(await updateListingCore('listing-1', {})).toEqual({ ok: true, held: true })
    expect(h.updates).toHaveLength(0)
  })

  it('a LIVE row that was never approved is pulled even by a save that changes nothing else', async () => {
    h.current = aisleRow({ verified: true })
    expect(await updateListingCore('listing-1', {})).toEqual({ ok: true, held: true })
    expect(h.updates[0]).toEqual(expect.objectContaining({ verified: false }))
  })

  it('eno’s desk is exempt: a move in needs no values and stays live; an edit never writes verified', async () => {
    h.desk = true
    h.current = row({ subcategorySlug: 'service-other', listingType: 'service', priceUnit: 'VND/service' })
    expect(await updateListingCore('listing-1', { subcategorySlug: 'visa-legal' })).toEqual({ ok: true })
    expect(h.updates[0].subcategorySlug).toBe('visa-legal')
    expect(h.updates[0]).not.toHaveProperty('verified')
    h.updates = []
    h.current = aisleRow({}, null)
    expect(await updateListingCore('listing-1', { title: 'e-Visa desk', attributes: { visaSpeed: '1H' } })).toEqual({ ok: true })
    expect(h.updates[0]).not.toHaveProperty('verified')
  })

  it('⛔ an edit never writes verified:true or identityHold — whatever the row, the move or the body', async () => {
    const cases: Array<[Row, Row]> = [
      [aisleRow({ verified: false }), { title: 'New title', verified: true, identityHold: false }],
      [stampedRow({ verified: false }), { title: 'New title' }],
      [stampedRow(), { attributes: { ...VISA } }],
      [aisleRow({ verified: false }), { subcategorySlug: 'service-other' }],
      [row({ subcategorySlug: 'service-other', listingType: 'service', priceUnit: 'VND/service', verified: false }), { subcategorySlug: 'visa-legal', attributes: { ...VISA } }],
    ]
    for (const [current, body] of cases) {
      h.current = current
      await updateListingCore('listing-1', body)
    }
    expect(h.updates.length).toBe(cases.length)
    for (const u of h.updates) {
      expect(u.verified).not.toBe(true)
      expect(u).not.toHaveProperty('identityHold')
    }
  })

  it('an edit that does not touch an approved row’s values or aisle is unaffected', async () => {
    h.current = stampedRow()
    expect(await updateListingCore('listing-1', { price: 600_000 })).toEqual({ ok: true })
    expect(h.updates[0]).not.toHaveProperty('verified')
  })
})

describe('⛔ the edit is a compare-and-set on the licence facts it read (R2, plan review 2026-10-14)', () => {
  it('an aisle row’s write matches the stamp, attributes and subcategory it read', async () => {
    h.current = stampedRow()
    await updateListingCore('listing-1', { title: 'e-Visa in 3 days' })
    expect(h.wheres[0]).toEqual({
      id: 'listing-1', status: { not: 'removed' },
      verificationMethod: h.current.verificationMethod, attributes: h.current.attributes, subcategorySlug: 'visa-legal',
    })
  })

  it('so does a move INTO an aisle (the row becomes one) — the facts of the row as read', async () => {
    h.current = row({ subcategorySlug: 'service-other', listingType: 'service', priceUnit: 'VND/service' })
    await updateListingCore('listing-1', { subcategorySlug: 'visa-legal', attributes: { ...VISA } })
    expect(h.wheres[0]).toMatchObject({ verificationMethod: null, attributes: null, subcategorySlug: 'service-other' })
  })

  it('every other edit keeps the plain guard', async () => {
    h.current = row({ subcategorySlug: 'cleaning', listingType: 'service', priceUnit: 'VND/service' })
    await updateListingCore('listing-1', { title: 'Weekly cleaning' })
    expect(h.wheres[0]).toEqual({ id: 'listing-1', status: { not: 'removed' } })
  })

  it('⛔ an approval, a revoke or another save landing between the read and the write: 409 listing_changed, NOTHING written', async () => {
    // Read: held, no stamp. Meanwhile an admin approves (the stamp lands).
    h.current = aisleRow({ verified: false })
    const approved = stampedRow({ verified: true })
    h.dbRow = approved
    expect(await updateListingCore('listing-1', { title: 'e-Visa, 2 days' })).toEqual({ ok: false, code: 409, error: 'listing_changed' })
    // Read: approved. Meanwhile another save changed the number (and cleared the stamp).
    h.current = stampedRow()
    h.dbRow = { ...h.current, attributes: JSON.stringify({ ...VISA, providerLicenceNo: '79-999/2019/TCDL-GP LHQT' }), verificationMethod: null }
    h.finds = 0
    expect(await updateListingCore('listing-1', { attributes: { ...VISA } })).toEqual({ ok: false, code: 409, error: 'listing_changed' })
    expect(h.updates).toHaveLength(0)
  })

  // ⛔ Commit gate, 2026-10-14: a re-hold decides the licence hold's mark on the row's publication (licence-stamp.ts
  // licenceHeldMark) — so its CAS covers verified, the identity park and the mark. An Unverify landing between the read
  // (live) and the write must not come back as a mark an approval would publish by.
  it('⛔ a re-hold’s CAS covers the publication facts: an Unverify landing in between → 409, nothing written', async () => {
    h.current = aisleRow({ verified: true }) // live, unapproved (a grandfathered VietKite row): this edit re-holds it
    h.dbRow = { ...h.current, verified: false, identityHold: false, verificationNotes: null }
    expect(await updateListingCore('listing-1', { title: 'e-Visa in 3 days, all nationalities' })).toEqual({ ok: false, code: 409, error: 'listing_changed' })
    expect(h.updates).toHaveLength(0)
    expect(h.wheres[0]).toMatchObject({ verified: true, identityHold: false, verificationNotes: null })
  })

  it('an edit that decides no mark keeps the CAS on the licence facts only (an approved row’s title fix)', async () => {
    h.current = stampedRow()
    await updateListingCore('listing-1', { title: 'e-Visa in 3 days' })
    expect(h.wheres[0]).not.toHaveProperty('verified')
    expect(h.wheres[0]).not.toHaveProperty('verificationNotes')
  })

  it('a miss on a row that is gone or removed is still the 404', async () => {
    h.current = stampedRow()
    h.dbRow = { ...h.current, status: 'removed' }
    h.afterMiss = { ...h.current, status: 'removed' }
    expect(await updateListingCore('listing-1', { title: 'e-Visa in 3 days' })).toEqual({ ok: false, code: 404, error: 'not_found' })
    h.finds = 0
    h.afterMiss = null
    expect(await updateListingCore('listing-1', { title: 'e-Visa in 3 days' })).toEqual({ ok: false, code: 404, error: 'not_found' })
  })

  it('an unchanged row writes as usual', async () => {
    h.current = stampedRow()
    h.dbRow = { ...h.current }
    expect(await updateListingCore('listing-1', { title: 'e-Visa in 3 days' })).toEqual({ ok: true })
    expect(h.updates).toHaveLength(1)
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
    await createVisaLegal({ priceBasis: 'hourly', ...VISA })
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
