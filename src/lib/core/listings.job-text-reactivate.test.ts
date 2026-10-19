import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ A RE-ACTIVATION OF A HIRING POST IS SCREENED LIKE AN EDIT (2026-10-19 — core/listings.ts reactivationJobTextProblem). A
 * Jobs `job` listing hidden or sold before the job-text screen existed — or holding words the screen has since learned to
 * refuse — must not go back on the page by its status alone: setStatusCore's relist (the dashboard's Relist, /api/v1 status,
 * MCP set_listing_status, a sync row's `status: 'active'`) and confirmCore's revive ("still available") run jobTextProblem
 * over the row's stored printed fields — the list an edit screens — and refuse with the same code and `detail`. Nothing is
 * written on a refusal. A listing already live, a `wanted` post and a listing outside Jobs are not screened; taking a
 * listing down never is.
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  read: null as Row | null,
  writes: [] as Row[],
}))

vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      findUnique: async () => h.read,
      updateMany: async (a: Row) => { h.writes.push(a); return { count: 1 } },
      count: async () => 0,
    },
    teacherProfile: { updateMany: async () => ({ count: 0 }) },
    notification: { deleteMany: async () => ({ count: 0 }) },
  },
}))
vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('@/lib/log', () => ({ logError: () => {} }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/revalidate-lang', () => ({ revalidatePublicPath: () => {} }))
vi.mock('@/lib/compliance/account-state', async (orig) => ({
  ...(await orig<typeof import('@/lib/compliance/account-state')>()),
  identityGateEnforced: () => false,
}))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ sellerPublishDecision: async () => ({ ok: true }), assertSellerMayPublish: async () => {} }))
vi.mock('@/lib/released-charge-gate', () => ({ releasedChargeGate: async () => null, releasedChargeStanding: async () => null, releasedChargeGateFor: async () => null }))
vi.mock('@/lib/listing-index', () => ({ reindexListing: async () => {}, removeFromIndex: async () => {} }))
vi.mock('@/lib/trust', () => ({ recordEngagement: async () => {} }))
vi.mock('@/lib/stale', () => ({ canBump: () => false }))
vi.mock('@/lib/translate', () => ({ warmTranslations: async () => {} }))
vi.mock('@/lib/webhooks', () => ({ dispatchListingEvent: async () => {}, dispatchListingEventsBatch: async () => {} }))
vi.mock('@/lib/ranking', () => ({ browseRankScore: () => 0, recomputeRankScoreForListing: async () => {} }))

const { setStatusCore, confirmCore } = await import('@/lib/core/listings')

const CLEAN = 'Teach English to adults at our centre in District 7, 20–25 hours a week. We apply for your work permit.'

/** A hidden Jobs › Teaching hiring post as the revives read it (overridable). */
function jobRow(over: Row = {}): Row {
  return {
    id: 'L1', status: 'hidden', sellerId: 's1', listingType: 'job', verified: true, subcategorySlug: 'teaching',
    seller: { ownerId: 'p1', owner: { enforcementState: 'good_standing' } }, category: { slug: 'jobs' }, verificationMethod: null,
    title: 'English teacher, District 7', description: CLEAN, attributes: JSON.stringify({ jobtype: 'fulltime' }),
    location: 'Quận 7', district: 'Quận 7', city: 'Hồ Chí Minh',
    postedAt: new Date('2026-09-01'), sellerTrustScore: 100, featured: false, views: 0, contactCount: 0,
    soldAt: null, updatedAt: new Date('2026-10-01'),
    ...over,
  }
}

beforeEach(() => {
  h.read = jobRow()
  h.writes = []
})

