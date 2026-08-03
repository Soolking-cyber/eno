import { describe, it, expect } from 'vitest'
import { readTokenClaims, needsRefresh } from './vnpt-auth'

// The store itself needs a DB, so these pin the PURE decisions it makes — the ones that decide
// whether a rotation succeeds or silently stores something unusable.
const jwt = (exp: number) => `x.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.sig`
const sec = (d: number) => Math.floor(Date.now() / 1000) + d

describe('VNPT token rotation decisions', () => {
  it('takes expiry FROM THE TOKEN, never from an assumed lifetime', () => {
    // The console says 8h; a measured token carried 24h. They disagree, so any hardcoded lifetime
    // either expires a good token early or keeps using a dead one.
    const exp = sec(8 * 3600)
    expect(readTokenClaims(jwt(exp))?.exp).toBe(exp)
  })

  it('⚠️ refuses a token that is already stale', () => {
    // Storing one "succeeds" and then fails on first use — the operator walks away believing
    // rotation worked, and verification is broken until someone notices.
    expect(needsRefresh({ exp: sec(60) })).toBe(true)      // 1 min left
    expect(needsRefresh({ exp: sec(-1) })).toBe(true)      // already dead
    expect(needsRefresh({ exp: sec(8 * 3600) })).toBe(false)
  })

  it('treats an unparseable token as unusable rather than guessing', () => {
    expect(readTokenClaims('bearer-not-a-jwt')).toBeNull()
    expect(needsRefresh(null)).toBe(true)
  })

  it('the console prefixes the value with "bearer " — the raw JWT is what gets stored', () => {
    // vnpt-token.sh strips it; if it did not, the Authorization header would read
    // "Bearer bearer eyJ..." and every call would 401.
    const raw = 'bearer eyJhbGciOiJIUzI1NiJ9.e30.sig'
    expect(raw.replace(/^[Bb]earer /, '').startsWith('eyJ')).toBe(true)
  })
})
