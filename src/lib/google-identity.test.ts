import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { makeNoncePair, googleIdentityEnabled } from './google-identity'

/**
 * The nonce pairing for supabase.auth.signInWithIdToken + Google Identity Services.
 *
 * ⚠️ THIS IS THE ONE THAT FAILS SILENTLY. Getting it backwards does not break sign-in — the form
 * falls back to the old redirect OAuth on any error — it just means the branded consent screen
 * never appears and nobody finds out. So the invariant is pinned here rather than left to a
 * manual check nobody repeats.
 *
 * The contract (supabase/auth `internal/api/token_oidc.go`, IdTokenGrant):
 *     hash := fmt.Sprintf("%x", sha256.Sum256([]byte(params.Nonce)))
 *     if hash != idToken.Nonce { "Nonces mismatch" }
 * GoTrue hashes the nonce WE pass and compares it to the token's claim; Google copies the nonce
 * it was given into that claim verbatim. Therefore Google must receive the digest (`hashed`) and
 * Supabase the pre-image (`raw`).
 */
describe('makeNoncePair', () => {
  it('gives Google the SHA-256 hex of the value Supabase gets — not the other way round', async () => {
    const pair = await makeNoncePair()
    expect(pair).not.toBeNull()
    const expected = createHash('sha256').update(pair!.raw, 'utf8').digest('hex')
    expect(pair!.hashed).toBe(expected)
    // Guards the inversion specifically: sha256(hashed) must NOT equal raw.
    expect(createHash('sha256').update(pair!.hashed, 'utf8').digest('hex')).not.toBe(pair!.raw)
  })

  it('produces a lowercase 64-char hex digest (the representation GoTrue compares against)', async () => {
    const pair = await makeNoncePair()
    expect(pair!.hashed).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is single-use: a fresh random nonce per call', async () => {
    const [a, b] = await Promise.all([makeNoncePair(), makeNoncePair()])
    expect(a!.raw).not.toBe(b!.raw)
    expect(a!.hashed).not.toBe(b!.hashed)
  })
})

describe('googleIdentityEnabled', () => {
  it('is false with no NEXT_PUBLIC_GOOGLE_CLIENT_ID, so the sign-in form keeps the old OAuth flow', () => {
    // The env var is unset in the test env, and `window` is undefined under environment:'node' —
    // either alone must be enough to keep the branded path switched off.
    expect(googleIdentityEnabled()).toBe(false)
  })
})
