import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── /api/blocks — App Store gate `ugc-safety` (plan R3) ─────────────────────────────────────────────
// The client names a THREAD or a SHOP; the server resolves the person. No profile id is ever taken or
// given: the settings list names a block by an opaque, blocker-bound HANDLE, accepted only to unblock.
// The whole endpoint is a 404 while the gate is off.

type Row = Record<string, unknown>
const h = vi.hoisted(() => ({
  me: { id: 'me' } as Row | null,
  convos: {} as Record<string, Row>,
  sellers: {} as Record<string, Row>,
  profiles: new Set<string>(),
  blocks: [] as Array<{ blocker: string; blocked: string; on: boolean; ctx: Row }>,
  shopBlocks: [] as Array<{ blocker: string; sellerId: string; on: boolean; ctx: Row; opts?: Row }>,
  shopRows: [] as Row[],
  listings: {} as Record<string, Row>,
  hidden: [] as string[],
  shopTableMissing: false,
  shopRowFails: false,
  unblocked: [] as Array<{ blocker: string; handle: string }>,
  rows: [] as Row[],
  keyMissing: false,
  dbDown: false,
  afters: [] as Array<() => unknown>,
  endedBetween: [] as Array<{ a: string; b: string; reason: string }>,
  callsFinished: [] as string[],
}))

vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => h.me, getCurrentProfileId: async () => (h.me?.id as string) ?? null, getAdmin: async () => null }))
// In-app calls (2026-10-21): a block ends any live call between the two — in after(), so the block never waits on it.
vi.mock('next/server', async (orig) => ({ ...(await orig<Record<string, unknown>>()), after: (fn: () => unknown) => { h.afters.push(fn) } }))
vi.mock('@/lib/calls/server/session', () => ({
  endCallsBetween: async (a: string, b: string, reason: string) => { h.endedBetween.push({ a, b, reason }); return [{ id: 'call-1' }] },
}))
vi.mock('@/lib/calls/server/finish', () => ({ afterCallEnded: async (row: { id: string }, reason: string) => { h.callsFinished.push(`${row.id}:${reason}`) } }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 0 }) }))
// A shop the edition hides (the other edition's e-Visa desk) never reaches its Blocked list (opus, review).
vi.mock('@/lib/edition-scope', () => ({ isSellerHiddenHere: async (id: string) => id === 'other-edition-desk' }))
vi.mock('@/lib/db', () => ({
  db: {
    conversation: { findUnique: async (q: { where: { id: string } }) => h.convos[q.where.id] ?? null },
    seller: { findUnique: async (q: { where: { id: string } }) => h.sellers[q.where.id] ?? null },
    listing: { findUnique: async (q: { where: { id: string } }) => h.listings[q.where.id] ?? null },
    sellerBlock: { findMany: async () => h.shopRows },
    profile: { findUnique: async (q: { where: { id: string } }) => (h.profiles.has(q.where.id) ? { id: q.where.id } : null) },
    forumUserBlock: { findMany: async () => h.rows },
  },
}))
vi.mock('@/lib/user-blocks', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  setUserBlock: async (blocker: string, blocked: string, on: boolean, ctx: Row) => { h.blocks.push({ blocker, blocked, on, ctx }) },
  isStaffProfile: async (id: string) => id === 'desk-admin' || id === 'staff-me',
  isShopOnlyBlock: async (ownerId: string | null) => !ownerId || ownerId === 'desk-admin' || ownerId === 'staff-me',
  setSellerBlock: async (blocker: string, sellerId: string, on: boolean, ctx: Row, opts?: Row) => {
    if (h.shopRowFails) throw new Error('db down')
    if (h.shopTableMissing) { const { SellerBlocksMissing } = await orig<{ SellerBlocksMissing: new () => Error }>(); throw new SellerBlocksMissing() }
    h.shopBlocks.push({ blocker, sellerId, on, ctx, ...(opts ? { opts } : {}) })
  },
  hiddenSellerIdsFor: async () => h.hidden,
  unblockByHandle: async (blocker: string, handle: string) => {
    if (h.keyMissing) { const { BlockHandleKeyMissing } = await orig<{ BlockHandleKeyMissing: new () => Error }>(); throw new BlockHandleKeyMissing() }
    if (h.dbDown) throw new Error('db down')
    h.unblocked.push({ blocker, handle })
    return handle === 'K'.repeat(22)
  },
}))

const { POST, GET } = await import('./route')

async function post(body: Row) {
  const res = await POST(new Request('https://www.eno.forum/api/blocks', { method: 'POST', body: JSON.stringify(body) }) as never, {} as never)
  return { status: res.status, body: (await res.json()) as Row }
}

