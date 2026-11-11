import { describe, expect, it } from 'vitest'
import { docsHostRedirectUrl, docsHostServesInPlace, isDocsHost } from './docs-host'

describe('docs-host', () => {
  it('matches docs.<base> and api.<base> exactly, port, case and a root dot ignored, www stripped from the base', () => {
    expect(isDocsHost('docs.eno.vn', 'https://eno.vn')).toBe(true)
    expect(isDocsHost('API.eno.vn:443', 'https://eno.vn')).toBe(true)
    expect(isDocsHost('docs.eno.vn.', 'https://eno.vn')).toBe(true)
    expect(isDocsHost('docs.eno.forum', 'https://www.eno.forum')).toBe(true)
    expect(isDocsHost('eno.vn', 'https://eno.vn')).toBe(false)
    expect(isDocsHost('docs.eno.vn.evil.example', 'https://eno.vn')).toBe(false)
    expect(isDocsHost('mydocs.eno.vn', 'https://eno.vn')).toBe(false)
    expect(isDocsHost(null, 'https://eno.vn')).toBe(false)
    expect(isDocsHost('docs.eno.vn', undefined)).toBe(false)
  })

  it('sends / to /developers and keeps any other path, on the app origin', () => {
    expect(docsHostRedirectUrl('https://eno.vn', '/', '')).toBe('https://eno.vn/developers')
    expect(docsHostRedirectUrl('https://eno.vn', '', '?a=1')).toBe('https://eno.vn/developers?a=1')
    expect(docsHostRedirectUrl('https://www.eno.forum', '/developers/versioning', '')).toBe('https://www.eno.forum/developers/versioning')
    expect(docsHostRedirectUrl('https://eno.vn', '/openapi.json', '')).toBe('https://eno.vn/openapi.json')
    expect(new URL(docsHostRedirectUrl('https://eno.vn', '//evil.example/x', '')!).host).toBe('eno.vn')
    expect(docsHostRedirectUrl(undefined, '/', '')).toBeNull()
    expect(docsHostRedirectUrl('not a url', '/', '')).toBeNull()
  })

  it('serves the API and well-known documents in place', () => {
    for (const p of ['/api', '/api/v1/status', '/.well-known', '/.well-known/api-catalog']) expect(docsHostServesInPlace(p)).toBe(true)
    for (const p of ['/', '/apis', '/developers', '/.well-knownx']) expect(docsHostServesInPlace(p)).toBe(false)
  })
})
