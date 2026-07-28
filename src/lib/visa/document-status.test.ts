import { describe, expect, it } from 'vitest'
import { nextDocumentStatus, suppressedDowngrade } from './document-status'

/**
 * The no-downgrade rule for visa documents. Every case here is the difference between an
 * applicant keeping their place in the form and being thrown back to step 1 by model noise.
 */

describe('⚠️ a passed document is never revoked by a re-analysis', () => {
  it('keeps passed even when the new run says failed', () => {
    // The bytes cannot have changed (upsert: false, one row per upload), so a second opinion on
    // identical input is noise. Production shows this model returning different issue sets for
    // the same subject minutes apart, at temperature 0.
    expect(nextDocumentStatus('passed', 'failed')).toBe('passed')
  })

  it('reports that the downgrade was suppressed, so it is auditable rather than erased', () => {
    expect(suppressedDowngrade('passed', 'failed')).toBe(true)
  })

  it('keeps passed when the new run agrees, and reports no suppression', () => {
    expect(nextDocumentStatus('passed', 'passed')).toBe('passed')
    expect(suppressedDowngrade('passed', 'passed')).toBe(false)
  })
})

describe('an uncertified document takes the new verdict, normally', () => {
  it.each(['pending', 'failed', 'unavailable', null, undefined, ''])(
    'from %s → passed', (stored) => {
      expect(nextDocumentStatus(stored as string | null | undefined, 'passed')).toBe('passed')
      expect(suppressedDowngrade(stored as string | null | undefined, 'passed')).toBe(false)
    },
  )

  it.each(['pending', 'failed', 'unavailable', null, undefined])(
    'from %s → failed', (stored) => {
      expect(nextDocumentStatus(stored as string | null | undefined, 'failed')).toBe('failed')
      expect(suppressedDowngrade(stored as string | null | undefined, 'failed')).toBe(false)
    },
  )

  it('lets a failed document be re-checked and pass — the rule must not block recovery', () => {
    // The whole point of "Send a different photo" is that a failed document can become passed.
    expect(nextDocumentStatus('failed', 'passed')).toBe('passed')
  })
})

describe('it protects ONLY the exact string passed', () => {
  it('is not fooled by a near-miss status', () => {
    for (const s of ['Passed', 'PASSED', 'pass', ' passed'])
      expect(nextDocumentStatus(s, 'failed')).toBe('failed')
  })
})
