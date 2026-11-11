import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Which Bearer challenge each refusal from resolveApiKey asks for (RFC 6750 §3.1) — respond.ts apiAuthError turns it
 * into the WWW-Authenticate header. The database and the limiter are mocked; the codes, statuses and messages are the
 * real ones, unchanged by the challenge.
 */
const h = vi.hoisted(() => ({ key: null as null | { id: string; sellerId: string; profileId: string; scopes: string; revokedAt: Date | null } }))
vi.mock('@/lib/db', () => ({ db: { apiKey: { findUnique: async () => h.key, update: async () => ({}) } } }))
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => ({ success: true, limit: 30, remaining: 29, resetSec: 60, windowSec: 60 }) }))

import { resolveApiKey } from './auth'

const KEY = `eno_live_${'A'.repeat(32)}`
const req = (authorization?: string) => new Request('https://eno.vn/api/v1/shop', { headers: authorization ? { authorization } : {} })

beforeEach(() => { h.key = null })

describe('resolveApiKey — the challenge on each refusal', () => {
  it('no credential, or another scheme: 401 with no error code', async () => {
    for (const r of [await resolveApiKey(req()), await resolveApiKey(req('Basic dXNlcjpwYXNz'))]) {
      expect(r).toMatchObject({ ok: false, status: 401, code: 'unauthorized' })
      expect(r.ok === false && r.challenge).toBeFalsy()
    }
  })

  it('a Bearer credential of the wrong shape, an unknown key, a revoked key, a bad token: invalid_token', async () => {
    expect(await resolveApiKey(req('Bearer not-a-key'))).toMatchObject({ status: 401, challenge: { error: 'invalid_token' } })
    expect(await resolveApiKey(req(`Bearer ${KEY}`))).toMatchObject({ status: 401, message: 'Invalid or revoked API key.', challenge: { error: 'invalid_token' } })
    h.key = { id: 'k', sellerId: 's', profileId: 'p', scopes: 'listings:read', revokedAt: new Date() }
    expect(await resolveApiKey(req(`Bearer ${KEY}`))).toMatchObject({ status: 401, challenge: { error: 'invalid_token' } })
    expect(await resolveApiKey(req('Bearer aaa.bbb.ccc'))).toMatchObject({ status: 401, message: 'Invalid or expired access token.', challenge: { error: 'invalid_token' } })
  })

  it('a valid key without the scope: 403 insufficient_scope naming the scope needed', async () => {
    h.key = { id: 'k', sellerId: 's', profileId: 'p', scopes: 'listings:read', revokedAt: null }
    expect(await resolveApiKey(req(`Bearer ${KEY}`), 'listings:write')).toMatchObject({
      ok: false,
      status: 403,
      code: 'insufficient_scope',
      challenge: { error: 'insufficient_scope', scope: 'listings:write' },
    })
  })
})
