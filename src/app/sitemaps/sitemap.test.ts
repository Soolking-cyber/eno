import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const h = vi.hoisted(() => ({ rows: [] as Row[] }))
const CATEGORY_SLUGS: Record<string, string> = vi.hoisted(() => ({
  'cat-rentals': 'rentals', 'cat-books': 'books-stationery', 'cat-services': 'services', 'cat-empty': 'jobs',
}))

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
        const groups = new Map<string, Record<string, unknown> & { _max: { updatedAt: Date | null } }>()
        for (const r of h.rows.filter((x) => matches(x, where))) {
          const key = JSON.stringify(by.map((k) => r[k]))
          const g = groups.get(key) ?? { ...Object.fromEntries(by.map((k) => [k, r[k]])), _max: { updatedAt: null } }
          if (!g._max.updatedAt || r.updatedAt > g._max.updatedAt) g._max.updatedAt = r.updatedAt
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
        ['import-seller', 'old-shop', 'desk-seller', 'own-seller']
          .map((id) => ({ id, handle: id === 'old-shop' ? { handle: 'oldshop' } : null }))
          .filter((s) => matches(s, where)),
    },
    forumPost: { findMany: async () => [] },
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
})

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

describe('the pages child', () => {
  /**
   * ⛔ THE STARVATION, REPRODUCED. 45,001 FRESH imported rows (the size of a full nhatot run) sit in
   * one district under one seller; the only rows in /c/books-stationery/thao-dien and the only rows
   * of the "oldshop" storefront are older. The old derivation read the newest 45,000 rows, so both
   * URLs vanished. The aggregates see the whole table.
   */
  it('keeps combos and storefronts that only OLDER rows support, however large the fresh import', async () => {
    h.rows = [
      ...Array.from({ length: LISTINGS_PER_SITEMAP + 1 }, (_, i) =>
        row({ id: `imp-${i}`, sellerId: 'import-seller', categoryId: 'cat-rentals', district: 'Quận 1', affiliateUrl: 'https://nhatot.com/x', updatedAt: FRESH }),
      ),
      row({ id: 'old-1', sellerId: 'old-shop', categoryId: 'cat-books', district: 'Thảo Điền', updatedAt: OLD }),
      row({ id: 'old-2', sellerId: 'old-shop', categoryId: 'cat-books', district: 'Thao Dien', updatedAt: new Date('2025-07-01T00:00:00Z') }),
    ]
    const xml = await (await pagesGET()).text()
    const urls = locs(xml)
    expect(xml).toMatch(/<urlset /)
    expect(urls).toContain(`${HOST}/c/books-stationery/thao-dien`)
    expect(urls).toContain(`${HOST}/oldshop`)
    expect(urls).toContain(`${HOST}/c/books-stationery`)
    // Imported stock still supports its category and storefront. Its LISTING URLs are withheld (not
    // in this file at all), and so is a category × district combo that ONLY imports reach.
    expect(urls).toContain(`${HOST}/c/rentals`)
    expect(urls).toContain(`${HOST}/sellers/import-seller`)
    expect(urls).not.toContain(`${HOST}/c/rentals/quan-1`)
    expect(urls.some((u) => u.includes('/listings/'))).toBe(false)
    // Two spellings of one place are one URL, carrying the later of their two dates.
    expect(urls.filter((u) => u.endsWith('/c/books-stationery/thao-dien'))).toHaveLength(1)
    expect(xml).toContain(`<loc>${HOST}/c/books-stationery/thao-dien</loc><lastmod>2025-07-01T00:00:00.000Z</lastmod>`)
    // The home page's lastmod is the freshest live row anywhere.
    expect(xml).toContain(`<loc>${HOST}</loc><lastmod>${FRESH.toISOString()}</lastmod>`)
  }, 60_000)

  /**
   * ⛔ A DISTRICT PAGE BACKED ONLY BY BORROWED LISTINGS IS NOT SUBMITTED (lead, 2026-09-24, under the
   * owner's 2026-09-17 rule). The combo aggregate counts what `submittedListingWhere` counts:
   * verified, active, in scope and `affiliateUrl: null`. A district with one listing of our own is
   * submitted, dated by THAT listing — an import's fresher sync must not move its lastmod.
   */
  it('submits a category × district combo only for our OWN verified, active listings', async () => {
    h.rows = [
      // Hà Nội district reached only by imports → not submitted.
      row({ id: 'imp-hn', sellerId: 'import-seller', categoryId: 'cat-rentals', district: 'Quận Cầu Giấy', affiliateUrl: 'https://www.nhatot.com/1.htm', updatedAt: FRESH }),
      // Our own rows that are not live do not qualify either.
      row({ id: 'own-hidden', categoryId: 'cat-rentals', district: 'Quận Hải Châu', status: 'hidden' }),
      row({ id: 'own-unverified', categoryId: 'cat-rentals', district: 'Quận Sơn Trà', verified: false }),
      // A district with one own listing AND a fresher import → submitted, with the OWN row's date.
      row({ id: 'own-q3', categoryId: 'cat-rentals', district: 'Quận 3', updatedAt: OLD }),
      row({ id: 'imp-q3', sellerId: 'import-seller', categoryId: 'cat-rentals', district: 'Quận 3', affiliateUrl: 'https://muaban.net/x', updatedAt: FRESH }),
    ]
    const xml = await (await pagesGET()).text()
    const urls = locs(xml)
    expect(urls.filter((u) => u.startsWith(`${HOST}/c/rentals/`))).toEqual([`${HOST}/c/rentals/quan-3`])
    expect(xml).toContain(`<loc>${HOST}/c/rentals/quan-3</loc><lastmod>${OLD.toISOString()}</lastmod>`)
    // The category page and the import seller's storefront still count imported stock.
    expect(xml).toContain(`<loc>${HOST}/c/rentals</loc><lastmod>${FRESH.toISOString()}</lastmod>`)
    expect(urls).toContain(`${HOST}/sellers/import-seller`)
  })

  it('keeps the edition boundary and the empty-category rule', async () => {
    h.rows = [
      row({ id: 'own-1', categoryId: 'cat-books', district: 'Quận 3' }),
      row({ id: 'desk-1', sellerId: 'desk-seller', categoryId: 'cat-services', district: 'Quận 1' }),
    ]
    const urls = locs(await (await pagesGET()).text())
    expect(urls).not.toContain(`${HOST}/c/services`)
    expect(urls.some((u) => u.includes('/c/services/'))).toBe(false)
    expect(urls).not.toContain(`${HOST}/sellers/desk-seller`)
    expect(urls).not.toContain(`${HOST}/c/jobs`) // a category with no live listing serves noindex
    expect(urls).toContain(`${HOST}/c/books-stationery/quan-3`)
    expect(urls).toContain(`${HOST}/sellers/own-seller`)
  })
})
