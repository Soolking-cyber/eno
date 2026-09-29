import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ A BULK IMPORT MUST NOT PUSH ANYTHING OUT OF THE SITEMAP.
 *
 * /sitemap.xml used to be one urlset built from two `take: 45000` windows ordered by `updatedAt desc`.
 * A 44,000-row property import (or any affiliate sync) fills such a window with its own fresh rows,
 * and every category × district combo, storefront and listing URL that only OLDER rows supported
 * disappeared from it — silently. It is now an index of capped children (src/lib/sitemap.ts), with
 * the derivations taken from whole-table aggregates.
 *
 * ⚠️ THE FAKE DATABASE APPLIES `where`, `orderBy`, `skip` and `take` — a mock that returned every
 * fixture row would make the edition and affiliate assertions pass with the predicates deleted.
 */

type Row = {
  id: string
  sellerId: string
  categoryId: string
  district: string | null
  affiliateUrl: string | null
  verified: boolean
  status: string
  updatedAt: Date
}

const h = vi.hoisted(() => ({ rows: [] as Row[], hubLive: { car: 1, motorbike: 1 } as Record<string, number>, lookups: 0 }))
const CATEGORY_SLUGS: Record<string, string> = vi.hoisted(() => ({
  'cat-rentals': 'rentals', 'cat-books': 'books-stationery', 'cat-services': 'services', 'cat-empty': 'jobs',
}))
/**
 * Seller id → handle. `sub_shop` is served on its own subdomain, `subshop.eno.vn` (a subdomain is the
 * handle without underscores, owner 2026-09-28 — like production's `sdc_store` → `sdcstore.eno.vn`);
 * `old_shop` would be `oldshop.eno.vn`, but a PERSON holds `oldshop`, and the exact handle decides a
 * label, so its canonical stays the path; `apple` is a BRAND slug, which never gets a subdomain, so it
 * keeps the path too (src/lib/storefront.ts).
 */
const SELLER_HANDLES: Record<string, string> = vi.hoisted(() => ({
  'old-shop': 'old_shop', 'sub-shop': 'sub_shop', 'brand-shop': 'apple',
}))
const PERSON_HANDLES = vi.hoisted(() => new Set(['oldshop']))
const BRAND_SLUGS = vi.hoisted(() => new Set(['apple']))

type Where = Record<string, unknown>
function matches(row: Record<string, unknown>, where: Where | undefined): boolean {
  if (!where) return true
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'AND') return (cond as Where[]).every((w) => matches(row, w))
    const value = row[key]
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as { in?: unknown[]; notIn?: unknown[]; not?: unknown }
      if ('in' in c) return c.in!.includes(value)
      if ('notIn' in c) return !c.notIn!.includes(value)
      if ('not' in c) return value !== c.not
      throw new Error(`fake db: unsupported condition on ${key}: ${JSON.stringify(cond)}`)
    }
    return value === cond
  })
}

