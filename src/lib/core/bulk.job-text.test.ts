import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE JOB-TEXT SCREEN ON THE BULK CORE TOO (teacher visibility plan §3a item 6; approved in the plan, 2026-10-18).
 * bulkImportCore creates with its own db.listing.create, so createListingCore's screen (listings.job-text.test.ts) never
 * runs for a CSV, /api/v1/listings/bulk, the MCP bulk tool or a partner sync's creates — a school could post round it.
 * Every Jobs row is stored as a hiring post. Pinned here, on both editions alike (one database; eno.vn shows the forum's rows):
 *   · a Jobs row with visa wording, or a denylist hit, fails on its row — in its title, description or district;
 *   · the error is the row's prose (this core's convention), naming the field, the words that tripped it and the rule;
 *   · refused before any work for that row (no duplicate lookup, no create); the rows around it import;
 *   · honest negations import, and a row outside Jobs is not screened.
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  creates: [] as Row[],
  dupChecks: [] as Row[],
}))

vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('@/lib/db', () => ({
  db: {
    category: {
      findMany: async (a: Row) => [
        { id: 'c-jobs', slug: 'jobs', name: 'Jobs', nameVi: 'Việc làm' },
        { id: 'c-services', slug: 'services', name: 'Services', nameVi: 'Dịch vụ' },
      ].filter((c) => (a.where.slug.in as string[]).includes(c.slug)),
    },
    listing: {
      findMany: async () => [],
      create: async (a: Row) => { h.creates.push(a.data); return { id: `new${h.creates.length}` } },
    },
  },
}))
vi.mock('@/lib/enforcement', () => ({ bulkPostingBudget: async () => ({ blocked: null, maxNewActive: null }) }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ sellerPublishDecision: async () => ({ ok: true }) }))
vi.mock('@/lib/released-charge-gate', () => ({ releasedChargeGate: async () => null, releasedChargeStanding: async () => null, releasedChargeGateFor: async () => null }))
vi.mock('@/lib/duplicate-guard', () => ({ findDuplicateListing: async (a: Row) => { h.dupChecks.push(a); return null } }))
vi.mock('@/lib/listing-image', () => ({ isListingImageUrl: () => true, isListingVideoUrl: () => false }))
vi.mock('@/lib/ssrf', () => ({ safeFetch: async () => new Response(new Uint8Array([1])) }))
vi.mock('@/lib/core/media', () => ({ storeListingImage: async () => 'https://cdn.eno.test/bulk/1.webp', IMG_MAX_BYTES: 1_000_000 }))
vi.mock('@/lib/translate', () => ({ warmTranslations: async () => {} }))
vi.mock('@/lib/listing-index', () => ({ reindexListing: async () => {}, removeFromIndex: async () => {} }))
vi.mock('@/lib/ai-moderation', () => ({ moderateListingById: async () => {} }))
vi.mock('@/lib/image-provenance', () => ({ indexAndCheckProvenance: async () => {} }))
vi.mock('@/lib/ranking', () => ({ browseRankScore: () => 0 }))

/** The bulk core as the given edition builds it — the edition is read once, when @/lib/edition first loads. */
async function bulkFor(edition: 'marketplace' | 'services') {
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', edition)
  vi.resetModules()
  const { bulkImportCore } = await import('@/lib/core/bulk')
  vi.unstubAllEnvs()
  return bulkImportCore
}
const bulk = { marketplace: await bulkFor('marketplace'), services: await bulkFor('services') }
const { JOB_TEXT_REFUSAL } = await import('@/lib/job-listing')

const SELLER = { id: 's1', ownerId: 'owner-1', trustTier: 'standard', trustScore: 70 }
const CLEAN = 'Teach English to adults at our centre in District 7, 20–25 hours a week. We apply for your work permit.'
const job = (title: string, description = CLEAN) => ({ category_slug: 'jobs', title, description, price: 25_000_000 })

beforeEach(() => {
  h.creates = []
  h.dupChecks = []
})

