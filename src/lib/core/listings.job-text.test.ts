import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE JOB-TEXT SCREEN ON EVERY WAY A HIRING POST IS WRITTEN (teacher visibility plan §3a item 6; approved in the plan,
 * 2026-10-18 — owner: "go with recommended"). It ships with the "Hiring? Post your job ad" prompt (teaching-links.tsx
 * PostJobLink): until now only IMPORTED job rows were screened (job-listing.ts mapStagedJob), and the prompt invites schools
 * to write their own. Against the real createListingCore / updateListingCore with a faked db (listings.sell-rules.test.ts'
 * dependency wall), each core loaded under its own edition:
 *   · BOTH editions refuse visa or residence wording (`job_residence_wording`) — they write one database, and eno.vn shows
 *     the forum's rows — and a discriminatory requirement, a candidate fee or adult-venue work, each rule its own code;
 *   · HIRING posts only (Jobs, `job` intent): a `wanted` post describing its author is not screened — until an edit turns it
 *     into a hiring post, which screens all of its text;
 *   · the title, the description, every attribute value, the location, the district and the city;
 *   · `detail` '<field>:<snippet>' — the field and the words to take out — and honest negations pass;
 *   · a clean teaching ad publishes, and a listing outside Jobs is not screened at all.
 * The post wizard says the rule's sentence (pinned equal in post-wizard.job-text-copy.test.ts). The bulk core's half: bulk.job-text.test.ts.
 */

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
    seller: { findUnique: async () => ({ officialPartner: false, owner: { accountType: 'business' } }) },
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
// The REAL publish guard runs (photos, contact details, banned words, location): the job-text screen sits beside it, and a
// clean ad must pass both.
vi.mock('@/lib/duplicate-guard', () => ({ findDuplicateListing: async () => null }))
vi.mock('@/lib/ai-moderation', () => ({ moderateListingById: async () => {} }))
vi.mock('@/lib/image-provenance', () => ({ indexAndCheckProvenance: async () => {} }))
vi.mock('@/lib/price-drop', () => ({ priceChangeEffects: async () => ({ data: {}, audit: null, notify: null }) }))
vi.mock('@/lib/urgent', () => ({ activateUrgentGate: async () => ({ ok: true }), urgentQuotaFree: async () => true, URGENT: {} }))

/** The cores as the given edition builds them — the edition is read once, when @/lib/edition first loads. */
async function coresFor(edition: 'marketplace' | 'services') {
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', edition)
  vi.resetModules()
  const { createListingCore, updateListingCore } = await import('@/lib/core/listings')
  const { IS_MARKETPLACE } = await import('@/lib/edition')
  vi.unstubAllEnvs()
  return { createListingCore, updateListingCore, IS_MARKETPLACE }
}
const editions = { marketplace: await coresFor('marketplace'), services: await coresFor('services') }

const JOBS = { id: 'c-jobs', slug: 'jobs', name: 'Jobs', nameVi: 'Việc làm' }
const SELLER = { id: 'seller-1', ownerId: 'owner-1', trustTier: 'standard', trustScore: 100, phone: null }
/** A school's real-shaped teaching ad: no contact details, no visa, no requirement on who may apply. */
const CLEAN = 'Teach English to adults and teenagers at our centre in District 7. 20–25 teaching hours a week, Monday to '
  + 'Saturday. Bachelor’s degree and a 120-hour TEFL certificate required; we apply for your work permit.'

type Cores = (typeof editions)['marketplace']
type JobOver = { title?: string; description?: string; attributes?: Record<string, string>; category?: Row; listingType?: string; subcategorySlug?: string; images?: string[]; location?: string; district?: string; city?: string }
/** A hiring post in Jobs › Teaching (everything overridable), as the wizard sends it — a job needs no photo. */
function createJob(core: Cores, over: JobOver = {}) {
  return core.createListingCore({
    seller: SELLER,
    guestCreate: false,
    category: (over.category ?? JOBS) as typeof JOBS,
    title: over.title ?? 'English teacher, District 7',
    price: 0,
    body: {
      listingType: over.listingType ?? 'job', subcategorySlug: over.subcategorySlug ?? 'teaching',
      description: over.description ?? CLEAN, district: over.district ?? 'Quận 7', salaryM: 25, images: over.images ?? [],
      ...(over.location !== undefined ? { location: over.location } : {}), ...(over.city !== undefined ? { city: over.city } : {}),
      attributes: over.attributes ?? { jobtype: 'fulltime', experience: '1-3-years', workMode: 'on-site' },
    },
    headers: new Headers(),
  })
}

