import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ModelPageConfig } from './model-landing'
import type { PriceRow } from './lowest-prices'

/**
 * ⛔ A MODEL NOT YET ON SALE IN VIETNAM HAS NO RAIL — the same gate as its price table and Product.
 * The verify of 2026-10-04 found the iPhone Duo page (on sale 23 October) able to show a used Duo under
 * "Trusted listings" directly beneath "No second-hand shop lists the iPhone Duo here yet".
 *
 * model-landing.tsx renders through SeoLanding and reads prices through lowest-prices.ts, both of which
 * import the Prisma client — so those two are stubbed and only the pure `modelContent` is exercised.
 */
vi.mock('@/components/marketplace/seo-landing', () => ({ SeoLanding: () => null }))
vi.mock('./lowest-prices', () => ({ lowestPrices: async () => ({ rows: [], known: true }), lowestNewPrices: async () => ({ rows: [], known: true }) }))
vi.mock('./price-table', () => ({ AffiliateNote: () => null, PriceTable: () => null, showAffiliateNote: () => false }))

let modelContent: typeof import('./model-landing').modelContent
beforeAll(async () => {
  ;({ modelContent } = await import('./model-landing'))
})

const cfg = (model: string): ModelPageConfig => ({
  model,
  slug: 'x-vietnam',
  eyebrow: 'Apple · Vietnam',
  h1: `${model} price in Vietnam`,
  intro: 'Intro.',
  rrp: 64_999_000,
  cta: `Browse second-hand ${model} listings`,
  browseQuery: model,
  sections: [],
  faqs: [],
  related: [],
})

// 23 October 2026 00:00 ICT is 22 October 17:00 UTC (price-guard.ts APPLE_VN_ON_SALE).
const BEFORE = new Date('2026-10-22T16:59:59Z')
const AFTER = new Date('2026-10-22T17:00:00Z')

describe('the rail follows the on-sale gate', () => {
  it('iPhone Duo before its Vietnamese on-sale date: rail OFF, and the copy says no shop lists one', () => {
    const c = modelContent(cfg('iPhone Duo'), [], true, BEFORE)
    expect(c.rail).toBe(false)
    expect(c.intro).toContain('No second-hand shop lists the iPhone Duo here yet')
  })

  it('from the on-sale date the rail is back, narrowed exactly as before (used, this one model)', () => {
    const c = modelContent(cfg('iPhone Duo'), [], true, AFTER)
    expect(c.rail).toBeUndefined()
    expect(c).toMatchObject({ condition: 'used', models: ['iPhone Duo'], brandSlug: 'apple', order: 'recent' })
  })

  it('a model already on sale (no on-sale date recorded) always has its rail', () => {
    expect(modelContent(cfg('iPhone 18 Pro'), [], true, BEFORE).rail).toBeUndefined()
    expect(modelContent(cfg('iPhone 18 Pro Max'), [], true, new Date('2020-01-01T00:00:00Z')).rail).toBeUndefined()
  })

  it('before the on-sale date the CTA is the hub, never a browse link onto the ungated feed', () => {
    const before = modelContent(cfg('iPhone Duo'), [], true, BEFORE)
    expect(before.cta).toBeUndefined()
    expect(before.browseLinks).toEqual([{ href: '/iphone-18-vietnam', label: 'Compare the iPhone 18 line' }])
    const after = modelContent(cfg('iPhone Duo'), [], true, AFTER)
    expect(after.cta).toBe('Browse second-hand iPhone Duo listings')
    expect(after.browseLinks).toBeUndefined()
    expect(modelContent(cfg('iPhone 18 Pro'), [], true, BEFORE).cta).toBe('Browse second-hand iPhone 18 Pro listings')
  })

  it('⚠️ switching the rail off never WIDENS it — `models` still names the one model', () => {
    // An empty `models` would mean "no model filter" (every used Apple phone), the opposite of the intent.
    expect(modelContent(cfg('iPhone Duo'), [], true, BEFORE).models).toEqual(['iPhone Duo'])
  })
})

