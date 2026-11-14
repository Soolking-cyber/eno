import { beforeEach, describe, expect, it, vi } from 'vitest'
import crypto from 'crypto'

/**
 * "Sign in with eno" (src/lib/api/oauth-grant.ts): the authorization request, client documents, codes, refresh rotation,
 * the token endpoint's sign-in grants and the access token's audience. The grant rows live in an in-memory ApiKey store
 * that honours the same conditional updates Prisma runs (pending → live, compare-and-swap on hashedKey), so single use,
 * rotation and replay revocation are exercised, not assumed.
 */

process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-for-oauth-grant'

type Row = { id: string; sellerId: string; profileId: string; name: string; prefix: string; hashedKey: string; scopes: string; lastUsedAt: Date | null; revokedAt: Date | null; createdAt?: Date }
const h = vi.hoisted(() => ({
  rows: new Map<string, Row>(),
  kv: new Map<string, unknown>(),
  profile: { accountType: 'business', enforcementState: 'good_standing' } as Record<string, string>,
  shopId: 'shop1',
  docs: new Map<string, { status: number; body: string }>(),
  kvDown: false,
}))

const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b)
const matches = (r: Row, where: Record<string, unknown>) => Object.entries(where).every(([k, v]) => {
  const cur = (r as Record<string, unknown>)[k]
  if (v === null) return cur === null
  if (v instanceof Date) return same(cur, v)
  if (v && typeof v === 'object' && 'not' in (v as object)) return (v as { not: unknown }).not === null ? cur !== null : !same(cur, (v as { not: unknown }).not)
  if (v && typeof v === 'object' && 'lt' in (v as object)) return cur instanceof Date && cur.getTime() < ((v as { lt: Date }).lt).getTime()
  return cur === v
})

vi.mock('@/lib/db', () => {
  const db: Record<string, unknown> = {
    // A transaction runs the same fake; kv_set inside it writes the same kv map (kv_store is a Postgres table).
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
    $queryRaw: async (_s: TemplateStringsArray, key: string, json: string) => { h.kv.set(key, JSON.parse(json)); return [{ won: true }] },
    apiKey: {
      create: async ({ data }: { data: Partial<Row> }) => {
        const id = 'c' + crypto.randomBytes(12).toString('hex')
        h.rows.set(id, { id, lastUsedAt: null, revokedAt: null, createdAt: new Date(), ...data } as Row)
        return { id }
      },
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        let count = 0
        for (const [id, r] of h.rows) if (matches(r, where)) { h.rows.delete(id); count++ }
        return { count }
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
        let count = 0
        for (const r of h.rows.values()) if (matches(r, where)) { Object.assign(r, data); count++ }
        return { count }
      },
      findUnique: async ({ where }: { where: { id?: string; hashedKey?: string } }) =>
        where.id ? h.rows.get(where.id) ?? null : [...h.rows.values()].find((r) => r.hashedKey === where.hashedKey) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => Object.assign(h.rows.get(where.id)!, data),
    },
    seller: { findUnique: async () => ({ id: h.shopId, name: 'My shop' }) },
    profile: { findUnique: async () => h.profile },
  }
  return { db }
})
vi.mock('@/lib/ratelimit', () => ({
  kv: {
    get: async (k: string) => { if (h.kvDown) throw new Error('kv_store unavailable'); return h.kv.get(k) ?? null },
    set: async (k: string, v: unknown, o?: { nx?: boolean }) => { if (o?.nx && h.kv.has(k)) return null; h.kv.set(k, v); return 'OK' },
  },
  rateLimit: async () => ({ success: true, remaining: 9, limit: 10, resetSec: 60, windowSec: 60 }),
}))
vi.mock('@/lib/ssrf', () => ({
  safeFetch: async (url: string) => {
    const d = h.docs.get(url)
    if (!d) throw new Error('ssrf:dns')
    return new Response(d.body, { status: d.status })
  },
}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'p1' } } }) } }) }))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.5' }))

const G = await import('./oauth-grant')
const { verifyAccessToken } = await import('./oauth')

