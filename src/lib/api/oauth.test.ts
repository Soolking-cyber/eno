import { describe, it, expect } from 'vitest'
import crypto from 'crypto'
import { issueAccessToken, verifyAccessToken, looksLikeAccessToken, TOKEN_TTL_SECONDS, OAUTH_ISSUER, LEGACY_ISSUER_UNTIL } from './oauth'

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

  it('accepts the legacy issuer BEFORE the cutoff and rejects it after', () => {
    // The transition window closes on a CLOCK, not on a future commit — an external reviewer
    // pointed out that a comment saying "delete this later" is a permanent widening with a TODO
    // attached. This is the test that makes the closing real: nothing here needs maintaining, and
    // if someone removes the cutoff to "fix" a red test, the second assertion goes red instead.
    const key = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(process.env.SUPABASE_SECRET_KEY!), Buffer.from('eno-oauth-v1'), Buffer.from('partner-api-access-token'), 32))
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const header = b64({ alg: 'HS256', typ: 'JWT' })
    const mint = (iss: string, at: number) => {
      const payload = b64({ iss, sub: 'key_1', sid: 'shop_1', pid: 'prof_1', scope: 'listings:read', exp: at + 900 })
      return `${header}.${payload}.${crypto.createHmac('sha256', key).update(`${header}.${payload}`).digest('base64url')}`
    }
    // ⚠️ RELATIVE TO NOW, NOT ABSOLUTE DATES. The window is anchored to PROCESS START (see
    // oauth.ts) precisely so that an owner-gated deploy weeks after the commit still gets its
    // transition hour. Absolute dates here would re-import the bug the anchor removes: this test
    // would start failing on a calendar boundary rather than on a behaviour change.
    const REAL_NOW = Math.floor(Date.now() / 1000)
    // A moment safely past the hard stop, whatever today is.
    const LEGACY_ISSUER_HARD_STOP_PROBE = Math.floor(Date.parse('2027-06-01T00:00:00Z') / 1000)
    const BEFORE = REAL_NOW + 60
    const AFTER = REAL_NOW + TOKEN_TTL_SECONDS * 2

    // ⛔ GATED ON THE WINDOW ACTUALLY BEING OPEN, AND THE PREVIOUS VERSION WAS NOT.
    // A reviewer caught this one turn after I introduced it: `LEGACY_ISSUER_UNTIL` is
    // `min(processStart + TTL, HARD_STOP)`, so once real time passes the hard stop the minimum
    // collapses to it, `BEFORE` (now + 60s) is past the cutoff, and this assertion goes red on a
    // calendar boundary with nobody having touched the code. That is precisely the failure the
    // comment above claims to have designed out — and the kind of red test someone "fixes" by
    // widening the very window it exists to bound. Asking the module when its window shuts, rather
    // than assuming, makes the test true on every date.
    if (REAL_NOW < LEGACY_ISSUER_UNTIL) {
      // Inside the window a marketplace-issued token still verifies on this build…
      expect(verifyAccessToken(mint('https://eno.vn', BEFORE), BEFORE)).not.toBeNull()
    }
    // …and once the hard stop has passed, it never does again, on any clock.
    expect(verifyAccessToken(mint('https://eno.vn', LEGACY_ISSUER_HARD_STOP_PROBE), LEGACY_ISSUER_HARD_STOP_PROBE)).toBeNull()
    // …and outside it, the allowlist is a single value again with no commit required.
    if (OAUTH_ISSUER !== 'https://eno.vn') {
      expect(verifyAccessToken(mint('https://eno.vn', AFTER), AFTER)).toBeNull()
    }
    // The current issuer is unaffected by the cutoff, in both directions.
    expect(verifyAccessToken(mint(OAUTH_ISSUER, AFTER), AFTER)).not.toBeNull()
  })

  it('rejects a wrong issuer even if signed correctly', () => {
    // ACTUALLY forge one (audit: this test previously never constructed a wrong-issuer
    // token — the suite stayed green with the iss check deleted). Re-derive the signing
    // key exactly as oauth.ts does and mint a correctly-signed token whose only flaw is
    // a foreign issuer: the signature check passes, the iss check must be what rejects.
    const key = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(process.env.SUPABASE_SECRET_KEY!), Buffer.from('eno-oauth-v1'), Buffer.from('partner-api-access-token'), 32))
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const header = b64({ alg: 'HS256', typ: 'JWT' })
    const payload = b64({ iss: 'https://evil.example', sub: 'key_1', sid: 'shop_1', pid: 'prof_1', scope: 'listings:read', exp: NOW + 900 })
    const sig = crypto.createHmac('sha256', key).update(`${header}.${payload}`).digest('base64url')
    const forged = `${header}.${payload}.${sig}`
    // Sanity: the signature itself is valid for our key (same-issuer variant verifies)…
    // ⚠️ THE CONTROL USES `OAUTH_ISSUER`, NOT THE LITERAL 'https://eno.vn'. It used to hardcode
    // that literal, which is the LEGACY issuer — accepted only until LEGACY_ISSUER_UNTIL. NOW is
    // 1_800_000_000 (2027-01-15), past that cutoff, so the control token stopped verifying and
    // this test went red for a reason that had nothing to do with what it tests. Reading the
    // issuer from the module keeps the control valid at any clock and on either edition, and the
    // assertion below still proves the one thing this test is for: the signature is good, so the
    // `iss` check is the only thing that can be rejecting the forgery.
    const goodPayload = b64({ iss: OAUTH_ISSUER, sub: 'key_1', sid: 'shop_1', pid: 'prof_1', scope: 'listings:read', exp: NOW + 900 })
    const goodSig = crypto.createHmac('sha256', key).update(`${header}.${goodPayload}`).digest('base64url')
    expect(verifyAccessToken(`${header}.${goodPayload}.${goodSig}`, NOW)).not.toBeNull()
    // …so the ONLY thing rejecting the forgery is the issuer check.
    expect(verifyAccessToken(forged, NOW)).toBeNull()
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
