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
vi.mock('@/lib/taxonomy', () => ({ migrateLegacyCategoryParams: (p: URLSearchParams) => p }))
vi.mock('@/lib/feed-diversity', () => ({}))
vi.mock('@/lib/feed-window', () => ({}))
vi.mock('@/lib/edition-scope', () => ({}))
vi.mock('@/lib/serialize', () => ({}))
vi.mock('@/lib/translate', () => ({}))
vi.mock('@/lib/facet-counts', () => ({}))
vi.mock('./semantic-rank', () => ({}))
vi.mock('@/lib/price-histogram', () => ({}))

import { NextRequest } from 'next/server'
const { POST } = await import('./route')
const { PublishBlockedError } = await import('@/lib/publish-guard')

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
})
