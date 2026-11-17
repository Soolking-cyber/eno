import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A model's price page (model-price-page.tsx): the grid's count sentence is announced only (quietCount 'always') when the
 * typical-ask line prints "· N listings" — that line needs the claim. Without the claim no line prints, so the count
 * sentence prints as on any grid: a sighted reader must still see a total next to 24 cards and "Show more".
 * The page's data and its chrome are stand-ins: only the line and the prop handed to the grid are under test.
 */
const h = vi.hoisted(() => ({ page: null as unknown }))

vi.mock('@/lib/model-pages', () => ({
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
vi.mock('@/components/marketplace/seller-listings', () => ({
  SellerListings: ({ quietCount }: { quietCount?: boolean | 'always' }) => <div data-quiet={String(quietCount)} />,
}))

const { ModelPricePage } = await import('./model-price-page')

const ENTRY = {
  slug: 'apple-iphone-13', brandSlug: 'apple', brandName: 'Apple', model: 'iPhone 13', name: 'Apple iPhone 13',
  categorySlug: 'electronics', subcategorySlug: 'phones-tablets', n: 30, own: 30, claim: true, lastmod: null,
}
const BAND = { n: 30, sellers: 3, p25: 9_000_000, p75: 11_000_000, low: 8_000_000, high: 13_000_000, claim: true, ldLow: true, ldHigh: true }
const html = async (band: unknown) => {
  h.page = { entry: ENTRY, params: {}, total: 30, band, indexable: true, listings: [] }
  return renderToStaticMarkup(await ModelPricePage({ slug: 'apple-iphone-13', lang: 'en' }))
}

beforeEach(() => { h.page = null })

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
