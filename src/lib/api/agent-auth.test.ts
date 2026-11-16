import { beforeEach, describe, expect, it, vi } from 'vitest'
import crypto from 'crypto'

/**
 * Agent registration — the auth.md service_auth claim ceremony (src/lib/api/agent-auth.ts), its page handlers, the token
 * endpoint's claim and jwt-bearer grants, and the guards that keep it apart from Sign in with eno. The grant rows live in
 * the same kind of in-memory ApiKey store as oauth-grant.test.ts (conditional updates honoured), so single use, replay
 * and revocation are exercised, not assumed.
 */

process.env.SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || 'test-secret-for-agent-auth'

type Row = { id: string; sellerId: string; profileId: string; name: string; prefix: string; hashedKey: string; scopes: string; lastUsedAt: Date | null; revokedAt: Date | null; createdAt: Date }
const h = vi.hoisted(() => ({
  rows: new Map<string, Row>(),
  kv: new Map<string, unknown>(),
  notices: [] as Record<string, unknown>[],
  profile: { accountType: 'business', enforcementState: 'good_standing' } as Record<string, string>,
  shopId: 'shop1' as string | null,
  user: { id: 'p1', email: 'Owner@Example.com', email_confirmed_at: '2026-01-01T00:00:00Z' } as Record<string, unknown> | null,
  dbReads: 0,
}))

const same = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b)
const matches = (r: Row, where: Record<string, unknown>): boolean => Object.entries(where).every(([k, v]) => {
  if (k === 'NOT') return !matches(r, v as Record<string, unknown>)
  const cur = (r as Record<string, unknown>)[k]
  if (v && typeof v === 'object' && 'startsWith' in (v as object)) return typeof cur === 'string' && cur.startsWith((v as { startsWith: string }).startsWith)
  if (v === null) return cur === null
  if (v instanceof Date) return same(cur, v)
  if (v && typeof v === 'object' && 'not' in (v as object)) return (v as { not: unknown }).not === null ? cur !== null : !same(cur, (v as { not: unknown }).not)
  if (v && typeof v === 'object' && 'lt' in (v as object)) return cur instanceof Date && cur.getTime() < ((v as { lt: Date }).lt).getTime()
  return cur === v
})

vi.mock('@/lib/db', () => ({
  db: {
    apiKey: {
      create: async ({ data }: { data: Partial<Row> }) => {
        const id = 'c' + crypto.randomBytes(12).toString('hex')
        h.rows.set(id, { id, lastUsedAt: null, revokedAt: null, createdAt: new Date(), ...data } as Row)
        return { id }
      },
      delete: async ({ where }: { where: { id: string } }) => { h.rows.delete(where.id) },
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
    seller: { findUnique: async () => { h.dbReads++; return h.shopId ? { id: h.shopId, name: 'My shop' } : null } },
    profile: { findUnique: async () => { h.dbReads++; return h.profile } },
    notification: { create: async ({ data }: { data: Record<string, unknown> }) => { h.notices.push(data); return data } },
  },
}))
vi.mock('@/lib/ratelimit', () => ({
  kv: {
    get: async (k: string) => h.kv.get(k) ?? null,
    set: async (k: string, v: unknown, o?: { nx?: boolean }) => { if (o?.nx && h.kv.has(k)) return null; h.kv.set(k, v); return 'OK' },
    del: async (k: string) => { h.kv.delete(k) },
    incrby: async (k: string, by: number) => { const v = Number(h.kv.get(k) ?? 0) + by; h.kv.set(k, v); return v },
  },
  rateLimit: async () => ({ success: true, remaining: 9, limit: 10, resetSec: 60, windowSec: 60 }),
}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: h.user } }) } }) }))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.7' }))
vi.mock('@/lib/ssrf', () => ({ safeFetch: async () => { throw new Error('no network in tests') } }))

const A = await import('./agent-auth')
const G = await import('./oauth-grant')
const { OAUTH_ISSUER, verifyAccessToken } = await import('./oauth')

