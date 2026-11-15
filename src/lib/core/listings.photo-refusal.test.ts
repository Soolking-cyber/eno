import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE SAVE-TIME PHOTO SCREEN ON CREATE AND EDIT (listing photo check, plan §2, A6 — listing-photo-refusal.ts): the web,
 * /api/v1 and MCP create and edit ask it; a refusal is `photo_not_allowed` with its `detail`, nothing written. A Facebook
 * import and a sync row (`photoRefusal: false`) never fail on a photo — the pass strips it. Dependency wall:
 * listings.job-text.test.ts.
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  updates: [] as Row[],
  creates: [] as Row[],
  current: {} as Row,
  screened: [] as Array<{ images: string[]; l: Row }>,
  refuse: false,
  afters: [] as Array<() => unknown>,
  /** The after-publish checks in the order they ran (moderation, provenance, the photo pass, syndication). */
  ran: [] as string[],
}))
// The photo pass after a save (listing-photo-pass.ts has its own tests): here only when it runs, on which lane.
vi.mock('@/lib/listing-photo-pass', () => ({ photoPassById: async (id: string, lane: string) => { h.ran.push(`pass:${id}:${lane}`) } }))
// The screen itself is listing-photo-refusal.test.ts; here only whether each path asks it, and what a refusal does.
vi.mock('@/lib/listing-photo-refusal', async () => {
  const { PublishBlockedError } = await import('@/lib/publish-guard')
  return {
    assertNoRefusedPhotos: async (images: string[], l: Row) => {
      h.screened.push({ images, l })
      if (h.refuse) throw new PublishBlockedError('photo_not_allowed', `flyer:${images[0]}`)
    },
  }
})

// The storefront owner is no review seat here (a seat's creates: core/listings.review-seat.test.ts, core/bulk.review-seat.test.ts).
vi.mock('@/lib/review-seat-listings', () => ({ ownerIsReviewSeat: async () => false, reviewSeatListingIds: async () => [] }))
vi.mock('next/server', () => ({ after: (fn: () => unknown) => { h.afters.push(fn) } }))
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
vi.mock('@/lib/syndicate', () => ({ syndicateListing: async () => {}, syndicateListingIfPublic: async () => { h.ran.push('syndicate') } }))
vi.mock('@/lib/meta-capi', () => ({ sendMetaCapiEvent: async () => {}, metaUserDataFromHeaders: () => ({}) }))
vi.mock('@/lib/webhooks', () => ({ dispatchListingEvent: async () => {} }))
vi.mock('@/lib/ranking', () => ({ browseRankScore: () => 0, recomputeRankScoreForListing: async () => {} }))
vi.mock('@/lib/compliance/account-state', () => ({ identityGateEnforced: () => false }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ assertSellerMayPublish: async () => {}, sellerPublishDecision: async () => ({ ok: true }) }))
vi.mock('@/lib/released-charge-gate', () => ({ releasedChargeGate: async () => null }))
// The REAL publish guard runs (photos, contact details, banned words, location): the job-text screen sits beside it, and a
// clean ad must pass both.
vi.mock('@/lib/duplicate-guard', () => ({ findDuplicateListing: async () => null }))
vi.mock('@/lib/ai-moderation', () => ({ moderateListingById: async () => { await Promise.resolve(); h.ran.push('moderation') } }))
vi.mock('@/lib/image-provenance', () => ({ indexAndCheckProvenance: async () => { await Promise.resolve(); h.ran.push('provenance') } }))
vi.mock('@/lib/price-drop', () => ({ priceChangeEffects: async () => ({ data: {}, audit: null, notify: null }) }))
vi.mock('@/lib/urgent', () => ({ activateUrgentGate: async () => ({ ok: true }), urgentQuotaFree: async () => true, URGENT: {} }))

const { createListingCore, updateListingCore } = await import('@/lib/core/listings')

const JOBS = { id: 'c-jobs', slug: 'jobs', name: 'Jobs', nameVi: 'Việc làm' }
const SELLER = { id: 'seller-1', ownerId: 'owner-1', trustTier: 'standard', trustScore: 100, phone: null }
const CLEAN = 'Teach English to adults and teenagers at our centre in District 7. 20–25 teaching hours a week.'
const IMG = 'https://sb.test/storage/v1/object/public/listings/a.webp'

const create = (imported?: { titleVi: string | null; descriptionVi: string | null }) => createListingCore({
  seller: SELLER, guestCreate: false, category: JOBS, title: 'English teacher, District 7', price: 0, headers: new Headers(),
  body: { listingType: 'job', subcategorySlug: 'teaching', description: CLEAN, district: 'Quận 7', salaryM: 25, images: [IMG], attributes: { jobtype: 'fulltime' } },
  ...(imported ? { imported } : {}),
})