const CLIENT = 'https://app.example.com/oauth/client.json'
const REDIRECT = 'https://app.example.com/callback'
const verifier = 'v'.repeat(50)
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
const doc = (over: Record<string, unknown> = {}) => JSON.stringify({ client_id: CLIENT, client_name: 'Example App', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', ...over })
const q = (over: Record<string, string> = {}) => new URLSearchParams({ client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 's1', ...over })
const now = () => Math.floor(Date.now() / 1000)

beforeEach(() => {
  h.rows.clear(); h.kv.clear(); h.docs.clear()
  h.profile = { accountType: 'business', enforcementState: 'good_standing' }; h.shopId = 'shop1'
  h.docs.set(CLIENT, { status: 200, body: doc() })
})

async function codeFor(scopes?: string) {
  const c = await G.checkAuthRequest(q(scopes ? { scope: scopes } : {}))
  if (!c.ok) throw new Error('request refused')
  const ticket = G.issueConsentTicket(c.req, 'p1', ['shop1'], now())!
  const t = G.openConsentTicket(ticket, now())!
  return (await G.approve(t, 'shop1', c.client.name, now()))!
}

describe('the authorization request', () => {
  it('an unknown client or an unregistered return address is refused', async () => {
    h.docs.clear()
    expect(await G.checkAuthRequest(q())).toMatchObject({ ok: false, error: 'invalid_client' })
    h.docs.set(CLIENT, { status: 200, body: doc() })
    expect(await G.checkAuthRequest(q({ redirect_uri: 'https://evil.example/cb' }))).toMatchObject({ ok: false })
  })

  it('a protocol error never carries a return address: an error is never redirected (no open redirect)', async () => {
    for (const bad of [q({ code_challenge_method: 'plain' }), q({ resource: 'https://elsewhere.example/api' }), q({ response_type: 'token' })]) {
      const c = await G.checkAuthRequest(bad)
      expect(c.ok).toBe(false)
      expect(c).not.toHaveProperty('redirectUri')
    }
    expect(await G.checkAuthRequest(q({ code_challenge_method: 'plain' }))).toMatchObject({ ok: false, error: 'invalid_request' })
    expect(await G.checkAuthRequest(q({ resource: 'https://elsewhere.example/api' }))).toMatchObject({ ok: false, error: 'invalid_target' })
    expect(await G.checkAuthRequest(q({ scope: 'listings:read admin:everything' }))).toMatchObject({ ok: false, error: 'invalid_scope' })
    expect(await G.checkAuthRequest(q({ response_type: 'token' }))).toMatchObject({ ok: false, error: 'unsupported_response_type' })
  })

  it('a client names no scope → the MCP tools\' scopes, never media:write', async () => {
    const c = await G.checkAuthRequest(q())
    expect(c.ok && c.req.scopes).toEqual(['listings:read', 'listings:write', 'analytics:read'])
  })
})

describe('return addresses', () => {
  it('match exactly, except a loopback address, which matches on any port (RFC 8252)', () => {
    expect(G.redirectMatches(['https://app.example.com/cb'], 'https://app.example.com/cb')).toBe(true)
    expect(G.redirectMatches(['https://app.example.com/cb'], 'https://app.example.com:8443/cb')).toBe(false)
    expect(G.redirectMatches(['http://127.0.0.1/callback'], 'http://127.0.0.1:53682/callback')).toBe(true)
    expect(G.redirectMatches(['http://127.0.0.1/callback'], 'http://127.0.0.1:53682/other')).toBe(false)
    expect(G.redirectMatches(['http://localhost/cb'], 'http://127.0.0.1:5000/cb')).toBe(false)
  })
})

describe('client metadata documents', () => {
  it('refuses a document that names another client, a confidential client, or only unsafe return addresses', async () => {
    for (const body of [doc({ client_id: 'https://other.example/c.json' }), doc({ token_endpoint_auth_method: 'client_secret_basic' }), doc({ redirect_uris: ['http://app.example.com/cb', 'https://app.example.com/cb#frag'] })]) {
      h.kv.clear(); h.docs.set(CLIENT, { status: 200, body })
      expect(await G.loadClient(CLIENT)).toBeNull()
    }
  })

  it('accepts a client that prefers a signed assertion but can also sign in as a public client (ChatGPT)', async () => {
    h.docs.set(CLIENT, { status: 200, body: doc({ token_endpoint_auth_method: 'private_key_jwt', token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'] }) })
    expect(await G.loadClient(CLIENT)).toMatchObject({ clientId: CLIENT, redirectUris: [REDIRECT] })
    for (const methods of [['private_key_jwt'], 'none', undefined]) {
      h.kv.clear(); h.docs.set(CLIENT, { status: 200, body: doc({ token_endpoint_auth_method: 'private_key_jwt', token_endpoint_auth_methods_supported: methods }) })
      expect(await G.loadClient(CLIENT), String(methods)).toBeNull()
    }
  })

  it('refuses an oversized document and a client_id that is not a clean https URL', async () => {
    h.docs.set(CLIENT, { status: 200, body: doc({ client_name: 'x'.repeat(6000) }) })
    expect(await G.loadClient(CLIENT)).toBeNull()
    for (const bad of ['http://app.example.com/c.json', 'https://app.example.com/', 'https://u:p@app.example.com/c.json', 'https://app.example.com/a/../c.json']) {
      expect(G.clientIdShapeOk(bad), bad).toBe(false)
    }
  })

  it('strips invisible and control characters from the displayed name', async () => {
    h.docs.set(CLIENT, { status: 200, body: doc({ client_name: 'Cla‮ude​' }) })
    expect((await G.loadClient(CLIENT))!.name).toBe('Claude')
  })
})

describe('code → grant → refresh', () => {
  it('a code redeems once, with the right verifier, return address and client; the grant row goes pending → live', async () => {
    const code = await codeFor()
    const pending = [...h.rows.values()][0]
    expect(pending.revokedAt).not.toBeNull()
    expect((await G.redeemCode({ code, verifier: 'w'.repeat(50), redirectUri: REDIRECT, clientId: CLIENT }, now())).ok).toBe(false)
    expect((await G.redeemCode({ code, verifier, redirectUri: 'https://app.example.com/other', clientId: CLIENT }, now())).ok).toBe(false)
    expect((await G.redeemCode({ code, verifier, redirectUri: REDIRECT, clientId: 'https://other.example/c.json' }, now())).ok).toBe(false)
    const r = await G.redeemCode({ code, verifier, redirectUri: REDIRECT, clientId: CLIENT }, now())
    expect(r.ok).toBe(true)
    const live = h.rows.get(pending.id)!
    expect(live.revokedAt).toBeNull()
    expect(live.prefix.startsWith('oag_')).toBe(true)
    expect(live.hashedKey).toBe(G.labelledHash('eno-rt', (r as { grant: { refreshToken: string } }).grant.refreshToken))
  })

  it('a replayed code is refused AND revokes the grant it produced', async () => {
    const code = await codeFor()
    expect((await G.redeemCode({ code, verifier, redirectUri: REDIRECT, clientId: CLIENT }, now())).ok).toBe(true)
    expect((await G.redeemCode({ code, verifier, redirectUri: REDIRECT, clientId: CLIENT }, now() + 2)).ok).toBe(false)
    expect([...h.rows.values()][0].revokedAt).not.toBeNull()
  })

  it('a pending grant revoked from the dashboard can no longer be redeemed by its code', async () => {
    const code = await codeFor()
    const row = [...h.rows.values()][0]
    row.revokedAt = new Date() // what the dashboard's Revoke writes
    expect((await G.redeemCode({ code, verifier, redirectUri: REDIRECT, clientId: CLIENT }, now())).ok).toBe(false)
    expect(h.rows.get(row.id)!.revokedAt).not.toBeNull()
  })

  it('a refresh token nobody was ever issued is refused WITHOUT disconnecting the real grant', async () => {
    const code = await codeFor()
    const first = await G.redeemCode({ code, verifier, redirectUri: REDIRECT, clientId: CLIENT }, now())
    const keyId = (first as { grant: { keyId: string } }).grant.keyId
    const forged = `eno_rt_${keyId}_${'A'.repeat(43)}`
    expect((await G.rotateRefresh({ refreshToken: forged, clientId: CLIENT }, now())).ok).toBe(false)
    expect(h.rows.get(keyId)!.revokedAt).toBeNull()
    // …and the real token still works.
    expect((await G.rotateRefresh({ refreshToken: (first as { grant: { refreshToken: string } }).grant.refreshToken, clientId: CLIENT }, now())).ok).toBe(true)
  })

  it('pending rows whose code was never redeemed are dropped after ten minutes', async () => {
    await codeFor()
    const stale = [...h.rows.values()][0]
    stale.createdAt = new Date(Date.now() - 11 * 60_000)
    await codeFor()
    expect(h.rows.has(stale.id)).toBe(false)
    expect(h.rows.size).toBe(1)
  })

  it('any replay of a rotated-out token revokes the grant — a thief who refreshed first never stays connected', async () => {
    const first = await G.redeemCode({ code: await codeFor(), verifier, redirectUri: REDIRECT, clientId: CLIENT }, now())
    const rt1 = (first as { grant: { refreshToken: string } }).grant.refreshToken
    expect((await G.rotateRefresh({ refreshToken: rt1, clientId: CLIENT }, now())).ok).toBe(true) // the thief, first
    expect((await G.rotateRefresh({ refreshToken: rt1, clientId: CLIENT }, now() + 3)).ok).toBe(false) // the real client
    expect([...h.rows.values()][0].revokedAt).not.toBeNull()
  })



  it('a refresh re-authorises: a shop no longer owned, a non-business account or a 180-day-old grant ends the connection', async () => {
    for (const [label, change] of [
      ['owner', () => { h.shopId = 'someone-elses' }],
      ['tier', () => { h.profile = { accountType: 'individual', enforcementState: 'good_standing' } }],
      ['held', () => { h.profile = { accountType: 'business', enforcementState: 'held' } }],
    ] as const) {
      h.rows.clear(); h.kv.clear(); h.profile = { accountType: 'business', enforcementState: 'good_standing' }; h.shopId = 'shop1'
      const g = await G.redeemCode({ code: await codeFor(), verifier, redirectUri: REDIRECT, clientId: CLIENT }, now())
      change()
      expect((await G.rotateRefresh({ refreshToken: (g as { grant: { refreshToken: string } }).grant.refreshToken, clientId: CLIENT }, now())).ok, label).toBe(false)
      expect([...h.rows.values()][0].revokedAt, label).not.toBeNull()
    }
    h.rows.clear(); h.kv.clear(); h.profile = { accountType: 'business', enforcementState: 'good_standing' }; h.shopId = 'shop1'
    const old = await G.redeemCode({ code: await codeFor(), verifier, redirectUri: REDIRECT, clientId: CLIENT }, now())
    expect((await G.rotateRefresh({ refreshToken: (old as { grant: { refreshToken: string } }).grant.refreshToken, clientId: CLIENT }, now() + G.GRANT_MAX_AGE_SECONDS + 10)).ok).toBe(false)
  })

  it('a code is not redeemed if the person stopped being eligible since Allow', async () => {
    const code = await codeFor()
    h.profile = { accountType: 'business', enforcementState: 'suspended' }
    expect((await G.redeemCode({ code, verifier, redirectUri: REDIRECT, clientId: CLIENT }, now())).ok).toBe(false)
    expect([...h.rows.values()][0].lastUsedAt).toBeNull()
  })

  it('a redeemed code replayed after its minute still revokes the grant it produced', async () => {
    const code = await codeFor()
    expect((await G.redeemCode({ code, verifier, redirectUri: REDIRECT, clientId: CLIENT }, now())).ok).toBe(true)
    expect((await G.redeemCode({ code, verifier, redirectUri: REDIRECT, clientId: CLIENT }, now() + 120)).ok).toBe(false)
    expect([...h.rows.values()][0].revokedAt).not.toBeNull()
  })

  it('the MCP server address with a trailing slash is the same server; any other address is refused', () => {
    expect(G.isMcpResource(`${G.MCP_RESOURCE}/`)).toBe(true)
    expect(G.isMcpResource(`${G.MCP_RESOURCE}/x`)).toBe(false)
    expect(G.isMcpResource('https://evil.example/api/mcp')).toBe(false)
  })

  it('a failed history read is a 503 (it throws), never "no replay"', async () => {
    const first = await G.redeemCode({ code: await codeFor(), verifier, redirectUri: REDIRECT, clientId: CLIENT }, now())
    const rt1 = (first as { grant: { refreshToken: string } }).grant.refreshToken
    expect((await G.rotateRefresh({ refreshToken: rt1, clientId: CLIENT }, now())).ok).toBe(true)
    h.kvDown = true
    await expect(G.rotateRefresh({ refreshToken: rt1, clientId: CLIENT }, now() + 1)).rejects.toThrow()
    h.kvDown = false
    expect((await G.rotateRefresh({ refreshToken: rt1, clientId: CLIENT }, now() + 2)).ok).toBe(false)
    expect([...h.rows.values()][0].revokedAt).not.toBeNull()
  })

  it('a code expires after 60 seconds', async () => {
    const code = await codeFor()
    expect((await G.redeemCode({ code, verifier, redirectUri: REDIRECT, clientId: CLIENT }, now() + 61)).ok).toBe(false)
  })

  it('refresh rotates; the old token replayed revokes the grant; another client cannot use it and cannot revoke it', async () => {
    const code = await codeFor()
    const first = await G.redeemCode({ code, verifier, redirectUri: REDIRECT, clientId: CLIENT }, now())
    const rt1 = (first as { grant: { refreshToken: string } }).grant.refreshToken
    // A stranger presenting the token: refused, and the grant survives.
    expect((await G.rotateRefresh({ refreshToken: rt1, clientId: 'https://other.example/c.json' }, now())).ok).toBe(false)
    expect([...h.rows.values()][0].revokedAt).toBeNull()
    // Widening is refused; narrowing is allowed.
    expect(await G.rotateRefresh({ refreshToken: rt1, clientId: CLIENT, scope: 'media:write' }, now())).toMatchObject({ ok: false, error: 'invalid_scope' })
    const second = await G.rotateRefresh({ refreshToken: rt1, clientId: CLIENT, scope: 'listings:read' }, now())
    expect(second).toMatchObject({ ok: true, grant: { scopes: ['listings:read'] } })
    // RFC 6749 §6: narrowing applies to this access token only; the grant keeps what the person approved.
    expect([...h.rows.values()][0].scopes).toBe('listings:read listings:write analytics:read')
    const rt2 = (second as { grant: { refreshToken: string } }).grant.refreshToken
    expect(rt2).not.toBe(rt1)
    // Replaying rt1: refused, and the whole grant is revoked; rt2 dies with it.
    expect((await G.rotateRefresh({ refreshToken: rt1, clientId: CLIENT }, now() + 5)).ok).toBe(false)
    expect([...h.rows.values()][0].revokedAt).not.toBeNull()
    expect((await G.rotateRefresh({ refreshToken: rt2, clientId: CLIENT }, now() + 6)).ok).toBe(false)
  })

  it('a consent ticket is bound: tampering or expiry opens nothing', async () => {
    const c = await G.checkAuthRequest(q())
    if (!c.ok) throw new Error('x')
    const ticket = G.issueConsentTicket(c.req, 'p1', ['shop1'], now())!
    const [payload, sig] = ticket.split('.')
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), pid: 'p2' })).toString('base64url')
    expect(G.openConsentTicket(`${forged}.${sig}`, now())).toBeNull()
    expect(G.openConsentTicket(ticket, now() + 601)).toBeNull()
    // A code is not a consent ticket, even though both are sealed with the same key family.
    expect(G.openConsentTicket(await codeFor(), now())).toBeNull()
    // A ticket the other edition sealed (same secret family, another resource) is not this site's consent.
    expect(G.openConsentTicket(G.issueConsentTicket({ ...c.req, resource: 'https://www.eno.forum/api/mcp' }, 'p1', ['shop1'], now())!, now())).toBeNull()
  })
})

describe('the token endpoint and the access token', () => {
  const tokenReq = (body: Record<string, string>) => new Request('https://eno.vn/api/v1/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString(),
  }) as never

  it('authorization_code answers an access token for the MCP server only, a refresh token, no-store', async () => {
    const { POST } = await import('@/app/api/v1/oauth/token/route')
    const code = await codeFor()
    const res = await POST(tokenReq({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT, client_id: CLIENT }))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    expect(body).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'listings:read listings:write analytics:read' })
    expect(body.refresh_token).toMatch(/^eno_rt_/)
    expect(verifyAccessToken(body.access_token, now())!.aud).toBe(G.MCP_RESOURCE)
  })

  it('client_credentials never accepts a sign-in grant row, whatever it is sent', async () => {
    const { POST } = await import('@/app/api/v1/oauth/token/route')
    const raw = 'eno_live_' + 'a'.repeat(40)
    const crypto2 = await import('crypto')
    h.rows.set('cgrant', { id: 'cgrant', sellerId: 'shop1', profileId: 'p1', name: 'x', prefix: 'oag_abc', hashedKey: crypto2.createHash('sha256').update(raw).digest('hex'), scopes: 'listings:read', lastUsedAt: null, revokedAt: null })
    const res = await POST(tokenReq({ grant_type: 'client_credentials', client_secret: raw }))
    expect(res.status).toBe(401)
  })

  it('a sign-in token works at the MCP server and nowhere else; a client_credentials token still works everywhere', async () => {
    const { resolveApiKey } = await import('./auth')
    const { issueAccessToken } = await import('./oauth')
    const bearer = (t: string) => new Request('https://eno.vn/x', { headers: { authorization: `Bearer ${t}` } })
    const g = await G.redeemCode({ code: await codeFor(), verifier, redirectUri: REDIRECT, clientId: CLIENT }, now())
    const signIn = issueAccessToken({ keyId: (g as { grant: { keyId: string } }).grant.keyId, sellerId: 's', profileId: 'p', scopes: ['listings:read'], aud: G.MCP_RESOURCE }, now())!
    const legacy = issueAccessToken({ keyId: 'k', sellerId: 's', profileId: 'p', scopes: ['listings:read'] }, now())!
    expect((await resolveApiKey(bearer(signIn), undefined, { resource: G.MCP_RESOURCE })).ok).toBe(true)
    expect((await resolveApiKey(bearer(signIn))).ok).toBe(false)
    expect((await resolveApiKey(bearer(legacy))).ok).toBe(true)
    expect((await resolveApiKey(bearer(legacy), undefined, { resource: G.MCP_RESOURCE })).ok).toBe(true)
  })

  it('a sign-in token stops working the moment its grant is disconnected', async () => {
    const { resolveApiKey } = await import('./auth')
    const { issueAccessToken } = await import('./oauth')
    const g = await G.redeemCode({ code: await codeFor(), verifier, redirectUri: REDIRECT, clientId: CLIENT }, now())
    const keyId = (g as { grant: { keyId: string } }).grant.keyId
    const tok = issueAccessToken({ keyId, sellerId: 'shop1', profileId: 'p1', scopes: ['listings:read'], aud: G.MCP_RESOURCE }, now())!
    const req = () => new Request('https://eno.vn/api/mcp', { headers: { authorization: `Bearer ${tok}` } })
    expect((await resolveApiKey(req(), undefined, { resource: G.MCP_RESOURCE })).ok).toBe(true)
    h.rows.get(keyId)!.revokedAt = new Date() // Disconnect in Dashboard › Developers
    expect((await resolveApiKey(req(), undefined, { resource: G.MCP_RESOURCE })).ok).toBe(false)
  })

  it('a sign-in token also stops at once on a suspension, a lost shop or the 180-day limit — without waiting for a refresh', async () => {
    const { resolveApiKey } = await import('./auth')
    const { issueAccessToken } = await import('./oauth')
    for (const [label, change] of [
      ['suspended', () => { h.profile = { accountType: 'business', enforcementState: 'suspended' } }],
      ['lost shop', () => { h.shopId = 'someone-elses' }],
      ['180 days', (id: string) => { h.rows.get(id)!.createdAt = new Date(Date.now() - (G.GRANT_MAX_AGE_SECONDS + 60) * 1000) }],
    ] as const) {
      h.rows.clear(); h.kv.clear(); h.profile = { accountType: 'business', enforcementState: 'good_standing' }; h.shopId = 'shop1'
      const g = await G.redeemCode({ code: await codeFor(), verifier, redirectUri: REDIRECT, clientId: CLIENT }, now())
      const keyId = (g as { grant: { keyId: string } }).grant.keyId
      const tok = issueAccessToken({ keyId, sellerId: 'shop1', profileId: 'p1', scopes: ['listings:read'], aud: G.MCP_RESOURCE }, now())!
      const req = new Request('https://eno.vn/api/mcp', { headers: { authorization: `Bearer ${tok}` } })
      change(keyId)
      expect((await resolveApiKey(req, undefined, { resource: G.MCP_RESOURCE })).ok, label).toBe(false)
      if (label !== '180 days') expect(h.rows.get(keyId)!.revokedAt, `${label}: ended for good, not paused`).not.toBeNull()
    }
  })
})
