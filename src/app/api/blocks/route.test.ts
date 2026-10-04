import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ── /api/blocks — App Store gate `ugc-safety` (plan R3) ─────────────────────────────────────────────
// The client names a THREAD or a SHOP; the server resolves the person. A profile id is accepted only
// for an existing profile (the settings list), and the whole endpoint is a 404 while the gate is off.

type Row = Record<string, unknown>
const h = vi.hoisted(() => ({
  me: { id: 'me' } as Row | null,
  convos: {} as Record<string, Row>,
  sellers: {} as Record<string, Row>,
  profiles: new Set<string>(),
  blocks: [] as Array<{ blocker: string; blocked: string; on: boolean; ctx: Row }>,
}))

vi.mock('@/lib/admin', () => ({ getCurrentProfile: async () => h.me, getCurrentProfileId: async () => (h.me?.id as string) ?? null, getAdmin: async () => null }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, resetSec: 0 }) }))
vi.mock('@/lib/db', () => ({
  db: {
    conversation: { findUnique: async (q: { where: { id: string } }) => h.convos[q.where.id] ?? null },
    seller: { findUnique: async (q: { where: { id: string } }) => h.sellers[q.where.id] ?? null },
    profile: { findUnique: async (q: { where: { id: string } }) => (h.profiles.has(q.where.id) ? { id: q.where.id } : null) },
    forumUserBlock: { findMany: async () => [] },
  },
}))
vi.mock('@/lib/user-blocks', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  setUserBlock: async (blocker: string, blocked: string, on: boolean, ctx: Row) => { h.blocks.push({ blocker, blocked, on, ctx }) },
  isStaffProfile: async (id: string) => id === 'desk-admin' || id === 'staff-me',
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
  vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
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

  it('a profile id may only UNBLOCK, and answers the same whether or not the id exists (no oracle)', async () => {
    expect(await post({ profileId: OTHER, blocked: false })).toEqual({ status: 200, body: { blocked: false } })
    expect(h.blocks[0]).toMatchObject({ blocked: OTHER, on: false })
    expect(await post({ profileId: '22222222-2222-4222-8222-222222222222', blocked: false })).toEqual({ status: 200, body: { blocked: false } })
    expect((await post({ profileId: OTHER, blocked: true })).status).toBe(400)
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
})
