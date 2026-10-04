import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { ModelPageConfig } from './model-landing'

/**
 * ⛔ A MODEL NOT YET ON SALE IN VIETNAM HAS NO RAIL — the same gate as its price table and Product.
 * The verify of 2026-10-04 found the iPhone Duo page (on sale 23 October) able to show a used Duo under
 * "Trusted listings" directly beneath "No second-hand shop lists the iPhone Duo here yet".
 *
 * model-landing.tsx renders through SeoLanding and reads prices through lowest-prices.ts, both of which
 * import the Prisma client — so those two are stubbed and only the pure `modelContent` is exercised.
 */
vi.mock('@/components/marketplace/seo-landing', () => ({ SeoLanding: () => null }))
vi.mock('./lowest-prices', () => ({ lowestPrices: async () => ({ rows: [], known: true }) }))
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
