import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * THE PARTNER API ON THE LICENCE CHECK (owner, 2026-10-14). An e-Visa (services/visa-legal) or Legal & permits
 * (services/legal-permits) listing from any shop but eno's own needs the provider's registered name and licence number
 * (attributes.providerLegalName / providerLicenceNo) and is stored UNPUBLISHED until eno has checked them. The contract
 * a partner codes against — and the OpenAPI document describes (../openapi.json/route.test.ts):
 *   · POST: 201 `{ listing: { id, verified: false, held: true } }`; 422 `provider_licence_required` /
 *     `provider_licence_invalid` with a message naming the keys — or the field and the reason, `detail` kept;
 *   · PATCH: 200 `{ ok, held }`; the same 422s; 409 `listing_changed` when the edit raced eno's check;
 *   · status / confirm: 409 `licence_check_required` for a revive of a listing still waiting.
 * The cores' rules are pinned in src/lib/core/listings.sell-rules.test.ts and listings.licence-revive.test.ts.
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  createError: null as Error | null,
  created: { id: 'new', verified: false, held: true } as Row,
  update: { ok: true } as Row,
  status: { ok: true, status: 'active' } as Row,
  confirm: { ok: true, bumped: false } as Row,
}))

vi.mock('@/lib/api/auth', () => ({
  resolveApiKey: async () => ({ ok: true, auth: { keyId: 'k1', sellerId: 's1', profileId: 'p1', scopes: new Set(['listings:write']) }, rate: { limit: 600, remaining: 599, resetSec: 60, windowSec: 60 } }),
  listingOwnedBy: async () => true,
}))
vi.mock('@/lib/api/idempotency', () => ({
  withIdempotency: async (_req: unknown, _key: unknown, _rate: unknown, fn: () => Promise<{ status: number; body: unknown }>) => {
    const out = await fn()
    return Response.json(out.body, { status: out.status })
  },
}))
vi.mock('@/lib/db', () => ({
  db: {
    category: { findUnique: async () => ({ id: 'c-services', slug: 'services', name: 'Services', nameVi: 'Dịch vụ' }) },
    seller: { findUnique: async () => ({ id: 's1', ownerId: 'p1', trustTier: 'standard', trustScore: 100, phone: null }) },
  },
}))
vi.mock('@/lib/serialize', () => ({ serializeListing: () => ({}) }))
vi.mock('@/lib/enforcement', () => ({ postingGate: async () => null }))
vi.mock('@/lib/core/listings', () => ({
  createListingCore: async () => { if (h.createError) throw h.createError; return h.created },
  updateListingCore: async () => h.update,
  setStatusCore: async () => h.status,
  confirmCore: async () => h.confirm,
  deleteListingCore: async () => ({ ok: true, deleted: true }),
  DELETE_HOLD_MESSAGE: {},
}))

const { POST } = await import('./route')
const { PATCH } = await import('./[id]/route')
const { POST: statusPOST } = await import('./[id]/status/route')
const { POST: confirmPOST } = await import('./[id]/confirm/route')
const { PublishBlockedError } = await import('@/lib/publish-guard')
const { LICENCE_CHECK_REQUIRED_COPY, LISTING_CHANGED_COPY } = await import('@/lib/licence-check-copy')

const auth = { authorization: 'Bearer k' }
const params = { params: Promise.resolve({ id: 'L1' }) }
async function json(res: Response) { return { status: res.status, body: (await res.json()) as Row } }
const post = async () => json(await POST(new Request('https://eno.vn/api/v1/listings', {
  method: 'POST', headers: auth,
  body: JSON.stringify({ categorySlug: 'services', subcategorySlug: 'visa-legal', title: 'Vietnam e-visa, 1 hour', price: 500000, attributes: { providerLegalName: 'CÔNG TY TNHH VISA5S.VN', providerLicenceNo: '01-1234/2019/TCDL-GP LHQT' } }),
}) as never))
const patch = async (body: Row) => json(await PATCH(new Request('https://eno.vn/api/v1/listings/L1', { method: 'PATCH', headers: auth, body: JSON.stringify(body) }) as never, params))
const relist = async () => json(await statusPOST(new Request('https://eno.vn/api/v1/listings/L1/status', { method: 'POST', headers: auth, body: JSON.stringify({ status: 'active' }) }) as never, params))
const confirm = async () => json(await confirmPOST(new Request('https://eno.vn/api/v1/listings/L1/confirm', { method: 'POST', headers: auth }) as never, params))

beforeEach(() => {
  h.createError = null
  h.created = { id: 'new', verified: false, held: true }
  h.update = { ok: true }
  h.status = { ok: true, status: 'active' }
  h.confirm = { ok: true, bumped: false }
})

