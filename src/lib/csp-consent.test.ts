import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The CSP is also a consent control: a host it does not admit cannot track anyone, whatever a zone or a
 * tag manager injects. Cloudflare Web Analytics and the Meta pixel hosts were taken out on 2026-10-01
 * and must not drift back in.
 *
 * Reads the SOURCE (comments stripped), for the reason src/lib/image-config.test.ts gives: next.config.ts
 * evaluates the env and the edition machinery at load, so importing it per edition is its own hazard.
 */
const code = readFileSync('next.config.ts', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

describe('CSP — consent-relevant hosts', () => {
  it('⛔ Cloudflare Web Analytics is not admitted anywhere (its beacon runs before any consent answer)', () => {
    expect(code).not.toMatch(/cloudflareinsights/)
  })

  it('⛔ no Meta pixel host on EITHER edition — a paused GTM tag must not be one click from a pre-consent pixel', () => {
    // Nothing in the code loads the pixel; eno.forum's GTM container loads before any consent answer,
    // so admitting the pixel's script (connect.facebook.net) or its image beacon (www.facebook.com)
    // would let a tag switched on in the GTM console track visitors who have not answered.
    expect(code).not.toMatch(/connect\.facebook\.net/)
    expect(code).not.toMatch(/www\.facebook\.com/)
    expect(code).not.toMatch(/metaPixelHost/)
  })

  it('keeps Turnstile and Google Tag Manager (both still load)', () => {
    expect(code).toContain('https://challenges.cloudflare.com')
    expect(code).toContain('https://www.googletagmanager.com')
  })
})
