import { describe, expect, it, vi, beforeEach } from 'vitest'

/** Settings › Privacy › Connected apps: one row per app, this account's only; Disconnect ends every grant of that app. */
const h = vi.hoisted(() => ({
  me: 'p1' as string | null,
  rows: [] as Record<string, unknown>[],
  updates: [] as { where: Record<string, unknown> }[],
}))
vi.mock('@/lib/admin', () => ({ getAdmin: async () => null, getCurrentProfile: async () => null, getCurrentProfileId: async () => h.me }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, limit: 1, remaining: 1, resetSec: 1 }), kv: {} }))
vi.mock('@/lib/db', () => ({
  db: {
    apiKey: {
      findMany: async () => h.rows,
      updateMany: async (a: { where: Record<string, unknown> }) => { h.updates.push(a); return { count: 2 } },
    },
  },
}))

import { GET } from './route'
import { DELETE } from './[app]/route'

const day = (d: string) => new Date(`2026-11-${d}T00:00:00Z`)
beforeEach(() => {
  h.me = 'p1'; h.updates = []
  h.rows = [
    { prefix: 'oag_aaaaaaaaaa111111111111', name: 'Claude (signed in 2026-11-17)', scopes: 'messages:read messages:write', sellerId: null, createdAt: day('17'), lastUsedAt: day('17'), revokedAt: null },
    { prefix: 'oag_aaaaaaaaaa222222222222', name: 'Claude (signed in 2026-11-10)', scopes: 'messages:read', sellerId: null, createdAt: day('10'), lastUsedAt: null, revokedAt: null },
    { prefix: 'oag_bbbbbbbbbb333333333333', name: 'ChatGPT (signed in 2026-11-12)', scopes: 'listings:read', sellerId: 's1', createdAt: day('12'), lastUsedAt: day('15'), revokedAt: null },
  ]
})

describe('GET /api/connected-apps', () => {
  it('groups grants by app: the name without its "(signed in …)", every scope, the first connection, the last use', async () => {
    const body = await (await GET(new Request('https://eno.vn/api/connected-apps'))).json()
    expect(body.apps).toEqual([
      { id: 'aaaaaaaaaa', name: 'Claude', scopes: ['messages:read', 'messages:write'], shop: false, connectedAt: day('10').toISOString(), lastUsedAt: day('17').toISOString() },
      { id: 'bbbbbbbbbb', name: 'ChatGPT', scopes: ['listings:read'], shop: true, connectedAt: day('12').toISOString(), lastUsedAt: day('15').toISOString() },
    ])
  })
  it('signed out → 401', async () => {
    h.me = null
    expect((await GET(new Request('https://eno.vn/api/connected-apps'))).status).toBe(401)
  })
})

describe('DELETE /api/connected-apps/<app>', () => {
  it('revokes every live grant of that app on THIS account only', async () => {
    const res = await DELETE(new Request('https://eno.vn/api/connected-apps/aaaaaaaaaa', { method: 'DELETE' }), { params: Promise.resolve({ app: 'aaaaaaaaaa' }) })
    expect(await res.json()).toEqual({ disconnected: 2 })
    expect(h.updates[0].where).toMatchObject({ profileId: 'p1', prefix: { startsWith: 'oag_aaaaaaaaaa' } })
  })
  it('a pending sign-in (Allow pressed, code not yet redeemed) is revoked too, so the redemption cannot reconnect it', async () => {
    await DELETE(new Request('https://eno.vn/api/connected-apps/aaaaaaaaaa', { method: 'DELETE' }), { params: Promise.resolve({ app: 'aaaaaaaaaa' }) })
    expect(h.updates[0].where.OR).toEqual([{ revokedAt: null }, { revokedAt: new Date(0) }])
  })

  it('refuses anything but a 10-hex app id', async () => {
    const res = await DELETE(new Request('https://eno.vn/api/connected-apps/x', { method: 'DELETE' }), { params: Promise.resolve({ app: '../x' }) })
    expect(res.status).toBe(400)
    expect(h.updates).toEqual([])
  })
})
