import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── /api/saved-listings — a signed-in person's saved listings (owner, 2026-11-09: "3 ok") ──────────────────────────────

const ME = '11111111-1111-4111-8111-111111111111'
const h = vi.hoisted(() => ({
  me: { id: '11111111-1111-4111-8111-111111111111' } as { id: string } | null,
  ids: ['b', 'a'] as string[],
  writes: [] as Array<{ profileId: string; add?: readonly string[]; remove?: readonly string[] }>,
  result: 'ok' as 'ok' | 'limit_reached',
  notStored: [] as string[],
  missing: false,
  boom: false,
}))
vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => h.me, getCurrentProfileId: async () => h.me?.id ?? null, getAdmin: async () => null }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 0 }) }))
const missingTable = () => Object.assign(new Error('relation "SavedListing" does not exist'), { code: 'P2021' })
vi.mock('@/lib/saved-listings', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  savedListingIds: async () => { if (h.missing) throw missingTable(); if (h.boom) throw new Error('db down'); return h.ids },
  writeSavedListings: async (profileId: string, w: { add?: readonly string[]; remove?: readonly string[] }) => {
    if (h.missing) throw missingTable()
    h.writes.push({ profileId, ...w })
    return { result: h.result, notStored: h.notStored }
  },
}))

const { GET, POST } = await import('./route')
const get = () => GET(new Request('https://eno.vn/api/saved-listings'), {} as never)
const post = (body: unknown) => POST(new Request('https://eno.vn/api/saved-listings', { method: 'POST', body: JSON.stringify(body) }), {} as never)

beforeEach(() => { h.me = { id: ME }; h.ids = ['b', 'a']; h.writes = []; h.result = 'ok'; h.notStored = []; h.missing = false; h.boom = false })

describe('GET /api/saved-listings', () => {
  it('a guest gets 401', async () => {
    h.me = null
    const r = await get()
    expect(r.status).toBe(401)
  })
  it('the account\'s ids, naming the account they belong to, never cached anywhere', async () => {
    const r = await get()
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ uid: ME, ids: ['b', 'a'] })
    expect(r.headers.get('cache-control')).toBe('private, no-store')
  })
  it('a database without the table says so — the browser keeps saving on the device', async () => {
    h.missing = true
    const r = await get()
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ uid: ME, ids: [], available: false })
    expect(r.headers.get('cache-control')).toBe('private, no-store')
  })
  it('any other failure is a 500, never an empty list (an empty list would read as "nothing saved")', async () => {
    h.boom = true
    expect((await get()).status).toBe(500)
  })
})

describe('POST /api/saved-listings', () => {
  it('a guest gets 401 and nothing is written', async () => {
    h.me = null
    expect((await post({ uid: ME, add: ['a'] })).status).toBe(401)
    expect(h.writes).toEqual([])
  })
  it('writes for the signed-in account, says which adds it did not keep, never cached', async () => {
    h.notStored = ['held']
    const r = await post({ uid: ME, add: ['a', 'held'], remove: ['b'] })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, notStored: ['held'] })
    expect(r.headers.get('cache-control')).toBe('private, no-store')
    expect(h.writes).toEqual([{ profileId: ME, add: ['a', 'held'], remove: ['b'] }])
  })
  it('⛔ a write meant for another account is refused (409 account_changed) — a sign-in between the tap and the request', async () => {
    const r = await post({ uid: '22222222-2222-4222-8222-222222222222', add: ['a'] })
    expect(r.status).toBe(409)
    expect(await r.json()).toEqual({ error: 'account_changed' })
    expect(h.writes).toEqual([])
  })
  it('refuses an empty write, an id both added and removed, a bad id, more than 200 ids, or no uid', async () => {
    for (const body of [
      { uid: ME },
      { uid: ME, add: [], remove: [] },
      { uid: ME, add: ['a'], remove: ['a'] },
      { uid: ME, add: ['a"b'] },
      { uid: ME, add: Array.from({ length: 201 }, (_, i) => `id${i}`) },
      { add: ['a'] },
      { uid: 'not-a-uuid', add: ['a'] },
    ]) {
      const r = await post(body)
      expect(r.status, JSON.stringify(body).slice(0, 80)).toBe(400)
    }
    expect(h.writes).toEqual([])
  })
  it('past the cap: 409 limit_reached', async () => {
    h.result = 'limit_reached'
    const r = await post({ uid: ME, add: ['a'] })
    expect(r.status).toBe(409)
    expect(await r.json()).toEqual({ error: 'limit_reached' })
  })
  it('no table yet: 503 saved_listings_unavailable', async () => {
    h.missing = true
    const r = await post({ uid: ME, add: ['a'] })
    expect(r.status).toBe(503)
    expect(await r.json()).toEqual({ error: 'saved_listings_unavailable' })
  })
})
