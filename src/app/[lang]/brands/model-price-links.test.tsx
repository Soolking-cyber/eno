// @vitest-environment jsdom
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

/**
 * "Prices by model" on /brands (owner, 2026-11-25, "1 ok": hub links): every submitted model page as a plain link, /price on
 * the English render and /gia on the Vietnamese one; nothing without a page.
 */
vi.mock('@/lib/model-pages', () => ({ modelPagePath: (slug: string, lang: string) => (lang === 'vi' ? `/gia/${slug}` : `/price/${slug}`) }))
vi.mock('@/components/marketplace/bilingual', () => ({ Bilingual: ({ en }: { en: string }) => <>{en}</> }))

const { ModelPriceLinks } = await import('./model-price-links')
const PAGES = [{ slug: 'apple-iphone-17-pro', name: 'Apple iPhone 17 Pro' }, { slug: 'samsung-galaxy-s26-ultra', name: 'Samsung Galaxy S26 Ultra' }]
const links = (lang: 'en' | 'vi') => {
  const d = new DOMParser().parseFromString(renderToStaticMarkup(<ModelPriceLinks pages={PAGES} lang={lang} />), 'text/html')
  return [...d.querySelectorAll('a')].map((a) => [a.getAttribute('href'), a.textContent])
}

describe('/brands — Prices by model', () => {
  it('English: /price links named by model; Vietnamese: /gia, the same names', () => {
    expect(links('en')).toEqual([['/price/apple-iphone-17-pro', 'Apple iPhone 17 Pro'], ['/price/samsung-galaxy-s26-ultra', 'Samsung Galaxy S26 Ultra']])
    expect(links('vi').map(([h]) => h)).toEqual(['/gia/apple-iphone-17-pro', '/gia/samsung-galaxy-s26-ultra'])
  })

  it('nothing without a page', () => {
    expect(renderToStaticMarkup(<ModelPriceLinks pages={[]} lang="en" />)).toBe('')
  })
})
