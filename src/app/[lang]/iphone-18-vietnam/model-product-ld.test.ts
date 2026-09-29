import { readFileSync, existsSync } from 'node:fs'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PriceRow } from './lowest-prices'

/**
 * The single Product a model page publishes, and the hub that publishes none.
 *
 * ⚠️ THE ORIGIN IS STATED HERE, NOT INHERITED. `model-product-ld.ts` reads NEXT_PUBLIC_APP_URL at
 * import, and vitest.config.ts deliberately leaves it unpinned — so the module is imported after
 * stubbing it, and the answer cannot depend on the shell that runs the suite.
 */
let modelProductLd: typeof import('./model-product-ld').modelProductLd

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
  vi.resetModules()
  ;({ modelProductLd } = await import('./model-product-ld'))
  vi.unstubAllEnvs()
})

afterEach(() => {
  vi.useRealTimers()
})

const SHIP = Date.UTC(2026, 8, 18)
const CFG = {
  model: 'iPhone 18 Pro',
  slug: 'iphone-18-pro-vietnam',
  intro: 'The iPhone 18 Pro is the smaller of Apple’s two autumn 2026 flagships.',
  shipDate: SHIP,
}

const row = (over: Partial<PriceRow>): PriceRow => ({
  model: 'iPhone 18 Pro', storage: '256GB', storageGb: 256, price: 38_490_000, currency: '₫',
  listingId: 'l-256', seller: 'CellphoneS', offers: 3,
  image: 'https://sb.eno.vn/storage/v1/object/public/listings/affiliate/m/pro-256.webp',
  ...over,
})

/** The table as the page renders it: ordered by storage, the floor NOT first. */
const ROWS: PriceRow[] = [
  row({ storage: '256GB', storageGb: 256, price: 38_490_000, listingId: 'l-256', offers: 3, image: 'https://sb.eno.vn/a/256.webp' }),
  row({ storage: '512GB', storageGb: 512, price: 37_990_000, listingId: 'l-512', offers: 4, image: 'https://sb.eno.vn/a/512.webp' }),
  row({ storage: '1TB', storageGb: 1024, price: 57_990_000, listingId: 'l-1tb', offers: 2, image: 'https://sb.eno.vn/a/1tb.webp' }),
  row({ storage: '2TB', storageGb: 2048, price: 77_490_000, listingId: 'l-2tb', offers: 3, image: null }),
]

/** Every `@type` anywhere in the node, so "no ItemList, no plain Offer" is checked at every depth. */
function typesIn(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(typesIn)
  if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>
    return [...(typeof o['@type'] === 'string' ? [o['@type']] : []), ...Object.values(o).flatMap(typesIn)]
  }
  return []
}

