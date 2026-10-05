import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GET /api/price-guidance — the post wizard's door to the band. The FALLBACK flows through here
 * (getPriceBand owns the choice; src/lib/price-fallback.ts owns the key), so a seller is coached
 * against the same band a buyer will see on the PDP:
 *  · a request with NO brand or model now reaches getPriceBand when its shelf has a fallback band,
 *    and the facet value arrives as `attr_<key>` — only the shelf's own key is read;
 *  · an unknown brand no longer ends the request — it only means there is no brand+model band;
 *  · a shelf with no fallback and no brand+model asked for still costs nothing: no rate-limit budget,
 *    no database.
 */

const h = vi.hoisted(() => ({
  band: null as Record<string, unknown> | null,
  brand: null as { slug: string } | null,
  canonical: [] as { model: string }[],
}))

const rateLimit = vi.fn(async () => ({ success: true }))
const getPriceBand = vi.fn(async () => h.band)
const findUnique = vi.fn(async () => h.brand)
const queryRaw = vi.fn(async () => h.canonical)

vi.mock('@/lib/ratelimit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...(a as [])) }))
vi.mock('@/lib/client-ip', () => ({ clientIp: () => '203.0.113.7' }))
vi.mock('@/lib/db', () => ({ db: { brand: { findUnique: (...a: unknown[]) => findUnique(...(a as [])) }, $queryRaw: (...a: unknown[]) => queryRaw(...(a as [])) } }))
vi.mock('@/lib/price-stat', () => ({ SALE_LISTING_TYPE: 'sell', getPriceBand: (...a: unknown[]) => getPriceBand(...(a as [])) }))

const { GET } = await import('./route')

async function ask(query: string) {
  const res = await GET(new NextRequest(`https://eno.vn/api/price-guidance?${query}`))
  return (await res.json()) as Record<string, unknown>
}
const bandArgs = () => (getPriceBand.mock.calls[0] as unknown as [Record<string, unknown>])[0]

beforeEach(() => {
  h.band = null
  h.brand = null
  h.canonical = []
  rateLimit.mockClear()
  getPriceBand.mockClear()
  findUnique.mockClear()
  queryRaw.mockClear()
})

describe('an unbranded item reaches its fallback band', () => {
  it('a sofa with its material: no brand, no model, the facet from attr_material', async () => {
    h.band = { n: 7, p25: 900_000, median: 1_200_000, p75: 1_800_000, basis: 'similar' }
    const body = await ask('category=furniture-appliances&subcategory=sofa-seating&condition=used&attr_material=fabric')
    expect(body).toEqual(h.band)
    expect(bandArgs()).toMatchObject({
      brandSlug: null, model: null, categorySlug: 'furniture-appliances', subcategorySlug: 'sofa-seating',
      listingType: 'sell', condition: 'used', attributes: { material: 'fabric' },
    })
    expect(findUnique).not.toHaveBeenCalled()
    expect(queryRaw).not.toHaveBeenCalled()
  })

  it('a shelf-alone shelf needs no facet', async () => {
    await ask('category=fashion-beauty&subcategory=womens&condition=used')
    expect(bandArgs()).toMatchObject({ brandSlug: null, model: null, attributes: null })
  })

})

describe('nothing to answer costs nothing', () => {
  it('a shelf with no fallback and no brand+model: { n: 0 }, no rate limit, no database', async () => {
    for (const q of [
      'category=furniture-appliances&subcategory=white-goods',
      'category=rentals&subcategory=apartment-rental&type=rent',
      'category=jobs&subcategory=teaching',
      'category=services&subcategory=cleaning',
      'category=furniture-appliances',
    ]) {
      expect(await ask(q)).toEqual({ n: 0 })
    }
    expect(rateLimit).not.toHaveBeenCalled()
    expect(getPriceBand).not.toHaveBeenCalled()
  })

  it('a facet shelf without a taxonomy value for its facet costs nothing either', async () => {
    for (const q of [
      'category=furniture-appliances&subcategory=beds-mattresses', // no material at all
      'category=furniture-appliances&subcategory=beds-mattresses&attr_size=xl', // another key is not its material
      'category=furniture-appliances&subcategory=beds-mattresses&attr_material=leather', // not a taxonomy value
    ]) {
      expect(await ask(q)).toEqual({ n: 0 })
    }
    expect(rateLimit).not.toHaveBeenCalled()
    expect(getPriceBand).not.toHaveBeenCalled()
  })
})

describe('a branded item still gets its brand+model band first, and the fallback behind it', () => {
  it('a known brand resolves its slug and canonical model, and the fallback key rides along', async () => {
    h.brand = { slug: 'ikea' }
    h.canonical = [{ model: 'Ektorp' }]
    await ask('brand=IKEA&model=ektorp&category=furniture-appliances&subcategory=sofa-seating&attr_material=fabric')
    expect(bandArgs()).toMatchObject({ brandSlug: 'ikea', model: 'Ektorp', attributes: { material: 'fabric' } })
  })

  it('an unknown brand no longer ends the request — the fallback still answers', async () => {
    h.band = { n: 5, p25: 100_000, median: 120_000, p75: 150_000, basis: 'similar' }
    const body = await ask('brand=Nobrand&model=X1&category=fashion-beauty&subcategory=womens')
    expect(body).toEqual(h.band)
    expect(bandArgs()).toMatchObject({ brandSlug: null, model: null })
  })

  it('the fallback sentinel is never taken as a brand', async () => {
    await ask('brandSlug=*&model=*&category=fashion-beauty&subcategory=womens')
    expect(queryRaw).not.toHaveBeenCalled()
    expect(bandArgs()).toMatchObject({ brandSlug: null, model: null })
  })

  /**
   * ⚠️ THE ONE BEHAVIOUR CHANGE FOR TODAY'S WIZARD, stated rather than hidden (Opus, diff review): a
   * BRANDED seller on a fallback shelf whose model has no band used to get { n: 0 } and now gets the
   * similar-items band. The wizard draws it with its existing box — "Similar listings go for {range}",
   * "Above the typical {range} range…", "Below the typical {range} range — buyers will see a good deal".
   * The PDP keeps that last promise with its green "Below similar listings" cue, except under half of
   * P25, where it shows no cue at all (market-price.tsx). getPriceBand picks the band; this route only
   * passes it on, `basis` included, for the wizard to branch on.
   */
  it('a branded seller whose model has no band now gets the similar band, basis included', async () => {
    h.brand = { slug: 'zara' }
    h.band = { n: 6, p25: 150_000, median: 200_000, p75: 300_000, basis: 'similar' }
    const body = await ask('brand=Zara&model=Trench&category=fashion-beauty&subcategory=womens&condition=used')
    expect(body).toEqual(h.band)
    expect(bandArgs()).toMatchObject({ brandSlug: 'zara', model: 'Trench', attributes: null })
  })

  it('a branded shelf with no fallback behaves as before', async () => {
    h.brand = { slug: 'apple' }
    h.canonical = [{ model: 'iPhone 15' }]
    await ask('brand=Apple&model=iphone 15&category=electronics&subcategory=phones-tablets&condition=used')
    expect(bandArgs()).toMatchObject({ brandSlug: 'apple', model: 'iPhone 15', attributes: null })
    expect(rateLimit).toHaveBeenCalledTimes(1)
  })
})