vi.mock('@/lib/db', () => ({
  db: {
    listing: {
      count: async ({ where }: { where?: Where } = {}) => h.rows.filter((r) => matches(r, where)).length,
      findMany: async ({ where, orderBy, skip = 0, take }: { where?: Where; orderBy?: { id?: 'asc' | 'desc'; updatedAt?: 'asc' | 'desc' }; skip?: number; take?: number } = {}) => {
        let out = h.rows.filter((r) => matches(r, where))
        if (orderBy?.id) out = [...out].sort((a, b) => (a.id < b.id ? -1 : 1) * (orderBy.id === 'desc' ? -1 : 1))
        // Honoured so the OLD `updatedAt desc, take 45000` shape can be run against this suite.
        if (orderBy?.updatedAt) out = [...out].sort((a, b) => (a.updatedAt.getTime() - b.updatedAt.getTime()) * (orderBy.updatedAt === 'desc' ? -1 : 1))
        // `category.slug` rides along for the same reason: the old query selected it.
        return out.slice(skip, take === undefined ? undefined : skip + take).map((r) => ({ ...r, category: { slug: CATEGORY_SLUGS[r.categoryId] } }))
      },
      groupBy: async ({ by, where }: { by: (keyof Row)[]; where?: Where }) => {
        // `_count._all` is always filled: a query that did not ask for it never reads it.
        const groups = new Map<string, Record<string, unknown> & { _max: { updatedAt: Date | null }; _count: { _all: number } }>()
        for (const r of h.rows.filter((x) => matches(x, where))) {
          const key = JSON.stringify(by.map((k) => r[k]))
          const g = groups.get(key) ?? { ...Object.fromEntries(by.map((k) => [k, r[k]])), _max: { updatedAt: null }, _count: { _all: 0 } }
          if (!g._max.updatedAt || r.updatedAt > g._max.updatedAt) g._max.updatedAt = r.updatedAt
          g._count._all++
          groups.set(key, g)
        }
        return [...groups.values()]
      },
    },
    category: {
      findMany: async () => Object.entries(CATEGORY_SLUGS).map(([id, slug]) => ({ id, slug })),
    },
    seller: {
      findMany: async ({ where }: { where?: Where } = {}) =>
        ['import-seller', 'old-shop', 'sub-shop', 'brand-shop', 'desk-seller', 'own-seller']
          .map((id) => ({ id, handle: SELLER_HANDLES[id] ? { handle: SELLER_HANDLES[id] } : null }))
          .filter((s) => matches(s, where)),
    },
    // What `storefrontByLabel` / `storefrontByHandle` (one label) and `storefrontCanonicals` (a set,
    // pages.xml) read to decide whether the subdomain serves a handle. `h.lookups` counts the batch's
    // reads. The label reads are `Prisma.sql` objects: every handle whose own spelling or
    // underscore-free form is among the values.
    $queryRaw: async (q: { values: unknown[] }) => {
      h.lookups++
      const want = new Set(q.values as string[])
      const rows = [
        ...Object.entries(SELLER_HANDLES).map(([id, handle]) => ({ handle, sellerId: id as string | null })),
        ...[...PERSON_HANDLES].map((handle) => ({ handle, sellerId: null })),
      ]
      return rows.filter((r) => want.has(r.handle) || want.has(r.handle.replace(/_/g, '')))
    },
    handle: {
      findUnique: async ({ where }: { where: { handle: string } }) => {
        if (PERSON_HANDLES.has(where.handle)) return { handle: where.handle, seller: null }
        const id = Object.keys(SELLER_HANDLES).find((k) => SELLER_HANDLES[k] === where.handle)
        return id ? { handle: where.handle, seller: { id, name: id, bannerUrl: null, bannerMobileUrl: null } } : null
      },
    },
    brand: {
      findUnique: async ({ where }: { where: { slug: string } }) => (BRAND_SLUGS.has(where.slug) ? { slug: where.slug } : null),
      findMany: async ({ where }: { where: { slug: { in: string[] } } }) => {
        h.lookups++
        return [...BRAND_SLUGS].filter((slug) => where.slug.in.includes(slug)).map((slug) => ({ slug }))
      },
    },
    forumPost: { findMany: async () => [] },
  },
}))

/** The vehicle-hire hubs' live counts (their predicate joins Category, which the fake db does not model). */
vi.mock('@/lib/vehicle-hubs', () => ({
  vehicleHubLiveCount: async (kind: string) => h.hubLive[kind] ?? 0,
  VEHICLE_HUB_KIND_BY_SLUG: {
    'car-rental-ho-chi-minh-city': 'car', 'thue-xe-tu-lai-tphcm': 'car',
    'motorbike-rental-ho-chi-minh-city': 'motorbike', 'thue-xe-may-tphcm': 'motorbike',
  },
}))

/** The licensed-marketplace scope, emulated: the desk seller's rows are invisible to every read. */
vi.mock('@/lib/edition-scope', () => ({
  scopedListingWhere: async (w: object) => ({ AND: [w, { sellerId: { notIn: ['desk-seller'] } }] }),
}))

import { GET as indexGET } from '@/app/sitemap.xml/route'
import { GET as pagesGET } from '@/app/sitemaps/pages.xml/route'
import { GET as childGET } from '@/app/sitemaps/[file]/route'
import { LISTINGS_PER_SITEMAP, listingSitemapCount, parseListingSitemapFile } from '@/lib/sitemap'
import { MIN_INDEXABLE_LISTINGS } from '@/lib/index-floor'
import { storefrontCanonical } from '@/lib/storefront'

