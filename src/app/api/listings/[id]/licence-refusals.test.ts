import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LICENCE_CHECK_REQUIRED_COPY, LISTING_CHANGED_COPY } from '@/lib/licence-check-copy'
import { PROVIDER_LICENCE_REFUSAL } from '@/lib/provider-licence'

/**
 * THE SELLER'S OWN DOORS ON THE LICENCE CHECK (owner, 2026-10-14) — PATCH /api/listings/[id], POST …/status, POST
 * …/confirm. The web dashboard and the post wizard word these codes themselves; the native iOS and Android dashboards
 * call these same routes and cannot, so every licence refusal carries its bilingual sentence as `message`:
 *   · the edit: `provider_licence_required` / `provider_licence_invalid` (400, `detail` '<field>:<reason>' passed through)
 *     and `listing_changed` (409 — the compare-and-set before the write missed; nothing was written);
 *   · a relist or a reviving confirm of an e-Visa / Legal & permits listing eno has not checked: `licence_check_required`
 *     (409 — waiting for the check, not refused for good).
 * The rules themselves are pinned on the cores (listings.sell-rules.test.ts, listings.licence-revive.test.ts).
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  update: { ok: true } as Row,
  status: { ok: true, status: 'active' } as Row,
  confirm: { ok: true, bumped: false } as Row,
}))

vi.mock('@/lib/listing-owner', () => ({ checkListingOwner: async () => ({ ok: true, profileId: 'p1', sellerId: 's1' }) }))
vi.mock('@/lib/core/listings', () => ({
  updateListingCore: async () => h.update,
  deleteListingCore: async () => ({ ok: true, deleted: true }),
  setStatusCore: async () => h.status,
  confirmCore: async () => h.confirm,
}))
// The rest of the PATCH route's import graph (GET / DELETE) — not exercised here.
vi.mock('@/lib/admin', () => ({ getCurrentProfileId: async () => 'p1' }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: () => ({}) }))
vi.mock('@/lib/phone-unique', () => ({ phoneTakenByOther: async () => false }))
vi.mock('@/lib/serialize', () => ({ serializeListing: () => ({}) }))
vi.mock('@/lib/price-stat', () => ({ getPriceBand: async () => null }))
vi.mock('@/lib/seller-metrics', () => ({ topSellerReviews: async () => [], sameSellerListings: async () => [] }))

const { PATCH } = await import('./route')
const { POST: statusPOST } = await import('./status/route')
const { POST: confirmPOST } = await import('./confirm/route')

const params = { params: Promise.resolve({ id: 'L1' }) }
async function json(res: Response) { return { status: res.status, body: (await res.json()) as Row } }
const patch = async (body: Row) => json(await PATCH(new Request('https://eno.vn/api/listings/L1', { method: 'PATCH', body: JSON.stringify(body) }) as never, params))
const relist = async () => json(await statusPOST(new Request('https://eno.vn/api/listings/L1/status', { method: 'POST', body: JSON.stringify({ status: 'active' }) }) as never, params))
const confirm = async () => json(await confirmPOST(new Request('https://eno.vn/api/listings/L1/confirm', { method: 'POST' }) as never, params))

beforeEach(() => {
  h.update = { ok: true }
  h.status = { ok: true, status: 'active' }
  h.confirm = { ok: true, bumped: false }
})

describe('PATCH /api/listings/[id]', () => {
  it('provider_licence_required → 400 with the code and PROVIDER_LICENCE_REFUSAL', async () => {
    h.update = { ok: false, code: 400, error: 'provider_licence_required' }
    expect(await patch({ subcategorySlug: 'visa-legal' })).toEqual({ status: 400, body: { error: 'provider_licence_required', message: PROVIDER_LICENCE_REFUSAL } })
  })

  it('provider_licence_invalid → 400 with its detail passed through, and the same sentence', async () => {
    h.update = { ok: false, code: 400, error: 'provider_licence_invalid', detail: 'providerLegalName:contact' }
    expect(await patch({ attributes: {} })).toEqual({ status: 400, body: { error: 'provider_licence_invalid', detail: 'providerLegalName:contact', message: PROVIDER_LICENCE_REFUSAL } })
  })

  it('⛔ listing_changed → 409 with "reload and try again" in both languages', async () => {
    h.update = { ok: false, code: 409, error: 'listing_changed' }
    expect(await patch({ title: 'e-Visa in 3 days' })).toEqual({ status: 409, body: { error: 'listing_changed', message: LISTING_CHANGED_COPY } })
  })

  it('`held` — waiting for eno’s licence check — rides on the 200; a plain save is the bare ack', async () => {
    h.update = { ok: true, held: true }
    expect(await patch({ title: 'e-Visa in 3 days' })).toEqual({ status: 200, body: { ok: true, held: true } })
    h.update = { ok: true }
    expect(await patch({ title: 'e-Visa in 3 days' })).toEqual({ status: 200, body: { ok: true } })
  })

  // The job-text screen on a hiring post's edit (job-listing.ts jobTextProblem, 2026-10-18): the field and the words
  // ('<field>:<snippet>') and the rule's sentence.
  it('a job-text refusal → 400 with the field and the words passed through, and its rule’s sentence', async () => {
    const { JOB_TEXT_REFUSAL } = await import('@/lib/job-listing')
    h.update = { ok: false, code: 400, error: 'job_candidate_fee', detail: 'description:Training fee required' }
    expect(await patch({ description: 'Training fee required.' })).toEqual({ status: 400, body: { error: 'job_candidate_fee', detail: 'description:Training fee required', message: JOB_TEXT_REFUSAL.job_candidate_fee } })
    h.update = { ok: false, code: 400, error: 'job_residence_wording', detail: 'title:visa' }
    expect(await patch({ title: 'ESL teacher + visa' })).toEqual({ status: 400, body: { error: 'job_residence_wording', detail: 'title:visa', message: JOB_TEXT_REFUSAL.job_residence_wording } })
  })

  it('every other refusal stays the bare code (no message, no detail)', async () => {
    h.update = { ok: false, code: 409, error: 'urgent_quota' }
    expect(await patch({ urgent: true })).toEqual({ status: 409, body: { error: 'urgent_quota' } })
  })
})

describe('POST /api/listings/[id]/status and /confirm — a revive eno’s licence check has not cleared', () => {
  it('⛔ status → 409 licence_check_required with the bilingual sentence', async () => {
    h.status = { ok: false, code: 409, error: 'licence_check_required' }
    expect(await relist()).toEqual({ status: 409, body: { error: 'licence_check_required', message: LICENCE_CHECK_REQUIRED_COPY } })
  })

  it('⛔ confirm → 409 licence_check_required with the same sentence', async () => {
    h.confirm = { ok: false, code: 409, error: 'licence_check_required' }
    expect(await confirm()).toEqual({ status: 409, body: { error: 'licence_check_required', message: LICENCE_CHECK_REQUIRED_COPY } })
  })

  it('every other refusal is unchanged — the bare code at its status', async () => {
    h.status = { ok: false, code: 403, error: 'account_held' }
    expect(await relist()).toEqual({ status: 403, body: { error: 'account_held' } })
    h.confirm = { ok: false, code: 404, error: 'not_found' }
    expect(await confirm()).toEqual({ status: 404, body: { error: 'not_found' } })
  })

  // A relist or a reviving confirm of a hiring post whose stored text the job-text screen refuses (2026-10-19 —
  // core/listings.ts reactivationJobTextProblem): the field and the words, and the rule's sentence, as an edit's refusal.
  it('⛔ a job-text refusal of a relist or a revive → 400 with the field and the words, and its rule’s sentence', async () => {
    const { JOB_TEXT_REFUSAL } = await import('@/lib/job-listing')
    h.status = { ok: false, code: 400, error: 'job_residence_wording', detail: 'attributes.visaSponsorship:Visa' }
    expect(await relist()).toEqual({ status: 400, body: { error: 'job_residence_wording', detail: 'attributes.visaSponsorship:Visa', message: JOB_TEXT_REFUSAL.job_residence_wording } })
    h.confirm = { ok: false, code: 400, error: 'job_candidate_fee', detail: 'description:Training fee required' }
    expect(await confirm()).toEqual({ status: 400, body: { error: 'job_candidate_fee', detail: 'description:Training fee required', message: JOB_TEXT_REFUSAL.job_candidate_fee } })
  })

  it('the sentences are what the copy module says: curated pairs, typographic apostrophes', () => {
    for (const copy of [LICENCE_CHECK_REQUIRED_COPY, LISTING_CHANGED_COPY]) {
      expect(copy.en.length).toBeGreaterThan(20)
      expect(copy.vi.length).toBeGreaterThan(20)
      expect(`${copy.en}${copy.vi}`).not.toContain("'")
    }
    expect(LICENCE_CHECK_REQUIRED_COPY.en).toContain('eno’s licence check')
  })
})
