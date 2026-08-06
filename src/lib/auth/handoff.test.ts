import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { normalizePairInput, PAIR_LEN } from './handoff-client'

// ⚠️ WHY THIS FILE EXISTS. The pairing code is the only thing standing between a parked OAuth
// authorization code and an attacker, and it shipped with ZERO tests — in a repo that tests
// auth-policy.ts. Everything here is pure and cheap to check; the DB state machine is exercised
// against a real Postgres by the handoff e2e, not mocked here (a mocked SQL assertion would prove
// the mock matches the code, which is not the property anyone needs).
//
// ⚠️ handoff.ts is `server-only` and reads env at call time, so it is imported dynamically INSIDE
// tests after the env is arranged. A top-level import would freeze the module before the pepper is
// set and make the "throws without a key" case unprovable.
const load = async () => await import('./handoff')

const PEPPER = 'test-pepper-value-that-is-long-enough'

describe('pairing code alphabet', () => {
  beforeEach(() => { process.env.IDENTITY_HASH_PEPPER = PEPPER })

  it('has no duplicate characters', async () => {
    const { newPair } = await load()
    // Recover the alphabet from many draws rather than reaching for the private constant.
    const seen = new Set<string>()
    for (let i = 0; i < 4000; i++) for (const c of newPair()) seen.add(c)
    // The bug this guards: '7' appeared twice in the literal, so it came out at 7.81% against
    // 4.30% for every other character and the real space was 24^6 rather than 25^6.
    expect(seen.size).toBe(24)
  })

  it('excludes every confusable pair, in BOTH directions', async () => {
    const { newPair } = await load()
    const seen = new Set<string>()
    for (let i = 0; i < 4000; i++) for (const c of newPair()) seen.add(c)
    // A code is read off one screen and typed into another; B/8, S/5, Z/2, G/6, I/1, O/0 must not
    // appear at all — leaving either member in costs real sign-ins and burns a five-guess budget.
    for (const c of ['B', '8', 'S', '5', 'Z', '2', 'G', '6', 'I', '1', 'O', '0']) {
      expect(seen.has(c), `alphabet must not contain ${c}`).toBe(false)
    }
  })

  it('is close to uniform — no character is a materially better guess', async () => {
    const { newPair } = await load()
    const counts = new Map<string, number>()
    const draws = 30_000
    for (let i = 0; i < draws; i++) for (const c of newPair()) counts.set(c, (counts.get(c) ?? 0) + 1)
    const freqs = [...counts.values()]
    const expected = (draws * PAIR_LEN) / 24
    // Generous band: this is a bias check, not a randomness proof. The shipped bug sat at 1.8x.
    for (const f of freqs) expect(f / expected).toBeGreaterThan(0.8)
    for (const f of freqs) expect(f / expected).toBeLessThan(1.2)
  })

  it('always returns exactly PAIR_LEN characters', async () => {
    const { newPair } = await load()
    for (let i = 0; i < 500; i++) expect(newPair()).toHaveLength(PAIR_LEN)
  })
})

describe('normalizePair', () => {
  beforeEach(() => { process.env.IDENTITY_HASH_PEPPER = PEPPER })

  it('agrees with the client-side copy on every input shape', async () => {
    const { normalizePair } = await load()
    // ⚠️ THE TWO IMPLEMENTATIONS ARE SEPARATE FILES BY NECESSITY — handoff.ts is server-only, so the
    // sign-in bundle cannot import it. That makes them a sync pair, and a drift here rejects a code
    // the visitor typed correctly. This is the test that catches it.
    for (const raw of ['abc def', 'BSZGIO', 'b s z g i o', '  a-c-d  ', 'AC7D9', 'x'.repeat(40), '']) {
      expect(normalizePair(raw)).toBe(normalizePairInput(raw))
    }
  })

  it('folds confusables and strips separators', async () => {
    const { normalizePair } = await load()
    expect(normalizePair('b-s z')).toBe('852')
    expect(normalizePair('gio')).toBe('610')
    expect(normalizePair('a c d')).toBe('ACD')
  })
})

describe('hashes and the HMAC key', () => {
  const saved = { pepper: process.env.IDENTITY_HASH_PEPPER, secret: process.env.SUPABASE_SECRET_KEY }
  afterEach(() => {
    process.env.IDENTITY_HASH_PEPPER = saved.pepper
    process.env.SUPABASE_SECRET_KEY = saved.secret
  })

  it('browserHash is deterministic and domain-separated from nonceHash', async () => {
    process.env.IDENTITY_HASH_PEPPER = PEPPER
    const { browserHash, nonceHash } = await load()
    const v = 'a'.repeat(43)
    expect(browserHash(v)).toBe(browserHash(v))
    // Same input, different meaning — they must not collide, or a nonce could be replayed as a
    // browser secret and the binding that closes the takeover would be circular.
    expect(browserHash(v)).not.toBe(nonceHash(v))
  })

  it('isNonce accepts a real secret and rejects junk', async () => {
    process.env.IDENTITY_HASH_PEPPER = PEPPER
    const { isNonce, newNonce, newBrowserSecret } = await load()
    expect(isNonce(newNonce())).toBe(true)
    // The browser secret rides through the same validator, so it has to pass it.
    expect(isNonce(newBrowserSecret())).toBe(true)
    for (const bad of ['', 'short', null, undefined, 42, 'has spaces in it '.repeat(4), '!'.repeat(50)]) {
      expect(isNonce(bad)).toBe(false)
    }
  })
})