describe('POST /api/v1/listings', () => {
  it('⛔ an e-Visa / Legal & permits create answers 201 { listing: { id, verified: false, held: true } } — not "live"', async () => {
    expect(await post()).toEqual({ status: 201, body: { listing: { id: 'new', verified: false, held: true } } })
  })

  it('provider_licence_required → 422 naming both keys, the two aisles and the inferred-subcategory case', async () => {
    h.createError = new PublishBlockedError('provider_licence_required')
    const r = await post()
    expect(r.status).toBe(422)
    expect(r.body.error.code).toBe('provider_licence_required')
    for (const s of ['attributes.providerLegalName', 'attributes.providerLicenceNo', 'services/visa-legal', 'services/legal-permits', 'subcategorySlug', 'unpublished']) expect(r.body.error.message).toContain(s)
  })

  it('provider_licence_invalid → 422 naming the field and the reason, with `detail` kept for a client that branches on it', async () => {
    h.createError = new PublishBlockedError('provider_licence_invalid', 'providerLicenceNo:personal_id')
    const r = await post()
    expect(r.status).toBe(422)
    expect(r.body.error).toMatchObject({ code: 'provider_licence_invalid', detail: 'providerLicenceNo:personal_id' })
    expect(r.body.error.message).toMatch(/^attributes\.providerLicenceNo cannot be accepted \(personal_id\): .*personal ID/)
  })

  it('a malformed detail still gets a sentence, never "undefined"', async () => {
    h.createError = new PublishBlockedError('provider_licence_invalid', 'nonsense')
    const r = await post()
    expect(r.body.error.message).toBe('attributes.providerLegalName or attributes.providerLicenceNo cannot be accepted as written.')
  })
})

describe('PATCH /api/v1/listings/{id}', () => {
  it('`held` rides on the 200 — an API client must not read a plain success as "still live"', async () => {
    h.update = { ok: true, held: true }
    expect(await patch({ title: 'e-Visa in 3 days' })).toEqual({ status: 200, body: { ok: true, held: true } })
    h.update = { ok: true }
    expect(await patch({ title: 'e-Visa in 3 days' })).toEqual({ status: 200, body: { ok: true } })
  })

  it('provider_licence_required → 422 with the sentence, not the bare code', async () => {
    h.update = { ok: false, code: 400, error: 'provider_licence_required' }
    const r = await patch({ subcategorySlug: 'legal-permits' })
    expect(r.status).toBe(422)
    expect(r.body).toEqual({ error: { code: 'provider_licence_required', message: expect.stringContaining('attributes.providerLicenceNo') } })
  })

  it('provider_licence_invalid → 422 with the field, the reason and `detail` in the envelope', async () => {
    h.update = { ok: false, code: 400, error: 'provider_licence_invalid', detail: 'providerLegalName:contact' }
    const r = await patch({ attributes: {} })
    expect(r.status).toBe(422)
    expect(r.body).toEqual({ error: { code: 'provider_licence_invalid', detail: 'providerLegalName:contact', message: expect.stringMatching(/^attributes\.providerLegalName cannot be accepted \(contact\): /) } })
  })

  it('⛔ listing_changed → 409 (retryable, nothing written) with "reload and try again"', async () => {
    h.update = { ok: false, code: 409, error: 'listing_changed' }
    expect(await patch({ title: 'e-Visa in 3 days' })).toEqual({ status: 409, body: { error: { code: 'listing_changed', message: LISTING_CHANGED_COPY.en } } })
  })

  it('every other refusal keeps its old answer', async () => {
    h.update = { ok: false, code: 400, error: 'title_too_short' }
    expect(await patch({ title: 'ab' })).toEqual({ status: 422, body: { error: { code: 'title_too_short', message: 'title_too_short' } } })
  })
})

describe('POST /api/v1/listings/{id}/status and /confirm — licence_check_required', () => {
  it('⛔ a relist of a listing waiting for eno’s licence check → 409 with the sentence, never the 422 "malformed status"', async () => {
    h.status = { ok: false, code: 409, error: 'licence_check_required' }
    expect(await relist()).toEqual({ status: 409, body: { error: { code: 'licence_check_required', message: LICENCE_CHECK_REQUIRED_COPY.en } } })
  })

  it('⛔ a confirm that would revive one → 409, never the 404 "not found"', async () => {
    h.confirm = { ok: false, code: 409, error: 'licence_check_required' }
    expect(await confirm()).toEqual({ status: 409, body: { error: { code: 'licence_check_required', message: LICENCE_CHECK_REQUIRED_COPY.en } } })
  })
})
