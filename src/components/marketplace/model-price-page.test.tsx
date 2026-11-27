import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A model's price page (model-price-page.tsx): the grid's count sentence is announced only (quietCount 'always') when the
 * typical-ask line prints "· N listings" — that line needs the claim. Without the claim no line prints, so the count
 * sentence prints as on any grid: a sighted reader must still see a total next to 24 cards and "Show more".
 * The page's data and its chrome are stand-ins: only the line and the prop handed to the grid are under test.
 */
const h = vi.hoisted(() => ({ page: null as unknown, linked: [] as { slug: string; name: string }[] | Error }))

vi.mock('@/lib/model-pages', async (importOriginal) => ({
  // The real path builders: the twin link's and the hub's addresses are the ones the routes serve.
  modelPagePath: (await importOriginal<typeof import('@/lib/model-pages')>()).modelPagePath,
  modelHubPath: (await importOriginal<typeof import('@/lib/model-pages')>()).modelHubPath,
  linkedModelPages: async () => { if (h.linked instanceof Error) throw h.linked; return h.linked },
  MODEL_PAGE_SIZE: 24,
  loadModelPage: async () => h.page,
  modelPageMetadata: () => ({}),
  modelProductLd: () => null,
}))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('notFound') } }))
vi.mock('@/components/marketplace/header', () => ({ Header: () => null }))
vi.mock('@/components/marketplace/footer', () => ({ Footer: () => null }))
vi.mock('@/context/language-context', () => ({ Tr: ({ text }: { text: string }) => text }))
vi.mock('@/components/marketplace/bilingual', () => ({
  Bilingual: ({ en, values }: { en: string; values?: Record<string, string> }) => Object.entries(values ?? {}).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), en),
}))
vi.mock('./lang-pilot-link', () => ({
  LangPilotLink: ({ href, hrefLang, label }: { href: string; hrefLang: string; label: string }) => <a href={href} hrefLang={hrefLang}>{label}</a>,
}))
vi.mock('@/components/marketplace/seller-listings', () => ({
  SellerListings: ({ quietCount }: { quietCount?: boolean | 'always' }) => <div data-quiet={String(quietCount)} />,
}))

const { ModelPriceHub, ModelPricePage, modelPriceHubMetadata } = await import('./model-price-page')
const { SITE_NAME } = await import('@/lib/edition')

const ENTRY = {
  slug: 'apple-iphone-13', brandSlug: 'apple', brandName: 'Apple', model: 'iPhone 13', name: 'Apple iPhone 13',
  categorySlug: 'electronics', subcategorySlug: 'phones-tablets', n: 30, own: 30, claim: true, lastmod: null,
}
const BAND = { n: 30, sellers: 3, p25: 9_000_000, p75: 11_000_000, low: 8_000_000, high: 13_000_000, claim: true, ldLow: true, ldHigh: true }
const html = async (band: unknown) => {
  h.page = { entry: ENTRY, params: {}, total: 30, band, indexable: true, listings: [] }
  return renderToStaticMarkup(await ModelPricePage({ slug: 'apple-iphone-13', lang: 'en' }))
}

beforeEach(() => { h.page = null; h.linked = [] })

describe('ModelPricePage — the count sentence', () => {
  it('with the claim, the line prints the count and the grid only announces its own', async () => {
    const out = await html(BAND)
    expect(out).toContain('· 30 listings')
    expect(out).toContain('data-quiet="always"')
  })

  it('without the claim (two sellers, a wide spread, no band at all), no line prints and the grid prints its count', async () => {
    for (const band of [{ ...BAND, sellers: 2, claim: false }, null]) {
      const out = await html(band)
      expect(out).not.toContain('Typical ask')
      expect(out).toContain('data-quiet="undefined"')
    }
  })
})

