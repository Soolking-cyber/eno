import { describe, expect, it, vi, beforeEach } from 'vitest'

/** Who a sign-in connects (owner 2026-11-17: "ok to agents for all") — connectTarget, grantEligible, alreadyGranted. */
const h = vi.hoisted(() => ({
  profile: { accountType: 'business', enforcementState: 'good_standing' } as { accountType: string; enforcementState: string } | null,
  shop: { id: 's1', name: 'Shop' } as { id: string; name: string } | null,
  grants: [] as { scopes: string }[],
  lastWhere: null as unknown,
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) }))
vi.mock('@/lib/db', () => ({
  db: {
    profile: { findUnique: async () => h.profile },
    seller: { findUnique: async () => h.shop },
    apiKey: { findMany: async ({ where }: { where: unknown }) => { h.lastWhere = where; return h.grants } },
  },
}))

import { alreadyGranted, connectTarget, grantEligible, clientBinding, GRANT_PREFIX } from './oauth-grant'

const SHOP = ['listings:read', 'listings:write', 'analytics:read']
const CHAT = ['messages:read', 'messages:write']

beforeEach(() => {
  h.profile = { accountType: 'business', enforcementState: 'good_standing' }
  h.shop = { id: 's1', name: 'Shop' }
  h.grants = []
})

describe('connectTarget', () => {
  it('a business with a shop gets its shop, with everything asked', async () => {
    expect(await connectTarget('p1', [...SHOP, ...CHAT])).toEqual({ ok: true, kind: 'shop', shop: { id: 's1', name: 'Shop' }, scopes: [...SHOP, ...CHAT], narrowed: false })
  })
  it('chat-only asked → the person alone, for ANY account (a business too, so a type switch never cuts it)', async () => {
    expect(await connectTarget('p1', CHAT)).toEqual({ ok: true, kind: 'person', scopes: CHAT, narrowed: false })
    h.profile = { accountType: 'personal', enforcementState: 'good_standing' }; h.shop = null
    expect(await connectTarget('p1', CHAT)).toEqual({ ok: true, kind: 'person', scopes: CHAT, narrowed: false })
  })
  it('no shop, shop + chat asked → the person with the chat scopes only (the screen says so)', async () => {
    h.profile = { accountType: 'personal', enforcementState: 'good_standing' }; h.shop = null
    expect(await connectTarget('p1', [...SHOP, ...CHAT])).toEqual({ ok: true, kind: 'person', scopes: CHAT, narrowed: true })
  })
  it('no shop and no chat asked → today\'s refusal; a held or suspended account → restricted, whatever was asked', async () => {
    h.profile = { accountType: 'personal', enforcementState: 'good_standing' }; h.shop = null
    expect(await connectTarget('p1', SHOP)).toEqual({ ok: false, reason: 'not_business' })
    h.profile = { accountType: 'personal', enforcementState: 'suspended' }
    expect(await connectTarget('p1', CHAT)).toEqual({ ok: false, reason: 'restricted' })
    expect(await connectTarget('p1', [...SHOP, ...CHAT])).toEqual({ ok: false, reason: 'restricted' })
  })
})

describe('grantEligible', () => {
  it('a person-only grant lives while the account may connect; a shop grant while it still owns THAT shop', async () => {
    h.profile = { accountType: 'personal', enforcementState: 'good_standing' }; h.shop = null
    expect(await grantEligible('p1', null)).toBe(true)
    expect(await grantEligible('p1', 's1')).toBe(false)
    h.profile = { accountType: 'personal', enforcementState: 'held' }
    expect(await grantEligible('p1', null)).toBe(false)
    h.profile = null
    expect(await grantEligible('p1', null)).toBe(false)
    h.profile = { accountType: 'business', enforcementState: 'good_standing' }; h.shop = { id: 's1', name: 'Shop' }
    expect(await grantEligible('p1', 's1')).toBe(true)
    expect(await grantEligible('p1', 's2')).toBe(false)
  })
})

describe('alreadyGranted (the one-tap Continue screen, never an automatic approval)', () => {
  it('true only when one live grant of THIS app, account and target covers every scope asked', async () => {
    h.grants = [{ scopes: 'messages:read' }, { scopes: 'messages:read messages:write' }]
    expect(await alreadyGranted('p1', 'https://claude.ai/oauth/mcp-client.json', null, CHAT)).toBe(true)
    expect(h.lastWhere).toMatchObject({ profileId: 'p1', sellerId: null, revokedAt: null, prefix: { startsWith: `${GRANT_PREFIX}${clientBinding('https://claude.ai/oauth/mcp-client.json')}` } })
    h.grants = [{ scopes: 'messages:read' }]
    expect(await alreadyGranted('p1', 'https://claude.ai/oauth/mcp-client.json', null, CHAT)).toBe(false)
  })
})
