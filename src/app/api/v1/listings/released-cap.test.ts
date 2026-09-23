import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/v1/listings — THE RELEASED-CHARGE CAP ON THE PARTNER CREATE (owner, 2026-09-24).
 *
 * createListingCore refuses a create past the active-listing cap a released scam charge carries with
 * PublishBlockedError('released_charge_listing_cap') (the rule: src/lib/core/released-charge-cap.test.ts).
 * This route must answer it as the ACCOUNT limit it is — 403 with the code and a sentence naming the
 * limit — not as the 422 "remove phone numbers…" its content-refusal arm would otherwise produce.
 */

type Row = Record<string, any>
const h = vi.hoisted(() => ({ createError: null as Error | null }))

vi.mock('@/lib/api/auth', () => ({
  resolveApiKey: async () => ({ ok: true, auth: { keyId: 'k1', sellerId: 's1', profileId: 'p1', scopes: new Set(['listings:write']) }, rate: { limit: 600, remaining: 599, resetSec: 60, windowSec: 60 } }),
}))
vi.mock('@/lib/api/idempotency', () => ({
  withIdempotency: async (_req: unknown, _key: unknown, _rate: unknown, fn: () => Promise<{ status: number; body: unknown }>) => {
    const out = await fn()
    return Response.json(out.body, { status: out.status })
  },
}))
vi.mock('@/lib/db', () => ({
  db: {
    category: { findUnique: async () => ({ id: 'c1', slug: 'phones', name: 'Phones', nameVi: 'Điện thoại' }) },
    seller: { findUnique: async () => ({ id: 's1', ownerId: 'p1', trustTier: 'restricted', trustScore: 20, phone: null }) },
  },
}))
vi.mock('@/lib/serialize', () => ({ serializeListing: () => ({}) }))
vi.mock('@/lib/enforcement', () => ({ postingGate: async () => null }))
vi.mock('@/lib/core/listings', () => ({
  createListingCore: async () => { if (h.createError) throw h.createError; return { id: 'new', verified: true } },
}))

const { POST } = await import('./route')
const { PublishBlockedError } = await import('@/lib/publish-guard')

const post = async () => {
  const res = await POST(new Request('https://eno.vn/api/v1/listings', {
    method: 'POST', headers: { authorization: 'Bearer k' },
    body: JSON.stringify({ categorySlug: 'phones', title: 'A phone', price: 100000 }),
  }) as never)
  return { status: res.status, body: await res.json() as Row }
}

beforeEach(() => { h.createError = null })

describe('POST /api/v1/listings', () => {
  it('released_charge_listing_cap → 403 with the code and a sentence naming the limit', async () => {
    h.createError = new PublishBlockedError('released_charge_listing_cap')
    const r = await post()
    expect(r.status).toBe(403)
    expect(r.body.error).toMatchObject({ code: 'released_charge_listing_cap', message: expect.stringContaining('at most 10 active listings') })
  })

  it('account_restricted is still the 403 it was', async () => {
    h.createError = new PublishBlockedError('account_restricted')
    const r = await post()
    expect(r.status).toBe(403)
    expect(r.body.error).toMatchObject({ code: 'account_restricted' })
  })

  it('a content refusal is still the 422', async () => {
    h.createError = new PublishBlockedError('photos_min')
    expect((await post()).status).toBe(422)
  })

  it('success is the 201', async () => {
    expect((await post()).status).toBe(201)
  })
})
