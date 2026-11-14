import { beforeEach, describe, expect, it, vi } from 'vitest'
import { REVIEW_SEAT_LISTING_COPY } from '@/lib/review-seat-accounts'

/**
 * ⛔ A STORE-REVIEW SEAT'S LISTING ON THE WIRE (round 5, 2026-11-14 — src/lib/review-seat-accounts.ts). The cores decide
 * (core/listings.review-seat.test.ts); these are the doors that answer:
 *   · a relist or a reviving confirm of a seat's listing, any type: 403 `review_seat_listing` — with the neutral line as
 *     `message: { en, vi }` on the session routes (the native dashboards), its English on /api/v1 — never the session
 *     confirm's bare code, the v1 status route's 422 "malformed status" or the v1 confirm route's 404 "not found";
 *   · an edit of a seat's listing that is still not public: `unpublished: true` on the 200 of both PATCH routes (the wizard
 *     goes to the dashboard); every other answer is byte-for-byte what it was.
 */

type Row = Record<string, any>

const h = vi.hoisted(() => ({
  update: { ok: true } as Row,
  status: { ok: true, status: 'active' } as Row,
  confirm: { ok: true, bumped: false } as Row,
}))

vi.mock('@/lib/listing-owner', () => ({ checkListingOwner: async () => ({ ok: true, profileId: 'p1', sellerId: 's1' }) }))
vi.mock('@/lib/api/auth', () => ({
  resolveApiKey: async () => ({ ok: true, auth: { keyId: 'k1', sellerId: 's1', profileId: 'p1', scopes: new Set(['listings:write']) }, rate: { limit: 600, remaining: 599, resetSec: 60, windowSec: 60 } }),
  listingOwnedBy: async () => true,
}))
vi.mock('@/lib/core/listings', () => ({
  updateListingCore: async () => h.update,
  deleteListingCore: async () => ({ ok: true, deleted: true }),
  setStatusCore: async () => h.status,
  confirmCore: async () => h.confirm,
  DELETE_HOLD_MESSAGE: {},
}))
// The rest of the PATCH routes' import graph (GET / DELETE) — not exercised here.
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
const { PATCH: v1PATCH } = await import('@/app/api/v1/listings/[id]/route')
const { POST: v1StatusPOST } = await import('@/app/api/v1/listings/[id]/status/route')
const { POST: v1ConfirmPOST } = await import('@/app/api/v1/listings/[id]/confirm/route')

const params = { params: Promise.resolve({ id: 'L1' }) }
async function json(res: Response) { return { status: res.status, body: (await res.json()) as Row } }
const body = (b: unknown) => ({ method: 'POST', headers: { authorization: 'Bearer k' }, body: JSON.stringify(b) })
const SEAT = { ok: false, code: 403, error: 'review_seat_listing' }

beforeEach(() => {
  h.update = { ok: true }
  h.status = { ok: true, status: 'active' }
  h.confirm = { ok: true, bumped: false }
})

describe('the session routes (web + native dashboards)', () => {
  it('⛔ POST …/status: a relist of a seat\'s listing → 403 review_seat_listing with the neutral line in both languages', async () => {
    h.status = SEAT
    expect(await json(await statusPOST(new Request('https://eno.vn/api/listings/L1/status', body({ status: 'active' })) as never, params)))
      .toEqual({ status: 403, body: { error: 'review_seat_listing', message: REVIEW_SEAT_LISTING_COPY } })
  })

  it('⛔ POST …/confirm: a reviving confirm of a seat\'s listing → 403 review_seat_listing with the same line', async () => {
    h.confirm = SEAT
    expect(await json(await confirmPOST(new Request('https://eno.vn/api/listings/L1/confirm', { method: 'POST' }) as never, params)))
      .toEqual({ status: 403, body: { error: 'review_seat_listing', message: REVIEW_SEAT_LISTING_COPY } })
  })

  it('⛔ PATCH: `unpublished` rides on the 200; `held` and the bare ack are exactly as before', async () => {
    const patch = async () => json(await PATCH(new Request('https://eno.vn/api/listings/L1', { method: 'PATCH', body: JSON.stringify({ title: 'Oak desk' }) }) as never, params))
    h.update = { ok: true, unpublished: true }
    expect(await patch()).toEqual({ status: 200, body: { ok: true, unpublished: true } })
    h.update = { ok: true, held: true }
    expect(await patch()).toEqual({ status: 200, body: { ok: true, held: true } })
    h.update = { ok: true }
    expect(await patch()).toEqual({ status: 200, body: { ok: true } })
  })
})

describe('the partner API (/api/v1)', () => {
  it('⛔ POST /status: 403 review_seat_listing with its sentence — never the 422 "malformed status"', async () => {
    h.status = SEAT
    const r = await json(await v1StatusPOST(new Request('https://eno.vn/api/v1/listings/L1/status', body({ status: 'active' })) as never, params))
    expect(r.status).toBe(403)
    expect(r.body.error).toMatchObject({ code: 'review_seat_listing', message: REVIEW_SEAT_LISTING_COPY.en })
  })

  it('⛔ POST /confirm: 403 review_seat_listing with its sentence — never the 404 "not found"', async () => {
    h.confirm = SEAT
    const r = await json(await v1ConfirmPOST(new Request('https://eno.vn/api/v1/listings/L1/confirm', { method: 'POST', headers: { authorization: 'Bearer k' } }) as never, params))
    expect(r.status).toBe(403)
    expect(r.body.error).toMatchObject({ code: 'review_seat_listing', message: REVIEW_SEAT_LISTING_COPY.en })
  })

  it('⛔ PATCH: `unpublished` rides on the 200; `held` and the bare ack are exactly as before', async () => {
    const patch = async () => json(await v1PATCH(new Request('https://eno.vn/api/v1/listings/L1', { method: 'PATCH', headers: { authorization: 'Bearer k' }, body: JSON.stringify({ title: 'Oak desk' }) }) as never, params))
    h.update = { ok: true, unpublished: true }
    expect(await patch()).toEqual({ status: 200, body: { ok: true, unpublished: true } })
    h.update = { ok: true, held: true }
    expect(await patch()).toEqual({ status: 200, body: { ok: true, held: true } })
    h.update = { ok: true }
    expect(await patch()).toEqual({ status: 200, body: { ok: true } })
  })
})
