import { beforeEach, describe, expect, it, vi } from 'vitest'

// POST /api/admin/listings/photo-override — "Photo is fine" (2026-11-15, plan A13): the human route against a wrong
// refusal of a listing photo. Admin only; only for a key the check held or removed ON THIS LISTING; the override and the
// restore in one transaction (listing-photo-pass.test.ts), then the pass again (which releases a held listing whose photos
// are now all fine).
const LISTING = 'cmv6pv9yh002p01o3k4wh2ora'
const h = vi.hoisted(() => ({
  admin: 'mod@eno.vn' as string | null,
  exists: true,
  audits: [] as Array<Record<string, unknown>>,
  order: [] as string[],
  written: [] as Array<Record<string, unknown>>,
  restores: [] as Array<string[] | null>,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin', () => ({ getAdmin: async () => h.admin, getCurrentProfile: async () => null, getCurrentProfileId: async () => null, isAdminEmail: () => true }))
vi.mock('@/lib/db', () => ({
  db: {
    listing: { findFirst: async () => (h.exists ? { id: LISTING } : null) },
    complianceAudit: { findMany: async () => h.audits },
  },
}))
vi.mock('@/lib/compliance/audit', () => ({ appendAudit: async (_tx: unknown, input: Record<string, unknown>) => { h.written.push(input) } }))
vi.mock('@/lib/listing-photo-pass', () => ({
  restoreStrippedPhotos: async (id: string, keys: string[], admin: string) => { h.order.push(`restore:${id}:${keys.join(',')}:${admin}`); return h.restores.length ? h.restores.shift()! : [] },
  photoPassById: async (id: string, lane: string) => { h.order.push(`pass:${id}:${lane}`); return { plan: { release: true }, dryRun: false, wrote: ['released'] } },
}))

const { POST } = await import('./route')
const call = (body: unknown) => POST(new Request('https://eno.vn/api/admin/listings/photo-override', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://eno.vn' }, body: JSON.stringify(body) }) as never, {} as never)
const KEY = 'affiliate/m/1791898094623-rh7bov-hab12.webp'
const HELD = { action: 'listing.photo.held', detail: { wasPublic: true, parked: false, photos: [{ i: 0, key: KEY, rule: 'flyer' }] } }
const STRIPPED = { action: 'listing.photo.stripped', detail: { before: ['u0', 'u1'], removed: [{ i: 1, url: 'u1', key: 'b.webp', rule: 'contact' }] } }

beforeEach(() => { Object.assign(h, { admin: 'mod@eno.vn', exists: true, audits: [HELD, STRIPPED], order: [], written: [], restores: [] }) })

describe('POST /api/admin/listings/photo-override', () => {
  it('a held photo: the override and restore for THIS listing, actor the admin — then the pass again', async () => {
    const res = await call({ listingId: LISTING, key: KEY })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, restored: 0, pass: { dryRun: false, wrote: ['released'] } })
    expect(h.order).toEqual([`restore:${LISTING}:${KEY}:mod@eno.vn`, `pass:${LISTING}:pass`])
  })
  it('a removed photo goes back (restoreStrippedPhotos), and a restore that lost a race is read again once', async () => {
    h.restores = [null, ['u1']]
    const res = await call({ listingId: LISTING, key: 'b.webp' })
    expect(await res.json()).toMatchObject({ ok: true, restored: 1 })
    expect(h.order.filter((o) => o.startsWith('restore'))).toHaveLength(2)
  })
  it('⛔ a restore that keeps losing → 409 retry; no override is written outside it, nothing else runs', async () => {
    h.restores = [null, null]
    expect((await call({ listingId: LISTING, key: 'b.webp' })).status).toBe(409)
    expect(h.order.some((o) => o.startsWith('pass'))).toBe(false)
    expect(h.written).toEqual([])
  })
  it('⛔ only a key the check held or removed on THIS listing — 404 otherwise, nothing written', async () => {
    expect((await call({ listingId: LISTING, key: 'never-refused.webp' })).status).toBe(404)
    h.exists = false
    expect((await call({ listingId: LISTING, key: KEY })).status).toBe(404)
    expect(h.order).toEqual([])
  })
  it('⛔ not an admin → 403; a malformed id or key → 400', async () => {
    h.admin = null
    expect((await call({ listingId: LISTING, key: KEY })).status).toBe(403)
    h.admin = 'mod@eno.vn'
    expect((await call({ listingId: 'not a listing', key: KEY })).status).toBe(400)
    expect((await call({ listingId: LISTING, key: '../etc/passwd' })).status).toBe(400)
    expect((await call({ listingId: LISTING, key: 'a/../b.webp' })).status).toBe(400)
    expect(h.order).toEqual([])
  })
  it('⛔ a UUID listing id is a listing id too (gate review): the appeal reaches it', async () => {
    const res = await call({ listingId: '0b9c6c55-2f0e-4c1e-9a43-7d2b1f6a9e10', key: KEY })
    expect(res.status).not.toBe(400)
  })
})
