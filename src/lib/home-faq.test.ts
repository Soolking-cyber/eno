import { describe, expect, it, vi } from 'vitest'
import { HOME_ABOUT } from './home-about'
import { HOME_FAQ_HEADING, HOME_QUESTIONS_PUBLISHED, answerText, homeFaqJsonLd, homeQuestionsArticleJsonLd } from './home-faq'

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
    expect(src.indexOf('<HomeFaq />')).toBeGreaterThan(src.indexOf('<ListingsExplorer'))
    expect(src).not.toContain('<HomeAbout')
  })

  it('⛔ its FAQPage + Article JSON-LD render BEFORE the feed, once (checkers read only the HTML\'s first ~200 KB)', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../app/[lang]/(home)/page.tsx', import.meta.url), 'utf8')
    const at = src.indexOf('<HomeFaqJsonLd lang={lang}')
    expect(at).toBeGreaterThan(-1)
    expect(at).toBeLessThan(src.indexOf('<ListingsExplorer'))
    expect(src.split('<HomeFaqJsonLd').length).toBe(2)
    const faq = readFileSync(new URL('../components/marketplace/home-faq.tsx', import.meta.url), 'utf8')
    // The section draws the questions; only HomeFaqJsonLd writes their JSON-LD, so it is never on the page twice.
    expect(faq.split('homeFaqJsonLd(lang)').length).toBe(2)
  })

  it('the block is an Article by eno.vn, dated, and PART OF the home WebPage, never its main entity', () => {
    const page = 'https://eno.vn/#webpage'
    for (const lang of ['en', 'vi'] as const) {
      const a = homeQuestionsArticleJsonLd(lang, page) as Record<string, any>
      expect(a['@type']).toBe('Article')
      expect(a.author).toMatchObject({ '@type': 'Organization', name: 'eno.vn' })
      expect(a.datePublished).toBe(HOME_QUESTIONS_PUBLISHED)
      expect(a.isPartOf).toEqual({ '@id': page })
      // Google's recommended Article fields, all four (an audit flagged the missing image): the page's own share card.
      expect(a.image).toMatchObject({ '@type': 'ImageObject', url: expect.stringMatching(/\/og\/share-card\.jpg$/), width: 1200, height: 630 })
      for (const k of ['headline', 'author', 'datePublished', 'image']) expect(a, k).toHaveProperty(k)
      expect(a).not.toHaveProperty('mainEntityOfPage')
      expect(a.headline).toBe(HOME_FAQ_HEADING[lang])
      expect(a.inLanguage).toBe(lang)
    }
  })

  it('the page wires the Article to the real home WebPage @id (a missing id leaves the Article out, never prints "undefined")', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
    vi.resetModules()
    try {
      const { homeWebPageId } = await import('../app/[lang]/(home)/home-metadata')
      for (const lang of ['en', 'vi']) expect(homeWebPageId(lang)).toMatch(/^https?:\/\/.+#webpage$/)
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })
})
