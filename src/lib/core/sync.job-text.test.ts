import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── A PARTNER SYNC'S UPDATE THAT THE JOB-TEXT SCREEN REFUSED (2026-10-18) ─────────────────────────────────────────────
//
// A sync updates existing rows through updateListingCore, so a hiring post's edit meets the job-text screen there
// (job-listing.ts jobTextProblem; core/listings.job-text.test.ts). Its refusal carries `detail` '<field>:<snippet>' — the
// field and the words to take out — and the failed row passes it on beside the code, so a partner can fix the row instead
// of guessing at a bare code. A refusal with no pointer reports exactly as before. (A sync's CREATES go through the bulk
// core, whose prose names the field and the words itself — core/bulk.job-text.test.ts.)

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  existing: [] as Row[],
  update: { ok: true } as Row,
  status: null as Row | null,
}))

vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      findMany: async () => h.existing,
      updateMany: async () => ({ count: 0 }),
    },
  },
}))
vi.mock('@/lib/core/licence-check', () => ({ licenceBlockedIds: async () => new Set<string>() }))
vi.mock('@/lib/core/listings', () => ({
  updateListingCore: async () => h.update,
  setStatusCore: async (_id: string, status: string) => h.status ?? { ok: true, status },
}))
vi.mock('@/lib/core/bulk', () => ({ bulkImportCore: async () => ({ results: [] }), rehostListingImage: async () => null, BULK_MAX_ROWS: 200 }))
vi.mock('@/lib/enforcement', () => ({ bulkPostingBudget: async () => ({ blocked: null, maxNewActive: null }) }))
vi.mock('@/lib/released-charge-gate', () => ({ releasedChargeStanding: async () => null, releasedChargeGateFor: async () => ({ remaining: 99 }) }))
vi.mock('@/lib/compliance/seller-publish-gate', () => ({ sellerPublishDecision: async () => ({ ok: true }) }))
vi.mock('@/lib/listing-index', () => ({ removeFromIndex: async () => {} }))
vi.mock('@/lib/webhooks', () => ({ dispatchListingEventsBatch: async () => {} }))
vi.mock('next/server', () => ({ after: () => {} }))

const { syncListingsCore } = await import('@/lib/core/sync')

const SELLER = { id: 's1', ownerId: 'owner-1', trustTier: 'standard', trustScore: 100 }

beforeEach(() => {
  h.existing = [{ id: 'L1', externalId: 'job-1', status: 'active', subcategorySlug: 'teaching', verified: true }]
  h.update = { ok: true }
  h.status = null
})

describe('syncListingsCore — an update the job-text screen refused', () => {
  it('⛔ the failed row carries the code AND the field and words to take out', async () => {
    h.update = { ok: false, code: 400, error: 'job_residence_wording', detail: 'description:Visa' }
    const out = await syncListingsCore(SELLER, [{ externalId: 'job-1', description: 'English teacher. Visa support provided.' }], 'partial')
    expect(out.results).toEqual([{ external_id: 'job-1', id: 'L1', action: 'failed', error: 'job_residence_wording', detail: 'description:Visa' }])
    expect(out.failed).toBe(1)
  })

  it('a refusal with no pointer reports exactly as before — no detail key', async () => {
    h.update = { ok: false, code: 400, error: 'title_too_short' }
    const out = await syncListingsCore(SELLER, [{ externalId: 'job-1', title: 'x' }], 'partial')
    expect(out.results).toEqual([{ external_id: 'job-1', id: 'L1', action: 'failed', error: 'title_too_short' }])
  })
})

// A re-activation the job-text screen refused (2026-10-19 — setStatusCore screens a revived hiring post's stored text,
// core/listings.ts reactivationJobTextProblem): the failed row passes its `detail` on too.
describe('syncListingsCore — a revive the job-text screen refused', () => {
  it('⛔ the failed row carries the code and the field and words; the row’s edits (each screened by the edit) stay applied', async () => {
    h.existing = [{ id: 'L1', externalId: 'job-1', status: 'hidden', subcategorySlug: 'teaching', verified: true }]
    h.status = { ok: false, code: 400, error: 'job_residence_wording', detail: 'attributes.visaSponsorship:Visa' }
    const out = await syncListingsCore(SELLER, [{ externalId: 'job-1', title: 'English teacher, District 7', status: 'active' }], 'partial')
    expect(out.results).toEqual([{ external_id: 'job-1', id: 'L1', action: 'failed', error: 'job_residence_wording', detail: 'attributes.visaSponsorship:Visa' }])
    expect(out.updated).toBe(0)
  })
})
