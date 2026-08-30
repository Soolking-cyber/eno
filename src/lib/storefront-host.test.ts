import { describe, expect, it } from 'vitest'
import { isHostnameLabel, isInfraSubdomain, storefrontBaseHost, storefrontHandleFromHost, storefrontUrl } from './storefront-host'

// The Host header is client-supplied and everything downstream keys off this parse, so the tests
// that matter most are the ones asserting what does NOT resolve.

describe('storefrontHandleFromHost — what resolves', () => {
  it('reads a one-label subdomain of the app host', () => {
    expect(storefrontHandleFromHost('applestore.eno.vn', 'eno.vn')).toBe('applestore')
  })

  it('is case-insensitive on both sides', () => {
    expect(storefrontHandleFromHost('ApPleStore.ENO.vn', 'eno.VN')).toBe('applestore')
  })

  it('strips a port, so localhost development resolves', () => {
    expect(storefrontHandleFromHost('shopone.localhost:3000', 'localhost:3000')).toBe('shopone')
    expect(storefrontHandleFromHost('shopone.eno.vn:443', 'eno.vn')).toBe('shopone')
  })

  it('resolves on the services edition against its own host', () => {
    expect(storefrontHandleFromHost('shopone.eno.forum', 'eno.forum')).toBe('shopone')
  })
})

describe('⛔ underscore handles are not hostnames', () => {
  // The handle grammar allows `_` and rejects `-`; DNS and TLS do the exact opposite. Real shops
  // on this marketplace hold underscore handles today (sdc_store, eno_visa), so this is the
  // difference between withholding a subdomain and publishing an address nobody can reach.
  it('never resolves a host containing an underscore', () => {
    expect(storefrontHandleFromHost('sdc_store.eno.vn', 'eno.vn')).toBeNull()
    expect(storefrontHandleFromHost('apple_store.eno.vn', 'eno.vn')).toBeNull()
  })

  it('falls back to the path form rather than publishing an illegal name', () => {
    expect(storefrontUrl('sdc_store', 'https://eno.vn')).toBe('https://eno.vn/sdc_store')
  })

  it('knows which characters a hostname label allows', () => {
    expect(isHostnameLabel('applestore')).toBe(true)
    expect(isHostnameLabel('apple-store')).toBe(true) // legal in DNS, though the handle grammar bars it
    expect(isHostnameLabel('apple_store')).toBe(false)
    expect(isHostnameLabel('-apple')).toBe(false)
    expect(isHostnameLabel('apple-')).toBe(false)
    expect(isHostnameLabel('a'.repeat(64))).toBe(false)
  })
})

