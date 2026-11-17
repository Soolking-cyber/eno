import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * END TO END through the real token check: a person-only sign-in grant (no shop — ApiKey.sellerId NULL, token sid '')
 * is accepted at the MCP resource while the account may connect, and ends the moment it may not (2026-11-17).
 */
const h = vi.hoisted(() => ({
  grant: { revokedAt: null as Date | null, createdAt: new Date(), profileId: 'p1', sellerId: null as string | null },
  profile: { accountType: 'personal', enforcementState: 'good_standing' } as { accountType: string; enforcementState: string } | null,
  revoked: 0,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, limit: 600, remaining: 599, resetSec: 60 }), kv: {} }))
vi.mock('@/lib/db', () => ({
  db: {
    apiKey: {
      findUnique: async () => h.grant,
      updateMany: async () => { h.revoked++; return { count: 1 } },
    },
    profile: { findUnique: async () => h.profile },
    seller: { findUnique: async () => null },
  },
}))

import { resolveApiKey } from './auth'
import { issueAccessToken } from './oauth'
import { MCP_RESOURCE } from './oauth-grant'

const now = () => Math.floor(Date.now() / 1000)
const tokenReq = () => new Request('https://eno.vn/api/mcp', {
  headers: { authorization: `Bearer ${issueAccessToken({ keyId: 'k1', sellerId: '', profileId: 'p1', scopes: ['messages:read', 'messages:write'], aud: MCP_RESOURCE }, now())}` },
})

beforeEach(() => {
  h.grant = { revokedAt: null, createdAt: new Date(), profileId: 'p1', sellerId: null }
  h.profile = { accountType: 'personal', enforcementState: 'good_standing' }
  h.revoked = 0
})

describe('resolveApiKey — a person-only grant', () => {
  it('is live for an account that may connect: sellerId \'\', the chat scopes', async () => {
    const r = await resolveApiKey(tokenReq(), undefined, { resource: MCP_RESOURCE })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.auth.sellerId).toBe('')
      expect([...r.auth.scopes].sort()).toEqual(['messages:read', 'messages:write'])
    }
  })
  it('ends, and is revoked, the moment the account is suspended', async () => {
    h.profile = { accountType: 'personal', enforcementState: 'suspended' }
    const r = await resolveApiKey(tokenReq(), undefined, { resource: MCP_RESOURCE })
    expect(r.ok).toBe(false)
    expect(h.revoked).toBe(1)
  })
  it('is never a REST token (no resource: the audience check refuses it first)', async () => {
    expect((await resolveApiKey(tokenReq(), 'listings:read')).ok).toBe(false)
  })
})