const OTHER = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  h.me = { id: 'me' }
  h.convos = { c1: { buyerProfileId: 'me', sellerProfileId: 'them' }, c2: { buyerProfileId: 'x', sellerProfileId: 'y' }, desk: { buyerProfileId: 'me', sellerProfileId: null } }
  h.sellers = { s1: { ownerId: 'shop-owner' }, linked: { ownerId: null }, mine: { ownerId: 'me' }, desk: { ownerId: 'desk-admin' } }
  h.profiles = new Set([OTHER])
  h.blocks = []
  h.shopBlocks = []
  h.shopRows = []
  h.listings = { l1: { sellerId: 's1' }, l2: { sellerId: 'linked' } }
  h.hidden = []
  h.shopTableMissing = false
  h.shopRowFails = false
  h.unblocked = []
  h.rows = []
  h.keyMissing = false
  h.dbDown = false
  h.afters = []; h.endedBetween = []; h.callsFinished = []
  vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
  // The real blockHandle signs with a key derived from this (user-blocks.ts).
  vi.stubEnv('SUPABASE_SECRET_KEY', 'test-secret-for-block-handles')
})
afterEach(() => vi.unstubAllEnvs())

describe('POST /api/blocks', () => {
  it('is a 404 while the gate is off, and writes nothing', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    expect(await post({ conversationId: 'c1', blocked: true })).toEqual({ status: 404, body: { error: 'blocking_unavailable' } })
    expect(h.blocks).toEqual([])
  })

  it('needs a signed-in user', async () => {
    h.me = null
    expect((await post({ conversationId: 'c1', blocked: true })).status).toBe(401)
  })

  it('from a thread: blocks the OTHER participant', async () => {
    expect(await post({ conversationId: 'c1', blocked: true })).toEqual({ status: 200, body: { blocked: true } })
    expect(h.blocks).toEqual([{ blocker: 'me', blocked: 'them', on: true, ctx: { surface: 'chat', conversationId: 'c1', sellerId: null, listingId: null } }])
  })

  it('⛔ a block ends any live call between the two INSIDE the request; only the revocation + record wait for after()', async () => {
    expect((await post({ conversationId: 'c1', blocked: true })).status).toBe(200)
    expect(h.endedBetween).toEqual([{ a: 'me', b: 'them', reason: 'blocked' }]) // before the response, not after it
    expect(h.callsFinished).toEqual([])
    for (const fn of h.afters) await fn()
    expect(h.callsFinished).toEqual(['call-1:blocked'])
    h.afters = []; h.endedBetween = []
    expect((await post({ conversationId: 'c1', blocked: false })).status).toBe(200)
    expect(h.endedBetween).toEqual([])
    expect(h.afters).toEqual([])
  })

  it("refuses someone else's thread", async () => {
    expect((await post({ conversationId: 'c2', blocked: true })).status).toBe(403)
    expect(h.blocks).toEqual([])
  })

  it('a thread with nobody on the other side (support desk) has nobody to block', async () => {
    expect((await post({ conversationId: 'desk', blocked: true })).status).toBe(404)
  })

  it('from a shop a PERSON runs: blocks that person — and files the shop\'s row (no second note) so its listings hide', async () => {
    expect((await post({ sellerId: 's1', blocked: true })).status).toBe(200)
    expect(h.blocks[0]).toMatchObject({ blocked: 'shop-owner', ctx: { surface: 'storefront', sellerId: 's1', listingId: null } })
    expect(h.shopBlocks).toEqual([{ blocker: 'me', sellerId: 's1', on: true, ctx: { surface: 'storefront', sellerId: 's1', listingId: null }, opts: { note: false } }])
    // Before the DDL the person block still stands.
    h.shopTableMissing = true; h.blocks = []
    expect((await post({ sellerId: 's1', blocked: true })).status).toBe(200)
    expect(h.blocks).toHaveLength(1)
    // An unblock by shop goes through the person (setUserBlock lifts the row itself).
    h.shopTableMissing = false; h.shopBlocks = []
    expect((await post({ sellerId: 's1', blocked: false })).status).toBe(200)
    expect(h.shopBlocks).toEqual([])
  })

  it('⛔ a shop row that does not land (not a missing table) answers 500 AFTER the call ended — the person block stands, a retry is idempotent', async () => {
    h.shopRowFails = true
    expect((await post({ sellerId: 's1', blocked: true })).status).toBe(500)
    expect(h.blocks).toHaveLength(1)
    expect(h.endedBetween).toEqual([{ a: 'me', b: 'shop-owner', reason: 'blocked' }])
  })

  it('a block from a THREAD files no shop row (it would name a buyer\'s shop to the person who blocked them)', async () => {
    expect((await post({ conversationId: 'c1', blocked: true })).status).toBe(200)
    expect(h.shopBlocks).toEqual([])
  })

  it('⛔ the eno team does not shop-block either (a moderator would hide a shop from their own review)', async () => {
    h.me = { id: 'staff-me' }
    expect(await post({ sellerId: 'linked', blocked: true })).toEqual({ status: 403, body: { error: 'cannot_block_staff' } })
    expect(h.shopBlocks).toEqual([])
  })

  it('⛔ an ownerless "Linked shop" is blocked AS A SHOP — the App Store 1.2 rejection of 2026-10-28 — and nobody is person-blocked', async () => {
    expect(await post({ sellerId: 'linked', blocked: true })).toEqual({ status: 200, body: { blocked: true } })
    expect(h.shopBlocks).toEqual([{ blocker: 'me', sellerId: 'linked', on: true, ctx: { surface: 'storefront', sellerId: 'linked', listingId: null } }])
    expect(h.blocks).toEqual([])
    expect(await post({ sellerId: 'linked', blocked: false })).toEqual({ status: 200, body: { blocked: false } })
    expect(h.shopBlocks[1]).toMatchObject({ sellerId: 'linked', on: false })
  })

  it('from a listing page: the note names the listing — only when it really is that shop\'s', async () => {
    expect((await post({ sellerId: 'linked', listingId: 'l2', blocked: true })).status).toBe(200)
    expect(h.shopBlocks[0]!.ctx).toEqual({ surface: 'listing', sellerId: 'linked', listingId: 'l2' })
    expect((await post({ sellerId: 's1', listingId: 'l1', blocked: true })).status).toBe(200)
    expect(h.blocks[0]!.ctx).toMatchObject({ surface: 'listing', sellerId: 's1', listingId: 'l1' })
    h.shopBlocks = []
    // Another shop's listing (or none at all) is not named: the block stands, as a storefront block.
    expect((await post({ sellerId: 'linked', listingId: 'l1', blocked: true })).status).toBe(200)
    expect(h.shopBlocks[0]!.ctx).toEqual({ surface: 'storefront', sellerId: 'linked', listingId: null })
    expect((await post({ sellerId: 'linked', listingId: 'nope', blocked: true })).status).toBe(200)
    expect(h.shopBlocks[1]!.ctx).toMatchObject({ listingId: null })
    // A listing never travels without its shop.
    expect((await post({ conversationId: 'c1', listingId: 'l1', blocked: true })).status).toBe(400)
  })

  it('a shop block before the SellerBlock DDL says "unavailable" rather than pretend', async () => {
    h.shopTableMissing = true
    expect(await post({ sellerId: 'linked', blocked: true })).toEqual({ status: 503, body: { error: 'blocking_unavailable' } })
  })

  it('an unknown shop is a 404', async () => {
    expect((await post({ sellerId: 'ghost', blocked: true })).status).toBe(404)
  })

  it('cannot block yourself', async () => {
    expect(await post({ sellerId: 'mine', blocked: true })).toEqual({ status: 400, body: { error: 'cannot_block_self' } })
  })

  it('a HANDLE may only UNBLOCK, among the caller\'s own blocks; a miss is an honest 404 (the handle is caller-bound, so it is no oracle)', async () => {
    expect(await post({ handle: 'K'.repeat(22), blocked: false })).toEqual({ status: 200, body: { blocked: false } })
    expect(await post({ handle: 'Z'.repeat(22), blocked: false })).toEqual({ status: 404, body: { error: 'not_found' } })
    expect(h.unblocked).toEqual([{ blocker: 'me', handle: 'K'.repeat(22) }, { blocker: 'me', handle: 'Z'.repeat(22) }])
    expect((await post({ handle: 'K'.repeat(22), blocked: true })).status).toBe(400)
    expect(h.blocks).toEqual([])
  })

  it('a profile id is no longer accepted at all, and a malformed handle is a 400', async () => {
    expect((await post({ profileId: OTHER, blocked: false })).status).toBe(400)
    expect((await post({ handle: 'short', blocked: false })).status).toBe(400)
    expect((await post({ handle: 'K'.repeat(21) + '/', blocked: false })).status).toBe(400)
    expect(h.unblocked).toEqual([])
  })

  it('without a signing secret an unblock says it is unavailable instead of claiming success', async () => {
    h.keyMissing = true
    expect(await post({ handle: 'K'.repeat(22), blocked: false })).toEqual({ status: 503, body: { error: 'blocking_unavailable' } })
  })

  it('a database failure is an ordinary 500, not a "no secret" 503', async () => {
    h.dbDown = true
    expect(await post({ handle: 'K'.repeat(22), blocked: false })).toEqual({ status: 500, body: { error: 'internal_error' } })
  })

  it('the eno team cannot be blocked as a PERSON (it owns the e-Visa desk and imported shops) — its shop is blocked as a shop', async () => {
    h.convos.deskThread = { buyerProfileId: 'me', sellerProfileId: 'desk-admin' }
    expect(await post({ conversationId: 'deskThread', blocked: true })).toEqual({ status: 403, body: { error: 'cannot_block_staff' } })
    expect(await post({ sellerId: 'desk', blocked: true })).toEqual({ status: 200, body: { blocked: true } })
    expect(h.blocks).toEqual([])
    expect(h.shopBlocks).toEqual([{ blocker: 'me', sellerId: 'desk', on: true, ctx: { surface: 'storefront', sellerId: 'desk', listingId: null } }])
  })

  it('…and does not block either — its own desk threads would close', async () => {
    h.me = { id: 'staff-me' }
    expect(await post({ sellerId: 's1', blocked: true })).toEqual({ status: 403, body: { error: 'cannot_block_staff' } })
  })

  it('takes exactly one target', async () => {
    expect((await post({ conversationId: 'c1', sellerId: 's1', blocked: true })).status).toBe(400)
    expect((await post({ blocked: true })).status).toBe(400)
  })
})

