import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A JOB IS PAID A SALARY, NOT PRICED — on the SERVER, for create AND edit (owner, 2026-10-01: "if job
 * selected it should be salary and urgent hire etc."). The wizard no longer sends a price for a job,
 * but /api/v1, MCP and a stale tab still can, so the rule has to hold here:
 *   · the stored price is DERIVED from the salary (salaryM × 1,000,000 ₫/month, 0 when unstated); a
 *     `price` sent without a `salaryM` is READ AS the monthly salary (whole millions, rounded down) —
 *     the bulk CSV's rule, on every path — and never stored as sent;
 *   · switching into or out of the job intent re-stamps the price unit;
 *   · a job is never negotiable (no offers, no Counter), even when the body says so or it is urgent;
 *   · urgent on a job ("Tuyển gấp") neither forces offers on nor is ended by negotiable=false;
 *   · a changed salary is not a price drop — no badge, no notification, no audit row.
 * Same harness as listings.republish.test.ts: the real functions, a faked db, every payload inspected.
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  updates: [] as Row[],
  creates: [] as Row[],
  dupPrices: [] as number[],
  current: {} as Row,
  dropCalls: 0,
  txCalls: 0,
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
    seller: { findUnique: async () => null },
    priceChange: { create: () => ({}) },
    $transaction: async (ops: unknown[]) => { h.txCalls++; return ops },
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
vi.mock('@/lib/syndicate', () => ({ syndicateListingIfPublic: async () => {} }))
vi.mock('@/lib/meta-capi', () => ({ sendMetaCapiEvent: async () => {}, metaUserDataFromHeaders: () => ({}) }))
vi.mock('@/lib/webhooks', () => ({ dispatchListingEvent: async () => {} }))
vi.mock('@/lib/ranking', () => ({ browseRankScore: () => 0, recomputeRankScoreForListing: async () => {} }))
vi.mock('@/lib/compliance/account-state', () => ({ identityGateEnforced: () => false }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ assertSellerMayPublish: async () => {}, sellerPublishDecision: async () => ({ ok: true }) }))
vi.mock('@/lib/released-charge-gate', () => ({ releasedChargeGate: async () => null }))
vi.mock('@/lib/publish-guard', () => ({
  assertPublishable: () => {},
  assertCleanTexts: () => {},
  assertCleanContactName: () => {},
  assertEnoughAngles: () => {},
  PublishBlockedError: class PublishBlockedError extends Error {},
}))
vi.mock('@/lib/duplicate-guard', () => ({ findDuplicateListing: async ({ price }: { price: number }) => { h.dupPrices.push(price); return null } }))
vi.mock('@/lib/ai-moderation', () => ({ moderateListingById: async () => {} }))
vi.mock('@/lib/image-provenance', () => ({ indexAndCheckProvenance: async () => {} }))
vi.mock('@/lib/price-drop', () => ({
  priceChangeEffects: async () => { h.dropCalls++; return { data: {}, audit: null, notify: null } },
}))
vi.mock('@/lib/urgent', () => ({
  activateUrgentGate: async () => ({ ok: true, urgentUntil: new Date(Date.now() + 7 * 86_400_000) }),
  urgentQuotaFree: async () => true,
  URGENT: { DURATION_MS: 7 * 86_400_000 },
}))

const { createListingCore, updateListingCore } = await import('@/lib/core/listings')

