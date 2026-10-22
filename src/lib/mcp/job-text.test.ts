import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE MCP TOOLS ON THE JOB-TEXT SCREEN (teacher visibility plan §3a item 6; owner 2026-10-18: "go with recommended").
 * create_listing and update_listing write hiring posts through the same cores as the website, so the job-text screen
 * (job-listing.ts jobTextProblem) refuses them there too — and an agent must be told what to fix: the code, the rule's
 * sentence and `detail` '<field>:<snippet>' (the field and the words to take out). Never the route's `internal_error`
 * ("The tool failed to execute.", logged as a crash), which is what a PublishBlockedError that tools.ts does not map
 * becomes (src/app/api/mcp/route.ts). The route carrying `detail` to the agent: src/app/api/mcp/tool-error-detail.test.ts.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({
  update: { ok: true } as Row,
  createError: null as Error | null,
  status: { ok: true, status: 'active' } as Row,
  createBodies: [] as Row[],
  updateBodies: [] as Row[],
}))

vi.mock('@/lib/api/auth', () => ({ listingOwnedBy: async () => true }))
vi.mock('@/lib/core/listings', () => ({
  setStatusCore: async () => h.status,
  createListingCore: async (a: Row) => { h.createBodies.push(a.body); if (h.createError) throw h.createError; return { id: 'new', verified: true } },
  updateListingCore: async (_id: string, body: Row) => { h.updateBodies.push(body); return h.update },
  deleteListingCore: async () => ({ ok: true, deleted: true }),
  DELETE_HOLD_MESSAGE: {},
}))
// The rest of the tool module's import graph — not exercised here.
vi.mock('@/lib/db', () => ({
  db: {
    category: { findUnique: async () => ({ id: 'c-jobs', slug: 'jobs', name: 'Jobs', nameVi: 'Việc làm' }) },
    seller: { findUnique: async () => ({ id: 's1', ownerId: 'p1', trustTier: 'standard', trustScore: 100, phone: null }) },
  },
}))
vi.mock('@/lib/serialize', () => ({ serializeListing: () => ({}) }))
vi.mock('@/lib/ssrf', () => ({ assertSafeUrl: async () => {} }))
vi.mock('@/lib/core/bulk', () => ({ bulkImportCore: async () => ({}), rehostListingImage: async () => null, claimRehostedImages: async () => {}, discardRehostedImages: async () => {}, BULK_MAX_ROWS: 200 }))
vi.mock('@/lib/core/sync', () => ({ syncListingsCore: async () => ({}), SYNC_MAX_ROWS: 200 }))
vi.mock('@/lib/core/seller', () => ({ updateSellerCore: async () => ({ ok: true }) }))
vi.mock('@/lib/enforcement', () => ({ postingGate: async () => null }))
vi.mock('@/lib/listing-analytics', () => ({ getListingAnalytics: async () => ({}) }))
vi.mock('@/lib/webhooks', () => ({ dispatchListingEventsBatch: async () => {}, generateWebhookSecret: () => 'x' }))
vi.mock('next/server', () => ({ after: () => {} }))

const { TOOLS, ToolError } = await import('./tools')
const { PublishBlockedError, JOB_TEXT_BLOCK_CODES } = await import('@/lib/publish-guard')
const { JOB_TEXT_REFUSAL } = await import('@/lib/job-listing')
const AUTH = { keyId: 'k1', sellerId: 's1', profileId: 'p1', scopes: new Set(['listings:write']) }
const tool = (name: string) => TOOLS.find((t) => t.name === name)!

beforeEach(() => {
  h.update = { ok: true }
  h.createError = null
  h.status = { ok: true, status: 'active' }
  h.createBodies = []
  h.updateBodies = []
})

