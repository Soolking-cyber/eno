// @vitest-environment jsdom
/**
 * An English article links its Vietnamese pair (owner, 2026-11-25, "1 ok": hub links — Seobility crawl 6 found the Vietnamese
 * phone guides 4–5 clicks deep, named by hreflang alone). A plain link with the pair's own title for screen readers and
 * crawlers; none on a Vietnamese article or an article with no pair.
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PHONE_GUIDES } from '@/lib/phone-guides'

vi.mock('./header', () => ({ Header: () => null }))
vi.mock('./footer', () => ({ Footer: () => null }))
vi.mock('@/components/marketplace/cross-site-promo', () => ({ CrossSitePromo: () => null }))
vi.mock('./seo-article-related', () => ({ keepReading: () => [] }))
vi.mock('./seo-listing-rail', () => ({ SeoListingRail: () => null }))

const { SeoArticle } = await import('./seo-article')
type Content = Parameters<typeof SeoArticle>[0]['content']

const BASE: Content = {
  eyebrow: 'Buying guide',
  h1: 'The best phones under 10 million đồng in Vietnam',
  intro: 'The lede paragraph.',
  canonical: '/phones-under-10-million-vietnam',
  published: '2026-09-23',
  lang: 'en',
  sections: [{ id: 'one', title: 'Section one', body: React.createElement('p', null, 'first') }],
  faqs: [],
}

async function doc(patch: Partial<Content>) {
  const out = renderToStaticMarkup(await SeoArticle({ content: { ...BASE, ...patch } }))
  return new DOMParser().parseFromString(out, 'text/html')
}

describe('SeoArticle — the Vietnamese pair link', () => {
  it('an English article: "Tiếng Việt" to its pair, named by the pair\'s registry title, a plain link', async () => {
    const d = await doc({ alternate: { lang: 'vi', href: '/dien-thoai-duoi-10-trieu' } })
    const a = d.querySelector('a[href="/dien-thoai-duoi-10-trieu"]')!
    expect(a, 'the pair link').not.toBeNull()
    expect(a.getAttribute('hreflang')).toBe('vi-VN')
    expect(a.getAttribute('lang')).toBe('vi')
    const label = PHONE_GUIDES.find((g) => g.slug === 'dien-thoai-duoi-10-trieu')!.label
    expect(a.textContent).toBe(`Tiếng Việt: ${label}`)
    expect(a.querySelector('.sr-only')!.textContent).toBe(`: ${label}`)
  })

  it('no link on a Vietnamese article or without a pair', async () => {
    const vi = await doc({ lang: 'vi', canonical: '/dien-thoai-duoi-10-trieu', alternate: { lang: 'en', href: '/phones-under-10-million-vietnam' } })
    expect(vi.querySelector('a[href="/phones-under-10-million-vietnam"]')).toBeNull()
    const none = await doc({})
    expect(none.querySelector('a[hreflang="vi-VN"]')).toBeNull()
  })

  it('every English article\'s pair is named, so no two pairs share the anchor "Tiếng Việt"', () => {
    const en = PHONE_GUIDES.filter((g) => g.lang === 'en')
    for (const g of en) expect(PHONE_GUIDES.find((p) => p.slug === g.pair)?.label, g.slug).toBeTruthy()
  })
})