const SELLER = { id: 'seller-1', trustTier: 'standard', trustScore: 50, phone: null, ownerId: 'owner-1' }
const JOBS = { id: 'cat-jobs', slug: 'jobs', name: 'Jobs', nameVi: 'Việc làm' }
const ELECTRONICS = { id: 'cat-el', slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' }
const create = (category: typeof JOBS, price: number, body: Row) =>
  createListingCore({ seller: SELLER, guestCreate: false, category, title: 'English teacher, full-time', price, body: { description: 'Teach adults, evenings and weekends.', district: 'Bình Thạnh', ...body }, headers: new Headers() })

function jobRow(overrides: Row = {}): Row {
  return {
    title: 'English teacher', description: 'Teach adults.', district: 'Bình Thạnh', location: 'Bình Thạnh',
    brandSlug: null, model: null, subcategorySlug: 'teaching', verified: true, images: [], video: null,
    condition: null, year: null, listingType: 'job', titleVi: null, descriptionVi: null,
    price: 30_000_000, createdAt: new Date('2026-01-01'), sellerId: 'seller-1',
    previousPrice: null, priceDropAt: null, lowestNotifiedPrice: null, priceDropNotifiedAt: null, urgentUntil: null,
    negotiable: false, salaryM: 30, affiliateUrl: null, priceUnit: 'VND/month',
    seller: { trustTier: 'standard' }, category: { slug: 'jobs', name: 'Jobs', nameVi: 'Việc làm' },
    ...overrides,
  }
}

beforeEach(() => {
  h.updates = []; h.creates = []; h.dupPrices = []; h.dropCalls = 0; h.txCalls = 0
  h.current = jobRow()
})

describe('createListingCore — a job is stored at its salary, never at the price it was sent', () => {
  it('derives price from salaryM and ignores the caller price', async () => {
    await create(JOBS, 20_000, { listingType: 'job', salaryM: 45 })
    const row = h.creates[0]
    expect(row.price).toBe(45_000_000)
    expect(row.salaryM).toBe(45)
    expect(row.priceUnit).toBe('VND/month')
    expect(row.listingType).toBe('job')
    expect(h.dupPrices).toEqual([45_000_000]) // the duplicate guard compares the price that is stored
  })

  it('no salary and no price in the body → price 0 (the negotiable state)', async () => {
    await create(JOBS, 12_000_000, { listingType: 'job' })
    expect(h.creates[0].price).toBe(0)
  })

  it('a price with no salaryM (API, MCP, a stale tab) is read AS the monthly salary, rounded down', async () => {
    await create(JOBS, 0, { listingType: 'job', price: 12_500_000 })
    expect(h.creates[0].salaryM).toBe(12)
    expect(h.creates[0].price).toBe(12_000_000)
    h.creates = []
    // …and one under a million states no salary: negotiable, never a 20,000 đ "salary".
    await create(JOBS, 0, { listingType: 'job', price: 20_000 })
    expect(h.creates[0].price).toBe(0)
  })

  it('a job is never negotiable — not when asked, not when urgent', async () => {
    await create(JOBS, 0, { listingType: 'job', salaryM: 20, negotiable: true, urgent: true })
    const row = h.creates[0]
    expect(row.negotiable).toBe(false)
    // …and the urgent run is still granted: "Tuyển gấp" is the same flag, it just opens no offers.
    expect(row.urgentUntil).toBeInstanceOf(Date)
  })

  it('an omitted listingType in Jobs is a job (the category\'s primary intent)', async () => {
    await create(JOBS, 9_999, { salaryM: 15 })
    expect(h.creates[0].listingType).toBe('job')
    expect(h.creates[0].price).toBe(15_000_000)
    expect(h.creates[0].negotiable).toBe(false)
  })

  it('CONTROL: a product keeps its own price, and urgent still forces offers on', async () => {
    await create(ELECTRONICS, 20_000_000, { listingType: 'sell', negotiable: false, urgent: true })
    const row = h.creates[0]
    expect(row.price).toBe(20_000_000)
    expect(row.priceUnit).toBe('VND')
    expect(row.negotiable).toBe(true)
  })
})

describe('updateListingCore — a job edit re-derives the price from the salary', () => {
  it('ignores a sent price, derives from the new salary, and runs NO price-drop pipeline', async () => {
    const res = await updateListingCore('listing-1', { price: 5, salaryM: 25 })
    expect(res).toEqual({ ok: true })
    const data = h.updates[0]
    expect(data.price).toBe(25_000_000) // a 30 → 25 cut, which on a sale would be a drop badge
    expect(data.salaryM).toBe(25)
    expect(h.dropCalls).toBe(0)
    expect(h.txCalls).toBe(0) // no PriceChange audit row
    expect('previousPrice' in data).toBe(false)
  })

  it('a price alone is read as the salary (an API client resending the old one changes nothing)', async () => {
    await updateListingCore('listing-1', { price: 30_000_000 })
    expect('price' in h.updates[0]).toBe(false) // still 30 × 1,000,000
    expect(h.dropCalls).toBe(0)

    h.updates = []
    await updateListingCore('listing-1', { price: 27_900_000 }) // a sync row / MCP update_listing
    expect(h.updates[0].salaryM).toBe(27)
    expect(h.updates[0].price).toBe(27_000_000)
    expect(h.dropCalls).toBe(0) // a salary change is never a price drop
  })

  it('a pre-rule job saved from the wizard as "Negotiable" loses its old typed price', async () => {
    // "20,000 đ / month", no salary: the wizard seeds Negotiable and now sends salaryM: null.
    h.current = jobRow({ salaryM: null, price: 20_000, negotiable: true })
    await updateListingCore('listing-1', { listingType: 'job', salaryM: null, title: 'English teacher' })
    expect(h.updates[0].price).toBe(0)
    expect(h.updates[0].negotiable).toBe(false)
  })

  it('switching Wanted → Job re-stamps the unit to per MONTH and derives the price; Job → Wanted takes it back', async () => {
    h.current = jobRow({ listingType: 'wanted', salaryM: null, price: 5_000_000, negotiable: false })
    await updateListingCore('listing-1', { listingType: 'job', salaryM: 18 })
    expect(h.updates[0].priceUnit).toBe('VND/month')
    expect(h.updates[0].price).toBe(18_000_000)

    h.updates = []
    h.current = jobRow()
    await updateListingCore('listing-1', { listingType: 'wanted', price: 4_000_000 })
    expect(h.updates[0].priceUnit).toBe('VND')
    expect(h.updates[0].price).toBe(4_000_000)

    h.updates = []
    h.current = jobRow()
    await updateListingCore('listing-1', { listingType: 'job', title: 'English teacher, evenings' })
    expect('priceUnit' in h.updates[0]).toBe(false) // no crossing, no re-stamp
  })

  it('clearing the salary makes the job negotiable-pay: price 0', async () => {
    await updateListingCore('listing-1', { salaryM: null })
    expect(h.updates[0].salaryM).toBeNull()
    expect(h.updates[0].price).toBe(0)
  })

  it('forces negotiable=false, even on a row stored before the rule with negotiable=true', async () => {
    h.current = jobRow({ negotiable: true })
    await updateListingCore('listing-1', { negotiable: true, title: 'Senior English teacher' })
    expect(h.updates[0].negotiable).toBe(false)
  })

  it('urgent hiring opens no offers, and negotiable=false does NOT end a live urgent run', async () => {
    await updateListingCore('listing-1', { urgent: true })
    expect(h.updates[0].urgentUntil).toBeInstanceOf(Date)
    expect(h.updates[0].negotiable).toBeUndefined() // not flipped to true

    h.updates = []
    const live = new Date(Date.now() + 86_400_000)
    h.current = jobRow({ urgentUntil: live })
    await updateListingCore('listing-1', { negotiable: false, title: 'English teacher (urgent)' })
    expect('urgentUntil' in h.updates[0]).toBe(false)
  })

  it('⛔ a LINKED job (affiliateUrl) is never re-priced from its salary floor', async () => {
    h.current = jobRow({ affiliateUrl: 'https://jobs.example/1', price: 0, salaryM: 10 })
    await updateListingCore('listing-1', { salaryM: 10 })
    expect(h.updates[0]?.price).toBeUndefined()
  })

  it('⛔ an imported HOURLY job keeps its rate', async () => {
    h.current = jobRow({ priceUnit: 'VND/hour', price: 150_000, salaryM: null })
    await updateListingCore('listing-1', { price: 150_000 })
    expect(h.updates[0]?.price).toBeUndefined()
  })

  it('Job → Wanted clears the salary and ends a hiring-urgency run', async () => {
    h.current = jobRow({ urgentUntil: new Date(Date.now() + 86_400_000) })
    await updateListingCore('listing-1', { listingType: 'wanted' })
    expect(h.updates[0].salaryM).toBeNull()
    expect((h.updates[0].urgentUntil as Date).getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('a stale drop badge on a job is cleared when its pay changes', async () => {
    h.current = jobRow({ previousPrice: 40_000_000, priceDropAt: new Date() })
    await updateListingCore('listing-1', { salaryM: 35 })
    expect(h.updates[0].price).toBe(35_000_000)
    expect(h.updates[0].previousPrice).toBeNull()
    expect(h.updates[0].priceDropAt).toBeNull()
  })

  it('an edit that does not touch the pay leaves a pre-rule job\'s stated price alone', async () => {
    h.current = jobRow({ salaryM: null, price: 18_000_000, negotiable: false })
    await updateListingCore('listing-1', { title: 'English teacher — evenings' })
    expect('price' in h.updates[0]).toBe(false)
  })

  it('CONTROL: a sale edit still takes the sent price through the price-drop pipeline', async () => {
    h.current = jobRow({ listingType: 'sell', salaryM: null, price: 1_000_000, negotiable: true, category: { slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' } })
    await updateListingCore('listing-1', { price: 900_000 })
    expect(h.updates[0].price).toBe(900_000)
    expect(h.dropCalls).toBe(1)
  })
})
