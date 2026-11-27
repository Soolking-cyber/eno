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
}

const row = (over: Partial<PriceRow>): PriceRow => ({
  model: 'iPhone 18 Pro', storage: '256GB', storageGb: 256, price: 38_490_000, currency: '₫',
  listingId: 'l-256', seller: 'Minh Tuấn Mobile', offers: 3, condition: 'used', tracked: false,
  image: 'https://sb.eno.vn/storage/v1/object/public/listings/affiliate/m/pro-256.webp',
  ...over,
  // The tier's dearest guarded listing: the floor itself unless a test says otherwise.
  ceiling: over.ceiling ?? over.price ?? 38_490_000,
})

/** The table as the page renders it: ordered by storage, the floor NOT first. */
const ROWS: PriceRow[] = [
  row({ storage: '256GB', storageGb: 256, price: 38_490_000, listingId: 'l-256', offers: 3, image: 'https://sb.eno.vn/a/256.webp' }),
  row({ storage: '512GB', storageGb: 512, price: 37_990_000, listingId: 'l-512', offers: 4, image: 'https://sb.eno.vn/a/512.webp' }),
  row({ storage: '1TB', storageGb: 1024, price: 57_990_000, listingId: 'l-1tb', offers: 2, image: 'https://sb.eno.vn/a/1tb.webp' }),
  // Three listings behind the 2TB floor; the dearest of them asks 79.990.000.
  row({ storage: '2TB', storageGb: 2048, price: 77_490_000, ceiling: 79_990_000, listingId: 'l-2tb', offers: 3, image: null }),
]

/** The NEW table as the page renders it above the used one (lowestNewPrices): the shops' units, at about Apple's price. */
const NEW_ROWS: PriceRow[] = [
  row({ storage: '256GB', storageGb: 256, price: 37_990_000, listingId: 'n-256', offers: 3, condition: 'new', tracked: true, seller: 'ShopDunk', image: 'https://sb.eno.vn/a/new-256.webp' }),
  row({ storage: '2TB', storageGb: 2048, price: 80_999_000, listingId: 'n-2tb', offers: 2, condition: 'new', tracked: true, seller: 'CellphoneS', image: 'https://sb.eno.vn/a/new-2tb.webp' }),
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
  it('rows → exactly one Product with one AggregateOffer: the table minimum, the printed listing count, the counted listings’ ceiling', () => {
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
    // Used rows only → the node says so, on the Product and the offer (model-product-ld.ts: one condition per node).
    expect(ld.itemCondition).toBe('https://schema.org/UsedCondition')
    const offers = ld.offers as Record<string, unknown>
    // 37.990.000 is the 512GB row — the minimum is the table's, not the first row's.
    expect(offers).toEqual({
      '@type': 'AggregateOffer',
      itemCondition: 'https://schema.org/UsedCondition',
      lowPrice: 37_990_000,
      // The dearest of the 12 counted listings (the 2TB tier's ceiling), not the largest floor the table prints (77.490.000).
      highPrice: 79_990_000,
      priceCurrency: 'VND',
      // 3 + 4 + 2 + 3: the "12 listings" PriceTable prints (it sums `offers` the same way), not 4 rows.
      offerCount: 12,
      availability: 'https://schema.org/InStock',
    })
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

  // A second-hand unit exists only once someone owns one — no PreOrder branch since 2026-10-03.
  it('is InStock whatever the date — a live used listing is stock by definition', () => {
    vi.useFakeTimers()
    vi.setSystemTime(SHIP - 86_400_000)
    expect((modelProductLd(CFG, ROWS)?.offers as Record<string, unknown>).availability).toBe('https://schema.org/InStock')
  })

  // ⛔ ONE CONDITION PER NODE (commit gate round 6): with new rows on the page the Product is the NEW units', labelled new —
  // a cheaper second-hand unit is never the "from" price of a node about the new model.
  it('new and second-hand rows → one Product of the NEW rows only, labelled NewCondition', () => {
    const used = [row({ price: 30_000_000, listingId: 'u-cheap', offers: 1, image: 'https://sb.eno.vn/a/u-cheap.webp' })]
    const ld = modelProductLd(CFG, [...NEW_ROWS, ...ROWS, ...used]) as Record<string, unknown>
    expect(typesIn(ld).sort()).toEqual(['AggregateOffer', 'Brand', 'Product'])
    expect(ld.itemCondition).toBe('https://schema.org/NewCondition')
    expect(ld.offers).toEqual({
      '@type': 'AggregateOffer',
      itemCondition: 'https://schema.org/NewCondition',
      lowPrice: 37_990_000,
      highPrice: 80_999_000,
      priceCurrency: 'VND',
      // 3 + 2: the new table's printed count only.
      offerCount: 5,
      availability: 'https://schema.org/InStock',
    })
    expect(ld.image).toBe('https://sb.eno.vn/a/new-256.webp')
    expect(JSON.stringify(ld)).not.toContain('30000000')
  })

  it('used rows alone publish the second-hand Product, as before 2026-11-26', () => {
    const ld = modelProductLd(CFG, ROWS) as Record<string, unknown>
    expect((ld.offers as Record<string, unknown>).itemCondition).toBe('https://schema.org/UsedCondition')
    expect((ld.offers as Record<string, unknown>).offerCount).toBe(12)
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
