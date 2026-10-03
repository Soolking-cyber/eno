import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { phoneGuideRail } from './phone-guides-rail'
import { PHONE_GUIDES, phoneGuideCategories } from './phone-guides'

describe('phoneGuideRail — the second-hand rail under the phone guides', () => {
  it('every guide whose primary shelf is electronics gets a used phones rail, newest first', () => {
    for (const g of PHONE_GUIDES.filter((x) => phoneGuideCategories(x)[0] === 'electronics')) {
      const rail = phoneGuideRail(`/${g.slug}`)
      expect(rail, g.slug).toBeDefined()
      expect(rail!.target).toMatchObject({ categorySlug: 'electronics', subcategorySlug: 'phones-tablets', condition: 'used', order: 'recent' })
    }
  })

  it('the eSIM pair (primary shelf: services) gets none, nor does a page that is not a phone guide', () => {
    expect(phoneGuideRail('/esim-vietnam-guide')).toBeUndefined()
    expect(phoneGuideRail('/esim-viettel-vinaphone-mobifone')).toBeUndefined()
    expect(phoneGuideRail('/moving-to-vietnam')).toBeUndefined()
  })

  it('an iPhone guide rails Apple only, a Galaxy guide Samsung only — never a ₫300k feature phone', () => {
    expect(phoneGuideRail('/buying-a-used-iphone-vietnam')!.target.brandSlug).toBe('apple')
    expect(phoneGuideRail('/kinh-nghiem-mua-iphone-cu')!.target.brandSlug).toBe('apple')
    expect(phoneGuideRail('/ipad-buying-guide-vietnam')!.target.brandSlug).toBe('apple')
    expect(phoneGuideRail('/samsung-galaxy-buying-guide-vietnam')!.target.brandSlug).toBe('samsung')
    expect(phoneGuideRail('/budget-5g-phones-vietnam')!.target.brandSlug).toBeUndefined()
  })

  it('speaks the article\'s language', () => {
    expect(phoneGuideRail('/buying-a-used-iphone-vietnam')!.title).toBe('Second-hand iPhones and iPads for sale now')
    expect(phoneGuideRail('/kinh-nghiem-mua-iphone-cu')!.title).toBe('iPhone và iPad cũ đang được rao bán')
    expect(phoneGuideRail('/dien-thoai-5g-gia-re')!.cta).toBe('Xem điện thoại cũ')
  })

  it('SeoArticle applies it by default, and a page\'s own rail still wins', () => {
    const src = readFileSync('src/components/marketplace/seo-article.tsx', 'utf8')
    expect(src).toContain('const rail = content.rail ?? phoneGuideRail(content.canonical)')
    expect(src).toMatch(/\{rail && <SeoListingRail \{\.\.\.rail\}/)
  })
})
