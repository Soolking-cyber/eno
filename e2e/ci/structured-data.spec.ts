import { test, expect, type APIRequestContext } from '@playwright/test'

// ─────────────────────────────────────────────────────────────────────────────
// THE LISTING PAGE'S STRUCTURED DATA, AS THE SERVER SENDS IT (SEO wave B, S3).
//
// Every indexable listing but a job used to publish one Product+Offer: a rental was a flat FOR SALE,
// an unset condition was "used", every price expired 90 days after posting, and own listings shipped
// free with no returns. src/lib/listing-jsonld.ts now builds one node per kind, and its unit test
// covers every kind as a pure function. This reads the built page, so the wiring is held too: the
// page hands the builder the right row fields, and nothing else on the page publishes a Product.
//  - `ci-l-4` (a `sell` row in rentals, bare unit 'month', no subcategory): a RealEstateListing whose
//    mainEntity is a Place, with a LeaseOut offer priced per month, and no Product anywhere;
//  - `ci-l-1` (a plain electronics row, no condition, a private seller): a Product with no expiry,
//    return policy, shipping terms or condition, sold by a Person.
//
// ⛔ Fixture-backed like the rest of e2e/ci (scripts/ci-fixtures.ts). Never point E2E_CI_BASE at
// production.
// ─────────────────────────────────────────────────────────────────────────────

const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
const LEASE_OUT = 'http://purl.org/goodrelations/v1#LeaseOut'
/** The site-wide nodes the layout emits on every page; not the listing's. */
const SITE_TYPES = new Set(['Organization', 'OnlineBusiness', 'WebSite'])

type Node = Record<string, unknown>

/** Every JSON-LD block in the server's HTML for a path, with its canonical URL. No JavaScript runs. */
async function readLd(request: APIRequestContext, path: string, locale: string) {
  const res = await request.get(path, { headers: { 'user-agent': GOOGLEBOT, 'accept-language': locale } })
  expect(res.status(), `${path} must answer 200`).toBe(200)
  const html = await res.text()
  const blocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]) as Node)
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? null
  // A node's @type may be a string or an array; a site-wide node is one that names any SITE_TYPES entry.
  const listing = blocks.filter((b) => ![b['@type']].flat().some((t) => SITE_TYPES.has(String(t))))
  return {
    canonical,
    items: listing.filter((b) => b['@type'] !== 'BreadcrumbList'),
    crumbs: listing.filter((b) => b['@type'] === 'BreadcrumbList'),
  }
}

/** Every key and every @type anywhere under a node. */
function keysAndTypes(o: unknown, keys = new Set<string>(), types = new Set<string>()) {
  if (Array.isArray(o)) o.forEach((v) => keysAndTypes(v, keys, types))
  else if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) {
      keys.add(k)
      if (k === '@type') types.add(String(v))
      keysAndTypes(v, keys, types)
    }
  }
  return { keys, types }
}

for (const locale of ['en-US', 'vi-VN']) {
  test.describe(`listing structured data (${locale})`, () => {
    test('ci-l-4, a rental: a RealEstateListing of a Place, leased per month, and no Product', async ({ request }) => {
      const { canonical, items, crumbs } = await readLd(request, '/listings/ci-l-4', locale)
      expect(crumbs).toHaveLength(1)
      expect(items).toHaveLength(1)
      const n = items[0]
      expect(n['@type']).toBe('RealEstateListing')
      expect(n.url).toBe(canonical)
      expect((n.mainEntity as Node)['@type']).toBe('Place')
      // An own listing (no affiliateUrl), so it states the date its "Posted" line prints.
      expect(typeof n.datePosted).toBe('string')
      const offer = n.offers as Node
      expect(offer['@type']).toBe('Offer')
      expect(offer.businessFunction).toBe(LEASE_OUT)
      expect(offer).not.toHaveProperty('price')
      const spec = offer.priceSpecification as Node
      expect(spec).toMatchObject({ '@type': 'UnitPriceSpecification', price: 12_300_000, priceCurrency: 'VND' })
      expect(spec.referenceQuantity).toEqual({ '@type': 'QuantitativeValue', value: 1, unitCode: 'MON' })
      const { keys, types } = keysAndTypes(items)
      expect(types.has('Product')).toBe(false)
      for (const k of ['seller', 'itemCondition', 'availability', 'priceValidUntil']) expect(keys.has(k), k).toBe(false)
    })

    test('ci-l-1, goods: a Product with no expiry, returns, shipping or condition, sold by a Person', async ({ request }) => {
      const { canonical, items, crumbs } = await readLd(request, '/listings/ci-l-1', locale)
      expect(crumbs).toHaveLength(1)
      expect(items).toHaveLength(1)
      const n = items[0]
      expect(n['@type']).toBe('Product')
      expect(n.sku).toBe('ci-l-1')
      // The fixture's photo is root-relative; the markup states it on the page's own origin.
      expect(n.image).toEqual([`${new URL(canonical!).origin}/icons/ui/rest/camera.svg`])
      const offer = n.offers as Node
      expect(offer).toMatchObject({
        '@type': 'Offer', url: canonical, price: 18_500_000, priceCurrency: 'VND',
        availability: 'https://schema.org/InStock',
        seller: { '@type': 'Person', name: 'CI Fixture Shop' },
      })
      const { keys } = keysAndTypes(items)
      for (const k of ['priceValidUntil', 'hasMerchantReturnPolicy', 'shippingDetails', 'itemCondition']) expect(keys.has(k), k).toBe(false)
    })
  })
}
