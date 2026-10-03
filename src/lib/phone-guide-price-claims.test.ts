import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PHONE_GUIDE_PATHS } from './phone-guides'

/**
 * ⛔ A GUIDE MUST NOT PROMISE WHAT THE PRICE PAGE NO LONGER SHOWS (second-hand focus, owner 2026-10-03).
 *
 * The iPhone price pages (/iphone-18-vietnam and its model pages) read SECOND-HAND listings only since the
 * new-goods catalogues were hidden; they quote Apple Vietnam's own prices as Apple's. Twenty-odd guide
 * paragraphs still sent readers there for "what Vietnamese retailers are asking today", "live retailer
 * prices" or prices "read from retailers' listings, not a press release" (review, 2026-10-03). This scans
 * every paragraph of every phone guide that links one of those pages for a claim of that shape, in
 * English and in Vietnamese. A source scan, because the guides are server components that import the DB.
 */
const PRICE_PAGE = /href="\/iphone-(18|duo)[a-z-]*"/
const RETAIL_CLAIM = /retailer|nhà bán lẻ|live (iPhone (18 )?)?price|live retailer|Live prices|giá thực tế|bảng giá niêm yết|press release|thông cáo/i

describe('phone guides — no retailer-price promise next to a link to the iPhone price pages', () => {
  for (const slug of PHONE_GUIDE_PATHS) {
    it(slug, () => {
      const src = readFileSync(`src/app/[lang]/${slug}/page.tsx`, 'utf8')
      const paragraphs = [...src.matchAll(/<P>([\s\S]*?)<\/P>/g)].map((m) => m[1]).filter((p) => PRICE_PAGE.test(p))
      for (const p of paragraphs) expect(p.replace(/\s+/g, ' '), `${slug}`).not.toMatch(RETAIL_CLAIM)
    })
  }
})