const now = () => Math.floor(Date.now() / 1000)
const EMAIL = 'owner@example.com'
const personHash = () => A.emailHash(EMAIL)
const clearPoll = () => { for (const k of [...h.kv.keys()]) if (k.includes(':poll:')) h.kv.delete(k) }

beforeEach(() => {
  h.rows.clear(); h.kv.clear(); h.notices.length = 0; h.dbReads = 0
  h.profile = { accountType: 'business', enforcementState: 'good_standing' }; h.shopId = 'shop1'
  h.user = { id: 'p1', email: 'Owner@Example.com', email_confirmed_at: '2026-01-01T00:00:00Z' }
})

async function registered() {
  const r = await A.registerServiceAuth(EMAIL, now())
  if (!r) throw new Error('registration failed')
  return r
}
async function allowed() {
  const r = await registered()
  const open = (await A.lookupByCode(personHash(), r.claim.user_code, now()))!
  expect(await A.completeClaim(open, 'p1', 'shop1', now())).toBe(true)
  return r
}

describe('registration (POST /api/agent/identity)', () => {
  it('answers the auth.md shape with a BARE verification_uri, and keeps no email — only its labelled hash', async () => {
    const r = await registered()
    expect(r).toMatchObject({ registration_type: 'service_auth', claim_url: A.CLAIM_PATH, post_claim_scopes: G.DEFAULT_SIGN_IN_SCOPES })
    expect(r.registration_id).toMatch(/^reg_[a-f0-9]{20}$/)
    expect(r.claim_token).toMatch(/^clm_[a-f0-9]{20}_[A-Za-z0-9_-]{43}$/)
    expect(r.claim).toEqual({ user_code: expect.stringMatching(/^\d{6}$/), verification_uri: `${OAUTH_ISSUER}/oauth/agent`, expires_in: A.ATTEMPT_TTL_SECONDS, interval: A.POLL_INTERVAL_SECONDS })
    const stored = JSON.stringify([...h.kv.entries()])
    expect(stored).not.toContain(EMAIL)
    expect(stored).not.toContain(r.claim_token)
    expect(stored).not.toContain(`"${r.claim.user_code}"`)
  })

  it('the route: only service_auth, a real email, and the same answer whether or not an account exists (no lookup at all)', async () => {
    const { POST } = await import('@/app/api/agent/identity/route')
    const post = (b: unknown) => POST(new Request('https://eno.vn/api/agent/identity', { method: 'POST', body: JSON.stringify(b) }) as never)
    expect((await post({ type: 'anonymous' })).status).toBe(400)
    expect(await (await post({ type: 'identity_assertion', assertion: 'x' })).json()).toMatchObject({ error: 'unsupported_identity_type' })
    expect((await post({ type: 'service_auth', login_hint: 'not-an-email' })).status).toBe(400)
    const ok = await post({ type: 'service_auth', login_hint: 'nobody-has-this@example.org' })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('cache-control')).toBe('no-store')
    expect(h.dbReads).toBe(0) // nothing asked about accounts: nothing to enumerate
    const { OPTIONS } = await import('@/app/api/agent/identity/route')
    const opt = await OPTIONS()
    expect(opt.status).toBe(204)
    expect(opt.headers.get('allow')).toBe('POST, OPTIONS')
  })
})

