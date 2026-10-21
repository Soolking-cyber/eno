import { describe, it, expect, beforeAll } from 'vitest'

/**
 * The REAL digest, unmocked. The KYC tests stand in an opaque fake for `hmacSubject`, which cannot see one
 * equivalence a typed passport depends on (2026-10-21): the submit path digests it with `issuer: undefined`
 * (it has no nationality), the camera path stores `issuer: ''` as `anyIssuerHash`, and review.ts re-digests
 * the reviewer's re-typed number with no options at all. All three must be the same digest, or every typed
 * approval answers `number_mismatch` and the cross-namespace match never meets.
 */
beforeAll(() => { process.env.IDENTITY_HASH_PEPPER = 'test-pepper-0123456789-0123456789-abcdef' })

describe('hmacSubject', () => {
  it('no issuer, an undefined issuer and an empty issuer are one namespace', async () => {
    const { hmacSubject } = await import('./subject-hash')
    const bare = hmacSubject('X1234567')
    expect(hmacSubject('X1234567', { issuer: undefined })).toBe(bare)
    expect(hmacSubject('X1234567', { issuer: '' })).toBe(bare)
    // …and a real issuer is a different one: a number is only unique within its issuing country.
    expect(hmacSubject('X1234567', { issuer: 'SWE' })).not.toBe(bare)
  })

  it('normalises the way people copy a number — spaces, dashes, filler, case', async () => {
    const { hmacSubject } = await import('./subject-hash')
    expect(hmacSubject(' x123 4567<< ', { issuer: 'swe' })).toBe(hmacSubject('X1234567', { issuer: 'SWE' }))
  })
})