const HOST = 'https://eno.vn'
const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
const child = async (file: string) => childGET(new Request(`${HOST}/sitemaps/${file}`), { params: Promise.resolve({ file }) })

function row(over: Partial<Row> & Pick<Row, 'id'>): Row {
  return {
    sellerId: 'own-seller', categoryId: 'cat-books', district: null, affiliateUrl: null,
    verified: true, status: 'active', updatedAt: new Date('2026-01-01T00:00:00Z'), ...over,
  }
}

const OLD = new Date('2025-06-01T00:00:00Z')
const FRESH = new Date('2026-09-24T00:00:00Z')

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_URL', HOST)
  h.rows = []
  h.hubLive = { car: 1, motorbike: 1 }
  h.lookups = 0
})
afterEach(() => { vi.unstubAllEnvs() })

describe('the sitemap index', () => {
  it('is a <sitemapindex> naming the pages child and one listing child per 45,000 submitted listings', async () => {
    h.rows = Array.from({ length: 2 * LISTINGS_PER_SITEMAP + 1 }, (_, i) => row({ id: `own-${String(i).padStart(6, '0')}` }))
    const res = await indexGET()
    const xml = await res.text()
    expect(res.headers.get('content-type')).toContain('application/xml')
    expect(xml).toMatch(/^<\?xml[^>]*\?>\s*<sitemapindex /)
    expect(locs(xml)).toEqual([
      `${HOST}/sitemaps/pages.xml`,
      `${HOST}/sitemaps/listings-0.xml`,
      `${HOST}/sitemaps/listings-1.xml`,
      `${HOST}/sitemaps/listings-2.xml`,
    ])
  })

  it('names no listing child when nothing is submitted', async () => {
    h.rows = [row({ id: 'imp-1', affiliateUrl: 'https://nhatot.com/x' })]
    expect(locs(await (await indexGET()).text())).toEqual([`${HOST}/sitemaps/pages.xml`])
  })
})

describe('the listing children', () => {
  /**
   * ⛔ THE REGRESSION: the old file emitted at most 45,000 listing URLs, so the 45,001st listing was
   * in no sitemap at all. Every submitted listing must now be in exactly one child.
   */
  it('cover EVERY submitted listing exactly once, each child ≤ 45,000 URLs', async () => {
    const n = LISTINGS_PER_SITEMAP + 7
    h.rows = Array.from({ length: n }, (_, i) => row({ id: `own-${String(i).padStart(6, '0')}`, updatedAt: new Date(Date.UTC(2026, 0, 1) + i * 1000) }))
    const seen: string[] = []
    for (const loc of locs(await (await indexGET()).text()).filter((l) => l.includes('/listings-'))) {
      const file = loc.split('/').pop()!
      const urls = locs(await (await child(file)).text())
      expect(urls.length).toBeLessThanOrEqual(LISTINGS_PER_SITEMAP)
      seen.push(...urls)
    }
    expect(seen.length).toBe(n)
    expect(new Set(seen).size).toBe(n)
    expect(seen).toContain(`${HOST}/listings/own-${String(n - 1).padStart(6, '0')}`)
  }, 60_000)

  it('keep the submission rules: no imported/affiliate row, no hidden or unverified row, no desk row', async () => {
    h.rows = [
      row({ id: 'own-live' }),
      row({ id: 'imp-live', affiliateUrl: 'https://muaban.net/x', sellerId: 'import-seller' }),
      row({ id: 'own-hidden', status: 'hidden' }),
      row({ id: 'own-unverified', verified: false }),
      row({ id: 'desk-live', sellerId: 'desk-seller' }),
    ]
    const xml = await (await child('listings-0.xml')).text()
    expect(xml).toMatch(/<urlset /)
    expect(locs(xml)).toEqual([`${HOST}/listings/own-live`])
    expect(xml).toContain('<lastmod>2026-01-01T00:00:00.000Z</lastmod>')
  })

  /**
   * The HCMC vehicle-hire import (scripts/import-vehicle-rentals.ts, ~6,400 rows) is reference stock:
   * browsable, `noindex` on the PDP (src/lib/rental-places.ts), and never submitted. Pinned here so a
   * change to the affiliate rule cannot quietly push thousands of copied car pages into the sitemap.
   */
  it('never submits an imported vehicle-hire listing, and still submits a car a real seller posted', async () => {
    h.rows = [
      row({ id: 'car-imported', affiliateUrl: 'https://www.mioto.vn/car/vinfast-vf5-2026/KJJRTU', sellerId: 'import-seller' }),
      row({ id: 'bike-imported', affiliateUrl: 'https://janmotorbike.com/product/airblade/', sellerId: 'import-seller' }),
      row({ id: 'car-own' }),
    ]
    expect(locs(await (await child('listings-0.xml')).text())).toEqual([`${HOST}/listings/car-own`])
  })

  it('404 anything that is not a bounded listings-<k>.xml, and answer an empty urlset past the end', async () => {
    for (const bad of ['listings.xml', 'listings-01.xml', 'listings--1.xml', 'listings-200.xml', 'foo.xml', 'pages.txt']) {
      expect((await child(bad)).status, bad).toBe(404)
    }
    h.rows = [row({ id: 'own-1' })]
    const past = await child('listings-3.xml')
    expect(past.status).toBe(200)
    expect(locs(await past.text())).toEqual([])
  })

  it('parse and count children the same way the index does', () => {
    expect(parseListingSitemapFile('listings-0.xml')).toBe(0)
    expect(parseListingSitemapFile('listings-199.xml')).toBe(199)
    expect(parseListingSitemapFile('listings-200.xml')).toBeNull()
    expect(listingSitemapCount(0)).toBe(0)
    expect(listingSitemapCount(1)).toBe(1)
    expect(listingSitemapCount(LISTINGS_PER_SITEMAP)).toBe(1)
    expect(listingSitemapCount(LISTINGS_PER_SITEMAP + 1)).toBe(2)
    expect(listingSitemapCount(Number.NaN)).toBe(0)
  })
})

