// @vitest-environment jsdom
/**
 * ⛔ THE WORDS UNDER A GRID COUNT AS PARAGRAPHS (owner, 2026-11-26: "Add below the cards"). Seobility's "Pages with only a few
 * paragraphs" counts a block at about 20 words or more (crawl 10: 20, 22 and 23 counted; 14 and 16–18 did not) and wants three.
 * So every paragraph these blocks add is pinned at 20+ words in both languages, for the shortest inputs a page can pass: a
 * one-word shop name, one listing, no categories. The word count is letters/digits runs, as a crawler splits text.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { LanguageProvider } from '@/context/language-context'
import { storefrontIntro } from '@/lib/storefront-intro'
import { ShopAbout } from './shop-about'
import { GridDealsNote, GridLedeTail, ReportNote } from './grid-about'

beforeEach(() => {
  Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['en-US'] })
})
afterEach(() => {
  cleanup()
  Reflect.deleteProperty(navigator, 'languages')
})

const LANGS = ['en', 'vi'] as const
const html = (lang: 'en' | 'vi', node: React.ReactNode) => {
  const el = document.createElement('div')
  el.innerHTML = renderToString(<LanguageProvider initialLang={lang} initialViDict={{}}>{node}</LanguageProvider>)
  return el
}
const words = (s: string) => (s.match(/[\p{L}\p{N}]+(?:[.'’][\p{L}\p{N}]+)*/gu) ?? []).length
const paragraphs = (el: HTMLElement) => [...el.querySelectorAll('p')].map((p) => (p.textContent ?? '').replace(/\s+/g, ' ').trim())

describe('ShopAbout — three paragraphs of 20+ words under the shop grid (three since the short footer, 2026-11-26)', () => {
  const cases = {
    'one listing, no category': storefrontIntro('Mive', 1, []),
    'one listing, a category': storefrontIntro('Mive', 1, [{ category: { name: 'Rentals', nameVi: 'Cho thuê' } }]),
    'many, no category': storefrontIntro('Mive', 3, []),
    'many, categories': storefrontIntro('Mive', 154, [{ category: { name: 'Rentals', nameVi: 'Cho thuê' } }, { category: { name: 'Jobs', nameVi: 'Việc làm' } }]),
  }
  for (const [label, intro] of Object.entries(cases)) {
    for (const lang of LANGS) {
      it(`${label} (${lang})`, () => {
        const ps = paragraphs(html(lang, <ShopAbout intro={intro!} />))
        expect(ps).toHaveLength(3)
        for (const p of ps) expect(words(p), p).toBeGreaterThanOrEqual(20)
        expect(ps[0]).toContain('Mive')
        expect(ps.join(' ')).not.toMatch(/\{\w+\}/)
      })
    }
  }

  it('says the grid’s own facts: the count grouped, and the categories as "including" (the loaded rows, not a census)', () => {
    const en = paragraphs(html('en', <ShopAbout intro={cases['many, categories']!} />))[0]
    expect(en).toMatch(/^Mive has 154 listings on eno\.(vn|forum), including Rentals and Jobs\./)
    const vi = paragraphs(html('vi', <ShopAbout intro={storefrontIntro('Mive', 1540, [])!} />))[0]
    expect(vi).toContain('1.540 tin đăng')
  })

  it('claims no chat, price, payment or rule-taking (affiliate-only shops have no chat; job posts have no price; imported rows were not posted here)', () => {
    for (const intro of Object.values(cases)) {
      for (const lang of LANGS) {
        // The shop's two (the third, ReportNote, is about the site's moderation, not the shop).
        const text = paragraphs(html(lang, <ShopAbout intro={intro!} />)).slice(0, 2).join(' ')
        expect(text).not.toMatch(/(?<!\p{L})(chat|message|price|pay|payment|rules|responsible|nhắn|giá|thanh toán|quy định|trách nhiệm)(?!\p{L})/iu)
      }
    }
  })
})

describe('GridLedeTail + GridDealsNote — the /c and district pages', () => {
  for (const lang of LANGS) {
    it(`the lede's tail alone is 20+ words, and so is the deals note (${lang})`, () => {
      const tail = (html(lang, <GridLedeTail />).textContent ?? '').trim()
      expect(words(tail), tail).toBeGreaterThanOrEqual(20)
      for (const node of [<GridDealsNote key="d" />, <ReportNote key="r" />]) {
        const [note] = paragraphs(html(lang, node))
        expect(words(note), note).toBeGreaterThanOrEqual(20)
        expect(note).not.toMatch(/\{\w+\}/)
        // Under any grid, beside linked and affiliate rows: no chat, no price, no payment by eno.
        expect(note).not.toMatch(/(?<!\p{L})(chat|message|price|payment|nhắn|giá|thanh toán)(?!\p{L})/iu)
      }
    })
  }
})
