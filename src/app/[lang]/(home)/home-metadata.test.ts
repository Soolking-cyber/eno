import { afterEach, describe, expect, it, vi } from 'vitest'

// The suite runs as the services edition (vitest.config.ts); these strings are the marketplace's.
const edition = vi.hoisted(() => ({ services: false }))
vi.mock('@/lib/edition', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/edition')>()
  return {
    ...real,
    get IS_SERVICES() { return edition.services },
    get IS_MARKETPLACE() { return !edition.services },
    get SITE_NAME() { return edition.services ? 'eno.forum' : 'eno.vn' },
  }
})
// The `/vi` pilot's list, switched on per test (V3b); the merged constant is empty.
const pilot = vi.hoisted(() => ({ on: false }))
vi.mock('@/lib/lang-pinned', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/lang-pinned')>()
  return {
    ...real,
    langAlternates: (p: string, v: string, o: string, l?: Parameters<typeof real.langAlternates>[3]) =>
      real.langAlternates(p, v, o, l ?? (pilot.on ? { live: ['/', '/c/furniture-appliances'], retired: [] } : { live: [], retired: [] })),
  }
})
const { HOME_DESCRIPTION_VI, HOME_TITLE_VI, homeMetadata, homeWebPageJsonLd } = await import('./home-metadata')
const { SITE_TITLE } = await import('@/lib/site-title')
afterEach(() => { edition.services = false; pilot.on = false; vi.unstubAllEnvs() })

/** SEO wave B, V2 — copy sheet CS-3 V2-1 / V2-2 (approved by the owner 2026-10-01), verbatim. */
describe('homeMetadata (marketplace)', () => {
  it('the vi variant gets the Vietnamese title and description, the canonical kept', () => {
    expect(homeMetadata('vi')).toEqual({
      alternates: { canonical: '/', types: { 'text/markdown': '/index.md', 'application/atom+xml': '/feed.xml' } },
      title: 'eno.vn — rao vặt miễn phí cho người nước ngoài và người Việt',
      description: 'eno.vn là chợ rao vặt miễn phí cho người nước ngoài và người Việt tại Việt Nam: nhà cho thuê, việc làm, nội thất, đồ điện tử và nhiều hơn nữa.',
    })
  })

  it('the en variant sets only the canonical — the layout keeps the English title and description', () => {
    expect(homeMetadata('en')).toEqual({ alternates: { canonical: '/', types: { 'text/markdown': '/index.md', 'application/atom+xml': '/feed.xml' } } })
  })

  it('stays within the lengths CS-3 measured (title 60, description 142) and claims no trust', () => {
    expect([...HOME_TITLE_VI.normalize('NFC')].length).toBeLessThanOrEqual(60)
    expect([...HOME_DESCRIPTION_VI.normalize('NFC')].length).toBeLessThanOrEqual(160)
    expect(`${HOME_TITLE_VI} ${HOME_DESCRIPTION_VI}`).not.toMatch(/uy tín|tin cậy|trusted/i)
  })

  it('eno.forum keeps the layout title and description on both variants', () => {
    edition.services = true
    for (const lang of ['en', 'vi']) expect(homeMetadata(lang)).toEqual({ alternates: { canonical: '/', types: { 'text/markdown': '/index.md', 'application/atom+xml': '/feed.xml' } } })
  })
})

describe('homeMetadata under the /vi pilot (V3b, lists on)', () => {
  it('en (the plain URL): self-canonical, reciprocal hreflang, an English card with og:url and en_US', () => {
    pilot.on = true
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
    const m = homeMetadata('en')
    expect(m.alternates).toEqual({ canonical: 'https://eno.vn', languages: { en: 'https://eno.vn', 'vi-VN': 'https://eno.vn/vi', 'x-default': 'https://eno.vn' }, types: { 'text/markdown': '/index.md', 'application/atom+xml': '/feed.xml' } })
    expect(m.title).toBeUndefined() // the layout's English title stays
    expect(m.openGraph).toMatchObject({ url: 'https://eno.vn', locale: 'en_US', title: 'eno.vn — free classifieds for expats and locals in Vietnam' })
    expect(m.twitter).toMatchObject({ title: 'eno.vn — free classifieds for expats and locals in Vietnam' })
  })

  it('vi (`/vi`): self-canonical at /vi, the Vietnamese title and a Vietnamese card with vi_VN', () => {
    pilot.on = true
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
    const m = homeMetadata('vi')
    expect(m.alternates).toMatchObject({ canonical: 'https://eno.vn/vi' })
    expect(m.title).toBe(HOME_TITLE_VI)
    expect(m.openGraph).toMatchObject({ url: 'https://eno.vn/vi', locale: 'vi_VN', title: HOME_TITLE_VI, description: HOME_DESCRIPTION_VI })
  })

  it('lists off: exactly V2 (no hreflang, no card)', () => {
    expect(homeMetadata('en')).toEqual({ alternates: { canonical: '/', types: { 'text/markdown': '/index.md', 'application/atom+xml': '/feed.xml' } } })
    expect(Object.keys(homeMetadata('vi')).sort()).toEqual(['alternates', 'description', 'title'])
  })

  it('eno.forum: nothing, even with the list on', () => {
    pilot.on = true
    edition.services = true
    for (const lang of ['en', 'vi']) expect(homeMetadata(lang)).toEqual({ alternates: { canonical: '/', types: { 'text/markdown': '/index.md', 'application/atom+xml': '/feed.xml' } } })
  })
})

describe('homeWebPageJsonLd', () => {
  it('the marketplace home is a WebPage in the variant\'s language, named by its title, inside the site and about eno', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
    expect(homeWebPageJsonLd('en')).toEqual({
      '@context': 'https://schema.org', '@type': 'WebPage', '@id': 'https://eno.vn/#webpage', url: 'https://eno.vn/',
      name: SITE_TITLE, inLanguage: 'en', isPartOf: { '@id': 'https://eno.vn/#website' }, about: { '@id': 'https://eno.vn/#organization' },
    })
    expect(homeWebPageJsonLd('vi')).toMatchObject({ name: HOME_TITLE_VI, inLanguage: 'vi', url: 'https://eno.vn/' })
    // The name is the title the variant shows: homeMetadata sets one only on vi, else the layout's SITE_TITLE stands.
    expect(homeWebPageJsonLd('vi').name).toBe(homeMetadata('vi').title)
  })
  it('under the /vi pilot each variant is its own page: its own canonical url, and an @id that follows it', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
    pilot.on = true
    const en = homeWebPageJsonLd('en'), vin = homeWebPageJsonLd('vi')
    expect(vin.url).not.toBe(en.url)
    expect(en['@id']).toBe(`${en.url}#webpage`)
    expect(vin['@id']).toBe(`${vin.url}#webpage`)
    expect(vin.url).toMatch(/^https:\/\/eno\.vn\//)
    expect(en.url).toMatch(/^https:\/\/eno\.vn\//)
    expect(vin.url).toBe(new URL(homeMetadata('vi').alternates?.canonical as string).href)
    expect(en.url).toBe(new URL(homeMetadata('en').alternates?.canonical as string).href)
  })
  it('on eno.forum: its own origin, the shared title, no @id references (those nodes are marketplace only)', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.eno.forum')
    edition.services = true
    const n = homeWebPageJsonLd('vi')
    expect(n).toMatchObject({ '@type': 'WebPage', url: 'https://www.eno.forum/', inLanguage: 'vi' })
    expect(n.name).not.toBe(HOME_TITLE_VI)
    expect(n).not.toHaveProperty('isPartOf')
    expect(n).not.toHaveProperty('about')
  })
})
