import { describe, it, expect } from 'vitest'
import { canonicalJson, computeRowHash } from './audit'

// ⚠️ These are the properties the audit log's evidentiary value rests on. If canonicalisation is
// order-dependent, or a chain link can be forged by reordering keys, the log proves nothing — so
// these are compliance controls, not incidental unit tests.

const base = {
  occurredAt: new Date('2026-08-03T09:00:00.000Z'),
  actorType: 'authority' as const,
  actorId: 'key_1',
  action: 'listing.taken_down',
  subjectType: 'listing' as const,
  subjectId: 'clx8',
  detail: { reason: 'visa_scam', orderReference: 'QD-1234/2026' },
  legalBasis: 'ecommerceLaw' as const,
}

describe('canonicalJson', () => {
  it('is independent of key insertion order', () => {
    // The failure this prevents: the same event, built by two code paths, hashing differently —
    // which makes the chain unverifiable by any independent implementation.
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }))
  })

  it('sorts nested keys too', () => {
    expect(canonicalJson({ x: { z: 1, y: 2 } })).toBe('{"x":{"y":2,"z":1}}')
  })

  it('preserves array order (arrays are sequences, not sets)', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]')
  })

  it('drops undefined rather than emitting invalid JSON', () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}')
  })

  it('does not confuse a nested object with its string form', () => {
    // A naive concatenation scheme lets {"a":"1"} and {"a":1} collide; JSON.stringify on the leaf
    // keeps the type distinction, which is what stops a forged detail matching a real digest.
    expect(canonicalJson({ a: '1' })).not.toBe(canonicalJson({ a: 1 }))
  })
})

describe('computeRowHash', () => {
  it('is deterministic for identical input', () => {
    expect(computeRowHash('aa', base)).toBe(computeRowHash('aa', base))
  })

  it('changes when the predecessor changes — this is the chain', () => {
    // If the hash ignored prevHash, rows would be independently forgeable and deleting one would
    // be undetectable. This assertion IS the tamper-evidence property.
    expect(computeRowHash('aa', base)).not.toBe(computeRowHash('bb', base))
  })

  it('changes when any recorded field changes', () => {
    const original = computeRowHash('aa', base)
    expect(computeRowHash('aa', { ...base, subjectId: 'other' })).not.toBe(original)
    expect(computeRowHash('aa', { ...base, action: 'listing.restored' })).not.toBe(original)
    expect(computeRowHash('aa', { ...base, detail: { reason: 'counterfeit' } })).not.toBe(original)
    expect(computeRowHash('aa', { ...base, occurredAt: new Date('2026-08-03T09:00:01Z') })).not.toBe(original)
  })

  it('is unaffected by how the detail object was assembled', () => {
    const a = computeRowHash('aa', base)
    const b = computeRowHash('aa', {
      ...base,
      detail: { orderReference: 'QD-1234/2026', reason: 'visa_scam' }, // same data, other order
    })
    expect(a).toBe(b)
  })

  it('genesis row (no predecessor) still produces a hash', () => {
    expect(computeRowHash(null, base)).toMatch(/^[0-9a-f]{64}$/)
  })
})