describe('the person\'s side (/oauth/agent)', () => {
  it('⛔ a code is found only among the SIGNED-IN person\'s own email\'s attempts', async () => {
    const r = await registered()
    expect(await A.lookupByCode(personHash(), r.claim.user_code, now())).toMatchObject({ n: 1 })
    expect(await A.lookupByCode(A.emailHash('someone-else@example.com'), r.claim.user_code, now())).toBeNull()
    expect(await A.lookupByCode(personHash(), r.claim.user_code === '000000' ? '000001' : '000000', now())).toBeNull()
    expect(await A.lookupByCode(personHash(), 'abcdef', now())).toBeNull()
    expect(await A.lookupByCode(personHash(), r.claim.user_code, now() + A.ATTEMPT_TTL_SECONDS + 1)).toBeNull()
  })

  it('a new code (claim endpoint) needs the same email, retires the old code, and stops at MAX_ATTEMPTS', async () => {
    const r = await registered()
    expect(await A.reissueAttempt(r.claim_token, 'other@example.com', now())).toMatchObject({ ok: false, error: 'invalid_request' })
    expect(await A.reissueAttempt('clm_' + 'a'.repeat(20) + '_' + 'b'.repeat(43), EMAIL, now())).toMatchObject({ ok: false, error: 'claim_expired' })
    const second = await A.reissueAttempt(r.claim_token, ` ${EMAIL.toUpperCase()} `, now())
    if (!second.ok) throw new Error('reissue refused')
    expect(second.body.claim_attempt.verification_uri).toBe(`${OAUTH_ISSUER}/oauth/agent`)
    expect(await A.lookupByCode(personHash(), r.claim.user_code, now())).toBeNull()
    expect(await A.lookupByCode(personHash(), second.body.claim_attempt.user_code, now())).toMatchObject({ n: 2 })
    for (let i = 2; i < A.MAX_ATTEMPTS; i++) expect((await A.reissueAttempt(r.claim_token, EMAIL, now())).ok).toBe(true)
    expect(await A.reissueAttempt(r.claim_token, EMAIL, now())).toMatchObject({ ok: false, error: 'too_many_attempts' })
  })

  it('⛔ ONE answer per registration: a Cancel after an Allow changes nothing, an Allow after a Cancel makes nothing', async () => {
    const r = await registered()
    const open = (await A.lookupByCode(personHash(), r.claim.user_code, now()))!
    expect(await A.denyClaim(open)).toBe(true)
    expect(await A.completeClaim(open, 'p1', 'shop1', now())).toBe(false)
    expect(h.rows.size).toBe(0) // the row made for the losing Allow is dropped again
    expect(await A.pollClaim(r.claim_token, now())).toMatchObject({ ok: false, error: 'access_denied' })
    const r2 = await A.registerServiceAuth(EMAIL, now())
    const open2 = (await A.lookupByCode(personHash(), r2!.claim.user_code, now()))!
    expect(await A.completeClaim(open2, 'p1', 'shop1', now())).toBe(true)
    expect(await A.denyClaim(open2)).toBe(false)
    clearPoll()
    expect((await A.pollClaim(r2!.claim_token, now())).ok).toBe(true)
  })

  it('the page lists exactly the scopes granted, each in words', async () => {
    const { SCOPE_TEXT } = await import('@/app/[lang]/oauth/agent/scope-text')
    for (const s of G.DEFAULT_SIGN_IN_SCOPES) expect(SCOPE_TEXT[s], s).toBeDefined()
  })

  it('Allow makes ONE pending agent grant and a bell notice; a second answer makes nothing', async () => {
    const r = await registered()
    const open = (await A.lookupByCode(personHash(), r.claim.user_code, now()))!
    expect(await A.completeClaim(open, 'p1', 'shop1', now())).toBe(true)
    const rows = [...h.rows.values()]
    expect(rows).toHaveLength(1)
    expect(rows[0].prefix.startsWith(G.AGENT_GRANT_PREFIX)).toBe(true)
    expect(rows[0].prefix.startsWith(G.AGENT_GRANT_FAMILY)).toBe(true)
    expect(rows[0].prefix).toHaveLength(26) // the length of every oag_ prefix
    expect(rows[0].revokedAt?.getTime()).toBe(0) // pending: nothing usable until the agent collects it
    expect(h.notices).toEqual([expect.objectContaining({ recipientId: 'p1', type: 'system', url: '/dashboard/dev' })])
    expect(await A.completeClaim(open, 'p1', 'shop1', now())).toBe(false)
    expect(h.rows.size).toBe(1)
    expect(await A.lookupByCode(personHash(), r.claim.user_code, now())).toBeNull() // answered: the code is spent
  })

  it('the agent ticket is its own sealed type: a consent ticket never opens as one, nor one from another issuer', async () => {
    const t = G.issueAgentTicket({ reg: 'a'.repeat(20), n: 1, pid: 'p1', sid: 'shop1' }, now(), 600)!
    expect(G.openAgentTicket(t, now())).toMatchObject({ reg: 'a'.repeat(20), pid: 'p1', iss: OAUTH_ISSUER })
    expect(G.openAgentTicket(t, now() + 601)).toBeNull()
    const consent = G.issueConsentTicket({ clientId: 'https://x.example/c.json', redirectUri: 'https://x.example/cb', state: 's', codeChallenge: 'c'.repeat(43), scopes: ['listings:read'], resource: G.MCP_RESOURCE }, 'p1', ['shop1'], now())!
    expect(G.openAgentTicket(consent, now())).toBeNull()
    expect(G.openConsentTicket(t, now())).toBeNull()
  })
})

