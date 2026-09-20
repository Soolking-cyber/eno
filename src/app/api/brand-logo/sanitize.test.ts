import { describe, expect, it } from 'vitest'

/**
 * ⛔ THE BRAND LOGO ROUTE SERVES ADMIN-PASTED SVG FROM OUR OWN ORIGIN, AND ITS CSP HEADER IS
 * OVERRIDDEN. Measured 2026-09-20: the route set `Content-Security-Policy: default-src 'none';
 * sandbox`, and the app-wide CSP in next.config.ts replaced it — the served response carries
 * `script-src 'self' 'unsafe-inline'`. So the only thing standing between a pasted `<script>` and
 * same-origin execution is `sanitizeBrandSvg()`. These tests pin it.
 * ⛔ IT FAILS CLOSED. A file carrying anything active is REFUSED (null), never "cleaned" and
 * served — `brandLogoUrl()` runs the same check so a refused logo is never linked, and the card
 * falls back to its monogram chip.
 *
 * ⚠️ THEY IMPORT THE REAL FUNCTION. It lives in src/lib/brand-logo-url.ts precisely so this test
 * can call it directly: an earlier version scraped it out of the route source and ran it through
 * `new Function`, which cannot parse TypeScript, and a copy of the regexes here would pass forever
 * while the route drifted — the exact failure this file exists to prevent.
 */
import { sanitizeBrandSvg as sanitize } from '@/lib/brand-logo-url'

describe('brand logo sanitize()', () => {
  it('keeps an ordinary logo intact and forces the namespace', () => {
    const out = sanitize('<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>')!
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(out).toContain('<path')
  })

  it('accepts an <svg> behind an XML prolog', () => {
    expect(sanitize('<?xml version="1.0"?><svg><path d="M0 0"/></svg>')).toContain('<path')
  })

  it('returns null when there is no <svg> at all', () => {
    expect(sanitize('M12 0C5.37 0 0 5.37 0 12')).toBeNull()
    expect(sanitize('')).toBeNull()
  })

  /**
   * ⛔ EVERY PAYLOAD BELOW WAS SUPPLIED BY A REVIEWER, NOT BY THE AUTHOR, AND THE FIRST
   * IMPLEMENTATION SHIPPED GREEN AGAINST ITS OWN EIGHT CASES WHILE FAILING ALL OF THESE.
   * That is the whole lesson: a denylist tested only on the payloads its author imagined is a
   * denylist that passes. `sanitizeBrandSvg` now REFUSES anything active rather than rewriting it,
   * so the assertion is `toBeNull()` — a cleaned-but-served file is not an acceptable outcome.
   */
  for (const [label, payload] of [
    ['a plain <script>', '<svg><script>alert(1)</script><path d="M0 0"/></svg>'],
    ['a self-closing <script>', '<svg><script src="//evil.test/x.js"/><path d="M0 0"/></svg>'],
    // Browsers execute an unterminated <script> to EOF; neither strip regex matched it.
    ['an UNTERMINATED <script>', '<svg><script>fetch("/api/keys")'],
    // A single-pass strip of the inner tag reassembles the outer one into a live <script>.
    ['a nested reassembling <script>', '<svg><sc<script></script>ript>alert(1)</script></svg>'],
    ['an onload handler', '<svg onload="alert(1)"><path d="M0 0"/></svg>'],
    // `/` is not whitespace, so the original `\son[a-z]+` never saw this one.
    ['onload after a slash, no space', '<svg/onload=alert(document.cookie)>'],
    ['a bare onclick', '<svg><rect onclick=alert(1) /></svg>'],
    ['a single-quoted onerror', "<svg><image onerror='alert(1)' href='x'/></svg>"],
    ['a javascript: href', '<svg><a href="javascript:alert(1)"><path d="M0 0"/></a></svg>'],
    ['a javascript: xlink:href', '<svg><a xlink:href="javascript:alert(1)"/></svg>'],
    // Entity-encoded so no literal "javascript:" appears anywhere in the source.
    ['an entity-encoded javascript:', '<svg><a href="jav&#x61;script:alert(1)">x</a></svg>'],
    ['a decimal-entity javascript:', '<svg><a href="&#106;avascript:alert(1)">x</a></svg>'],
    // SMIL assigns the handler at runtime — there is no `on…=` in the markup at all.
    ['SMIL <set> assigning onload', '<svg><set attributeName="onload" to="alert(1)"/></svg>'],
    ['SMIL <animate> to javascript:', '<svg><animate attributeName="href" values="javascript:alert(1)"/></svg>'],
    ['a foreignObject', '<svg><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></body></foreignObject></svg>'],
    ['an <iframe>', '<svg><iframe src="//evil.test"/></svg>'],
    ['an external <use>', '<svg><use href="https://evil.test/x.svg#a"/></svg>'],
    ['an external <use> via xlink', '<svg><use xlink:href="//evil.test/x.svg#a"/></svg>'],
    ['an <image> fetching a remote URL', '<svg><image href="https://evil.test/track.png"/></svg>'],
    ['an inline DTD entity', '<svg><!ENTITY xxe SYSTEM "file:///etc/passwd">"</svg>'],
  ] as const) {
    it(`REFUSES ${label}`, () => {
      expect(sanitize(payload)).toBeNull()
    })
  }

  /**
   * ⚠️ THE OTHER HALF OF FAILING CLOSED: an ORDINARY logo must still come through untouched.
   * A refusal rule that also refuses clean artwork silently blanks the brand wall, which is the
   * same visible outcome as the bug it replaced. These are the shapes real curated logos take.
   */
  for (const [label, ok] of [
    ['a plain path', '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>'],
    ['groups and transforms', '<svg><g transform="translate(4,4)"><path d="M0 0h16"/></g></svg>'],
    ['inline style and fills', '<svg><style>.a{fill:#000}</style><path class="a" d="M0 0h8"/></svg>'],
    ['a fragment-only href', '<svg><defs><path id="p" d="M0 0h8"/></defs><use href="#p"/></svg>'],
    ['title and desc metadata', '<svg><title>Acme</title><desc>logo</desc><path d="M0 0h8"/></svg>'],
    ['an attribute merely containing "on"', '<svg><path id="button-on" d="M0 0h8"/></svg>'],
    // Routine in exported artwork; refusing these silently turned real logos into monograms.
    ['an embedded raster', '<svg><image href="data:image/png;base64,iVBORw0KGgo="/><path d="M0 0h8"/></svg>'],
    ['an outbound <a> link', '<svg><a href="https://acme.example"><path d="M0 0h8"/></a></svg>'],
  ] as const) {
    it(`accepts ${label}`, () => {
      const out = sanitize(ok)
      expect(out, 'a clean logo must not be refused').not.toBeNull()
      expect(out!).toContain('<path')
    })
  }
})
