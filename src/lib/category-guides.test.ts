import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CATEGORY_GUIDE_LIMIT, guidesForCategory } from './category-guides'
import { MARKETPLACE_GUIDES } from './expat-guides'
import { PHONE_GUIDES } from './phone-guides'

const slugs = (category: string, lang: 'en' | 'vi') => guidesForCategory(category, lang).map((g) => g.href.slice(1))

describe('guidesForCategory', () => {
  it('puts the guides written FOR rentals first, and falls back to English on a Vietnamese page', () => {
    expect(slugs('rentals', 'en')).toEqual([
      'renting-an-apartment-vietnam-foreigner',
      'rental-deposit-vietnam',
      'furnishing-a-home-in-vietnam',
    ])
    // No Vietnamese rentals guide exists yet — English, not an empty block and not a mix.
    expect(slugs('rentals', 'vi')).toEqual(slugs('rentals', 'en'))
    expect(guidesForCategory('rentals', 'vi').every((g) => g.lang === 'en')).toBe(true)
  })

  it('serves a Vietnamese page its own Vietnamese guides when they exist', () => {
    expect(slugs('furniture-appliances', 'vi')).toEqual(['thanh-ly-do-gia-dung-cu-tphcm', 'ban-do-cu-o-dau-duoc-gia'])
    expect(guidesForCategory('furniture-appliances', 'vi').every((g) => g.lang === 'vi')).toBe(true)
    expect(slugs('furniture-appliances', 'en')).toEqual([
      'furnishing-a-home-in-vietnam',
      'selling-up-before-you-leave-vietnam',
      'secondhand-furniture-ho-chi-minh-city',
    ])
  })

  /** Used furniture here is dealer-supplied; a guide about foreigners' moving sales must not sit on it. */
  it('never links the moving-sales framing from the furniture category', () => {
    for (const lang of ['en', 'vi'] as const) expect(slugs('furniture-appliances', lang)).not.toContain('do-cu-cua-nguoi-nuoc-ngoai')
  })

  it('caps electronics at four phone guides, each in the page language', () => {
    for (const lang of ['en', 'vi'] as const) {
      const g = guidesForCategory('electronics', lang)
      expect(g).toHaveLength(CATEGORY_GUIDE_LIMIT)
      expect(g.every((x) => x.lang === lang)).toBe(true)
    }
    expect(slugs('electronics', 'en')[0]).toBe('best-place-to-buy-iphone-vietnam')
    expect(slugs('electronics', 'vi')[0]).toBe('mua-iphone-o-dau-uy-tin')
  })

  it('links the eSIM guide from services, where the eSIM plans are listed', () => {
    expect(slugs('services', 'en')).toEqual(['esim-vietnam-guide'])
    expect(slugs('services', 'vi')).toEqual(['esim-viettel-vinaphone-mobifone'])
  })

  it('returns nothing for a category no guide is written for', () => {
    expect(guidesForCategory('jobs', 'en')).toEqual([])
    expect(guidesForCategory('property', 'vi')).toEqual([])
    expect(guidesForCategory('rentals', 'en', 0)).toEqual([])
  })

  it('carries the guide\'s own label and blurb — link text in the guide\'s language', () => {
    const all = [...MARKETPLACE_GUIDES, ...PHONE_GUIDES]
    for (const cat of ['rentals', 'furniture-appliances', 'electronics', 'services']) {
      for (const lang of ['en', 'vi'] as const) {
        for (const g of guidesForCategory(cat, lang)) {
          const entry = all.find((x) => `/${x.slug}` === g.href)!
          expect(g.label).toBe(entry.label)
          expect(g.blurb).toBe(entry.blurb)
          expect(g.lang).toBe(entry.lang ?? 'en')
        }
      }
    }
  })

  /**
   * ⛔ EVERY LINK MUST BE A MARKETPLACE ROUTE. The block renders on eno.vn; a guide that only exists
   * as a forum `.svc.` page would be a 404 linked from a category hub.
   */
  it('links only guides that exist as a page.tsx on both editions', () => {
    for (const cat of ['rentals', 'furniture-appliances', 'electronics', 'services']) {
      for (const lang of ['en', 'vi'] as const) {
        for (const g of guidesForCategory(cat, lang)) {
          expect(existsSync(`src/app/[lang]${g.href}/page.tsx`), `${g.href} has no page.tsx`).toBe(true)
        }
      }
    }
  })
})
