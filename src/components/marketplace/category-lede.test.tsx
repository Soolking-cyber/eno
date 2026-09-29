// @vitest-environment jsdom
/**
 * ⛔ THE LEDE OPENS WITH WHAT THE CATEGORY HOLDS, GROUPED (C1-LEDE, L-NUMBERS, 2026-09-29). It used to
 * BE the provenance sentence with a raw "63730 listings available." trailing it — no separator, and
 * the reader learned where the stock came from before what it was. Every number is a live count, so
 * these pin the frame and the gates, not a figure.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { LanguageProvider } from '@/context/language-context'
import { CATEGORY_LINKED_SENTENCE } from '@/app/[lang]/c/[category]/category-copy'
import { CategoryLede } from './category-lede'

beforeEach(() => {
  Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['en-US'] })
})
afterEach(() => {
  cleanup()
  Reflect.deleteProperty(navigator, 'languages')
})

const text = (lang: 'en' | 'vi', node: React.ReactNode) => {
  const el = document.createElement('div')
  el.innerHTML = renderToString(<LanguageProvider initialLang={lang} initialViDict={{}}>{node}</LanguageProvider>)
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim()
}

const cat = { name: 'Electronics', nameVi: 'Điện tử', slug: 'electronics' }
const top = [
  { name: 'Phones', nameVi: 'Điện thoại', count: 41002 },
  { name: 'Laptops', nameVi: 'Laptop', count: 9114 },
  { name: 'Audio', nameVi: 'Âm thanh', count: 3508 },
]

describe('CategoryLede — the count sentence', () => {
  it('opens with the grouped count and the busiest subcategories, then the provenance sentence', () => {
    const en = text('en', <CategoryLede {...cat} linked="all" total={63730} top={top} />)
    expect(en).toBe(`63,730 listings in Electronics, including Phones (41,002), Laptops (9,114) and Audio (3,508). ${CATEGORY_LINKED_SENTENCE.all.en}`)
    const vi = text('vi', <CategoryLede {...cat} linked="all" total={63730} top={top} />)
    expect(vi).toBe(`63.730 tin đăng điện tử, gồm Điện thoại (41.002), Laptop (9.114) và Âm thanh (3.508). ${CATEGORY_LINKED_SENTENCE.all.vi}`)
    expect(`${en} ${vi}`).not.toMatch(/\d{5,}/)
  })

  it('is singular at exactly one, and names no subcategory when there is none to name', () => {
    expect(text('en', <CategoryLede {...cat} linked="none" total={1} />)).toMatch(/^1 listing in Electronics\. /)
    expect(text('vi', <CategoryLede {...cat} linked="none" total={1} />)).toMatch(/^1 tin đăng điện tử\. /)
  })

  it('prints no count on an empty category — never "0 listings"', () => {
    expect(text('en', <CategoryLede {...cat} linked="none" total={0} />)).not.toMatch(/\b0 listing/)
  })

  it('keeps the jobs safety sentence after the count', () => {
    expect(text('en', <CategoryLede name="Jobs" nameVi="Việc làm" slug="jobs" linked="all" total={2400} />)).toMatch(/^2,400 listings in Jobs\. Most jobs here link to the original posting/)
  })
})
