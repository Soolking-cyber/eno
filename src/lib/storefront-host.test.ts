import { describe, expect, it } from 'vitest'
import { isHostnameLabel, isInfraSubdomain, storefrontBaseHost, storefrontHandleFromHost, storefrontSubdomainLabel, storefrontUrl, subdomainKey, underscoreHost } from './storefront-host'

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

describe('hyphens resolve, because a handle is now also a hostname', () => {
  // The grammar gained `-` on 2026-08-30 so `slugifyHandle` could stop turning every space into an
  // underscore — which is what stopped a multi-word shop name ever having a subdomain.
  it('resolves a hyphenated handle', () => {
    expect(storefrontHandleFromHost('my-shop.eno.vn', 'eno.vn')).toBe('my-shop')
    expect(storefrontUrl('my-shop', 'https://eno.vn')).toBe('https://my-shop.eno.vn')
  })

  it('⛔ still refuses a label DNS would refuse, whatever the handle grammar allows', () => {
    // `-bob` and `bob-` match nothing here because HANDLE_RE needs a leading letter and
    // slugifyHandle strips a trailing separator — but isHostnameLabel is the backstop either way.
    expect(isHostnameLabel('-bob')).toBe(false)
    expect(isHostnameLabel('bob-')).toBe(false)
  })
})

