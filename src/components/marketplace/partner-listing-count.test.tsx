// @vitest-environment jsdom
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LanguageProvider } from '@/context/language-context'
import { VI_OVERRIDES } from '@/generated/vi-overrides'
import { SITE_NAME } from '@/lib/edition'
import { PartnerListingCount } from './partner-listing-count'

/**
 * '{n} listings on <site>' — inline (the seller strip) and, since 2026-11-14, as a figure (`layout="stat"`, the rental listing
 * page's host card; owner-approved, cook r05 "rental-c"): the number in the h2 role over the same words in the meta role. The
 * words, the singular, the reader's grouping and the edition's own site name are the same in both layouts.
 */
const dom = (lang: 'en' | 'vi', n: number, layout?: 'inline' | 'stat') => {
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
    expect(text(dom(lang, n, 'stat'))).toBe(words)
  })

  it('stat: the number on its own line in the h2 role, ink; the words under it in the meta role, muted', () => {
    const el = dom('en', 5379, 'stat')
    const [num, words] = [...el.querySelectorAll(':scope > span')]
    expect(num.className.split(' ')).toEqual(expect.arrayContaining(['block', 'text-t-h2', 'text-foreground', 'tabular-nums']))
    expect(text(num)).toBe('5,379')
    expect(words.className.split(' ')).toEqual(expect.arrayContaining(['block', 'text-t-meta', 'text-muted-foreground']))
    expect(text(words)).toBe(`listings on ${SITE_NAME}`)
  })

  it('inline is what it was: one span, no blocks', () => {
    const el = dom('en', 12)
    expect(el.querySelectorAll('span.block')).toHaveLength(0)
    expect(el.hasAttribute('class')).toBe(false)
  })
})
