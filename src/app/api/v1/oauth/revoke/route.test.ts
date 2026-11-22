/**
 * RFC 7009 revocation (owner 2026-11-22, the Personal Agent Protocol 1.0 issuer binding): a sign-in grant's current refresh
 * token, presented by its own client, ends the grant; everything else answers without revealing what exists; access tokens
 * are stateless and say so. The grant row is a stand-in (one ApiKey), as in oauth-grant.connect.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ row: null as null | { prefix: string; hashedKey: string; revokedAt: Date | null }, revoked: 0, limited: false, history: new Map<string, { keyId: string; at: number }>() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: !h.limited, limit: 30, remaining: 1, resetSec: 60 }), kv: { get: async (k: string) => h.history.get(k) ?? null } }))
vi.mock('@/lib/db', () => ({
  db: {
    apiKey: {
      findUnique: async () => h.row,
      updateMany: async () => {
        if (h.row && !h.row.revokedAt) { h.row.revokedAt = new Date(); h.revoked++; return { count: 1 } }
        return { count: 0 }
      },
    },
  },
}))

const { POST } = await import('./route')
const { GRANT_PREFIX, clientBinding, labelledHash } = await import('@/lib/api/oauth-grant')

const CLIENT = 'https://claude.ai/oauth/claude-code-client-metadata'
const KEY = 'k1234567890abcdefghij'
const TOKEN = `eno_rt_${KEY}_${'A'.repeat(43)}`
const post = (body: Record<string, string>) =>
  POST(new NextRequest('https://eno.vn/api/v1/oauth/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() }))

beforeEach(() => {
  h.row = { prefix: `${GRANT_PREFIX}${clientBinding(CLIENT)}abc123`, hashedKey: labelledHash('eno-rt', TOKEN), revokedAt: null }
  h.revoked = 0
  h.limited = false
  h.history = new Map()
})

describe('POST /api/v1/oauth/revoke', () => {
  it('revokes the current refresh token of its own client: 200, the grant ends', async () => {
    const r = await post({ token: TOKEN, token_type_hint: 'refresh_token', client_id: CLIENT })
    expect(r.status).toBe(200)
    expect(h.revoked).toBe(1)
    expect(h.row!.revokedAt).toBeInstanceOf(Date)
  })

  it('refuses another client, and leaves the grant alive', async () => {
    const r = await post({ token: TOKEN, client_id: 'https://other.example/client.json' })
    expect(r.status).toBe(400)
    expect((await r.json()).error).toBe('unauthorized_client')
    expect(h.revoked).toBe(0)
  })

  it('an unknown, rotated-out, malformed or already revoked token is a plain 200 that changes nothing (RFC 7009 §2.2)', async () => {
    for (const token of [`eno_rt_${KEY}_${'B'.repeat(43)}`, 'not-a-token']) {
      const r = await post({ token, client_id: CLIENT })
      expect(r.status, token).toBe(200)
    }
    h.row!.revokedAt = new Date(0)
    expect((await post({ token: TOKEN, client_id: CLIENT })).status).toBe(200)
    expect(h.revoked).toBe(0)
  })

  it('the hint is a hint: a refresh token sent as "access_token" is still revoked (RFC 7009 §2.1)', async () => {
    const r = await post({ token: TOKEN, token_type_hint: 'access_token', client_id: CLIENT })
    expect(r.status).toBe(200)
    expect(h.revoked).toBe(1)
  })

  it('a sign-out that raced a refresh still ends the grant: the rotated-out token of this grant revokes it', async () => {
    const old = `eno_rt_${KEY}_${'C'.repeat(43)}`
    h.history.set(`oauth:rt-prev:${labelledHash('eno-rt', old)}`, { keyId: KEY, at: 1 })
    expect((await post({ token: old, client_id: 'https://other.example/c.json' })).status).toBe(400) // still only its own client
    expect(h.revoked).toBe(0)
    expect((await post({ token: old, client_id: CLIENT })).status).toBe(200)
    expect(h.revoked).toBe(1)
  })

  it('a JSON body that is not an object is a 400, not a crash', async () => {
    const r = await POST(new NextRequest('https://eno.vn/api/v1/oauth/revoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'null' }))
    expect(r.status).toBe(400)
  })

  it('needs a token and a client_id, and is rate limited', async () => {
    expect((await post({ client_id: CLIENT })).status).toBe(400)
    expect((await post({ token: TOKEN })).status).toBe(401)
    h.limited = true
    expect((await post({ token: TOKEN, client_id: CLIENT })).status).toBe(429)
    expect(h.revoked).toBe(0)
  })
})

describe('the issuer metadata advertises it (Personal Agent Protocol 1.0 §3.2)', () => {
  it('revocation_endpoint, protected_resources = the origin, refresh_token among the grants', async () => {
    const { GET } = await import('@/app/api/well-known/oauth-authorization-server/route')
    const m = await (await GET()).json()
    expect(m.revocation_endpoint).toBe(`${m.issuer}/api/v1/oauth/revoke`)
    expect(m.protected_resources).toEqual([new URL(m.issuer).origin])
    expect(m.grant_types_supported).toContain('refresh_token')
  })
})
