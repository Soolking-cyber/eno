import { describe, expect, it } from 'vitest'
import { canonicalAppPath } from './deep-link'

// Attack table (audit Phase 1): before consolidation, native-push validated deep-link
// urls with a bare startsWith('/') — `//evil.com` passed and the trusted native shell
// navigated off-origin. These pin the shared canonicalize-then-validate discipline.
describe('canonicalAppPath', () => {
  it('accepts ordinary app paths, preserving query + hash', () => {
    expect(canonicalAppPath('/listings/abc?src=push#photos')).toBe('/listings/abc?src=push#photos')
    expect(canonicalAppPath('/messages/xyz')).toBe('/messages/xyz')
  })

  it('rejects protocol-relative and backslash escapes', () => {
    expect(canonicalAppPath('//evil.example')).toBeNull()
    expect(canonicalAppPath('/\\evil.example')).toBeNull()
    expect(canonicalAppPath('/\\\\evil.example')).toBeNull()
  })

  it('rejects absolute/foreign and non-path input', () => {
    expect(canonicalAppPath('https://evil.example/x')).toBeNull()
    expect(canonicalAppPath('javascript:alert(1)')).toBeNull()
    expect(canonicalAppPath('')).toBeNull()
    expect(canonicalAppPath(null)).toBeNull()
    expect(canonicalAppPath(undefined)).toBeNull()
  })

  it('blocks auth-flow paths when asked, incl. double-encoded smuggling', () => {
    expect(canonicalAppPath('/auth/callback', { blockAuthPaths: true })).toBeNull()
    expect(canonicalAppPath('/signin?next=/x', { blockAuthPaths: true })).toBeNull()
    expect(canonicalAppPath('/%2561uth/callback', { blockAuthPaths: true })).toBeNull() // %2561 → %61 → a
    // …and stays allowed without the flag (bootstrap's forum branch never sets it).
    expect(canonicalAppPath('/auth/callback')).toBe('/auth/callback')
  })
})
