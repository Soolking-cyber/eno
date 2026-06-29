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
})
