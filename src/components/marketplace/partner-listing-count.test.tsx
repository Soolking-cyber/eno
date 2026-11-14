// @vitest-environment jsdom
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LanguageProvider } from '@/context/language-context'
import { VI_OVERRIDES } from '@/generated/vi-overrides'
import { SITE_NAME } from '@/lib/edition'
import { PartnerListingCount } from './partner-listing-count'

/**
 * '{n} listings on <site>' — inline (the seller strip) and, since 2026-11-15, with its number leading in bold ink
 * (`layout="lead"`, the rental listing page's flat host row; owner-approved 2026-11-15 (build 7), cook r07 "rental" — it replaced
 * the cook r05 `stat` figure). The words, the singular, the reader's grouping and the edition's own site name are the same in
 * both layouts.
 */
const dom = (lang: 'en' | 'vi', n: number, layout?: 'inline' | 'lead') => {
  const div = document.createElement('div')
  div.innerHTML = renderToString(<LanguageProvider initialLang={lang} initialViDict={VI_OVERRIDES}><PartnerListingCount n={n} layout={layout} /></LanguageProvider>).replaceAll('<!-- -->', '')
  return div.querySelector('[data-partner-listing-count]') as HTMLElement
}
const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

describe('PartnerListingCount', () => {
  it.each([
    ['en', 5379, `5,379 listings on ${SITE_NAME}`],
    ['en', 1, `1 listing on ${SITE_NAME}`],
    ['vi', 5379, `5.379 tin đăng trên ${SITE_NAME}`],
    ['vi', 1, `1 tin đăng trên ${SITE_NAME}`],
  ] as const)('%s %d: "%s" in both layouts', (lang, n, words) => {
    expect(text(dom(lang, n))).toBe(words)
    expect(text(dom(lang, n, 'lead'))).toBe(words)
  })

  it('lead: one line — the number bold in ink, the words in the line\'s own ink, no blocks', () => {
    const el = dom('en', 5379, 'lead')
    const num = el.querySelector(':scope > span')!
    expect(num.className.split(' ')).toEqual(expect.arrayContaining(['font-bold', 'text-foreground', 'tabular-nums']))
    expect(text(num)).toBe('5,379')
    expect(el.querySelectorAll('span.block')).toHaveLength(0)
    expect(el.querySelectorAll(':scope > span')).toHaveLength(1)
  })

  it('inline is what it was: one span, no blocks', () => {
    const el = dom('en', 12)
    expect(el.querySelectorAll('span.block')).toHaveLength(0)
    expect(el.hasAttribute('class')).toBe(false)
  })
})
