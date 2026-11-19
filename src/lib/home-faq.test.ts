import { describe, expect, it } from 'vitest'
import { HOME_ABOUT } from './home-about'
import { HOME_FAQ_HEADING, answerText, homeFaqJsonLd } from './home-faq'

/** The home page's questions: one accordion, and FAQPage JSON-LD built from exactly what it draws (owner 2026-11-19). */
describe('the home FAQ', () => {
  it('the FAQPage JSON-LD is exactly the questions the page draws, with their whole answers, in the variant\'s language', () => {
    for (const lang of ['en', 'vi'] as const) {
      const ld = homeFaqJsonLd(lang) as { '@type': string; inLanguage: string; mainEntity: { name: string; acceptedAnswer: { text: string } }[] }
      expect(ld['@type']).toBe('FAQPage')
      expect(ld.inLanguage).toBe(lang)
      expect(ld.mainEntity.map((q) => q.name)).toEqual(HOME_ABOUT.map((s) => s.q[lang]))
      expect(ld.mainEntity.map((q) => q.acceptedAnswer.text)).toEqual(HOME_ABOUT.map((s) => answerText(s, lang)))
    }
  })

  it('each answer starts with its direct answer, and no question is asked twice', () => {
    for (const s of HOME_ABOUT) expect(answerText(s, 'en').startsWith(s.open[0].en)).toBe(true)
    expect(new Set(HOME_ABOUT.map((s) => s.q.en)).size).toBe(HOME_ABOUT.length)
  })

  it('keeps the questions people ask most: free, posting, contacting a seller, safety and AI assistants', () => {
    const qs = HOME_ABOUT.map((s) => s.q.en)
    for (const q of ['Is eno.vn free to use?', 'How do I post a listing?', 'How do I contact a seller?', 'Is it safe to buy and sell on eno.vn?', 'How do AI agents use eno.vn?']) {
      expect(qs).toContain(q)
    }
    expect(HOME_FAQ_HEADING.vi).not.toBe(HOME_FAQ_HEADING.en)
  })

  it('the home page renders it after the feed, once (the About block folded into it)', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../app/[lang]/(home)/page.tsx', import.meta.url), 'utf8')
    expect(src.indexOf('<HomeFaq lang={lang} />')).toBeGreaterThan(src.indexOf('<ListingsExplorer'))
    expect(src).not.toContain('<HomeAbout')
  })
})