/** A live Jobs › Teaching row as updateListingCore reads it. */
function jobRow(overrides: Row = {}): Row {
  return {
    title: 'English teacher, District 7', description: CLEAN, district: 'Quận 7', location: 'Quận 7', city: 'Hồ Chí Minh',
    brandSlug: null, model: null, subcategorySlug: 'teaching', verified: true, images: [], video: null,
    condition: null, year: null, listingType: 'job', titleVi: null, descriptionVi: null,
    price: 25_000_000, createdAt: new Date('2026-10-01'), sellerId: 'seller-1', previousPrice: null, priceDropAt: null,
    lowestNotifiedPrice: null, priceDropNotifiedAt: null, urgentUntil: null,
    negotiable: false, salaryM: 25, affiliateUrl: null, priceUnit: 'VND/month', attributes: JSON.stringify({ jobtype: 'fulltime' }),
    seller: { trustTier: 'standard' },
    category: { slug: 'jobs', name: 'Jobs', nameVi: 'Việc làm' },
    status: 'active',
    verificationMethod: null, verifiedAt: null, verificationNotes: null, identityHold: false,
    ...overrides,
  }
}

beforeEach(() => {
  h.updates = []
  h.creates = []
  h.current = jobRow()
})

it('each set of cores runs as its own edition', () => {
  expect(editions.marketplace.IS_MARKETPLACE).toBe(true)
  expect(editions.services.IS_MARKETPLACE).toBe(false)
})

