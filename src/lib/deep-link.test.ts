import { describe, expect, it } from 'vitest'
import { canonicalAppPath, mayReachFrameworkPath } from './deep-link'

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
    // …and stays allowed without the flag (it is opt-in; every caller in src sets it).
    expect(canonicalAppPath('/auth/callback')).toBe('/auth/callback')
  })

  // GHSA-rvm3-566m-v7fv (critical): Capacitor ≤8.4.2 — every store binary so far — serves /_capacitor_http_interceptor_
  // on the app's own origin and fetches whatever URL the caller names. No link may navigate the app there.
  it('refuses every path under "/_", however it is spelled, with or without the auth flag', () => {
    for (const raw of [
      '/_capacitor_http_interceptor_?u=https%3A%2F%2Fevil.example%2F',
      '/%5Fcapacitor_http_interceptor_?u=https://evil.example/', // %5F → _
      '/%255Fcapacitor_http_interceptor_', // double-encoded
      '/%2525255Fcapacitor_http_interceptor_', // more layers than any real link has: refused, not waved through
      '/x/../_capacitor_http_interceptor_', // dot segments resolve first
      '/x/%2e%2e/_capacitor_http_interceptor_',
      '/x/%252e%252e/_capacitor_http_interceptor_', // the decode MINTS the dot segments — re-resolved each round
      '/x%5C..%5C_capacitor_http_interceptor_', // …and backslashes (the URL parser reads \ as /)
      '/%5Fcapacitor_http_interceptor_/%ZZ?u=https://evil.example/', // a malformed escape doesn't hide the readable one…
      '/%5F%E0capacitor_http_interceptor_', // …nor does a broken UTF-8 byte in the same run
      '/_capacitor_file_/data/user/0/eno.vn/files/x',
      '/_next/static/chunks/main.js',
    ]) {
      expect(canonicalAppPath(raw), raw).toBeNull()
      expect(canonicalAppPath(raw, { blockAuthPaths: true }), raw).toBeNull()
    }
  })

  it('fails CLOSED on a path with no stable spelling', () => {
    for (const raw of [
      '/%2F_capacitor_http_interceptor_', // decodes to //_capacitor… — another origin
      '/%25252525255Fcapacitor_http_interceptor_', // six layers: still changing after the last round
    ]) {
      expect(canonicalAppPath(raw), raw).toBeNull()
    }
  })

  it('an underscore anywhere else, or a slug spelled with escapes, is an ordinary path', () => {
    expect(canonicalAppPath('/listings/abc_def')).toBe('/listings/abc_def')
    expect(canonicalAppPath('/c/rentals?ref=_home')).toBe('/c/rentals?ref=_home')
    expect(canonicalAppPath('/listings/x#_photos')).toBe('/listings/x#_photos')
    expect(canonicalAppPath('/c/nh%C3%A0-%C4%91%E1%BA%A5t')).toBe('/c/nh%C3%A0-%C4%91%E1%BA%A5t')
    expect(canonicalAppPath('/c/nhà-đất')).toBe('/c/nh%C3%A0-%C4%91%E1%BA%A5t')
    expect(canonicalAppPath('/brands/a%20b')).toBe('/brands/a%20b')
    // A percent sign — encoded or stray — is a character, not a reason to refuse the link.
    expect(canonicalAppPath('/brands/100%25')).toBe('/brands/100%25')
    expect(canonicalAppPath('/listings/50%-off')).toBe('/listings/50%-off')
  })
})

describe('mayReachFrameworkPath', () => {
  it('any spelling under "/_", or no stable spelling at all', () => {
    expect(mayReachFrameworkPath('/_capacitor_http_interceptor_')).toBe(true)
    expect(mayReachFrameworkPath('/%5Fnext/data')).toBe(true)
    expect(mayReachFrameworkPath('/x/%252e%252e/_y')).toBe(true)
    expect(mayReachFrameworkPath('/%5F/%ZZ')).toBe(true)
    expect(mayReachFrameworkPath('/listings/_x')).toBe(false)
    expect(mayReachFrameworkPath('/c/nh%C3%A0')).toBe(false)
    expect(mayReachFrameworkPath('/')).toBe(false)
  })
})
