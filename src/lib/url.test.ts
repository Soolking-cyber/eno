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
})