beforeEach(() => {
  h.updates = []
  h.creates = []
  h.screened = []
  h.refuse = false
  h.afters = []
  h.ran = []
  h.current = {
    title: 'English teacher, District 7', description: CLEAN, district: 'Quận 7', location: 'Quận 7', city: 'Hồ Chí Minh',
    brandSlug: null, model: null, subcategorySlug: 'teaching', verified: true, images: JSON.stringify([IMG]), video: null,
    condition: null, year: null, listingType: 'job', titleVi: null, descriptionVi: null,
    price: 25_000_000, createdAt: new Date('2026-10-01'), sellerId: 'seller-1', previousPrice: null, priceDropAt: null,
    lowestNotifiedPrice: null, priceDropNotifiedAt: null, urgentUntil: null,
    negotiable: false, salaryM: 25, affiliateUrl: null, priceUnit: 'VND/month', attributes: JSON.stringify({ jobtype: 'fulltime' }),
    seller: { trustTier: 'standard' }, category: { slug: 'jobs', name: 'Jobs', nameVi: 'Việc làm' }, status: 'active',
    verificationMethod: null, verifiedAt: null, verificationNotes: null, identityHold: false,
  }
})

describe('createListingCore — the photo screen', () => {
  it('asks it with the images, the category, the resolved subcategory and the storefront', async () => {
    await create()
    expect(h.screened).toEqual([{ images: [IMG], l: { category: 'jobs', subcategory: 'teaching', sellerId: 'seller-1' } }])
  })

  it('⛔ a refusal is thrown as itself, and nothing is written', async () => {
    h.refuse = true
    await expect(create()).rejects.toMatchObject({ code: 'photo_not_allowed', detail: `flyer:${IMG}` })
    expect(h.creates).toHaveLength(0)
  })

  it('a Facebook import is not asked (the pass strips a refused photo there)', async () => {
    h.refuse = true
    await expect(create({ titleVi: null, descriptionVi: null })).resolves.toMatchObject({ id: 'new-1' })
    expect(h.screened).toHaveLength(0)
  })
})

describe('updateListingCore — the photo screen', () => {
  it('⛔ an edit that sends images is asked, with the listing (its overrides count) and its photos as stored (O1: writes off screens only new ones); a refusal is 400 with its detail, nothing written', async () => {
    h.refuse = true
    expect(await updateListingCore('listing-1', { images: [IMG] })).toEqual({ ok: false, code: 400, error: 'photo_not_allowed', detail: `flyer:${IMG}` })
    expect(h.screened).toEqual([{ images: [IMG], l: { category: 'jobs', subcategory: 'teaching', sellerId: 'seller-1', listingId: 'listing-1', existing: JSON.stringify([IMG]) } }])
    expect(h.updates).toHaveLength(0)
  })

  it('an edit without images is not asked', async () => {
    expect(await updateListingCore('listing-1', { title: 'English teacher, District 7 — evenings' })).toEqual({ ok: true })
    expect(h.screened).toHaveLength(0)
  })

  it('⛔ a sync row (photoRefusal: false) is never refused on a photo', async () => {
    h.refuse = true
    expect(await updateListingCore('listing-1', { images: [IMG], price: 26_000_000 }, { photoRefusal: false })).toEqual({ ok: true })
    expect(h.screened).toHaveLength(0)
  })
})

// ⛔ THE PHOTO PASS AFTER A SAVE (listing-photo-pass.ts): it may RELEASE a photo-held row, so on an edit it runs only once
// the moderation and provenance holds have settled — a hold they write ends the photo hold first (A10). A sync row's pass
// is charged to the sweep lane (A7).
describe('the photo pass after a save', () => {
  const runAfters = async () => { for (const fn of h.afters) await fn() }

  it('an edit with images: moderation and provenance first, then the pass, on the pass lane', async () => {
    expect(await updateListingCore('listing-1', { images: [IMG] })).toEqual({ ok: true })
    await runAfters()
    expect(h.ran.slice(-1)).toEqual(['pass:listing-1:pass'])
    expect([...h.ran.slice(0, 2)].sort()).toEqual(['moderation', 'provenance'])
  })

  it('a sync row: the sweep lane', async () => {
    await updateListingCore('listing-1', { images: [IMG] }, { photoRefusal: false })
    await runAfters()
    expect(h.ran).toContain('pass:listing-1:sweep')
  })

  it('an edit of the words only: moderation, no pass', async () => {
    await updateListingCore('listing-1', { title: 'English teacher, District 7 — evenings' })
    await runAfters()
    expect(h.ran).toEqual(['moderation'])
  })

  it('a create: the pass with both checks, before syndication; a Facebook import on the sweep lane', async () => {
    await create()
    await runAfters()
    expect(h.ran).toContain('pass:new-1:pass')
    expect(h.ran.indexOf('syndicate')).toBeGreaterThan(h.ran.indexOf('pass:new-1:pass'))
    h.afters = []; h.ran = []
    await create({ titleVi: null, descriptionVi: null })
    await runAfters()
    expect(h.ran).toContain('pass:new-1:sweep')
  })
})
