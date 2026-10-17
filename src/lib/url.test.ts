import { describe, it, expect } from 'vitest'
import { safeNextPath } from './url'

// safeNextPath guards every post-auth redirect (?next=) against open-redirect.
const ORIGIN = 'https://eno.vn'

describe('safeNextPath', () => {
  it('keeps same-origin root-relative paths (incl. query + hash)', () => {
    expect(safeNextPath('/dashboard', ORIGIN)).toBe('/dashboard')
    expect(safeNextPath('/c/vehicles?sort=newest#top', ORIGIN)).toBe('/c/vehicles?sort=newest#top')
  })

  it('rejects external / protocol-relative / backslash-trick targets', () => {
    expect(safeNextPath('https://evil.com', ORIGIN)).toBe('/')
    expect(safeNextPath('//evil.com', ORIGIN)).toBe('/')
    expect(safeNextPath('/\\evil.com', ORIGIN)).toBe('/') // WHATWG normalizes /\ → //
  })

  it('rejects a path whose DOT SEGMENTS resolve to a protocol-relative one (/a/..//evil.com → //evil.com)', () => {
    expect(safeNextPath('/a/..//evil.com', ORIGIN)).toBe('/')
    expect(safeNextPath('/a/..//evil.com?x=1#y', ORIGIN)).toBe('/')
    expect(safeNextPath('/x/./../%2F%2Fevil.com', ORIGIN)).not.toMatch(/^\/\//)
    expect(safeNextPath('/a/../teachers/join', ORIGIN)).toBe('/teachers/join')
  })

  it('rejects non-http schemes and falls back to /', () => {
    expect(safeNextPath('javascript:alert(1)', ORIGIN)).toBe('/')
    expect(safeNextPath(null, ORIGIN)).toBe('/')
    expect(safeNextPath('', ORIGIN)).toBe('/')
  })

  it('rejects post-auth CONTROL routes as a destination (redirect-loop guard)', () => {
    expect(safeNextPath('/signin', ORIGIN)).toBe('/')
    expect(safeNextPath('/signin?next=/x', ORIGIN)).toBe('/')
    expect(safeNextPath('/auth/callback?code=abc', ORIGIN)).toBe('/')
    expect(safeNextPath('/onboard', ORIGIN)).toBe('/')
    // But a legit path that merely STARTS with those letters is fine.
    expect(safeNextPath('/signin-help', ORIGIN)).toBe('/signin-help')
    expect(safeNextPath('/authors/jane', ORIGIN)).toBe('/authors/jane')
  })

  it('never lands under "/_" — Capacitor ≤8.4.2 proxies any URL from there on our origin (GHSA-rvm3-566m-v7fv)', () => {
    expect(safeNextPath('/_capacitor_http_interceptor_?u=https://evil.example/', ORIGIN)).toBe('/')
    expect(safeNextPath('/%5Fcapacitor_http_interceptor_?u=https://evil.example/', ORIGIN)).toBe('/')
    expect(safeNextPath('https://eno.vn/_capacitor_http_interceptor_', ORIGIN)).toBe('/')
    expect(safeNextPath('/x/../_next/data', ORIGIN)).toBe('/')
    expect(safeNextPath('/x/%252e%252e/_capacitor_http_interceptor_', ORIGIN)).toBe('/')
    // A malformed escape beside it doesn't hide the readable one.
    expect(safeNextPath('/%5Fcapacitor_http_interceptor_/%ZZ', ORIGIN)).toBe('/')
    // An underscore later in the path, or an encoded percent sign, is an ordinary path.
    expect(safeNextPath('/listings/a_b?x=_y', ORIGIN)).toBe('/listings/a_b?x=_y')
    expect(safeNextPath('/brands/100%25', ORIGIN)).toBe('/brands/100%25')
  })
})
