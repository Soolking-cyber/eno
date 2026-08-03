import { describe, it, expect } from 'vitest'
import {
  DECLARATIONS, CURRENT_DECLARATION, declarationHash, buildDeclaration, verifyDeclaration,
} from './declaration'

describe('identity declaration', () => {
  it('the current version exists and states all four commitments', () => {
    const d = DECLARATIONS[CURRENT_DECLARATION]
    expect(d).toBeDefined()
    for (const n of ['(1)', '(2)', '(3)', '(4)']) {
      expect(d.vi).toContain(n)
      expect(d.en).toContain(n)
    }
  })

  it('⚠️ explicitly places legal responsibility on the declarant', () => {
    // This is the sentence the owner asked for; if it is ever edited away the declaration stops
    // doing the one job it exists to do.
    const d = DECLARATIONS[CURRENT_DECLARATION]
    expect(d.vi).toMatch(/chịu trách nhiệm trước pháp luật/)
    expect(d.en).toMatch(/full legal responsibility/i)
  })

  it('states which language governs', () => {
    // A bilingual legal declaration with no stated precedence is ambiguous exactly when it matters.
    expect(DECLARATIONS[CURRENT_DECLARATION].vi).toMatch(/giá trị pháp lý/)
    expect(DECLARATIONS[CURRENT_DECLARATION].en).toMatch(/legally binding/i)
  })

  it('cites the governing instruments', () => {
    const d = DECLARATIONS[CURRENT_DECLARATION]
    expect(d.vi).toContain('248/2026')
    expect(d.vi).toContain('122/2025')
  })

  it('hashes both languages, so locale does not change the digest', () => {
    // Otherwise the same affirmation yields different digests per user and cannot be compared.
    const h = declarationHash(CURRENT_DECLARATION)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(declarationHash(CURRENT_DECLARATION)).toBe(h) // deterministic
  })

  it('⚠️ REFUSES to record a declaration that was not affirmatively accepted', () => {
    // A record of a declaration nobody actively made is worse than no record: it is false evidence.
    expect(buildDeclaration(CURRENT_DECLARATION, false, '1.2.3.4')).toEqual({ error: 'not_accepted' })
    expect(buildDeclaration('does-not-exist', true, '1.2.3.4')).toEqual({ error: 'unknown_version' })
  })

  it('records version, hash, time and ip on acceptance', () => {
    const now = new Date('2026-08-03T10:00:00Z')
    const r = buildDeclaration(CURRENT_DECLARATION, true, '1.2.3.4', now)
    expect(r).toEqual({
      version: CURRENT_DECLARATION,
      hash: declarationHash(CURRENT_DECLARATION),
      declaredAt: now,
      ip: '1.2.3.4',
    })
  })

  it('detects text edited after the fact', () => {
    // The tampering this exists to expose: rewriting a published version retroactively changes
    // what past users are recorded as having affirmed.
    expect(verifyDeclaration({ version: CURRENT_DECLARATION, hash: declarationHash(CURRENT_DECLARATION)! })).toBe('valid')
    expect(verifyDeclaration({ version: CURRENT_DECLARATION, hash: 'deadbeef' })).toBe('text_changed')
  })

  it('⚠️ distinguishes a retired version from a tampered one', () => {
    // Collapsing these would make every historical record look forged the day a new version ships.
    expect(verifyDeclaration({ version: 'identity-v0', hash: 'whatever' })).toBe('version_retired')
  })
})