describe('the agent\'s side: the claim poll and jwt-bearer', () => {
  it('pending → slow_down when too fast → the ONE answer → a second collection is a replay that ends the connection', async () => {
    const r = await registered()
    expect(await A.pollClaim(r.claim_token, now())).toMatchObject({ ok: false, error: 'authorization_pending' })
    expect(await A.pollClaim(r.claim_token, now())).toMatchObject({ ok: false, error: 'slow_down' })
    clearPoll()
    const open = (await A.lookupByCode(personHash(), r.claim.user_code, now()))!
    await A.completeClaim(open, 'p1', 'shop1', now())
    const got = await A.pollClaim(r.claim_token, now())
    if (!got.ok) throw new Error(got.error)
    expect(got.identityAssertion).toMatch(/^eno_ia_[a-z0-9]+_[A-Za-z0-9_-]{43}$/)
    const row = h.rows.get(got.grant.keyId)!
    expect(row.revokedAt).toBeNull()
    expect(row.name).toMatch(/^AI agent \(connected \d{4}-\d{2}-\d{2}\)$/)
    expect(row.hashedKey).toBe(G.labelledHash('eno-ia', got.identityAssertion))
    clearPoll()
    expect(await A.pollClaim(r.claim_token, now())).toMatchObject({ ok: false, error: 'invalid_grant' })
    expect(h.rows.get(got.grant.keyId)!.revokedAt).not.toBeNull()
    expect(await A.exchangeAssertion(got.identityAssertion, undefined, now())).toMatchObject({ ok: false, error: 'invalid_grant' })
  })

  it('Cancel → access_denied; an unknown, forged or expired claim_token → expired_token', async () => {
    const r = await registered()
    const open = (await A.lookupByCode(personHash(), r.claim.user_code, now()))!
    expect(await A.denyClaim(open)).toBe(true)
    expect(await A.pollClaim(r.claim_token, now())).toMatchObject({ ok: false, error: 'access_denied' })
    clearPoll()
    expect(await A.pollClaim(r.claim_token.slice(0, -1) + (r.claim_token.endsWith('A') ? 'B' : 'A'), now())).toMatchObject({ ok: false, error: 'expired_token' })
    expect(await A.pollClaim('nonsense', now())).toMatchObject({ ok: false, error: 'expired_token' })
    expect(await A.pollClaim(r.claim_token, now() + A.REGISTRATION_TTL_SECONDS + 1)).toMatchObject({ ok: false, error: 'expired_token' })
  })

  it('a shop that can no longer connect is not collected', async () => {
    const r = await allowed()
    h.profile = { accountType: 'individual', enforcementState: 'good_standing' }
    expect(await A.pollClaim(r.claim_token, now())).toMatchObject({ ok: false, error: 'invalid_grant' })
  })

  it('jwt-bearer: the issued assertion (re-presentable), narrowing only; an ID-JAG, a wrong secret or an ended connection is refused', async () => {
    const r = await allowed()
    const got = await A.pollClaim(r.claim_token, now())
    if (!got.ok) throw new Error(got.error)
    const ex = await A.exchangeAssertion(got.identityAssertion, undefined, now())
    expect(ex).toMatchObject({ ok: true, grant: { keyId: got.grant.keyId, scopes: G.DEFAULT_SIGN_IN_SCOPES } })
    expect(await A.exchangeAssertion(got.identityAssertion, undefined, now())).toMatchObject({ ok: true }) // not rotated
    expect(await A.exchangeAssertion(got.identityAssertion, 'listings:read', now())).toMatchObject({ ok: true, grant: { scopes: ['listings:read'] } })
    expect(await A.exchangeAssertion(got.identityAssertion, 'media:write', now())).toMatchObject({ ok: false, error: 'invalid_scope' })
    expect(await A.exchangeAssertion('eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJ4In0.sig', undefined, now())).toMatchObject({ ok: false, error: 'invalid_grant', description: expect.stringContaining('ID-JAG') })
    expect(await A.exchangeAssertion(got.identityAssertion.slice(0, -2) + 'zz', undefined, now())).toMatchObject({ ok: false, error: 'invalid_grant' })
    h.rows.get(got.grant.keyId)!.revokedAt = new Date() // Disconnect in Dashboard › Developers
    expect(await A.exchangeAssertion(got.identityAssertion, undefined, now())).toMatchObject({ ok: false, error: 'invalid_grant' })
  })

  it('jwt-bearer past the 180-day cap ends the connection', async () => {
    const r = await allowed()
    const got = await A.pollClaim(r.claim_token, now())
    if (!got.ok) throw new Error(got.error)
    expect(await A.exchangeAssertion(got.identityAssertion, undefined, now() + G.GRANT_MAX_AGE_SECONDS + 10)).toMatchObject({ ok: false, error: 'invalid_grant' })
    expect(h.rows.get(got.grant.keyId)!.revokedAt).not.toBeNull()
  })
})

