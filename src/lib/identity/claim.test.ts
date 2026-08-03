import { describe, it, expect } from 'vitest'
import { requestHash, MAX_ATTEMPTS_PER_DAY } from './claim'

describe('idempotency key binding', () => {
  it('⚠️ different documents with the SAME key must be a MISS, not a cache hit', () => {
    // codex caught this: a key scoped only to the profile lets a client reuse it with different
    // documents and receive the previous answer — a "verified" result for a passport nobody saw.
    const a = requestHash('B', [new Uint8Array([1, 2, 3])])
    const b = requestHash('B', [new Uint8Array([4, 5, 6])])
    expect(a).not.toBe(b)
  })

  it('the same bytes and tier hash identically (a real replay)', () => {
    const files = [new Uint8Array([1, 2, 3]), new Uint8Array([9])]
    expect(requestHash('B', files)).toBe(requestHash('B', [new Uint8Array([1, 2, 3]), new Uint8Array([9])]))
  })

  it('tier is part of the identity — same images, different tier is a different request', () => {
    const f = [new Uint8Array([1])]
    expect(requestHash('A', f)).not.toBe(requestHash('B', f))
  })

  it('file ORDER matters — front and portrait are not interchangeable', () => {
    const x = new Uint8Array([1]), y = new Uint8Array([2])
    expect(requestHash('B', [x, y])).not.toBe(requestHash('B', [y, x]))
  })

  it('caps daily attempts', () => {
    expect(MAX_ATTEMPTS_PER_DAY).toBe(5)
  })
})