describe('storefrontHandleFromHost — what must not resolve', () => {
  it('returns null for the app host itself', () => {
    expect(storefrontHandleFromHost('eno.vn', 'eno.vn')).toBeNull()
    expect(storefrontHandleFromHost('eno.vn:3000', 'eno.vn:3000')).toBeNull()
  })

  it('⛔ never crosses editions — a forum host is not a marketplace storefront', () => {
    // Both editions run from one codebase behind one nginx. A storefront resolved from the wrong
    // edition's traffic is the licensing boundary failing, not a routing bug.
    expect(storefrontHandleFromHost('shop_one.eno.forum', 'eno.vn')).toBeNull()
    expect(storefrontHandleFromHost('shop_one.eno.vn', 'eno.forum')).toBeNull()
  })

  it('⛔ rejects a nested label — no certificate can cover *.*.eno.vn', () => {
    expect(storefrontHandleFromHost('a.b.eno.vn', 'eno.vn')).toBeNull()
    expect(storefrontHandleFromHost('evil.apple.eno.vn', 'eno.vn')).toBeNull()
  })

  it('⛔ rejects a suffix that merely ends the same way', () => {
    // `notenо.vn` and `evil-eno.vn` both end with the base string but are different domains; the
    // dot in the endsWith test is what separates them.
    expect(storefrontHandleFromHost('shopeno.vn', 'eno.vn')).toBeNull()
    expect(storefrontHandleFromHost('shop.evil-eno.vn', 'eno.vn')).toBeNull()
    expect(storefrontHandleFromHost('eno.vn.attacker.com', 'eno.vn')).toBeNull()
  })

  it('⛔ rejects infrastructure labels, sb.eno.vn above all', () => {
    // sb.eno.vn is the Supabase gateway vhost on the origin box.
    expect(storefrontHandleFromHost('sb.eno.vn', 'eno.vn')).toBeNull()
    expect(storefrontHandleFromHost('www.eno.vn', 'eno.vn')).toBeNull()
    expect(storefrontHandleFromHost('api.eno.vn', 'eno.vn')).toBeNull()
    expect(storefrontHandleFromHost('mail.eno.vn', 'eno.vn')).toBeNull()
  })

  it('⛔ rejects a reserved handle, so the path and host lists cannot disagree', () => {
    expect(storefrontHandleFromHost('admin.eno.vn', 'eno.vn')).toBeNull()
    expect(storefrontHandleFromHost('support.eno.vn', 'eno.vn')).toBeNull()
    expect(storefrontHandleFromHost('eno.eno.vn', 'eno.vn')).toBeNull()
  })

  it('rejects anything the handle grammar rejects', () => {
    expect(storefrontHandleFromHost('AB.eno.vn', 'eno.vn')).toBeNull() // too short
    expect(storefrontHandleFromHost('1shop.eno.vn', 'eno.vn')).toBeNull() // must start alpha
    expect(storefrontHandleFromHost('my-shop.eno.vn', 'eno.vn')).toBeNull() // legal in DNS, but the handle grammar bars hyphen
    expect(storefrontHandleFromHost(('a'.repeat(40)) + '.eno.vn', 'eno.vn')).toBeNull()
  })

  it('handles absent, empty and malformed hosts without throwing', () => {
    expect(storefrontHandleFromHost(null, 'eno.vn')).toBeNull()
    expect(storefrontHandleFromHost(undefined, 'eno.vn')).toBeNull()
    expect(storefrontHandleFromHost('', 'eno.vn')).toBeNull()
    expect(storefrontHandleFromHost('.eno.vn', 'eno.vn')).toBeNull()
    expect(storefrontHandleFromHost('shop.eno.vn', '')).toBeNull()
    expect(storefrontHandleFromHost('[::1]:3000', 'eno.vn')).toBeNull()
    expect(storefrontHandleFromHost('192.168.1.10', 'eno.vn')).toBeNull()
  })
})

describe('storefrontBaseHost — the derivation the earlier tests skipped', () => {
  // ⛔ These exist because the first version of this suite passed 'eno.forum' in by hand and so
  // never exercised how the base is DERIVED. A reviewer found that the services canonical is
  // https://www.eno.forum, which made the real host fail to resolve and a two-label host resolve.
  it('strips www so the services canonical yields the registrable host', () => {
    expect(storefrontBaseHost('https://www.eno.forum')).toBe('eno.forum')
    expect(storefrontBaseHost('https://eno.vn')).toBe('eno.vn')
    expect(storefrontBaseHost('http://localhost:3000')).toBe('localhost:3000')
  })

  it('is empty for an absent or unparseable url, which fails every host check closed', () => {
    expect(storefrontBaseHost(undefined)).toBe('')
    expect(storefrontBaseHost('not a url')).toBe('')
  })

  it('⛔ end to end: the real forum storefront resolves and the www-nested one does not', () => {
    const base = storefrontBaseHost('https://www.eno.forum')
    expect(storefrontHandleFromHost('shopone.eno.forum', base)).toBe('shopone')
    expect(storefrontHandleFromHost('shopone.www.eno.forum', base)).toBeNull()
  })

  it('⛔ and the published URL is the one a certificate covers', () => {
    expect(storefrontUrl('shopone', 'https://www.eno.forum')).toBe('https://shopone.eno.forum')
  })
})

describe('isInfraSubdomain', () => {
  it('covers the origin box vhost and the mail records', () => {
    expect(isInfraSubdomain('sb')).toBe(true)
    expect(isInfraSubdomain('mx')).toBe(true)
    expect(isInfraSubdomain('shopone')).toBe(false)
  })
})

describe('storefrontUrl', () => {
  it('builds the subdomain form for an ordinary handle', () => {
    expect(storefrontUrl('applestore', 'https://eno.vn')).toBe('https://applestore.eno.vn')
  })

  it('keeps the port, so a dev origin still works', () => {
    expect(storefrontUrl('applestore', 'http://localhost:3000')).toBe('http://applestore.localhost:3000')
  })

  it('⚠️ falls back to the path form when the handle cannot be a host', () => {
    // Every shop has the path; only some have the subdomain. A dead link is worse than a long one.
    expect(storefrontUrl('www', 'https://eno.vn')).toBe('https://eno.vn/www')
    expect(storefrontUrl('sb', 'https://eno.vn')).toBe('https://eno.vn/sb')
    expect(storefrontUrl('admin', 'https://eno.vn')).toBe('https://eno.vn/admin')
  })
})