describe('kept apart from Sign in with eno', () => {
  it('⛔ an agent grant row is never refreshed by the sign-in refresh grant — refused WITHOUT ending it', async () => {
    const r = await allowed()
    const got = await A.pollClaim(r.claim_token, now())
    if (!got.ok) throw new Error(got.error)
    const fake = `eno_rt_${got.grant.keyId}_${'x'.repeat(43)}`
    expect(await G.rotateRefresh({ refreshToken: fake, clientId: G.AGENT_CLIENT_LABEL }, now())).toMatchObject({ ok: false, error: 'invalid_grant' })
    expect(h.rows.get(got.grant.keyId)!.revokedAt).toBeNull()
  })

  it('⛔ the consent prune leaves EVERY edition\'s pending agent rows alone (one database, two issuers)', async () => {
    const other = `${G.AGENT_GRANT_FAMILY}ffff00000000` // another issuer's tag, same family
    h.rows.set('other', { id: 'other', sellerId: 'shop9', profileId: 'p9', name: 'AI agent (connection pending)', prefix: other, hashedKey: 'x', scopes: 'listings:read', lastUsedAt: null, revokedAt: new Date(0), createdAt: new Date(Date.now() - 20 * 60_000) })
    await G.approve({ clientId: 'https://x.example/c.json', redirectUri: 'https://x.example/cb', state: 's', codeChallenge: 'c'.repeat(43), scopes: ['listings:read'], resource: G.MCP_RESOURCE, pid: 'p1', sellers: ['shop1'], exp: now() + 60, nonce: 'n' }, 'shop1', 'X', now())
    expect(h.rows.has('other')).toBe(true)
    // …and this edition's agent code never touches the other issuer's rows as its own.
    expect(other.startsWith(G.AGENT_GRANT_PREFIX)).toBe(G.AGENT_GRANT_PREFIX.endsWith('ffff'))
  })

  it('the consent prune (10 minutes) leaves a pending agent row alone; its own prune takes it after its window', async () => {
    const r = await registered()
    const open = (await A.lookupByCode(personHash(), r.claim.user_code, now()))!
    await A.completeClaim(open, 'p1', 'shop1', now())
    const row = [...h.rows.values()][0]
    row.createdAt = new Date(Date.now() - 20 * 60_000)
    await G.approve({ clientId: 'https://x.example/c.json', redirectUri: 'https://x.example/cb', state: 's', codeChallenge: 'c'.repeat(43), scopes: ['listings:read'], resource: G.MCP_RESOURCE, pid: 'p1', sellers: ['shop1'], exp: now() + 60, nonce: 'n' }, 'shop1', 'X', now())
    expect(h.rows.has(row.id)).toBe(true)
    row.createdAt = new Date(Date.now() - (A.REGISTRATION_TTL_SECONDS + 700) * 1000)
    const r2 = await A.registerServiceAuth('second@example.com', now())
    const open2 = (await A.lookupByCode(A.emailHash('second@example.com'), r2!.claim.user_code, now()))!
    await A.completeClaim(open2, 'p1', 'shop1', now())
    expect(h.rows.has(row.id)).toBe(false)
  })
})