describe('setStatusCore — a relist of a hiring post', () => {
  it('⛔ stored visa wording, an invented attribute key, a hard-wrapped phrase: refused with the edit’s code and detail — nothing written', async () => {
    h.read = jobRow({ description: `${CLEAN} Visa support provided.` })
    expect(await setStatusCore('L1', 'active')).toEqual({ ok: false, code: 400, error: 'job_residence_wording', detail: 'description:Visa' })
    // The attribute as its Details row prints it: the page's label for the key beside its value.
    h.read = jobRow({ attributes: JSON.stringify({ jobtype: 'fulltime', visaSponsorship: 'yes' }) })
    expect(await setStatusCore('L1', 'active')).toEqual({ ok: false, code: 400, error: 'job_residence_wording', detail: 'attributes.visaSponsorship:Visa' })
    h.read = jobRow({ description: 'Hỗ trợ làm thẻ tạm\ntrú cho giáo viên.' })
    expect(await setStatusCore('L1', 'active')).toEqual({ ok: false, code: 400, error: 'job_residence_wording', detail: 'description:tạm trú' })
    h.read = jobRow({ status: 'sold', title: 'English teacher — female only' })
    expect(await setStatusCore('L1', 'active')).toEqual({ ok: false, code: 400, error: 'job_discrimination', detail: 'title:female only' })
    expect(h.writes).toEqual([])
  })

  it('a clean hiring post relists; honest negations too', async () => {
    expect(await setStatusCore('L1', 'active')).toEqual({ ok: true, status: 'active' })
    h.read = jobRow({ description: `${CLEAN}\n- No training fee\n- Không thu phí đào tạo` })
    expect(await setStatusCore('L1', 'active')).toEqual({ ok: true, status: 'active' })
    // A legacy row whose stored attributes are not JSON (or the literal null) relists — no Details rows, nothing to read.
    h.read = jobRow({ attributes: '{not json' })
    expect(await setStatusCore('L1', 'active')).toEqual({ ok: true, status: 'active' })
    h.read = jobRow({ attributes: 'null' })
    expect(await setStatusCore('L1', 'active')).toEqual({ ok: true, status: 'active' })
    expect(h.writes).toHaveLength(4)
  })

  it('not screened: a listing already live (a sync’s every-row re-send), a take-down, a `wanted` post, a listing outside Jobs', async () => {
    h.read = jobRow({ status: 'active', description: `${CLEAN} Visa support provided.` })
    expect(await setStatusCore('L1', 'active')).toEqual({ ok: true, status: 'active' })
    expect(await setStatusCore('L1', 'hidden')).toEqual({ ok: true, status: 'hidden' })
    h.read = jobRow({ listingType: 'wanted', subcategorySlug: 'hospitality', description: 'Barista, two years in cafés. Valid TRC.' })
    expect(await setStatusCore('L1', 'active')).toEqual({ ok: true, status: 'active' })
    h.read = jobRow({ category: { slug: 'services' }, listingType: 'service', subcategorySlug: 'cleaning', description: 'Female only team. Visa card accepted.' })
    expect(await setStatusCore('L1', 'active')).toEqual({ ok: true, status: 'active' })
    expect(h.writes).toHaveLength(4)
  })
})

describe('confirmCore — "still available" that revives a hiring post', () => {
  it('⛔ a revive of stored refused text → the edit’s code and detail, nothing written', async () => {
    h.read = jobRow({ status: 'sold', description: `${CLEAN} Training fee required.` })
    expect(await confirmCore('L1', 'p1')).toEqual({ ok: false, code: 400, error: 'job_candidate_fee', detail: 'description:Training fee required' })
    expect(h.writes).toEqual([])
  })

  it('a clean revive goes through; an ordinary confirm of a live listing is not screened — it puts nothing back on the page', async () => {
    expect(await confirmCore('L1', 'p1')).toEqual({ ok: true, bumped: false })
    h.read = jobRow({ status: 'active', description: `${CLEAN} Visa support provided.` })
    expect(await confirmCore('L1', 'p1')).toEqual({ ok: true, bumped: false })
    expect(h.writes).toHaveLength(2)
  })
})
