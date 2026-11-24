import { beforeEach, describe, expect, it, vi } from 'vitest'

// GET /api/listings/[id]/status — the OWNER's view of a listing the public page will not show (owner, 2026-11-24).
const h = vi.hoisted(() => ({ owner: { ok: true, sellerId: 's1', profileId: 'p1' } as unknown, row: null as null | Record<string, unknown>, viewable: true }))
vi.mock('@/lib/listing-owner', () => ({ checkListingOwner: async () => h.owner }))
vi.mock('@/lib/db', () => ({ db: { listing: { findFirst: async () => h.row } } }))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: object) => w }))
vi.mock('@/lib/core/listings', () => ({ setStatusCore: vi.fn() }))
vi.mock('@/app/[lang]/listings/[id]/(pdp)/get-listing', () => ({ isListingViewable: async () => h.viewable }))

const { GET } = await import('./route')
const get = async () => GET(new Request('https://eno.vn/api/listings/l1/status') as never, { params: Promise.resolve({ id: 'l1' }) })

describe('GET /api/listings/[id]/status', () => {
  beforeEach(() => { h.owner = { ok: true, sellerId: 's1', profileId: 'p1' }; h.row = null; h.viewable = true })

  it('an active, verified row the listing page itself will not show (its own rule) reads off, never live', async () => {
    h.row = { status: 'active', verified: true, identityHold: false, verificationNotes: null }
    h.viewable = false
    expect(await (await get()).json()).toEqual({ state: 'off' })
  })

  it.each([
    [{ status: 'active', verified: false, identityHold: false, verificationNotes: null }, 'pending'],
    [{ status: 'active', verified: false, identityHold: true, verificationNotes: null }, 'held'],
    [{ status: 'active', verified: false, identityHold: false, verificationNotes: 'licence:held' }, 'held'],
    [{ status: 'hidden', verified: true, identityHold: false, verificationNotes: null }, 'hidden'],
    [{ status: 'sold', verified: true, identityHold: false, verificationNotes: null }, 'sold'],
    [{ status: 'expired', verified: true, identityHold: false, verificationNotes: null }, 'off'],
    [{ status: 'active', verified: true, identityHold: false, verificationNotes: null }, 'live'],
  ])('row %o → %s, private and uncached', async (row, state) => {
    h.row = row
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ state })
    expect(res.headers.get('cache-control')).toBe('private, no-store')
  })

  it('401 when signed out; every other refusal (not theirs, no shop, gone) is the same 404 — no probing for hidden listings', async () => {
    h.owner = { ok: false, code: 401, error: 'auth_required' }
    expect((await get()).status).toBe(401)
    for (const [code, error] of [[403, 'forbidden'], [403, 'no_storefront'], [404, 'not_found']] as const) {
      h.owner = { ok: false, code, error }
      const res = await get()
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'not_found' })
    }
  })
})
