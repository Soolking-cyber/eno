import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * POST /api/seller/identity/challenge — the one door into uploading an identity document, and the moment the declaration
 * is recorded (the challenge carries it to the verification row).
 * ⛔ Pinned (identity-v2, owner 2026-10-16): ONLY the current declaration is issuable. A known but superseded version —
 * a tab rendered before v2 shipped, or a client hard-coding 'identity-v1' — is a 409 `notice_changed` with notice
 * 'declaration' (the verify page says "reload") and records NOTHING; an unknown id stays 400 `invalid_body`; the record
 * carries exactly the version the client rendered and its digest, never one stamped server-side.
 */
type Row = Record<string, unknown>
const h = vi.hoisted(() => ({
  userId: 'p1' as string | null,
  rl: [] as unknown[][],
  rlOk: true,
  issued: [] as Array<{ profileId: string; decl: Row }>,
  issue: null as Row | null,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/admin', () => ({ getCurrentProfileId: async () => h.userId, getAdmin: async () => null, getCurrentProfile: async () => null }))
vi.mock('@/lib/ratelimit', () => ({
  rateLimit: async (...a: unknown[]) => { h.rl.push(a); return { success: h.rlOk, resetSec: 1800 } },
}))
vi.mock('@/lib/log', () => ({ logError: () => {} }))
vi.mock('@/lib/identity/challenge', () => ({
  issueChallenge: async (profileId: string, decl: Row) => { h.issued.push({ profileId, decl }); return h.issue },
}))

const { POST } = await import('./route')
const { CURRENT_DECLARATION, declarationHash } = await import('@/lib/compliance/declaration')

const post = async (body: unknown, headers: Record<string, string> = {}) => {
  const res = await POST(new Request('https://eno.vn/api/seller/identity/challenge', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }))
  return { status: res.status, headers: res.headers, body: (await res.json()) as Row }
}

beforeEach(() => {
  h.userId = 'p1'; h.rl = []; h.rlOk = true; h.issued = []
  h.issue = { ok: true, code: 'K7M3XA', expiresAt: new Date('2026-10-16T10:10:00Z') }
})

describe('POST /api/seller/identity/challenge', () => {
  it('needs a signed-in account — and issues nothing without one', async () => {
    h.userId = null
    expect((await post({ version: CURRENT_DECLARATION, accepted: true })).status).toBe(401)
    expect(h.issued).toEqual([])
  })

  it('the current declaration issues a challenge whose record is that version, its digest, the moment and the Cloudflare ip', async () => {
    expect(CURRENT_DECLARATION).toBe('identity-v2')
    const r = await post({ version: CURRENT_DECLARATION, accepted: true }, { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.9' })
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('no-store')
    // ⛔ No `instruction` (A3, 2026-10-16): nobody is asked to write the code anywhere since 2026-09-04 — exactly two keys.
    expect(r.body).toEqual({ code: 'K7M3XA', expiresAt: '2026-10-16T10:10:00.000Z' })
    expect(h.issued).toHaveLength(1)
    const { profileId, decl } = h.issued[0]
    expect(profileId).toBe('p1')
    expect(decl).toMatchObject({ version: 'identity-v2', hash: declarationHash('identity-v2'), ip: '203.0.113.7' })
    expect(decl.declaredAt).toBeInstanceOf(Date)
    // The strict hourly limiter keys on the account.
    expect(h.rl).toEqual([['identity-challenge', 'p1', 20, '1 h', { strict: true }]])
  })

  it('⛔ a SUPERSEDED declaration (identity-v1) is refused with 409 notice_changed / declaration — and nothing is recorded', async () => {
    expect(declarationHash('identity-v1')).not.toBeNull() // still known: its records verify; it is just never issued again
    const r = await post({ version: 'identity-v1', accepted: true })
    expect(r.status).toBe(409)
    expect(r.body).toEqual({ error: 'notice_changed', notice: 'declaration' })
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(h.issued).toEqual([])
  })

  it('an UNKNOWN version stays 400 invalid_body — refused, never coerced to the current one', async () => {
    for (const version of ['identity-v0', 'identity-v3', 'IDENTITY-V2', '', 'x'.repeat(41)]) {
      const r = await post({ version, accepted: true })
      expect(r.status, version).toBe(400)
      expect(r.body, version).toEqual({ error: 'invalid_body' })
    }
    expect(h.issued).toEqual([])
  })

  it('⛔ only an explicit `accepted: true` makes a record — false, a string, or nothing is a 400', async () => {
    for (const body of [{ version: CURRENT_DECLARATION, accepted: false }, { version: CURRENT_DECLARATION, accepted: 'true' }, { version: CURRENT_DECLARATION }, 'not json']) {
      expect((await post(body)).status).toBe(400)
    }
    expect(h.issued).toEqual([])
  })

  it('the issuance cooldown answers 429 with the seconds to wait, in the body and the Retry-After header', async () => {
    h.issue = { ok: false, reason: 'cooldown', retryAfterSeconds: 42 }
    const r = await post({ version: CURRENT_DECLARATION, accepted: true })
    expect(r.status).toBe(429)
    expect(r.body).toEqual({ error: 'cooldown', retryAfterSeconds: 42 })
    expect(r.headers.get('Retry-After')).toBe('42')
  })

  it('the hourly limiter refuses before anything is read or issued', async () => {
    h.rlOk = false
    const r = await post({ version: CURRENT_DECLARATION, accepted: true })
    expect(r.status).toBe(429)
    expect(r.body).toMatchObject({ error: 'rate_limited' })
    expect(h.issued).toEqual([])
  })
})