describe('bulkImportCore — a Jobs row gets the job-text screen', () => {
  it.each(['marketplace', 'services'] as const)('⛔ %s: a visa row fails on its row, naming the field, the words and the rule — before any work; the rows around it import', async (edition) => {
    const r = await bulk[edition](SELLER, [
      job('English teacher, District 7'),
      job('English teacher, District 3', `${CLEAN} Visa support provided.`),
      job('English teacher, Thủ Đức'),
    ])
    expect(r.results).toEqual([
      { row: 1, id: 'new1' },
      { row: 2, error: `In the description, “Visa”: ${JOB_TEXT_REFUSAL.job_residence_wording.en}` },
      { row: 3, id: 'new2' },
    ])
    expect(h.dupChecks.map((d) => d.title)).toEqual(['English teacher, District 7', 'English teacher, Thủ Đức'])
    expect(h.creates.map((d) => d.listingType)).toEqual(['job', 'job'])
  })

  it.each(['marketplace', 'services'] as const)('⛔ %s: a denylist hit fails, each with its rule’s sentence — the district too', async (edition) => {
    const r = await bulk[edition](SELLER, [
      job('English teacher, female only'),
      job('English teacher, District 3', `${CLEAN} Training fee required.`),
      job('Hostess for a karaoke bar, English speaking'),
      { ...job('English teacher, District 3'), district: 'Quận 3 — đặt cọc trước' },
    ])
    expect(r.results).toEqual([
      { row: 1, error: `In the title, “female only”: ${JOB_TEXT_REFUSAL.job_discrimination.en}` },
      { row: 2, error: `In the description, “Training fee required”: ${JOB_TEXT_REFUSAL.job_candidate_fee.en}` },
      { row: 3, error: `In the title, “Hostess for a karaoke”: ${JOB_TEXT_REFUSAL.job_adult_venue.en}` },
      { row: 4, error: `In the district, “đặt cọc”: ${JOB_TEXT_REFUSAL.job_candidate_fee.en}` },
    ])
    expect(h.creates).toEqual([])
  })

  it('honest negations import: "No training fee, no deposit", "Không thu phí đào tạo"', async () => {
    const r = await bulk.marketplace(SELLER, [job('English teacher, District 3', `${CLEAN} No training fee, no deposit. Không thu phí đào tạo.`)])
    expect(r.results).toEqual([{ row: 1, id: 'new1' }])
  })

  it('⛔ a description is read as its page prints it: a phrase hard-wrapped inside one paragraph is whole, two list items are two', async () => {
    const r = await bulk.marketplace(SELLER, [
      job('English teacher, District 3', `${CLEAN}\nHỗ trợ làm thẻ tạm\ntrú.`),
      job('English teacher, District 4', `${CLEAN}\n- Hỗ trợ tiếp thị\n- Thực hiện các công việc khác`),
    ])
    expect(r.results).toEqual([
      { row: 1, error: `In the description, “tạm trú”: ${JOB_TEXT_REFUSAL.job_residence_wording.en}` },
      { row: 2, id: 'new1' },
    ])
  })

  it('⛔ a Jobs row stores no condition (a job page prints none); a row elsewhere keeps its own', async () => {
    const r = await bulk.marketplace(SELLER, [
      { ...job('English teacher, District 3'), condition: 'Visa ready' },
      { category_slug: 'services', title: 'Home cleaning', description: 'Two cleaners, three hours.', price: 300_000, image_urls: 'https://cdn.eno.test/a.jpg', condition: 'Insured team' },
    ])
    expect(r.results).toEqual([{ row: 1, id: 'new1' }, { row: 2, id: 'new2' }])
    expect(h.creates.map((d) => d.condition)).toEqual([null, 'Insured team'])
  })

  it('a row carries no attributes: { visaSponsorship: "yes" } sent beside one is never stored, so no job page can print it', async () => {
    const r = await bulk.marketplace(SELLER, [{ ...job('English teacher, District 3'), attributes: { visaSponsorship: 'yes' } } as never])
    expect(r.results).toEqual([{ row: 1, id: 'new1' }])
    expect(h.creates[0]).not.toHaveProperty('attributes')
  })

  it('a row outside Jobs is not screened by it', async () => {
    const r = await bulk.marketplace(SELLER, [{ category_slug: 'services', title: 'Home cleaning, female only team', description: 'Visa card accepted.', price: 300_000, image_urls: 'https://cdn.eno.test/a.jpg' }])
    expect(r.results).toEqual([{ row: 1, id: 'new1' }])
  })
})