for (const edition of ['marketplace', 'services'] as const) {
  describe(`${edition === 'marketplace' ? 'eno.vn' : 'eno.forum'} (${edition}): a hiring post’s text is screened`, () => {
    const core = editions[edition]

    it('⛔ visa or residence wording is refused on BOTH editions, naming the field and the words — nothing is written', async () => {
      await expect(createJob(core, { description: `${CLEAN} Visa support provided.` })).rejects.toMatchObject({ code: 'job_residence_wording', detail: 'description:Visa' })
      await expect(createJob(core, { title: 'ESL teacher — work permit and TRC sponsorship' })).rejects.toMatchObject({ code: 'job_residence_wording', detail: 'title:TRC' })
      // Every attribute value too (an API client may send any key; sanitizeAttributes keeps it).
      await expect(createJob(core, { attributes: { jobtype: 'fulltime', salaryText: '25M VND + visa' } })).rejects.toMatchObject({ code: 'job_residence_wording', detail: 'attributes.salaryText:visa' })
      expect(h.creates).toHaveLength(0)
    })

    it('⛔ …and the place fields an API client writes: the location, the district and the city', async () => {
      await expect(createJob(core, { location: 'Female only campus, Quận 7' })).rejects.toMatchObject({ code: 'job_discrimination', detail: 'location:Female only' })
      await expect(createJob(core, { district: 'Quận 7 (visa support)' })).rejects.toMatchObject({ code: 'job_residence_wording', detail: 'district:visa' })
      await expect(createJob(core, { city: 'Hà Nội — training fee required' })).rejects.toMatchObject({ code: 'job_candidate_fee', detail: 'city:training fee required' })
      expect(h.creates).toHaveLength(0)
    })

    it('⛔ a discriminatory requirement, a candidate fee or adult-venue work: one code per rule', async () => {
      await expect(createJob(core, { description: `${CLEAN} Female only.` })).rejects.toMatchObject({ code: 'job_discrimination', detail: 'description:Female only' })
      await expect(createJob(core, { description: `${CLEAN} Training fee required.` })).rejects.toMatchObject({ code: 'job_candidate_fee', detail: 'description:Training fee required' })
      await expect(createJob(core, { title: 'English-speaking hostess, karaoke bar' })).rejects.toMatchObject({ code: 'job_adult_venue', detail: 'title:hostess, karaoke' })
      expect(h.creates).toHaveLength(0)
    })

    it('honest negations publish — "no age limit", "no training fee", "không thu phí đào tạo"', async () => {
      expect(await createJob(core, { description: `${CLEAN} No age limit. No training fee, no deposit.\nKhông thu phí đào tạo.` })).toEqual({ id: 'new-1', verified: true })
    })

    it('⛔ an EDIT gets the same screen — publish clean, then add the line, is no way round it', async () => {
      expect(await core.updateListingCore('listing-1', { description: `${CLEAN} We help with your visa.` }))
        .toEqual({ ok: false, code: 400, error: 'job_residence_wording', detail: 'description:visa' })
      expect(await core.updateListingCore('listing-1', { attributes: { jobtype: 'fulltime', employer: 'Visa Academy' } }))
        .toEqual({ ok: false, code: 400, error: 'job_residence_wording', detail: 'attributes.employer:Visa' })
      expect(await core.updateListingCore('listing-1', { title: 'English teacher, nữ dưới 30 tuổi' })).toEqual({ ok: false, code: 400, error: 'job_discrimination', detail: 'title:nữ dưới 30 tuổi' })
      expect(await core.updateListingCore('listing-1', { district: 'Quận 3, nộp phí hồ sơ' })).toEqual({ ok: false, code: 400, error: 'job_candidate_fee', detail: 'district:nộp phí hồ sơ' })
      expect(await core.updateListingCore('listing-1', { city: 'Đà Nẵng — karaoke' })).toEqual({ ok: false, code: 400, error: 'job_adult_venue', detail: 'city:karaoke' })
      expect(h.updates).toHaveLength(0)
    })

    it('a work permit is fine to mention — and the clean ad publishes and edits', async () => {
      expect(await createJob(core)).toEqual({ id: 'new-1', verified: true })
      expect(h.creates[0]).toMatchObject({ listingType: 'job', subcategorySlug: 'teaching', description: CLEAN })
      expect(await core.updateListingCore('listing-1', { description: `${CLEAN} We file the work permit for you.` })).toEqual({ ok: true })
      expect(await core.updateListingCore('listing-1', { title: 'English teacher, District 7 — evenings' })).toEqual({ ok: true })
      expect(h.updates[1]).toMatchObject({ title: 'English teacher, District 7 — evenings' })
    })

    it('a `wanted` post is not screened: someone looking for work describes themselves', async () => {
      expect(await createJob(core, { listingType: 'wanted', subcategorySlug: 'hospitality', title: 'Barista looking for weekend shifts', description: 'Two years in cafés, latte art. Valid TRC.' }))
        .toEqual({ id: 'new-1', verified: true })
      h.current = jobRow({ listingType: 'wanted', subcategorySlug: 'hospitality', salaryM: null, priceUnit: 'VND' })
      expect(await core.updateListingCore('listing-1', { description: 'Two years in cafés, latte art. I have a work visa.' })).toEqual({ ok: true })
    })

    it('⛔ …until an edit TURNS it into a hiring post: then all the text the row carries is screened, sent or not', async () => {
      h.current = jobRow({ listingType: 'wanted', subcategorySlug: 'hospitality', salaryM: null, priceUnit: 'VND', description: 'Barista, two years. Valid TRC.' })
      expect(await core.updateListingCore('listing-1', { listingType: 'job' })).toEqual({ ok: false, code: 400, error: 'job_residence_wording', detail: 'description:TRC' })
      h.current = jobRow({ listingType: 'wanted', subcategorySlug: 'hospitality', salaryM: null, priceUnit: 'VND', city: 'Hà Nội, female only' })
      expect(await core.updateListingCore('listing-1', { listingType: 'job', title: 'Barista wanted' })).toEqual({ ok: false, code: 400, error: 'job_discrimination', detail: 'city:female only' })
      expect(h.updates).toHaveLength(0)
      h.current = jobRow({ listingType: 'wanted', subcategorySlug: 'hospitality', salaryM: null, priceUnit: 'VND' })
      expect(await core.updateListingCore('listing-1', { listingType: 'job' })).toEqual({ ok: true })
    })

    it('a listing outside Jobs is not screened: the same words publish in Services', async () => {
      const services = { id: 'c-services', slug: 'services', name: 'Services', nameVi: 'Dịch vụ' }
      expect(await createJob(core, { category: services, listingType: 'service', subcategorySlug: 'cleaning', title: 'Weekly home cleaning', description: 'Female only team. Visa card accepted. Deposit required for keys.', attributes: {}, images: ['https://cdn.eno.vn/l/clean-1.jpg'] }))
        .toEqual({ id: 'new-1', verified: true })
      h.current = jobRow({ category: { slug: 'services', name: 'Services', nameVi: 'Dịch vụ' }, subcategorySlug: 'cleaning', listingType: 'service', priceUnit: 'VND/service', salaryM: null, attributes: null })
      expect(await core.updateListingCore('listing-1', { description: 'Female only team. Visa card accepted.' })).toEqual({ ok: true })
    })
  })
}

/**
 * ⛔ AS THE JOB PAGE PRINTS IT (2026-10-19): the description in formatRichText's blocks — a phrase hard-wrapped inside one
 * paragraph is whole, two list items are two — and each attribute as its Details row, the page's own label beside the value
 * (taxonomy.ts detailRowLabel), so a key an API client invents is read as the page shows it: { visaSponsorship: 'yes' } is
 * "Visa sponsorship: yes". And a job has no condition: create and edit store null for one (taxonomy.ts storesCondition).
 */