describe('⛔ underscore handles are not hostnames', () => {
  // The handle grammar allows `_` and rejects `-`; DNS and TLS do the exact opposite. Real shops
  // on this marketplace hold underscore handles today (sdc_store, eno_visa). Owner, 2026-09-28: their
  // subdomain is the handle WITHOUT the underscores — never a host that carries one.
  it('never resolves a host containing an underscore', () => {
    expect(storefrontHandleFromHost('sdc_store.eno.vn', 'eno.vn')).toBeNull()
    expect(storefrontHandleFromHost('apple_store.eno.vn', 'eno.vn')).toBeNull()
  })

  it('publishes the underscore-free host, never the illegal name (2026-09-28)', () => {
    expect(storefrontUrl('sdc_store', 'https://eno.vn')).toBe('https://sdcstore.eno.vn')
    expect(storefrontUrl('sdc_store', 'https://www.eno.forum')).toBe('https://sdcstore.eno.forum')
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

/**
 * ⛔ A STOREFRONT'S SUBDOMAIN IS ITS HANDLE WITHOUT UNDERSCORES (SEO wave B, I2b) — owner, 2026-09-28:
 * "remove underscore in subdomains only together". `sdc_store` → `sdcstore.eno.vn`.
 */
describe('storefrontSubdomainLabel', () => {
  it('drops every underscore and keeps the rest, hyphens included', () => {
    expect(storefrontSubdomainLabel('sdc_store')).toBe('sdcstore')
    expect(storefrontSubdomainLabel('a_b_c_d')).toBe('abcd')
    expect(storefrontSubdomainLabel('my-shop_two')).toBe('my-shoptwo')
    expect(storefrontSubdomainLabel('eno-trading')).toBe('eno-trading')
    expect(storefrontSubdomainLabel('alex')).toBe('alex')
  })

  it('is case-insensitive, like the host it names', () => {
    expect(storefrontSubdomainLabel('SDC_Store')).toBe('sdcstore')
  })

  it('⛔ is null when the stripped label cannot be a storefront host', () => {
    expect(storefrontSubdomainLabel('s_b')).toBeNull() // `sb` is the Supabase gateway
    expect(storefrontSubdomainLabel('w_w_w')).toBeNull() // `www` is the site itself
    expect(storefrontSubdomainLabel('a_b')).toBeNull() // `ab` is under the 3-character grammar
    expect(storefrontSubdomainLabel('sign_in')).toBeNull() // reserved in any spelling
    expect(storefrontSubdomainLabel('e_n_o')).toBeNull() // `eno` is reserved
    expect(storefrontSubdomainLabel('admin')).toBeNull()
    expect(storefrontSubdomainLabel('1shop')).toBeNull() // not a handle at all
  })

  it('⛔ never names a host the proxy would refuse: label → host → the same label', () => {
    const handles = ['sdc_store', 'a_b_c_d', 'my-shop_two', 'eno-trading', 'alex', 's_b', 'w_w_w', 'a_b', 'sign_in',
      'e_n_o', 'x_-y', 'ab_-_cd', 'xn--bcher-kva', 'xn_-_-abc', 'q'.repeat(29) + '_z', 'shop_1']
    for (const h of handles) {
      const label = storefrontSubdomainLabel(h)
      if (label) {
        expect(storefrontHandleFromHost(`${label}.eno.vn`, 'eno.vn'), h).toBe(label)
        expect(storefrontUrl(h, 'https://eno.vn'), h).toBe(`https://${label}.eno.vn`)
      } else {
        expect(storefrontUrl(h, 'https://eno.vn'), h).toBe(`https://eno.vn/${h}`)
      }
    }
  })

  it('subdomainKey is the same stripping, for handles that can never be hosts too', () => {
    expect(subdomainKey('sdc_store')).toBe('sdcstore')
    expect(subdomainKey('s_b')).toBe('sb')
    expect(subdomainKey('Sdc-Store')).toBe('sdc-store')
  })
})

/**
 * ⛔ WHAT A HOST WITH AN UNDERSCORE IS (SEO wave B, I2b). Measured live 2026-09-29:
 * `https://sdc_store.eno.vn/` and its `/llms.txt` answered 200 with the whole marketplace.
 */
describe('underscoreHost', () => {
  it('is not its business when the host has no underscore: apex, www, a storefront, a random label', () => {
    for (const host of ['eno.vn', 'www.eno.vn', 'sdcstore.eno.vn', 'random-test-xyz.eno.vn', 'xn--bcher-kva.eno.vn', 'eno-trading.eno.vn:443']) {
      expect(underscoreHost(host, 'eno.vn'), host).toBeNull()
    }
    expect(underscoreHost(null, 'eno.vn')).toBeNull()
    expect(underscoreHost('', 'eno.vn')).toBeNull()
  })

  it('names the storefront host an underscore label should have been', () => {
    expect(underscoreHost('sdc_store.eno.vn', 'eno.vn')).toEqual({ label: 'sdcstore' })
    expect(underscoreHost('a_b_c_d.eno.vn', 'eno.vn')).toEqual({ label: 'abcd' }) // multiple
    expect(underscoreHost('my_shop-two.eno.vn', 'eno.vn')).toEqual({ label: 'myshop-two' }) // hyphen kept
    expect(underscoreHost('SDC_Store.ENO.vn:443', 'eno.VN')).toEqual({ label: 'sdcstore' }) // case, port
    expect(underscoreHost('xn--_bcher-kva.eno.vn', 'eno.vn')).toEqual({ label: 'xn--bcher-kva' }) // punycode
    expect(underscoreHost('sdc_store.eno.forum', storefrontBaseHost('https://www.eno.forum'))).toEqual({ label: 'sdcstore' })
    expect(underscoreHost('sdc_store.localhost:3270', 'localhost:3000')).toEqual({ label: 'sdcstore' })
  })

  it('⛔ is nobody\'s host when the stripped label could not be a storefront, or it is not ours', () => {
    expect(underscoreHost('x_y.eno.vn', 'eno.vn')).toEqual({ label: null }) // `xy`: too short
    expect(underscoreHost('w_w_w.eno.vn', 'eno.vn')).toEqual({ label: null }) // `www`
    expect(underscoreHost('s_b.eno.vn', 'eno.vn')).toEqual({ label: null }) // `sb`
    expect(underscoreHost('sign_in.eno.vn', 'eno.vn')).toEqual({ label: null }) // reserved
    expect(underscoreHost('a.b_c.eno.vn', 'eno.vn')).toEqual({ label: null }) // two labels deep
    expect(underscoreHost('_.eno.vn', 'eno.vn')).toEqual({ label: null })
    expect(underscoreHost('sdc_store.eno.forum', 'eno.vn')).toEqual({ label: null }) // the other zone
    expect(underscoreHost('sdc_store.evil.example', 'eno.vn')).toEqual({ label: null })
    expect(underscoreHost('sdc_store.eno.vn', '')).toEqual({ label: null }) // unconfigured build
  })
})