describe('the vehicle-hire hubs in the pages child', () => {
  const pagesLocs = async () => locs(await (await pagesGET()).text())
  it('submits each hub pair while it has live stock, and drops a pair the moment it has none (it serves noindex then)', async () => {
    expect(await pagesLocs()).toEqual(expect.arrayContaining([
      `${HOST}/car-rental-ho-chi-minh-city`, `${HOST}/thue-xe-tu-lai-tphcm`,
      `${HOST}/motorbike-rental-ho-chi-minh-city`, `${HOST}/thue-xe-may-tphcm`,
    ]))
    h.hubLive = { car: 5, motorbike: 0 }
    const out = await pagesLocs()
    expect(out).toContain(`${HOST}/car-rental-ho-chi-minh-city`)
    expect(out).not.toContain(`${HOST}/motorbike-rental-ho-chi-minh-city`)
    expect(out).not.toContain(`${HOST}/thue-xe-may-tphcm`)
  })
})

describe('the pages child', () => {
  /** `n` rows of one kind, ids `${prefix}-0…`, for the floor cases. */
  const many = (n: number, prefix: string, over: Partial<Row>) => Array.from({ length: n }, (_, i) => row({ id: `${prefix}-${i}`, ...over }))

  /**
   * ⛔ THE STARVATION, REPRODUCED. 45,001 FRESH imported rows (the size of a full nhatot run) sit in
   * one district under one seller; the only rows in /c/books-stationery/thao-dien and the only rows
   * of the "oldshop" storefront are older. The old derivation read the newest 45,000 rows, so both
   * URLs vanished. The aggregates see the whole table.
   *
   * ⚠️ TEN OLD ROWS, NOT TWO (SEO wave B, I1): a district page is submitted only at the floor of
   * MIN_INDEXABLE_LISTINGS own listings, so the old stock has to be a page's worth — split 6 + 4
   * across two spellings, which also pins that the floor is applied to the MERGED count.
   */
  it('keeps combos and storefronts that only OLDER rows support, however large the fresh import', async () => {
    h.rows = [
      ...Array.from({ length: LISTINGS_PER_SITEMAP + 1 }, (_, i) =>
        row({ id: `imp-${i}`, sellerId: 'import-seller', categoryId: 'cat-rentals', district: 'Quận 1', affiliateUrl: 'https://nhatot.com/x', updatedAt: FRESH }),
      ),
      ...many(6, 'old-a', { sellerId: 'old-shop', categoryId: 'cat-books', district: 'Thảo Điền', updatedAt: OLD }),
      ...many(4, 'old-b', { sellerId: 'old-shop', categoryId: 'cat-books', district: 'Thao Dien', updatedAt: new Date('2025-07-01T00:00:00Z') }),
    ]
    const xml = await (await pagesGET()).text()
    const urls = locs(xml)
    expect(xml).toMatch(/<urlset /)
    // ⚠️ THE CANONICAL SLUG (district-canonical.ts): "Thảo Điền" is a spelling of the curated Thủ Đức
    // entry, and /c/<cat>/thao-dien now 308s to /c/<cat>/thu-duc — the sitemap submits where it lands.
    expect(urls).toContain(`${HOST}/c/books-stationery/thu-duc`)
    expect(urls).not.toContain(`${HOST}/c/books-stationery/thao-dien`)
    expect(urls).toContain(`${HOST}/old_shop`)
    expect(urls).toContain(`${HOST}/c/books-stationery`)
    // Imported stock still supports its CATEGORY. Its LISTING URLs are withheld (not in this file at
    // all), and so are a category × district combo that ONLY imports reach and — since I2 — the
    // storefront of a seller whose every listing is imported.
    expect(urls).toContain(`${HOST}/c/rentals`)
    expect(urls).not.toContain(`${HOST}/sellers/import-seller`)
    expect(urls).not.toContain(`${HOST}/c/rentals/d1`)
    expect(urls).not.toContain(`${HOST}/c/rentals/quan-1`)
    expect(urls.some((u) => u.includes('/listings/'))).toBe(false)
    // Two spellings of one place are one URL, carrying the later of their two dates.
    expect(urls.filter((u) => u.endsWith('/c/books-stationery/thu-duc'))).toHaveLength(1)
    expect(xml).toContain(`<loc>${HOST}/c/books-stationery/thu-duc</loc><lastmod>2025-07-01T00:00:00.000Z</lastmod>`)
    // The home page's lastmod is the freshest live row anywhere.
    expect(xml).toContain(`<loc>${HOST}</loc><lastmod>${FRESH.toISOString()}</lastmod>`)
  }, 60_000)

  /**
   * ⛔ RULE A (SEO wave B, I1; decision I-a): A CATEGORY × DISTRICT PAGE IS SUBMITTED ONLY WITH AT
   * LEAST MIN_INDEXABLE_LISTINGS OF OUR OWN VERIFIED, ACTIVE LISTINGS, AND NEVER FOR RENTALS BY THAT
   * COUNT. Below the floor the page is `noindex, follow` or thin; an import is someone else's
   * catalogue (lead, 2026-09-24, under the owner's 2026-09-17 rule), so it never counts toward it.
   */
  it('submits a district page at N own listings and not at N - 1', async () => {
    h.rows = [
      ...many(MIN_INDEXABLE_LISTINGS, 'own-q5', { district: 'Quận 5' }),
      ...many(MIN_INDEXABLE_LISTINGS - 1, 'own-q3', { district: 'Quận 3' }),
    ]
    const urls = locs(await (await pagesGET()).text())
    expect(urls).toContain(`${HOST}/c/books-stationery/d5`)
    expect(urls).not.toContain(`${HOST}/c/books-stationery/d3`)
  })

  it('adds up the spellings of one place before the floor, and counts no import, hidden or unverified row', async () => {
    const half = MIN_INDEXABLE_LISTINGS / 2
    h.rows = [
      // 5 + 5 across "Quận 7" / "District 7" is one `d7` page of 10 → submitted.
      ...many(half, 'own-q7', { district: 'Quận 7' }),
      ...many(half, 'own-d7', { district: 'District 7' }),
      // 5 + 4 is one page of 9 → not.
      ...many(half, 'own-q8', { district: 'Quận 8' }),
      ...many(half - 1, 'own-d8', { district: 'District 8' }),
      // N - 1 own live rows, plus imports, a hidden and an unverified own row: still N - 1 that count.
      ...many(MIN_INDEXABLE_LISTINGS - 1, 'own-q3', { district: 'Quận 3', updatedAt: OLD }),
      ...many(30, 'imp-q3', { sellerId: 'import-seller', district: 'Quận 3', affiliateUrl: 'https://muaban.net/x', updatedAt: FRESH }),
      row({ id: 'own-q3-hidden', district: 'Quận 3', status: 'hidden' }),
      row({ id: 'own-q3-unverified', district: 'Quận 3', verified: false }),
      // A Hà Nội district that only imports reach → never.
      ...many(MIN_INDEXABLE_LISTINGS, 'imp-hn', { sellerId: 'import-seller', district: 'Quận Cầu Giấy', affiliateUrl: 'https://www.nhatot.com/1.htm' }),
    ]
    const xml = await (await pagesGET()).text()
    const urls = locs(xml)
    expect(urls.filter((u) => u.startsWith(`${HOST}/c/books-stationery/`))).toEqual([`${HOST}/c/books-stationery/d7`])
    // The category page still counts imported stock; the import seller's storefront does not (I2).
    expect(xml).toContain(`<loc>${HOST}/c/books-stationery</loc><lastmod>${FRESH.toISOString()}</lastmod>`)
    expect(urls).not.toContain(`${HOST}/sellers/import-seller`)
  })

  /**
   * ⛔ OWN COUNTS NEVER QUALIFY A RENTALS DISTRICT PAGE (rule A). This test used to pin the opposite —
   * one own rental in `d3` submitted `/c/rentals/d3` — which held only because no own rental existed.
   * Rentals district pages enter the sitemap through the rent index's rule (SEO wave B, D3), never by
   * their own count; the lastmod rule for the pages that ARE submitted is unchanged (own row's date).
   */
  it('never submits a rentals district page by its own count, however many', async () => {
    h.rows = [
      ...many(MIN_INDEXABLE_LISTINGS * 3, 'own-rent-q3', { categoryId: 'cat-rentals', district: 'Quận 3', updatedAt: OLD }),
      ...many(MIN_INDEXABLE_LISTINGS, 'own-books-q3', { district: 'Quận 3', updatedAt: OLD }),
      row({ id: 'imp-books-q3', sellerId: 'import-seller', district: 'Quận 3', affiliateUrl: 'https://muaban.net/x', updatedAt: FRESH }),
    ]
    const xml = await (await pagesGET()).text()
    const urls = locs(xml)
    expect(urls.some((u) => u.startsWith(`${HOST}/c/rentals/`))).toBe(false)
    expect(urls).toContain(`${HOST}/c/rentals`)
    // A district page that does qualify is dated by OUR newest row, never by an import's fresher sync.
    expect(xml).toContain(`<loc>${HOST}/c/books-stationery/d3</loc><lastmod>${OLD.toISOString()}</lastmod>`)
  })

  it('keeps the edition boundary and the empty-category rule', async () => {
    h.rows = [
      ...many(MIN_INDEXABLE_LISTINGS, 'own', { categoryId: 'cat-books', district: 'Quận 3' }),
      ...many(MIN_INDEXABLE_LISTINGS, 'desk', { sellerId: 'desk-seller', categoryId: 'cat-services', district: 'Quận 1' }),
    ]
    const urls = locs(await (await pagesGET()).text())
    expect(urls).not.toContain(`${HOST}/c/services`)
    expect(urls.some((u) => u.includes('/c/services/'))).toBe(false)
    expect(urls).not.toContain(`${HOST}/sellers/desk-seller`)
    expect(urls).not.toContain(`${HOST}/c/jobs`) // a category with no live listing is never submitted
    expect(urls).toContain(`${HOST}/c/books-stationery/d3`)
    expect(urls).toContain(`${HOST}/sellers/own-seller`)
  })

  /**
   * ⛔ STOREFRONTS (SEO wave B, I2): ONLY A SELLER WITH A LISTING OF ITS OWN, AT ITS PAGE'S OWN
   * CANONICAL (`storefrontCanonical`, the value `/<handle>` puts in `<link rel="canonical">`), AND
   * NOT AT ALL WHILE THAT CANONICAL IS A SUBDOMAIN (decision I-b, at its default). The loop used to
   * submit `${host}/<handle>` for every seller with any live row, imports included, while the page
   * canonicalised to `<handle>.eno.vn`.
   */
  it('submits a storefront at its own canonical: the path, never a subdomain', async () => {
    h.rows = [
      row({ id: 'own-1', sellerId: 'own-seller' }),
      // Dated by its own listing, never by an import's fresher sync.
      row({ id: 'old-1', sellerId: 'old-shop', updatedAt: OLD }),
      row({ id: 'old-imp', sellerId: 'old-shop', affiliateUrl: 'https://tiki.vn/x', updatedAt: FRESH }),
      row({ id: 'sub-1', sellerId: 'sub-shop' }),
      row({ id: 'brand-1', sellerId: 'brand-shop' }),
    ]
    const xml = await (await pagesGET()).text()
    const urls = locs(xml)
    // Three handle sellers, one batched handle read and one batched brand read — never two per seller.
    // Read before the per-handle calls below, which make reads of their own.
    expect(h.lookups).toBe(2)
    // Each submitted <loc> IS the page's canonical, from the one function the page calls.
    expect(await storefrontCanonical('old_shop', HOST)).toBe(`${HOST}/old_shop`)
    expect(await storefrontCanonical('apple', HOST)).toBe(`${HOST}/apple`)
    expect(urls).toContain(`${HOST}/old_shop`)
    expect(urls).toContain(`${HOST}/apple`)
    expect(urls).toContain(`${HOST}/sellers/own-seller`)
    expect(xml).toContain(`<loc>${HOST}/old_shop</loc><lastmod>${OLD.toISOString()}</lastmod>`)
    // The subdomain shop: its page canonicalises to the subdomain, so neither that nor the path is submitted.
    expect(await storefrontCanonical('sub_shop', HOST)).toBe('https://subshop.eno.vn')
    expect(urls.filter((u) => /subshop|sub-shop|sub_shop/.test(u))).toEqual([])
    expect(urls.every((u) => u.startsWith(HOST))).toBe(true)
  })

  it('leaves out a storefront with no listing of its own: all imported, or none live', async () => {
    h.rows = [
      row({ id: 'own-1', sellerId: 'own-seller' }),
      ...many(20, 'imp', { sellerId: 'import-seller', affiliateUrl: 'https://muaban.net/x', updatedAt: FRESH }),
      row({ id: 'old-imp', sellerId: 'old-shop', affiliateUrl: 'https://tiki.vn/x' }),
      row({ id: 'old-hidden', sellerId: 'old-shop', status: 'hidden' }),
      row({ id: 'old-unverified', sellerId: 'old-shop', verified: false }),
      row({ id: 'brand-sold', sellerId: 'brand-shop', status: 'sold' }),
      row({ id: 'desk-1', sellerId: 'desk-seller' }),
    ]
    const urls = locs(await (await pagesGET()).text())
    expect(urls).toContain(`${HOST}/sellers/own-seller`)
    for (const out of ['/sellers/import-seller', '/old_shop', '/sellers/old-shop', '/apple', '/sellers/brand-shop', '/sellers/desk-seller']) {
      expect(urls, out).not.toContain(`${HOST}${out}`)
    }
  })

  it('on eno.forum: the path canonical on www.eno.forum, and no subdomain shop', async () => {
    const FORUM = 'https://www.eno.forum'
    vi.stubEnv('NEXT_PUBLIC_APP_URL', FORUM)
    h.rows = [row({ id: 'old-1', sellerId: 'old-shop' }), row({ id: 'sub-1', sellerId: 'sub-shop' })]
    const urls = locs(await (await pagesGET()).text())
    expect(urls).toContain(`${FORUM}/old_shop`)
    expect(await storefrontCanonical('sub_shop', FORUM)).toBe('https://subshop.eno.forum')
    expect(urls.filter((u) => /subshop|sub-shop|sub_shop/.test(u))).toEqual([])
    expect(urls.every((u) => u.startsWith(FORUM))).toBe(true)
  })
})
