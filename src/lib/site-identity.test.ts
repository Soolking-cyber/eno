import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  aboutPageJsonLd,
  ENTITY_PROFILES,
  marketplaceOrganizationFields,
  ORGANIZATION_TYPE,
  organizationId,
  registeredOperatorFields,
  siteOrigin,
  toE164VN,
  websiteId,
} from './site-identity'
import { SOCIALS } from './socials'
import { LANGS } from './i18n/langs'
import { OPERATORS } from './site-legal'

afterEach(() => { vi.unstubAllEnvs() })

describe('the Organization entity fields', () => {
  it('sameAs is every profile eno OWNS — the eight socials plus the entity profiles, never the community group', () => {
    const f = marketplaceOrganizationFields('https://eno.vn')
    expect(f.sameAs).toEqual([...SOCIALS.filter((s) => s.me).map((s) => s.href), ...ENTITY_PROFILES])
    expect(f.sameAs).toHaveLength(10)
    expect(f.sameAs).toContain('https://www.crunchbase.com/organization/eno-vn-9f19')
    expect(f.sameAs).toContain('https://www.pinterest.com/enovietnam/')
    expect(new Set(f.sameAs).size).toBe(f.sameAs.length)
    expect(f.sameAs).toContain('https://www.linkedin.com/company/eno-vn/')
    expect(f.sameAs.some((u) => u.includes('/groups/'))).toBe(false)
  })

  it('carries the @id every referring page uses, the country, and the interface languages', () => {
    const f = marketplaceOrganizationFields('https://eno.vn')
    expect(f['@id']).toBe('https://eno.vn/#organization')
    expect(f['@id']).toBe(organizationId('https://eno.vn'))
    // ⚠️ The country only: a city list here would be a static claim about where stock is.
    expect(f.areaServed).toEqual({ '@type': 'Country', name: 'Vietnam' })
    expect(f.knowsLanguage).toEqual([...LANGS])
    expect(f.knowsLanguage).toHaveLength(11)
  })
})

describe('registeredOperatorFields', () => {
  it('⛔ emits nothing for an operator that is not registered — no placeholder as a legal name', () => {
    expect(registeredOperatorFields(OPERATORS.services)).toEqual({})
    expect(registeredOperatorFields({ registered: false, name: 'X', erc: '1' })).toEqual({})
  })

  it('emits the certificate’s own name and number once it is', () => {
    const op = OPERATORS.marketplace
    const f = registeredOperatorFields(op)
    if (!op.registered) return expect(f).toEqual({})
    expect(f).toEqual({
      legalName: op.name,
      identifier: { '@type': 'PropertyValue', propertyID: expect.any(String), value: op.erc },
    })
  })
})

describe('toE164VN', () => {
  it('turns the certificate’s local form into E.164, which Google asks for', () => {
    expect(toE164VN('0772007921')).toBe('+84772007921')
    expect(toE164VN(OPERATORS.marketplace.phone)).toBe('+84772007921')
  })

  it('passes an existing +84 number through, spacing and punctuation stripped', () => {
    expect(toE164VN('+84772007921')).toBe('+84772007921')
    expect(toE164VN('+84 77 200 7921')).toBe('+84772007921')
    expect(toE164VN('84772007921')).toBe('+84772007921')
    // A landline: +84, a two-digit area code, eight digits.
    expect(toE164VN('028 3822 1234')).toBe('+842838221234')
  })

  it('⛔ is null for the PENDING placeholder, an empty value and anything not Vietnamese — never a guess', () => {
    expect(toE164VN(OPERATORS.services.phone)).toBeNull()
    expect(toE164VN('đang cập nhật')).toBeNull()
    expect(toE164VN('')).toBeNull()
    expect(toE164VN(null)).toBeNull()
    expect(toE164VN(undefined)).toBeNull()
    expect(toE164VN('+1 202 555 0100')).toBeNull()
    expect(toE164VN('0084 772 007 921')).toBeNull() // international prefix: not re-prefixed into a wrong number
    expect(toE164VN('077200792')).toBeNull() // a digit short
  })
})

describe('ORGANIZATION_TYPE', () => {
  it('is OnlineBusiness: the true subtype for a site that sells nothing itself (not OnlineStore)', () => {
    expect(ORGANIZATION_TYPE).toBe('OnlineBusiness')
  })
})

describe('aboutPageJsonLd', () => {
  it('points at the layout’s Organization and WebSite nodes by @id instead of restating them', () => {
    const ld = aboutPageJsonLd('https://eno.vn', { name: 'About eno.vn', description: 'd' })
    expect(ld['@type']).toBe('AboutPage')
    expect(ld.url).toBe('https://eno.vn/about')
    expect(ld.mainEntity).toEqual({ '@id': organizationId('https://eno.vn') })
    expect(ld.about).toEqual({ '@id': organizationId('https://eno.vn') })
    expect(ld.isPartOf).toEqual({ '@id': websiteId('https://eno.vn') })
  })
})

describe('siteOrigin', () => {
  it('is the configured origin, with an edition-correct fallback', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.eno.forum')
    expect(siteOrigin()).toBe('https://www.eno.forum')
  })
})

/**
 * ⛔ THE ONE-ENTITY GUARD, READ FROM THE LAYOUT SOURCE. The root layout's JSON-LD is inline JSX, so the
 * gate cannot be exercised without rendering the whole document; the gate's SHAPE can be pinned.
 * Each entity field must sit behind `IS_SERVICES ? {} :` — the day one of them is spread
 * unconditionally, eno.forum starts telling search engines it is eno.vn.
 */
describe('root layout JSON-LD wiring', () => {
  const src = readFileSync(join(process.cwd(), 'src/app/[lang]/layout.tsx'), 'utf8')

  it('spreads the marketplace entity fields and the WebSite publisher only off the services edition', () => {
    expect(src).toContain('...(IS_SERVICES ? {} : marketplaceOrganizationFields(SITE_ORIGIN))')
    expect(src).toContain('...(IS_SERVICES ? {} : { "@id": websiteId(SITE_ORIGIN), publisher: { "@id": organizationId(SITE_ORIGIN) } })')
    expect(src).toContain('...registeredOperatorFields(COMPANY)')
  })

  it('types the node OnlineBusiness off the services edition and Organization on it', () => {
    expect(src).toContain('"@type": IS_SERVICES ? "Organization" : ORGANIZATION_TYPE')
  })

  it('states the phone in E.164 only, at the top level and on the contactPoint, and drops it when null', () => {
    expect(src).toContain('const ORG_TELEPHONE = toE164VN(COMPANY.phone)')
    expect(src.split('...(ORG_TELEPHONE ? { telephone: ORG_TELEPHONE } : {})')).toHaveLength(3)
    // The certificate's local form never reaches the markup.
    expect(src).not.toMatch(/telephone:\s*COMPANY\.phone/)
    // Both phones sit inside the registered-operator gate, after it opens and before the address.
    const gate = src.indexOf('...(OPERATOR_REGISTERED ? {')
    expect(gate).toBeGreaterThan(-1)
    expect(src.indexOf('...(ORG_TELEPHONE ?')).toBeGreaterThan(gate)
    // No taxID key until the owner confirms the MST number (the comments may name it).
    expect(src).not.toMatch(/["']?taxID["']?\s*:/)
  })

  it('no longer hand-copies social profile URLs (the registry is the one list)', () => {
    for (const s of SOCIALS) expect(src).not.toContain(s.href)
  })
})