const row = (over: Partial<PriceRow>): PriceRow => ({
  model: 'iPhone 18 Pro', storage: '256GB', storageGb: 256, price: 30_000_000, currency: '₫', listingId: 'u1',
  seller: 'Minh Tuấn Mobile', offers: 2, ceiling: 31_000_000, condition: 'used', tracked: false, image: 'https://sb.eno.vn/a/u1.webp', ...over,
})
const NEW = (over: Partial<PriceRow> = {}) =>
  row({ price: 37_990_000, ceiling: 38_999_000, listingId: 'n1', seller: 'ShopDunk', offers: 3, condition: 'new', tracked: true, image: 'https://sb.eno.vn/a/n1.webp', ...over })

/**
 * ⛔ THE INTRO STAYS TRUE WITH THE NEW TABLE (2026-11-26): it said "second-hand" of every price on the page. Each table now speaks
 * for itself, and with no new rows the page reads exactly as before.
 */
describe('the intro and the Product with new rows (lowestNewPrices)', () => {
  const pro = cfg('iPhone 18 Pro')

  it('no new rows → the intro is the second-hand page it was, word for word', () => {
    const before = modelContent(pro, [row({})], true, AFTER)
    expect(modelContent(pro, [row({})], true, AFTER, { rows: [], known: true }).intro).toBe(before.intro)
    expect(before.intro).toBe('Intro. The cheapest second-hand one from a shop here right now is 30,000,000 đ for the 256GB model. Every price in the table below is a live listing from a second-hand phone shop on this marketplace — each one links to the listing it was read from.')
  })

  it('new and used rows → both floors, and the tables named for what they are', () => {
    const c = modelContent(pro, [row({})], true, AFTER, { rows: [NEW()], known: true })
    expect(c.intro).toBe('Intro. The cheapest new one from a shop here right now is 37,990,000 đ for the 256GB model. The cheapest second-hand one is 30,000,000 đ for the 256GB model. Every price in the tables below is a live listing from a shop on this marketplace — each one links to the listing it was read from.')
  })

  it('new rows only → the new floor, no second-hand price, no "second-hand shop" claim about the table', () => {
    const c = modelContent(pro, [], true, AFTER, { rows: [NEW()], known: true })
    expect(c.intro).toBe('Intro. The cheapest new one from a shop here right now is 37,990,000 đ for the 256GB model. No second-hand shop lists one here yet. Every price in the table below is a live listing from a shop on this marketplace — each one links to the listing it was read from.')
    // A used read that failed says nothing about used stock.
    expect(modelContent(pro, [], false, AFTER, { rows: [NEW()], known: true }).intro).not.toContain('second-hand')
  })

  it('a failed NEW read with no used rows: Apple’s price, and nothing about new units', () => {
    const c = modelContent(pro, [], true, AFTER, { rows: [], known: false })
    expect(c.intro).toBe('Intro. No second-hand shop lists the iPhone 18 Pro here yet; Apple Vietnam\'s own price starts at 64,999,000 đ.')
  })

  it('ONE Product, of the NEW rows when the page has any — a cheaper used unit is never its "from" price', () => {
    const c = modelContent(pro, [row({})], true, AFTER, { rows: [NEW()], known: true })
    const products = (c.jsonLd ?? []).filter((n) => n['@type'] === 'Product')
    expect(products).toHaveLength(1)
    expect(products[0].itemCondition).toBe('https://schema.org/NewCondition')
    expect(products[0].offers).toMatchObject({ '@type': 'AggregateOffer', itemCondition: 'https://schema.org/NewCondition' })
    expect((products[0].offers as { lowPrice: number }).lowPrice).not.toBe(30_000_000)
  })

  it('the rail and the CTA stay second-hand — the new units are the new table’s, not the rail’s', () => {
    const c = modelContent(pro, [], true, AFTER, { rows: [NEW()], known: true })
    expect(c.condition).toBe('used')
    expect(c.cta).toBe('Browse second-hand iPhone 18 Pro listings')
  })
})