describe('GET /api/blocks', () => {
  it('says the feature is off while the gate is off', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    const res = await GET(new Request('https://www.eno.forum/api/blocks') as never, {} as never)
    expect(await res.json()).toEqual({ enabled: false, blocked: [], hiddenSellerIds: [] })
  })

  it('lists each block by its opaque handle — the blocked profile id never leaves the server (follow-up 3)', async () => {
    h.rows = [{ createdAt: new Date('2026-10-01T00:00:00Z'), blocked: { id: OTHER, displayName: null, email: 'lan.nguyen@example.com', avatarUrl: null, avatarColor: '#111111' } }]
    const res = await GET(new Request('https://www.eno.forum/api/blocks') as never, {} as never)
    const body = await res.json()
    expect(body.enabled).toBe(true)
    expect(body.blocked).toHaveLength(1)
    expect(body.blocked[0]).toMatchObject({ handle: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), blockedAt: '2026-10-01T00:00:00.000Z' })
    expect(Object.keys(body.blocked[0]).sort()).toEqual(['avatarColor', 'avatarUrl', 'blockedAt', 'handle', 'kind', 'name'])
    expect(body.blocked[0].kind).toBe('person')
    expect(JSON.stringify(body)).not.toContain(OTHER)
    // Never the raw email either.
    expect(JSON.stringify(body)).not.toContain('lan.nguyen@example.com')
  })

  it('?only=ids answers the hidden shops alone — the sync every signed-in load makes skips the list', async () => {
    h.hidden = ['linked']
    const res = await GET(new Request('https://www.eno.forum/api/blocks?only=ids') as never, {} as never)
    expect(await res.json()).toEqual({ enabled: true, hiddenSellerIds: ['linked'] })
  })

  it('lists SHOP blocks beside the people, newest first, each with its own handle — and the shop ids to hide', async () => {
    h.rows = [{ createdAt: new Date('2026-10-01T00:00:00Z'), blocked: { id: OTHER, displayName: 'Lan', email: null, avatarUrl: null, avatarColor: null } }]
    h.shopRows = [
      { createdAt: new Date('2026-10-02T00:00:00Z'), seller: { id: 'linked', ownerId: null, name: "Jan's Motorbike", avatarUrl: null, avatarColor: '#dc2626' } },
      // The row beside Lan's own person block is Lan's — listed once, as her.
      { createdAt: new Date('2026-10-01T00:00:00Z'), seller: { id: 'lans-shop', ownerId: OTHER, name: "Lan's shop", avatarUrl: null, avatarColor: null } },
      // ⛔ The other edition's e-Visa desk, blocked there: not named here.
      { createdAt: new Date('2026-10-03T00:00:00Z'), seller: { id: 'other-edition-desk', ownerId: 'desk-admin', name: 'e-Visa desk', avatarUrl: null, avatarColor: null } },
    ]
    h.hidden = ['linked', 's1']
    const body = await (await GET(new Request('https://www.eno.forum/api/blocks') as never, {} as never)).json()
    expect(body.blocked.map((b: Row) => [b.kind, b.name])).toEqual([['shop', "Jan's Motorbike"], ['person', 'Lan']])
    expect(body.blocked[0].handle).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(body.blocked[0].handle).not.toBe(body.blocked[1].handle)
    expect(body.hiddenSellerIds).toEqual(['linked', 's1'])
    expect(JSON.stringify(body)).not.toContain(OTHER)
    expect(JSON.stringify(body)).not.toContain('e-Visa desk')
  })
})
