import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  aboutPageJsonLd,
  marketplaceOrganizationFields,
  organizationId,
  registeredOperatorFields,
  siteOrigin,
  websiteId,
} from './site-identity'
import { SOCIALS } from './socials'
import { LANGS } from './i18n/langs'
import { OPERATORS } from './site-legal'

afterEach(() => { vi.unstubAllEnvs() })

describe('the Organization entity fields', () => {
  it('sameAs is every profile eno OWNS — all seven, never the community group', () => {
    const f = marketplaceOrganizationFields('https://eno.vn')
    expect(f.sameAs).toEqual(SOCIALS.filter((s) => s.me).map((s) => s.href))
    expect(f.sameAs).toHaveLength(7)
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

  it('no longer hand-copies social profile URLs (the registry is the one list)', () => {
    for (const s of SOCIALS) expect(src).not.toContain(s.href)
  })
})