describe('a hiring post’s text as its page prints it — paragraphs, attribute rows, no condition', () => {
  const core = editions.marketplace

  it('⛔ a visa phrase hard-wrapped across two lines of one paragraph is refused; as two list items each line passes', async () => {
    await expect(createJob(core, { description: `${CLEAN}\nWe support the work permit and temporary residence\ncard.` })).rejects.toMatchObject({ code: 'job_residence_wording', detail: 'description:temporary residence card' })
    await expect(createJob(core, { description: `${CLEAN}\nHỗ trợ làm thẻ tạm\ntrú.` })).rejects.toMatchObject({ code: 'job_residence_wording', detail: 'description:tạm trú' })
    expect(await core.updateListingCore('listing-1', { description: `${CLEAN}\nHỗ trợ làm thẻ tạm\ntrú.` })).toEqual({ ok: false, code: 400, error: 'job_residence_wording', detail: 'description:tạm trú' })
    expect(h.creates).toHaveLength(0)
    expect(h.updates).toHaveLength(0)
    expect(await createJob(core, { description: `${CLEAN}\n- Hỗ trợ tiếp thị\n- Thực hiện các công việc khác` })).toEqual({ id: 'new-1', verified: true })
  })

  it('⛔ { visaSponsorship: "yes" } is refused on create and on an edit — the label the page prints for the key is read beside its value', async () => {
    await expect(createJob(core, { attributes: { jobtype: 'fulltime', visaSponsorship: 'yes' } })).rejects.toMatchObject({ code: 'job_residence_wording', detail: 'attributes.visaSponsorship:Visa' })
    expect(await core.updateListingCore('listing-1', { attributes: { jobtype: 'fulltime', visaSponsorship: 'yes' } })).toEqual({ ok: false, code: 400, error: 'job_residence_wording', detail: 'attributes.visaSponsorship:Visa' })
    // The same invented key glued lowercase or SHOUTED prints "Visasponsorship" / " v i s a_ s p o n…" — read as the
    // identifier it is (job-listing.ts jobTextProblem), it is refused too.
    await expect(createJob(core, { attributes: { jobtype: 'fulltime', visasponsorship: 'yes' } })).rejects.toMatchObject({ code: 'job_residence_wording', detail: 'attributes.visasponsorship:Visasponsorship' })
    await expect(createJob(core, { attributes: { jobtype: 'fulltime', VISA_SPONSORSHIP: 'yes' } })).rejects.toMatchObject({ code: 'job_residence_wording' })
    // The label is read like any words the page prints — beside its value, so an honest answer passes: "Training fee: none".
    await expect(createJob(core, { attributes: { jobtype: 'fulltime', trainingFee: 'required' } })).rejects.toMatchObject({ code: 'job_candidate_fee', detail: 'attributes.trainingFee:Training fee' })
    expect(await core.updateListingCore('listing-1', { attributes: { jobtype: 'fulltime', trainingFee: 'none' } })).toEqual({ ok: true })
    expect(h.creates).toHaveLength(0)
    expect(h.updates).toHaveLength(1)
    // The facets the form asks (Type, Experience, Work mode) read as harmless rows.
    expect(await createJob(core)).toEqual({ id: 'new-1', verified: true })
  })

  it('⛔ a job stores no condition — create and edit, either intent; a legacy one is cleared by the next edit', async () => {
    const withCondition = (over: JobOver = {}) => core.createListingCore({
      seller: SELLER, guestCreate: false, category: JOBS, title: 'English teacher, District 7', price: 0,
      body: { listingType: over.listingType ?? 'job', subcategorySlug: over.subcategorySlug ?? 'teaching', description: CLEAN, district: 'Quận 7', salaryM: 25, images: [], attributes: { jobtype: 'fulltime' }, condition: 'Brand new, visa ready' },
      headers: new Headers(),
    })
    expect(await withCondition()).toEqual({ id: 'new-1', verified: true })
    expect(h.creates[0].condition).toBeNull()
    expect(await withCondition({ listingType: 'wanted', subcategorySlug: 'hospitality' })).toEqual({ id: 'new-1', verified: true })
    expect(h.creates[1].condition).toBeNull()
    expect(await core.updateListingCore('listing-1', { condition: 'used', title: 'English teacher, District 7 — evenings' })).toEqual({ ok: true })
    expect(h.updates[0]).toMatchObject({ condition: null })
    h.current = jobRow({ condition: 'used' })
    expect(await core.updateListingCore('listing-1', { title: 'English teacher, District 7 — mornings' })).toEqual({ ok: true })
    expect(h.updates[1]).toMatchObject({ condition: null })
  })

  it('a listing outside Jobs keeps its condition', async () => {
    const services = { id: 'c-services', slug: 'services', name: 'Services', nameVi: 'Dịch vụ' }
    await core.createListingCore({
      seller: SELLER, guestCreate: false, category: services as typeof JOBS, title: 'Weekly home cleaning', price: 300_000,
      body: { listingType: 'service', subcategorySlug: 'cleaning', description: 'Two cleaners, three hours, all supplies included.', district: 'Quận 7', images: ['https://cdn.eno.vn/l/clean-1.jpg'], condition: 'Insured team' },
      headers: new Headers(),
    })
    expect(h.creates[0].condition).toBe('Insured team')
  })
})
