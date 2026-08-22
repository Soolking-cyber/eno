import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const load = async () => { vi.resetModules(); return import('./unsubscribe-token') }
beforeEach(() => { vi.stubEnv('SUPABASE_SECRET_KEY', 'test-base-secret-value') })
afterEach(() => { vi.unstubAllEnvs() })

describe('unsubscribe tokens are derived, not stored', () => {
  it('round-trips the profile id', async () => {
    const { mintUnsubscribeToken, verifyUnsubscribeToken } = await load()
    const t = mintUnsubscribeToken('cku1abc234')!
    expect(t.startsWith('cku1abc234.')).toBe(true)
    expect(verifyUnsubscribeToken(t)).toBe('cku1abc234')
  })

  it('⛔ REJECTS A FORGED SIGNATURE — the whole point', async () => {
    const { mintUnsubscribeToken, verifyUnsubscribeToken } = await load()
    const t = mintUnsubscribeToken('victim-profile')!
    expect(verifyUnsubscribeToken('victim-profile.' + 'A'.repeat(t.split('.')[1].length))).toBeNull()
    // and you cannot lift another profile's signature onto your own id
    const other = mintUnsubscribeToken('other-profile')!
    expect(verifyUnsubscribeToken(`victim-profile.${other.split('.')[1]}`)).toBeNull()
  })

  it('⚠️ A LENGTH MISMATCH RETURNS NULL, IT DOES NOT THROW', async () => {
    // timingSafeEqual throws on unequal lengths, so an attacker choosing the signature
    // length would otherwise turn a rejection into a 500.
    const { verifyUnsubscribeToken } = await load()
    expect(() => verifyUnsubscribeToken('id.short')).not.toThrow()
    expect(verifyUnsubscribeToken('id.short')).toBeNull()
  })

  it('rejects malformed shapes without throwing', async () => {
    const { verifyUnsubscribeToken } = await load()
    for (const bad of ['', 'no-dot', '.leadingdot', 'trailingdot.', null, undefined]) {
      expect(verifyUnsubscribeToken(bad as string)).toBeNull()
    }
  })

  it('⛔ FAILS CLOSED WITH NO SECRET — never mints, never verifies', async () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', '')
    vi.stubEnv('CRON_SECRET', '')
    const { mintUnsubscribeToken, verifyUnsubscribeToken } = await load()
    expect(mintUnsubscribeToken('anyone')).toBeNull()
    // A constant here would make every signature forgeable by anyone who noticed.
    expect(verifyUnsubscribeToken('anyone.anything')).toBeNull()
  })

  it('is stable across calls, so a link keeps working months later', async () => {
    // Deliberately un-expiring: a dead unsubscribe link is a compliance problem.
    const { mintUnsubscribeToken } = await load()
    expect(mintUnsubscribeToken('p1')).toBe(mintUnsubscribeToken('p1'))
  })

  it('⛔ IS DOMAIN-SEPARATED FROM THE PARTNER-API KEY — same base secret, different key', async () => {
    // The first version of this test asserted only that mint returned something and
    // that the oauth module imported, which proved nothing at all. All three reviewers
    // said so. This derives the OTHER key from the SAME base secret and requires the
    // signatures to differ: without distinct HKDF info labels an access token could be
    // replayed as an unsubscribe token.
    const crypto = await import('node:crypto')
    const { mintUnsubscribeToken } = await load()
    const ikm = Buffer.from('test-base-secret-value')
    const oauthKey = Buffer.from(
      crypto.hkdfSync('sha256', ikm, Buffer.from('eno-oauth-v1'), Buffer.from('partner-api-access-token'), 32),
    )
    const asOauth = crypto.createHmac('sha256', oauthKey).update('p1').digest('base64url')
    const asUnsub = mintUnsubscribeToken('p1')!.split('.')[1]
    expect(asUnsub).not.toBe(asOauth)
  })

  it('⚠️ NON-STRING INPUT IS REJECTED, NOT THROWN ON', async () => {
    // A JSON body can carry a number, an array or an object where a token is expected.
    const { verifyUnsubscribeToken } = await load()
    for (const bad of [123, {}, [], true]) {
      expect(() => verifyUnsubscribeToken(bad as unknown as string)).not.toThrow()
      expect(verifyUnsubscribeToken(bad as unknown as string)).toBeNull()
    }
  })

})