describe('ModelPricePage — the other-language twin is a link (Seobility crawl 3: /gia pages reached only by the sitemap)', () => {
  it('the English page links its Vietnamese twin, the Vietnamese page its English one', async () => {
    h.page = { entry: { name: 'Apple iPad Air' }, params: {}, total: 1, listings: [], band: null }
    const en = renderToStaticMarkup(await ModelPricePage({ slug: 'apple-ipad-air', lang: 'en' }))
    expect(en).toContain('href="/gia/apple-ipad-air"')
    expect(en).toContain('hrefLang="vi-VN"')
    const vi = renderToStaticMarkup(await ModelPricePage({ slug: 'apple-ipad-air', lang: 'vi' }))
    expect(vi).toContain('href="/price/apple-ipad-air"')
    expect(vi).toContain('hrefLang="en"')
  })
})

describe('ModelPricePage — the maker\'s colours (Seobility crawl 11: model pages differing only in numbers read as one)', () => {
  it('a model in model-colours.ts names its colours; one outside it keeps the general meeting paragraph', async () => {
    const out = await html(BAND)
    expect(out).toContain('the Apple iPhone 13 was sold in (PRODUCT)RED, Starlight, Midnight, Blue, Pink and Green')
    expect(out).not.toContain('matches its photos and description')
    h.page = { entry: { ...ENTRY, slug: 'apple-ipad-air', model: 'iPad Air', name: 'Apple iPad Air' }, params: {}, total: 30, band: BAND, indexable: true, listings: [] }
    const other = renderToStaticMarkup(await ModelPricePage({ slug: 'apple-ipad-air', lang: 'en' }))
    expect(other).toContain('matches its photos and description')
    expect(other).not.toContain('compare the colour')
  })
})

/**
 * THE HUBS, /gia AND /price (2026-11-27): an h1, one line, then every linked model page at the hub's own address — the list
 * /brands shows, without its heading (the h1 is the heading) or a link back to itself. Nothing to list is a 404, and a failed
 * read throws (ISR keeps the last good HTML).
 */
describe('ModelPriceHub — /gia and /price', () => {
  const PAGES = [{ slug: 'apple-iphone-13', name: 'Apple iPhone 13' }, { slug: 'honda-wave-alpha', name: 'Honda Wave Alpha' }]
  const hrefs = (out: string) => [...out.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1])

  it('lists every linked page at its language\'s address, under one h1 and one line', async () => {
    h.linked = PAGES
    const vi = renderToStaticMarkup(await ModelPriceHub({ lang: 'vi' }))
    expect(hrefs(vi)).toEqual(['/gia/apple-iphone-13', '/gia/honda-wave-alpha'])
    expect(vi.match(/<h1/g)).toHaveLength(1)
    expect(vi.match(/<p /g)).toHaveLength(1)
    expect(vi).not.toMatch(/<h2|<section/)
    expect(hrefs(renderToStaticMarkup(await ModelPriceHub({ lang: 'en' })))).toEqual(['/price/apple-iphone-13', '/price/honda-wave-alpha'])
  })

  it('⛔ nothing to list is a 404, never an empty page; a failed read throws', async () => {
    await expect(ModelPriceHub({ lang: 'vi' })).rejects.toThrow('notFound')
    h.linked = new Error('index read failed')
    await expect(ModelPriceHub({ lang: 'vi' })).rejects.toThrow('index read failed')
    await expect(modelPriceHubMetadata('vi')).rejects.toThrow('index read failed')
  })

  it('metadata: self-canonical, the /gia ↔ /price hreflang pair, x-default English; noindex "Not found" when empty', async () => {
    h.linked = PAGES
    const languages = { en: '/price', 'vi-VN': '/gia', 'x-default': '/price' }
    const vi = await modelPriceHubMetadata('vi')
    expect(vi.alternates).toEqual({ canonical: '/gia', languages })
    expect(vi.title).toBe(`Giá theo mẫu tại Việt Nam | ${SITE_NAME}`)
    expect(vi.robots).toBeUndefined()
    const en = await modelPriceHubMetadata('en')
    expect(en.alternates).toEqual({ canonical: '/price', languages })
    expect(en.title).toBe(`Prices by model in Vietnam | ${SITE_NAME}`)
    h.linked = []
    expect(await modelPriceHubMetadata('en')).toMatchObject({ robots: { index: false } })
  })
})