describe('through the token endpoint', () => {
  const token = async (form: Record<string, string>) => {
    const { POST } = await import('@/app/api/v1/oauth/token/route')
    return POST(new Request('https://eno.vn/api/v1/oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() }) as never)
  }

  it('claim poll → an access token for the MCP server + identity_assertion; jwt-bearer → a fresh one; never a refresh_token', async () => {
    const r = await registered()
    const pending = await token({ grant_type: A.CLAIM_GRANT, claim_token: r.claim_token })
    expect(pending.status).toBe(400)
    expect(await pending.json()).toMatchObject({ error: 'authorization_pending' })
    clearPoll()
    const open = (await A.lookupByCode(personHash(), r.claim.user_code, now()))!
    await A.completeClaim(open, 'p1', 'shop1', now())
    const res = await token({ grant_type: A.CLAIM_GRANT, claim_token: r.claim_token })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ token_type: 'Bearer', identity_assertion: expect.stringMatching(/^eno_ia_/), assertion_expires: expect.any(String) })
    expect(body.refresh_token).toBeUndefined()
    expect(verifyAccessToken(body.access_token, now())).toMatchObject({ aud: G.MCP_RESOURCE, sellerId: 'shop1', profileId: 'p1' })
    const again = await token({ grant_type: A.JWT_BEARER_GRANT, assertion: body.identity_assertion })
    expect(again.status).toBe(200)
    const b2 = await again.json()
    expect(b2.identity_assertion).toBeUndefined()
    expect(b2.refresh_token).toBeUndefined()
    expect(verifyAccessToken(b2.access_token, now())).toMatchObject({ aud: G.MCP_RESOURCE })
  })

  it('⛔ the agent\'s token works on the MCP server, is refused on /api/v1, and stops at once on Disconnect', async () => {
    const r = await allowed()
    clearPoll()
    const body = await (await token({ grant_type: A.CLAIM_GRANT, claim_token: r.claim_token })).json()
    const { resolveApiKey } = await import('./auth')
    const req = () => new Request('https://eno.vn/api/mcp', { headers: { authorization: `Bearer ${body.access_token}` } })
    expect(await resolveApiKey(req(), undefined, { resource: G.MCP_RESOURCE })).toMatchObject({ ok: true })
    expect(await resolveApiKey(req(), 'listings:read')).toMatchObject({ ok: false, status: 401 }) // /api/v1: no resource
    const keyId = verifyAccessToken(body.access_token, now())!.keyId
    h.rows.get(keyId)!.revokedAt = new Date() // Disconnect in Dashboard › Developers
    expect(await resolveApiKey(req(), undefined, { resource: G.MCP_RESOURCE })).toMatchObject({ ok: false, status: 401 })
  })

  it('names the five grants when the grant_type is unknown, and needs no client_id for the agent grants', async () => {
    const bad = await (await token({ grant_type: 'password' })).json()
    expect(bad.error).toBe('unsupported_grant_type')
    expect(bad.error_description).toContain(A.CLAIM_GRANT)
    expect(bad.error_description).toContain(A.JWT_BEARER_GRANT)
    expect(await (await token({ grant_type: A.JWT_BEARER_GRANT, assertion: 'x' })).json()).toMatchObject({ error: 'invalid_grant' })
  })
})

