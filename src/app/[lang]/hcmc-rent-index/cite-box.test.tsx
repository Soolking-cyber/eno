// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { LanguageProvider } from '@/context/language-context'
import { CiteBox } from './cite-box'

/**
 * ⛔ OWNER DECISION 9 (the original-data terms, 2026-10): "free to cite; a credit link is welcome and may be nofollow".
 * The box used to ask readers to credit eno.vn "with a link"; a link required as the price of using content is what
 * Google's spam policies list as link spam, so the link is now welcome, never asked for, and may be nofollow.
 */
const PAGE_URL = 'https://eno.vn/hcmc-rent-index'
const render = (lang: 'en' | 'vi') => {
  const el = document.createElement('div')
  el.innerHTML = renderToString(
    <LanguageProvider initialLang={lang} initialViDict={{}}>
      <CiteBox url={PAGE_URL} htmlSnippet={`<a href="${PAGE_URL}">HCMC Rent Index, eno.vn (October 2026)</a>`} citation={`eno.vn (2026). Ho Chi Minh City Rent Index, 20 October 2026. ${PAGE_URL}`} />
    </LanguageProvider>,
  )
  return el
}

describe('the cite box', () => {
  it.each([
    ['en', 'Free to cite and quote. Please credit eno.vn; a link is welcome and may be nofollow.'],
    ['vi', 'Được tự do trích dẫn. Vui lòng ghi nguồn eno.vn; chúng tôi hoan nghênh liên kết, kể cả liên kết nofollow.'],
  ] as const)('%s: states the decision-9 terms in one sentence, and never asks for a link', (lang, terms) => {
    const el = render(lang)
    const first = el.querySelector('#cite p')!
    expect(first.textContent).toBe(terms)
    expect(el.textContent).not.toMatch(/with a link to|kèm liên kết đến/)
  })

  it.each(['en', 'vi'] as const)('%s: still shows the address to credit, as a link, under the terms', (lang) => {
    const links = [...render(lang).querySelectorAll('#cite p a')]
    expect(links.map((a) => [a.getAttribute('href'), a.textContent])).toEqual([[PAGE_URL, PAGE_URL]])
  })
})
