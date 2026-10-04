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
  unblocked: [] as Array<{ blocker: string; handle: string }>,
  rows: [] as Row[],
  keyMissing: false,
  dbDown: false,
}))

vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => h.me, getCurrentProfileId: async () => (h.me?.id as string) ?? null, getAdmin: async () => null }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 0 }) }))
vi.mock('@/lib/db', () => ({
  db: {
    conversation: { findUnique: async (q: { where: { id: string } }) => h.convos[q.where.id] ?? null },
    seller: { findUnique: async (q: { where: { id: string } }) => h.sellers[q.where.id] ?? null },
    profile: { findUnique: async (q: { where: { id: string } }) => (h.profiles.has(q.where.id) ? { id: q.where.id } : null) },
    forumUserBlock: { findMany: async () => h.rows },
  },
}))
vi.mock('@/lib/user-blocks', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  setUserBlock: async (blocker: string, blocked: string, on: boolean, ctx: Row) => { h.blocks.push({ blocker, blocked, on, ctx }) },
  isStaffProfile: async (id: string) => id === 'desk-admin' || id === 'staff-me',
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
  h.unblocked = []
  h.rows = []
  h.keyMissing = false
  h.dbDown = false
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
    expect(h.blocks).toEqual([{ blocker: 'me', blocked: 'them', on: true, ctx: { surface: 'chat', conversationId: 'c1', sellerId: null } }])
  })

  it("refuses someone else's thread", async () => {
    expect((await post({ conversationId: 'c2', blocked: true })).status).toBe(403)
    expect(h.blocks).toEqual([])
  })

  it('a thread with nobody on the other side (support desk) has nobody to block', async () => {
    expect((await post({ conversationId: 'desk', blocked: true })).status).toBe(404)
  })

  it('from a shop: blocks its owner; an ownerless linked shop has nobody to block', async () => {
    expect((await post({ sellerId: 's1', blocked: true })).status).toBe(200)
    expect(h.blocks[0]).toMatchObject({ blocked: 'shop-owner', ctx: { surface: 'storefront', sellerId: 's1' } })
    expect((await post({ sellerId: 'linked', blocked: true })).status).toBe(404)
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

  it('the eno team cannot be blocked (it owns the e-Visa desk and imported shops)', async () => {
    expect(await post({ sellerId: 'desk', blocked: true })).toEqual({ status: 403, body: { error: 'cannot_block_staff' } })
    expect(h.blocks).toEqual([])
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
    expect(await res.json()).toEqual({ enabled: false, blocked: [] })
  })

  it('lists each block by its opaque handle — the blocked profile id never leaves the server (follow-up 3)', async () => {
    h.rows = [{ createdAt: new Date('2026-10-01T00:00:00Z'), blocked: { id: OTHER, displayName: null, email: 'lan.nguyen@example.com', avatarUrl: null, avatarColor: '#111111' } }]
    const res = await GET(new Request('https://www.eno.forum/api/blocks') as never, {} as never)
    const body = await res.json()
    expect(body.enabled).toBe(true)
    expect(body.blocked).toHaveLength(1)
    expect(body.blocked[0]).toMatchObject({ handle: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), blockedAt: '2026-10-01T00:00:00.000Z' })
    expect(Object.keys(body.blocked[0]).sort()).toEqual(['avatarColor', 'avatarUrl', 'blockedAt', 'handle', 'name'])
    expect(JSON.stringify(body)).not.toContain(OTHER)
    // Never the raw email either.
    expect(JSON.stringify(body)).not.toContain('lan.nguyen@example.com')
  })
})