describe('the page handlers', () => {
  const form = (path: string, fields: Record<string, string>, origin = 'https://eno.vn') => {
    const fd = new FormData()
    for (const [k, v] of Object.entries(fields)) fd.set(k, v)
    return new Request(`https://eno.vn${path}`, { method: 'POST', headers: { origin }, body: fd })
  }
  const lookup = async (fields: Record<string, string>, origin?: string) => (await import('@/app/api/agent/identity/claim/lookup/route')).POST(form('/api/agent/identity/claim/lookup', fields, origin))
  const complete = async (fields: Record<string, string>, origin?: string) => (await import('@/app/api/agent/identity/claim/complete/route')).POST(form('/api/agent/identity/claim/complete', fields, origin))
  // ⛔ A RELATIVE Location: never built from req.url, which behind nginx may be the container's host.
  const to = (res: Response) => {
    const loc = res.headers.get('location')!
    expect(loc.startsWith('/oauth/agent')).toBe(true)
    return new URL(loc, 'https://eno.vn')
  }

  it('code → ticket → Allow: every answer a 303 back to /oauth/agent; the agent then collects', async () => {
    const r = await registered()
    expect((await lookup({ user_code: r.claim.user_code }, 'https://evil.example')).status).toBe(403)
    const wrong = await lookup({ user_code: r.claim.user_code === '123456' ? '654321' : '123456' })
    expect(wrong.status).toBe(303)
    expect(to(wrong).searchParams.get('e')).toBe('code')
    const found = await lookup({ user_code: r.claim.user_code })
    expect(to(found).pathname).toBe('/oauth/agent')
    const ticket = to(found).searchParams.get('ticket')!
    expect(ticket).toBeTruthy()
    expect((await complete({ allow: ticket }, 'https://evil.example')).status).toBe(403)
    const done = await complete({ allow: ticket })
    expect(to(done).searchParams.get('done')).toBe('allowed')
    expect(to(await complete({ allow: ticket })).searchParams.get('done')).toBe('allowed') // a double tap: the first answer
    expect((await A.pollClaim(r.claim_token, now())).ok).toBe(true)
  })

  it('⛔ another signed-in account, or one whose confirmed email is not the registered one, cannot answer', async () => {
    const r = await registered()
    const ticket = to(await lookup({ user_code: r.claim.user_code })).searchParams.get('ticket')!
    h.user = { id: 'p2', email: EMAIL, email_confirmed_at: '2026-01-01T00:00:00Z' }
    expect(to(await complete({ allow: ticket })).searchParams.get('e')).toBe('expired')
    h.user = { id: 'p3', email: 'intruder@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' }
    expect(to(await lookup({ user_code: r.claim.user_code })).searchParams.get('e')).toBe('code')
    h.user = { id: 'p4', email: EMAIL, email_confirmed_at: null }
    expect(to(await lookup({ user_code: r.claim.user_code })).searchParams.get('e')).toBe('email')
    expect(h.rows.size).toBe(0)
  })

  it('Cancel tells the agent no; a person without an eligible shop is told why before anything is made', async () => {
    const r = await registered()
    h.profile = { accountType: 'individual', enforcementState: 'good_standing' }
    expect(to(await lookup({ user_code: r.claim.user_code })).searchParams.get('e')).toBe('not_business')
    h.profile = { accountType: 'business', enforcementState: 'good_standing' }
    const ticket = to(await lookup({ user_code: r.claim.user_code })).searchParams.get('ticket')!
    expect(to(await complete({ deny: ticket })).searchParams.get('done')).toBe('denied')
    expect(await A.pollClaim(r.claim_token, now())).toMatchObject({ ok: false, error: 'access_denied' })
    expect(h.rows.size).toBe(0)
  })
})
