import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/listings (the web post wizard) — THE RELEASED-CHARGE CAP (owner, 2026-09-24).
 *
 * createListingCore refuses a create past the active-listing cap a released scam charge carries with
 * PublishBlockedError('released_charge_listing_cap') (the rule: src/lib/core/released-charge-cap.test.ts).
 * The route must answer it as an ACCOUNT limit — 403, `error` the code (the wizard maps it to words),
 * and the limit — not the 400 its content-refusal arm gives "fix your listing" codes.
 *
 * ⚠️ DATA SAFETY — every module in the route's import graph that could reach Postgres, Supabase or
 * Vertex is mocked by name.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({ createError: null as Error | null }))

vi.mock('@/lib/db', () => ({ db: { category: { findUnique: async () => ({ id: 'c1', slug: 'phones', name: 'Phones', nameVi: 'Điện thoại' }) } } }))
vi.mock('@/lib/admin', () => ({ getCurrentProfileId: async () => 'p1' }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true }) }))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '127.0.0.1' }))
vi.mock('./resolve-seller', () => ({ resolveSellerForPost: async () => ({ id: 's1', name: 'Shop', ownerId: 'p1', trustTier: 'restricted', trustScore: 20, phone: null }) }))
vi.mock('@/lib/handle', () => ({ consolidateSellerHandle: async () => {} }))
vi.mock('@/lib/enforcement', () => ({ postingGate: async () => null }))
vi.mock('@/lib/core/listings', () => ({
  createListingCore: async () => { if (h.createError) throw h.createError; return { id: 'new', verified: true } },
}))
vi.mock('@/lib/publish-funnel', () => ({ publishOutcome: () => 'x', recordPublishOutcome: async () => {} }))
vi.mock('./feed-query', () => ({}))
vi.mock('@/lib/taxonomy', async (importOriginal) => {
  const { TEACHER_PROFILE_REFUSAL } = await importOriginal<typeof import('@/lib/taxonomy')>()
  return { migrateLegacyCategoryParams: (p: URLSearchParams) => p, paysSalary: () => false, resolveListingType: () => 'sell', TEACHER_PROFILE_REFUSAL }
})
vi.mock('@/lib/feed-diversity', () => ({}))
vi.mock('@/lib/feed-window', () => ({}))
vi.mock('@/lib/edition-scope', () => ({}))
vi.mock('@/lib/serialize', () => ({}))
vi.mock('@/lib/translate', () => ({}))
vi.mock('@/lib/facet-counts', () => ({}))
vi.mock('./semantic-rank', () => ({}))
vi.mock('./keyword-rank', () => ({}))
vi.mock('@/lib/spell-correct', () => ({}))
vi.mock('@/lib/price-histogram', () => ({}))

import { NextRequest } from 'next/server'
const { POST } = await import('./route')
const { PublishBlockedError, JOB_TEXT_BLOCK_CODES } = await import('@/lib/publish-guard')

const post = async () => {
  const res = await POST(new NextRequest('https://eno.vn/api/listings', {
    method: 'POST',
    body: JSON.stringify({ categorySlug: 'phones', title: 'A phone', price: 100000, contactPhone: '0901234567', contactName: 'An' }),
  }))
  return { status: res.status, body: await res.json() as Row }
}

beforeEach(() => { h.createError = null })

describe('POST /api/listings', () => {
  it('released_charge_listing_cap → 403 with the code and the limit', async () => {
    h.createError = new PublishBlockedError('released_charge_listing_cap')
    expect(await post()).toEqual({ status: 403, body: { error: 'released_charge_listing_cap', limit: 10 } })
  })

  it('account_restricted is still the 403 it was', async () => {
    h.createError = new PublishBlockedError('account_restricted')
    const r = await post()
    expect(r.status).toBe(403)
    expect(r.body.error).toBe('account_restricted')
  })

  it('a content refusal is still the 400', async () => {
    h.createError = new PublishBlockedError('photos_min')
    expect((await post()).status).toBe(400)
  })

  // A teacher's job-seeker post (2026-10-12) — fixable in the form, so a 400, with the bilingual sentence for the native
  // apps, whose cached post schema offers the pair. (O-34b's `subcategory_partner_only`, the other such code, was
  // retired 2026-10-14 when the owner opened the e-Visa subcategory behind a licence check.)
  it('teacher_profile_instead → 400 with the code and the bilingual sentence', async () => {
    h.createError = new PublishBlockedError('teacher_profile_instead')
    const { TEACHER_PROFILE_REFUSAL } = await import('@/lib/taxonomy')
    const r = await post()
    expect(r.status).toBe(400)
    expect(r.body).toMatchObject({ error: 'teacher_profile_instead', message: TEACHER_PROFILE_REFUSAL })
  })

  it('every other content refusal carries no message', async () => {
    h.createError = new PublishBlockedError('photos_min')
    expect((await post()).body).not.toHaveProperty('message')
  })
})

// e-Visa / Legal & permits (owner, 2026-10-14): a post without the provider's registered name and licence number, or with
// one that cannot be accepted. The current native builds still offer both aisles but send no values, so the 400 carries
// the bilingual "post from the website" sentence beside the code — and `detail` names the field and the reason.
describe('POST /api/listings — the provider-licence refusals', () => {
  it('provider_licence_required → 400 with the code and PROVIDER_LICENCE_REFUSAL', async () => {
    h.createError = new PublishBlockedError('provider_licence_required')
    const { PROVIDER_LICENCE_REFUSAL } = await import('@/lib/provider-licence')
    const r = await post()
    expect(r.status).toBe(400)
    expect(r.body).toMatchObject({ error: 'provider_licence_required', message: PROVIDER_LICENCE_REFUSAL })
  })

  it('provider_licence_invalid → 400 with the code, its detail "<field>:<reason>" and the same sentence', async () => {
    h.createError = new PublishBlockedError('provider_licence_invalid', 'providerLicenceNo:personal_id')
    const { PROVIDER_LICENCE_REFUSAL } = await import('@/lib/provider-licence')
    expect(await post()).toEqual({ status: 400, body: { error: 'provider_licence_invalid', detail: 'providerLicenceNo:personal_id', message: PROVIDER_LICENCE_REFUSAL } })
  })

  it('a held create is the 201 it always was, `held` included', async () => {
    const created = { id: 'new', verified: false, held: true as const }
    const core = await import('@/lib/core/listings')
    vi.spyOn(core, 'createListingCore').mockResolvedValueOnce(created)
    expect(await post()).toEqual({ status: 201, body: created })
  })
})

// The job-text screen on a hiring post (job-listing.ts jobTextProblem — teacher visibility plan §3a item 6, 2026-10-18):
// fixable in the form, so a 400, with `detail` '<field>:<snippet>' (the field and the words) and the rule's bilingual
// sentence for the native apps, which word no code of their own.
describe('POST /api/listings — the job-text refusals', () => {
  it.each(JOB_TEXT_BLOCK_CODES)('%s → 400 with the code, the field and the words, and its rule’s sentence', async (code) => {
    h.createError = new PublishBlockedError(code, 'description:Vì sao')
    const { JOB_TEXT_REFUSAL } = await import('@/lib/job-listing')
    expect(await post()).toEqual({ status: 400, body: { error: code, detail: 'description:Vì sao', message: JOB_TEXT_REFUSAL[code] } })
  })
})
