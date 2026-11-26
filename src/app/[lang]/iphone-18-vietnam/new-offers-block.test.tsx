import * as React from 'react'
import { existsSync, readFileSync } from 'node:fs'
import { renderToString } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PriceRow } from './lowest-prices'

/**
 * "iPhone 18 on eno.vn" — the block the four iPhone buying guides carry under their intro (new-offers-block.tsx, 2026-11-26).
 * In the ARTICLE's language, money through vnd.ts in that locale, each price linking its listing and each model its page, the
 * who-sells and commission line — and with no rows or a failed read, nothing at all.
 */
const h = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], fail: false }))
vi.mock('@/lib/db', () => ({
  db: { listing: { findMany: async () => { if (h.fail) throw new Error('fake db: unreachable'); return h.rows } } },
}))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: unknown) => w }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en' }) }))

import { NEW_IPHONE_PAGES, NewIphoneBlock, newIphoneOffers } from './new-offers-block'
import { NEW_APPLE_IPHONE_MODELS, NEW_APPLE_SHOPS } from '@/lib/new-apple'

const text = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1])

const row = (over: Partial<PriceRow>): PriceRow => ({
  model: 'iPhone 18 Pro', storage: '256GB', storageGb: 256, price: 37_990_000, currency: '₫', listingId: 'n1',
  seller: 'ShopDunk', offers: 3, ceiling: 38_999_000, condition: 'new', tracked: true, image: null, ...over,
})
const ROWS = [row({}), row({ model: 'iPhone Duo', price: 64_999_000, listingId: 'n9', seller: 'CellphoneS' })]

beforeEach(() => { h.rows = []; h.fail = false })

describe('NewIphoneBlock', () => {
  it('English: each model links its page, each price its listing, the shop is named, then who sells and the commission line', () => {
    const html = renderToString(<NewIphoneBlock lang="en" rows={ROWS} />)
    const t = text(html)
    expect(t).toContain('iPhone 18 on')
    expect(t).toContain('iPhone 18 Pro : new from 37,990,000 đ for 256GB at ShopDunk')
    expect(t).toContain('iPhone Duo : new from 64,999,000 đ for 256GB at CellphoneS')
    expect(hrefs(html)).toEqual(['/iphone-18-pro-vietnam', '/listings/n1', '/iphone-duo-vietnam', '/listings/n9'])
    expect(t).toMatch(/The shops sell these new: message one on \S+ and you get a Buy now button that orders from the shop\. \S+ may earn a commission when you buy through it, at no extra cost to you\./)
  })

  it('Vietnamese: Vietnamese words, Vietnamese thousands separators', () => {
    const t = text(renderToString(<NewIphoneBlock lang="vi" rows={ROWS} />))
    expect(t).toContain('iPhone 18 trên')
    expect(t).toContain('iPhone 18 Pro : máy mới từ 37.990.000 đ , bản 256GB, tại ShopDunk')
    expect(t).toContain('có thể nhận hoa hồng khi bạn mua qua nút này')
    expect(t).not.toMatch(/\bnew from\b|commission/)
  })

  it('no rows → nothing (a post never says "none listed")', () => {
    expect(renderToString(<NewIphoneBlock lang="en" rows={[]} />)).toBe('')
  })

  it('names a page for every line, and every page exists as a model page for that line', () => {
    expect(Object.keys(NEW_IPHONE_PAGES).sort()).toEqual([...NEW_APPLE_IPHONE_MODELS].sort())
    for (const [model, path] of Object.entries(NEW_IPHONE_PAGES)) {
      const file = `src/app/[lang]${path}/page.tsx`
      expect(existsSync(file), file).toBe(true)
      expect(readFileSync(file, 'utf8')).toContain(`slug: '${path.slice(1)}'`)
      expect(model).toMatch(/^iPhone /)
    }
  })
})

describe('newIphoneOffers', () => {
  const [SHOPDUNK, CELLPHONES] = NEW_APPLE_SHOPS
  const fresh = (id: string, title: string, model: string, price: number, shop = SHOPDUNK) => ({
    id, title, titleVi: null, price, currency: '₫', model, images: '[]', sellerId: shop.sellerId, seller: { name: shop.name },
  })

  it('the cheapest tier of each line, in line order', async () => {
    h.rows = [
      fresh('d', 'iPhone Duo 256GB', 'iPhone Duo', 64_999_000, CELLPHONES),
      fresh('p5', 'iPhone 18 Pro 512GB', 'iPhone 18 Pro', 44_490_000),
      fresh('p2', 'iPhone 18 Pro 256GB', 'iPhone 18 Pro', 37_990_000),
    ]
    expect((await newIphoneOffers()).map((r) => [r.model, r.listingId])).toEqual([['iPhone 18 Pro', 'p2'], ['iPhone Duo', 'd']])
  })

  it('zero rows and a failed read are both [] — the page then passes no ledeRow', async () => {
    expect(await newIphoneOffers()).toEqual([])
    h.fail = true
    expect(await newIphoneOffers()).toEqual([])
  })
})

/**
 * ⚠️ A SOURCE SCAN, because the pages render SeoArticle (which pulls the Prisma client and the whole page shell). What it pins:
 * each guide regenerates hourly (so the block fills after the import), and passes `ledeRow` ONLY with rows — an empty one
 * would move the phone's "On this page" row (seo-article.tsx) on a page that shows nothing new.
 */
describe('the four iPhone buying guides', () => {
  const GUIDES: [string, 'en' | 'vi'][] = [
    ['best-place-to-buy-iphone-vietnam', 'en'],
    ['chinh-hang-vs-xach-tay-vietnam', 'en'],
    ['iphone-chinh-hang-va-xach-tay', 'vi'],
    ['mua-iphone-o-dau-uy-tin', 'vi'],
  ]
  it.each(GUIDES)('%s: revalidates hourly and renders the block in its own language, only with rows', (slug, lang) => {
    const src = readFileSync(`src/app/[lang]/${slug}/page.tsx`, 'utf8')
    expect(src).toMatch(/^export const revalidate = 3600$/m)
    expect(src).toContain(`lang: '${lang}',`)
    expect(src).toContain(`offers.length ? { ...CONTENT, ledeRow: <NewIphoneBlock lang="${lang}" rows={offers} /> } : CONTENT`)
  })
})
