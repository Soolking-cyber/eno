import { describe, it, expect } from 'vitest'
import { API_KEY_RE, API_KEY_BODY_LENGTH, generateApiKey } from './auth'

describe('generateApiKey — the generator honours the validator (review R01)', () => {
  it('every one of 2,000 fresh keys passes API_KEY_RE', () => {
    for (let i = 0; i < 2000; i++) {
      const { secret, prefix, hashedKey } = generateApiKey(i % 2 ? 'live' : 'test')
      expect(secret).toMatch(API_KEY_RE)
      expect(prefix).toBe(secret.slice(0, 16))
      expect(hashedKey).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('bytes that base64url would have spelled as - or _ no longer shorten the body', () => {
    // 62 and 63 are exactly the base64url positions of `-` and `_`; the old code stripped them.
    const worst = Buffer.alloc(API_KEY_BODY_LENGTH, 63)
    const { secret } = generateApiKey('live', () => worst)
    expect(secret).toMatch(API_KEY_RE)
    expect(secret.length).toBe('eno_live_'.length + API_KEY_BODY_LENGTH)
  })

  it('rejection sampling: bytes ≥ 248 are skipped, everything else maps uniformly onto the alphabet', () => {
    let calls = 0
    const feed = () => {
      calls++
      // first call: all rejected; second call: 0..31 → the first 32 alphabet characters
      return calls === 1 ? Buffer.alloc(API_KEY_BODY_LENGTH, 255) : Buffer.from(Array.from({ length: 32 }, (_, i) => i))
    }
    const { secret } = generateApiKey('test', feed)
    expect(secret).toBe('eno_test_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef')
  })

  it('a random source that never yields a usable byte fails loudly instead of spinning', () => {
    expect(() => generateApiKey('live', () => Buffer.alloc(API_KEY_BODY_LENGTH, 250))).toThrow(/entropy/)
  })
})
