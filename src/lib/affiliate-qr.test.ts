import { describe, it, expect, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const { affiliateQrSvg, safeAffiliateUrl } = await import('./affiliate-qr')

// A real tracking URL: long, query-heavy and percent-encoded, which is the case that pushes the
// encoder to a higher version. A QR that only ever gets tested with "https://example.com" proves
// nothing about the payload this feature actually carries.
const TRACKING_URL =
  'https://c.trackig.site/c/v3/CON000002642/?source=deeplink_generator&network_id=86' +
  '&url=https%3A%2F%2Fbooking.vinwonders.com%2Fvi-VND%2Fsearch%3Fcode%3DPQVW1'

describe('affiliateQrSvg', () => {
  it('encodes a long tracking URL as inline SVG', () => {
    const svg = affiliateQrSvg(TRACKING_URL)
    expect(svg).toBeTruthy()
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
    expect(svg).toContain('</svg>')
    // Dark modules are drawn as 1x1 path segments; a code this size has hundreds.
    expect((svg!.match(/h1v1h-1z/g) ?? []).length).toBeGreaterThan(200)
  })

  it('keeps the 4-module quiet zone the spec requires', () => {
    // Without it scanners fail intermittently, which reads as "our QR is flaky" not "wrong".
    const svg = affiliateQrSvg(TRACKING_URL)!
    const [, total] = /viewBox="0 0 (\d+) \1"/.exec(svg) ?? []
    expect(Number(total)).toBeGreaterThan(0)
    // No dark module may sit in the outer 4-module border.
    const coords = [...svg.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => [Number(m[1]), Number(m[2])])
    const max = Number(total) - 1
    for (const [x, y] of coords) {
      expect(x).toBeGreaterThanOrEqual(4)
      expect(y).toBeGreaterThanOrEqual(4)
      expect(x).toBeLessThanOrEqual(max - 4)
      expect(y).toBeLessThanOrEqual(max - 4)
    }
  })

  it('is deterministic — the same URL always yields the same code', () => {
    // The QR is printed and scanned; a code that changes between renders would invalidate anything
    // already in the wild.
    expect(affiliateQrSvg(TRACKING_URL)).toBe(affiliateQrSvg(TRACKING_URL))
  })

  it('differs when the destination differs', () => {
    // Guards the guard: a stub that ignored its input would pass every test above.
    expect(affiliateQrSvg('https://example.com/a')).not.toBe(affiliateQrSvg('https://example.com/b'))
  })

  it('returns null for an empty or whitespace URL instead of rendering an empty code', () => {
    expect(affiliateQrSvg('')).toBeNull()
    expect(affiliateQrSvg('   ')).toBeNull()
  })

  it('escapes the accessible label so a title cannot break out of the attribute', () => {
    const svg = affiliateQrSvg('https://example.com', { title: 'a" onload="x' })!
    expect(svg).toContain('&quot;')
    expect(svg).not.toContain('onload="x"')
  })
})

describe('safeAffiliateUrl', () => {
  it('accepts https', () => {
    expect(safeAffiliateUrl(TRACKING_URL)).toBe(TRACKING_URL)
    expect(safeAffiliateUrl('  https://example.com/x  ')).toBe('https://example.com/x')
  })

  it('refuses the script schemes that would be stored XSS in an href', () => {
    // eslint-disable-next-line no-script-url -- the point of the test
    for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,<script>', 'vbscript:x']) {
      expect(safeAffiliateUrl(bad), bad).toBeNull()
    }
  })

  it('refuses http — this link leads to a payment page', () => {
    expect(safeAffiliateUrl('http://booking.vinwonders.com/x')).toBeNull()
  })

  it('refuses empty, null and unparseable values', () => {
    for (const bad of ['', '   ', null, undefined, 'not a url', '//example.com']) {
      expect(safeAffiliateUrl(bad as string), String(bad)).toBeNull()
    }
  })
})