describe('create_listing — a hiring post the job-text screen refused', () => {
  const go = () => tool('create_listing').handler(AUTH as never, { title: 'English teacher, District 7', categorySlug: 'jobs', listingType: 'job', description: 'Visa support provided.' } as never)

  it.each(JOB_TEXT_BLOCK_CODES)('⛔ %s → a ToolError with the code, the rule’s sentence and the field and words — not internal_error', async (code) => {
    h.createError = new PublishBlockedError(code, 'description:Visa')
    const e = await go().catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ToolError)
    expect(e).toMatchObject({ code, message: JOB_TEXT_REFUSAL[code].en, detail: 'description:Visa' })
  })

  it('another content refusal still falls through to the route (its existing contract)', async () => {
    h.createError = new PublishBlockedError('banned_words')
    const e = await go().catch((x: unknown) => x)
    expect(e).toBeInstanceOf(PublishBlockedError)
  })
})

describe('update_listing — a hiring post’s edit the job-text screen refused', () => {
  const run = () => tool('update_listing').handler(AUTH as never, { id: 'L1', description: 'Female only.' } as never)

  it.each(JOB_TEXT_BLOCK_CODES)('⛔ %s → a ToolError with the code, the rule’s sentence and `detail`', async (code) => {
    h.update = { ok: false, code: 400, error: code, detail: 'description:Female only' }
    const e = await run().catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ToolError)
    expect(e).toMatchObject({ code, message: JOB_TEXT_REFUSAL[code].en, detail: 'description:Female only' })
  })

  it('other refusals are unchanged: the code as the message, no detail', async () => {
    h.update = { ok: false, code: 400, error: 'title_too_short' }
    const e = await run().catch((x: unknown) => x)
    expect(e).toMatchObject({ code: 'title_too_short', message: 'title_too_short' })
    expect((e as InstanceType<typeof ToolError>).detail).toBeUndefined()
  })
})

/**
 * { visaSponsorship: 'yes' } AND MCP (2026-10-19). The create and edit tools send no attributes — their inputs have no such
 * field, and each handler builds the core's body field by field — so an attribute an agent adds never reaches a row there.
 * The one MCP door to a stored attribute is a RELIST (set_listing_status 'active'), which setStatusCore screens like an edit
 * (core/listings.job-text-reactivate.test.ts): its refusal comes back as a ToolError with the code, the sentence and `detail`.
 */
describe('MCP and an attribute row a job ad may not carry', () => {
  it('create_listing and update_listing never pass an attribute on to the core', async () => {
    await tool('create_listing').handler(AUTH as never, { title: 'English teacher, District 7', categorySlug: 'jobs', listingType: 'job', description: 'Teach adults.', attributes: { visaSponsorship: 'yes' } } as never)
    await tool('update_listing').handler(AUTH as never, { id: 'L1', title: 'English teacher, District 7', attributes: { visaSponsorship: 'yes' } } as never)
    expect(h.createBodies).toHaveLength(1)
    expect(h.createBodies[0]).not.toHaveProperty('attributes')
    expect(h.updateBodies).toHaveLength(1)
    expect(h.updateBodies[0]).not.toHaveProperty('attributes')
  })

  it('⛔ set_listing_status: a relist refused for a stored { visaSponsorship: "yes" } → a ToolError with the code, the sentence and `detail`', async () => {
    h.status = { ok: false, code: 400, error: 'job_residence_wording', detail: 'attributes.visaSponsorship:Visa' }
    const e = await tool('set_listing_status').handler(AUTH as never, { id: 'L1', status: 'active' } as never).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ToolError)
    expect(e).toMatchObject({ code: 'job_residence_wording', message: JOB_TEXT_REFUSAL.job_residence_wording.en, detail: 'attributes.visaSponsorship:Visa' })
  })

  it('another relist refusal is unchanged — no detail', async () => {
    h.status = { ok: false, code: 409, error: 'licence_check_required' }
    const e = await tool('set_listing_status').handler(AUTH as never, { id: 'L1', status: 'active' } as never).catch((x: unknown) => x)
    expect(e).toMatchObject({ code: 'licence_check_required' })
    expect((e as InstanceType<typeof ToolError>).detail).toBeUndefined()
  })
})
