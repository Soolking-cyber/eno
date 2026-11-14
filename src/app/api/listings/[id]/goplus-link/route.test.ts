import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── GET /api/listings/[id]/goplus-link — the GoPlus room's own page, for the GoPlus account and eno's admins ONLY ──────
// (owner, 2026-10-30: "available only for admins goplus email and suport email … user shouldnt see the links").

const ROOM_ID = 'd1c036ae6826f5254ba9e8d9'
const ROOM = `https://goplus.com.vn/phong/${ROOM_ID}`
const h = vi.hoisted(() => ({
  userId: 'renter' as string | null,
  claimsAdmin: false,
  admin: null as string | null,
  getAdminCalls: 0,
  listing: null as null | { externalId: string | null; seller: { ownerId: string | null; officialPartner: boolean } },
  where: null as unknown,
  enoRun: false,
}))

vi.mock('@/lib/admin', () => ({
  getCurrentProfileId: async () => h.userId,
  getCurrentProfile: async () => (h.userId ? { id: h.userId, email: 'x@y.z' } : null),
  isCurrentUserAdminByClaims: async () => h.claimsAdmin,
  getAdmin: async () => { h.getAdminCalls++; return h.admin },
}))
vi.mock('@/lib/db', () => ({
  db: { listing: { findFirst: async (args: { where: unknown }) => { h.where = args.where; return h.listing } } },
}))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: Record<string, unknown>) => ({ ...w, editionScoped: true }) }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, remaining: 59 }) }))

// The pinned-pair check, switchable per test (src/lib/eno-run-partners.ts ships with no pairs).
vi.mock('@/lib/eno-run-partners', async (orig) => ({ ...(await orig<typeof import('@/lib/eno-run-partners')>()), isEnoRunPartner: () => h.enoRun }))

const { GET } = await import('./route')
const { GOPLUS_ROOM_PAGE } = await import('@/components/marketplace/goplus-room-link')

const call = async (id = 'L1') => {
  const res = await GET(new Request(`http://x/api/listings/${id}/goplus-link`), { params: Promise.resolve({ id }) })
  return { status: res.status, cache: res.headers.get('cache-control'), body: await res.json() }
}
const goplusRoom = (over: Partial<{ ownerId: string | null; officialPartner: boolean; externalId: string | null }> = {}) => ({
  externalId: 'externalId' in over ? over.externalId! : `goplus:${ROOM_ID}`,
  seller: { ownerId: 'ownerId' in over ? over.ownerId! : 'goplus-owner', officialPartner: over.officialPartner ?? true },
})

beforeEach(() => {
  h.enoRun = false
  h.userId = 'renter'
  h.claimsAdmin = false
  h.admin = null
  h.getAdminCalls = 0
  h.listing = goplusRoom()
  h.where = null
})

describe('who is told the URL', () => {
  it('the storefront\'s own account (the GoPlus account): the room on goplus.com.vn, never stored by any cache', async () => {
    h.userId = 'goplus-owner'
    const r = await call()
    expect(r).toEqual({ status: 200, cache: 'private, no-store', body: { url: ROOM, kind: 'goplus' } })
    expect(h.getAdminCalls).toBe(0)
    // The address the server builds (the real goplusRoomPageUrl) is the one shape the link will show (opus, round 2).
    expect(GOPLUS_ROOM_PAGE.test(r.body.url)).toBe(true)
  })

  it('an admin (ADMIN_EMAILS, confirmed by getAdmin — the claim check alone opens nothing)', async () => {
    h.claimsAdmin = true
    h.admin = 'support@eno.forum'
    expect((await call()).body).toEqual({ url: ROOM, kind: 'goplus' })
    h.admin = null // the claims say admin, the auth server no longer does
    expect((await call()).body).toEqual({ url: null, kind: null })
  })

  it('⛔ anyone else — the renter in the chat, any visitor: null, with the same no-store, and no auth round trip', async () => {
    expect(await call()).toEqual({ status: 200, cache: 'private, no-store', body: { url: null, kind: null } })
    expect(h.getAdminCalls).toBe(0)
  })

  it('a guest: 401, no URL', async () => {
    h.userId = null
    const r = await call()
    expect(r.status).toBe(401)
    expect(JSON.stringify(r.body)).not.toContain('goplus.com.vn')
  })
})

describe('what counts as a GoPlus room', () => {
  it('not an official partner\'s storefront, or not a goplus:<24 hex> externalId: null even for the owner and an admin', async () => {
    h.claimsAdmin = true
    h.admin = 'support@eno.forum'
    for (const listing of [goplusRoom({ officialPartner: false }), goplusRoom({ externalId: 'nhatot:123' }), goplusRoom({ externalId: null }), goplusRoom({ externalId: 'goplus:not-a-room' })]) {
      h.listing = listing
      h.userId = 'goplus-owner'
      expect((await call()).body).toEqual({ url: null, kind: null })
    }
  })

  it('a listing this edition does not carry, or none at all: null — looked up through scopedListingWhere', async () => {
    h.listing = null
    expect((await call('L9')).body).toEqual({ url: null, kind: null })
    expect(h.where).toEqual({ id: 'L9', editionScoped: true })
  })
})

// Owner 2026-11-14: "only admins should see the link to purchase devices for users … and send in chat if needed".
describe('an eno-run partner\'s staff-only purchase link', () => {
  const LINK = 'https://go.isclix.com/deep_link/7053736680188167797/4842412845025484719?url=https%3A%2F%2Fcellphones.com.vn%2Fx'
  const partnerRow = (over: Partial<{ url: string }> = {}) => ({ externalId: 'sku-1', sellerId: 'cps', seller: { ownerId: 'eno-login', officialPartner: true }, purchaseLink: { url: over.url ?? LINK } })
  beforeEach(() => { h.enoRun = true })
  it('its own eno-held login gets the purchase link, kind "purchase", never cached', async () => {
    h.userId = 'eno-login'; h.listing = partnerRow() as never
    expect(await call()).toEqual({ status: 200, cache: 'private, no-store', body: { url: LINK, kind: 'purchase' } })
  })
  it('an admin gets it too', async () => {
    h.userId = 'staff'; h.claimsAdmin = true; h.admin = 'support@eno.forum'; h.listing = partnerRow() as never
    expect((await call()).body).toEqual({ url: LINK, kind: 'purchase' })
  })
  it('⛔ any other viewer — a buyer in the chat — gets nothing', async () => {
    h.userId = 'buyer'; h.listing = partnerRow() as never
    expect((await call()).body).toEqual({ url: null, kind: null })
  })
  it('⛔ not an eno-run partner (no pinned pair): nothing, whoever asks', async () => {
    h.enoRun = false; h.userId = 'eno-login'; h.listing = partnerRow() as never
    expect((await call()).body).toEqual({ url: null, kind: null })
  })
  it('⛔ a stored url that is not an AccessTrade link host is never answered', async () => {
    h.userId = 'eno-login'; h.listing = partnerRow({ url: 'https://evil.example/x' }) as never
    expect((await call()).body).toEqual({ url: null, kind: null })
  })
})
