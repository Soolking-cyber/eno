import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { PARTNER_LINK_COVERED_ELSEWHERE, PARTNER_SOURCES, partnerSourceUrlOk } from './partner-source-link'
import { PARTNER_STRIP } from './partner-strip'

/** Owner 2026-11-24: "from now on all partner shops should have links for admins". */
describe('every partner shop has an admin link', () => {
  const registered = [...readFileSync('scripts/register-partner-seller.mjs', 'utf8').matchAll(/\n {4}handle: '([a-z0-9-]+)',/g)].map((m) => m[1])
  const roster = PARTNER_STRIP.map((p) => p.handle)

  it('reads both rosters (the harvest itself is guarded)', () => {
    expect(registered.length).toBeGreaterThanOrEqual(15)
    expect(roster.length).toBeGreaterThanOrEqual(15)
  })
  it('⛔ each partner on the strip or in register-partner-seller.mjs has its website here, or a written reason it is covered elsewhere', () => {
    const missing = [...new Set([...registered, ...roster])].filter((h) => !(h in PARTNER_SOURCES) && !(h in PARTNER_LINK_COVERED_ELSEWHERE))
    expect(missing, 'Add the partner to PARTNER_SOURCES in src/lib/partner-source-link.ts (its hosts and home page), then run scripts/backfill-partner-source-links.ts').toEqual([])
  })
  it('no partner is in both lists, and every home page passes its own host check', () => {
    for (const h of Object.keys(PARTNER_SOURCES)) {
      expect(h in PARTNER_LINK_COVERED_ELSEWHERE, h).toBe(false)
      expect(partnerSourceUrlOk(h, PARTNER_SOURCES[h].home), h).toBe(true)
    }
  })
})

describe('partnerSourceUrlOk', () => {
  it('a page on the partner\'s own host, with or without www', () => {
    expect(partnerSourceUrlOk('theextramile', 'https://theextramile.co/motorbikes/adv-160/')).toBe(true)
    expect(partnerSourceUrlOk('theextramile', 'https://www.theextramile.co/motorbikes/adv-160/')).toBe(true)
  })
  it('⛔ another partner\'s site, a look-alike host, a userinfo/port trick, or a non-web scheme: refused', () => {
    expect(partnerSourceUrlOk('theextramile', 'https://saigoncribs.com/listing/x/')).toBe(false)
    expect(partnerSourceUrlOk('theextramile', 'https://theextramile.co.evil.example/x')).toBe(false)
    expect(partnerSourceUrlOk('theextramile', 'https://evil-theextramile.co/x')).toBe(false)
    expect(partnerSourceUrlOk('theextramile', 'https://theextramile.co@evil.example/x')).toBe(false)
    expect(partnerSourceUrlOk('theextramile', 'https://theextramile.co:8443/x')).toBe(false)
    expect(partnerSourceUrlOk('theextramile', 'javascript:alert(1)')).toBe(false)
    expect(partnerSourceUrlOk('theextramile', 'not a url')).toBe(false)
  })
  it('⛔ http only where the partner\'s site has no https (Quê Hương), never elsewhere', () => {
    expect(partnerSourceUrlOk('quehuong', 'http://www.thuexetulaihcm.com/bmw-320i-2022')).toBe(true)
    expect(partnerSourceUrlOk('theextramile', 'http://theextramile.co/motorbikes/x/')).toBe(false)
  })
  it('⛔ an unknown handle, a prototype key, or nothing: refused', () => {
    expect(partnerSourceUrlOk('someone', 'https://theextramile.co/')).toBe(false)
    expect(partnerSourceUrlOk('__proto__', 'https://theextramile.co/')).toBe(false)
    expect(partnerSourceUrlOk('constructor', 'https://theextramile.co/')).toBe(false)
    expect(partnerSourceUrlOk(null, 'https://theextramile.co/')).toBe(false)
    expect(partnerSourceUrlOk('theextramile', null)).toBe(false)
  })
})
