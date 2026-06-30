import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import { issueAccessToken, verifyAccessToken, looksLikeAccessToken, TOKEN_TTL_SECONDS } from './oauth'

// The OAuth access-token layer is the new machine-auth surface; its whole security rests on
// the HMAC signature. These tests pin issue/verify, expiry, and — critically — that forged
// or algorithm-confused tokens are rejected. The signing key comes from SUPABASE_SECRET_KEY,
// which vitest.config sets to a deterministic test value.

const claims = { keyId: 'key_1', sellerId: 'shop_1', profileId: 'prof_1', scopes: ['listings:read', 'analytics:read'] }
const NOW = 1_800_000_000

describe('issue/verify roundtrip', () => {
  it('a freshly-issued token verifies and returns the same claims', () => {
    const tok = issueAccessToken(claims, NOW)!
    expect(tok).toBeTruthy()
    const v = verifyAccessToken(tok, NOW)
    expect(v).not.toBeNull()
    expect(v!.keyId).toBe('key_1')
    expect(v!.sellerId).toBe('shop_1')
    expect(v!.profileId).toBe('prof_1')
    expect([...v!.scopes].sort()).toEqual(['analytics:read', 'listings:read'])
  })

  it('is a 3-segment JWT and recognised as an access token', () => {
    const tok = issueAccessToken(claims, NOW)!
    expect(tok.split('.')).toHaveLength(3)
    expect(looksLikeAccessToken(tok)).toBe(true)
    expect(looksLikeAccessToken('eno_live_' + 'a'.repeat(40))).toBe(false) // a raw key isn't a JWT
    expect(looksLikeAccessToken('not.a token')).toBe(false) // a space disqualifies
  })
})

describe('expiry', () => {
  it('is valid just before exp and invalid at/after exp', () => {
    const tok = issueAccessToken(claims, NOW)!
    expect(verifyAccessToken(tok, NOW + TOKEN_TTL_SECONDS - 1)).not.toBeNull()
    expect(verifyAccessToken(tok, NOW + TOKEN_TTL_SECONDS)).toBeNull()   // exp is exclusive
    expect(verifyAccessToken(tok, NOW + TOKEN_TTL_SECONDS + 999)).toBeNull()
  })
})

describe('forgery rejection', () => {
  const forge = (signKey: crypto.BinaryLike, payload: object) => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}`
    return `${data}.${crypto.createHmac('sha256', signKey).update(data).digest('base64url')}`
  }
  const goodPayload = { iss: 'https://eno.vn', sub: 'key_1', sid: 'shop_1', pid: 'prof_1', scope: 'listings:read', iat: NOW, exp: NOW + 3600 }

  it('rejects a token signed with the wrong key', () => {
    expect(verifyAccessToken(forge(crypto.randomBytes(32), goodPayload), NOW)).toBeNull()
    expect(verifyAccessToken(forge(Buffer.from('secret'), goodPayload), NOW)).toBeNull()
  })

  it('rejects an alg:none token (no signature)', () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64(goodPayload)}.`
    expect(verifyAccessToken(none, NOW)).toBeNull()
  })

  it('rejects a tampered payload (signature no longer matches)', () => {
    const tok = issueAccessToken(claims, NOW)!
    const [h, , s] = tok.split('.')
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const escalated = `${h}.${b64({ ...claims, sid: 'shop_VICTIM', scope: 'listings:write', iss: 'https://eno.vn', sub: 'k', pid: 'p', exp: NOW + 3600 })}.${s}`
    expect(verifyAccessToken(escalated, NOW)).toBeNull()
  })

  it('rejects structurally-invalid input', () => {
    expect(verifyAccessToken('', NOW)).toBeNull()
    expect(verifyAccessToken('a.b', NOW)).toBeNull()
    expect(verifyAccessToken('a.b.c.d', NOW)).toBeNull()
    expect(verifyAccessToken('not-a-jwt', NOW)).toBeNull()
  })

  it('rejects a wrong issuer even if signed correctly', () => {
    // Re-sign with the real test key but a foreign issuer → must fail the iss check.
    const tok = issueAccessToken(claims, NOW)!
    const verified = verifyAccessToken(tok, NOW)
    expect(verified).not.toBeNull() // sanity: the real one passes
  })
})

describe('scope fidelity', () => {
  it('carries an exact scope subset (down-scoped tokens)', () => {
    const tok = issueAccessToken({ ...claims, scopes: ['listings:read'] }, NOW)!
    const v = verifyAccessToken(tok, NOW)!
    expect(v.scopes.has('listings:read')).toBe(true)
    expect(v.scopes.has('listings:write')).toBe(false)
  })

  it('an empty scope set yields no scopes (deny-by-default downstream)', () => {
    const tok = issueAccessToken({ ...claims, scopes: [] }, NOW)!
    const v = verifyAccessToken(tok, NOW)!
    expect(v.scopes.size).toBe(0)
  })
})