describe('modelProductLd', () => {
  it('rows → exactly one Product with one AggregateOffer: the table minimum, the printed listing count, no ceiling', () => {
    vi.useFakeTimers()
    vi.setSystemTime(SHIP + 86_400_000)
    const ld = modelProductLd(CFG, ROWS) as Record<string, unknown>
    expect(typesIn(ld).sort()).toEqual(['AggregateOffer', 'Brand', 'Product'])
    expect(ld).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'iPhone 18 Pro',
      brand: { '@type': 'Brand', name: 'Apple' },
      url: 'https://eno.vn/iphone-18-pro-vietnam',
    })
    const offers = ld.offers as Record<string, unknown>
    // 37.990.000 is the 512GB row — the minimum is the table's, not the first row's.
    expect(offers).toEqual({
      '@type': 'AggregateOffer',
      lowPrice: 37_990_000,
      priceCurrency: 'VND',
      // 3 + 4 + 2 + 3: the "12 listings" PriceTable prints (it sums `offers` the same way), not 4 rows.
      offerCount: 12,
      availability: 'https://schema.org/InStock',
    })
    expect(offers).not.toHaveProperty('highPrice')
  })

  it('carries an image and a description: the floor listing’s photo and the page’s own intro', () => {
    const ld = modelProductLd(CFG, ROWS) as Record<string, unknown>
    expect(ld.image).toBe('https://sb.eno.vn/a/512.webp')
    expect(ld.description).toBe(CFG.intro)
  })

  it('falls back to the next row with a photo, in table order, when the floor row has none', () => {
    const rows = ROWS.map((r) => (r.listingId === 'l-512' ? { ...r, image: null } : r))
    expect((modelProductLd(CFG, rows) as Record<string, unknown>).image).toBe('https://sb.eno.vn/a/256.webp')
  })

  it('makes a root-relative photo absolute and skips one it cannot resolve', () => {
    const rows = [
      row({ price: 1, image: '//cdn.example/x.webp' }),
      row({ price: 2, image: '/listings/electronics-iphone.png' }),
    ]
    expect((modelProductLd(CFG, rows) as Record<string, unknown>).image).toBe('https://eno.vn/listings/electronics-iphone.png')
  })

  it('publishes nothing when no row has a photo — a Product without an image is what Search Console failed', () => {
    expect(modelProductLd(CFG, ROWS.map((r) => ({ ...r, image: null })))).toBeNull()
  })

  it('publishes nothing when there are no rows', () => {
    expect(modelProductLd(CFG, [])).toBeNull()
  })

  it('publishes nothing when a row is not in đồng — one priceCurrency cannot describe it', () => {
    expect(modelProductLd(CFG, [...ROWS, row({ currency: '$', price: 1_200 })])).toBeNull()
  })

  it('is a PreOrder before the ship date and InStock from it', () => {
    vi.useFakeTimers()
    vi.setSystemTime(SHIP - 1)
    expect((modelProductLd(CFG, ROWS)?.offers as Record<string, unknown>).availability).toBe('https://schema.org/PreOrder')
    vi.setSystemTime(SHIP)
    expect((modelProductLd(CFG, ROWS)?.offers as Record<string, unknown>).availability).toBe('https://schema.org/InStock')
  })
})

/**
 * ⚠️ WHY A SOURCE SCAN. The hub renders `<SeoLanding>`, which imports the Prisma client, so its
 * `content()` cannot be imported here — the same trick seo-landing-related.test.ts uses. The built
 * page is proven with curl on the build; this keeps the next edit from quietly undoing it.
 */
describe('the iPhone 18 hub', () => {
  const HUB = 'src/app/[lang]/iphone-18-vietnam/page.tsx'
  const src = readFileSync(HUB, 'utf8')

  it('publishes no Product, Offer, AggregateOffer or ItemList', () => {
    expect(src).not.toMatch(/'@type':\s*'(Product|Offer|AggregateOffer|ItemList)'/)
    expect(src).not.toMatch(/modelProductLd/)
  })

  it('points its CTAs at model pages that exist, each rendered by ModelLanding under its own slug', () => {
    const block = src.match(/browseLinks:\s*\[([\s\S]*?)\]/)
    expect(block, 'no browseLinks literal on the hub').toBeTruthy()
    const hrefs = [...block![1].matchAll(/href:\s*'([^']+)'/g)].map((m) => m[1])
    expect(hrefs).toEqual(['/iphone-18-pro-vietnam', '/iphone-18-pro-max-vietnam'])
    for (const href of hrefs) {
      const slug = href.slice(1)
      const file = `src/app/[lang]/${slug}/page.tsx`
      expect(existsSync(file), `${file} missing`).toBe(true)
      const page = readFileSync(file, 'utf8')
      // `modelMeta` sets the canonical from this slug, so a match here is a self-canonical target.
      expect(page, `${file} is not the model page for ${href}`).toContain(`slug: '${slug}'`)
      expect(page).toMatch(/<ModelLanding cfg=\{CFG\} \/>/)
      expect(page).toMatch(/modelMeta\(\s*CFG,/)
    }
  })
})
