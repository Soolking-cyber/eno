import { describe, expect, it } from 'vitest'
// Cross-app import by design: the forum's safeNext is a designated sync-critical
// security helper; testing it from the ROOT suite keeps one runner covering both apps
// (the forum has no unit runner of its own — only Playwright).
import { safeNext } from '../../apps/forum/src/lib/safe-next'

// Attack table from the audit's Phase 1 spec: `//evil.com`, `/\evil.com`,
// `javascript:`, decode-fixpoint smuggling. The pre-consolidation callback copy
// accepted the backslash form.
describe('forum safeNext', () => {
  it('accepts ordinary relative paths', () => {
    expect(safeNext('/dashboard')).toBe('/dashboard')
    expect(safeNext('/itinerary?tab=2#day-3')).toBe('/itinerary?tab=2#day-3')
  })

  it('falls back to / for empty and non-relative input', () => {
    expect(safeNext(null)).toBe('/')
    expect(safeNext('')).toBe('/')
    expect(safeNext('https://evil.example')).toBe('/')
    expect(safeNext('javascript:alert(1)')).toBe('/')
  })

  it('rejects protocol-relative and backslash open redirects', () => {
    expect(safeNext('//evil.example')).toBe('/')
    expect(safeNext('/\\evil.example')).toBe('/')
    expect(safeNext('/..%2f..%2fetc')).toBe('/')
  })

  it('rejects traversal', () => {
    expect(safeNext('/../admin')).toBe('/')
    expect(safeNext('/a/../../b')).toBe('/')
  })

  it('rejects percent-encoded smuggling at the decode fixpoint', () => {
    expect(safeNext('/%2f%2fevil.example')).toBe('/')      // → //evil.example
    expect(safeNext('/%5cevil.example')).toBe('/')          // → \evil.example
    expect(safeNext('/%2e%2e/admin')).toBe('/')             // → ../admin
    expect(safeNext('/%252e%252e/admin')).toBe('/')         // double-encoded ..
  })

  it('rejects malformed percent-encoding rather than throwing', () => {
    expect(safeNext('/%zz')).toBe('/')
  })
})
