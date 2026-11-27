/**
 * The byline under every article (owner 2026-11-26): the author of the ARTICLE's language — English Shanazar Babakulyyev (COO),
 * Vietnamese Nguyễn Quốc Lập (Chuyên viên Marketing — partner.eno.vn's Vietnamese for Marketing Executive), with the photo from eno's partner page — printed under the article and declared as the Article's
 * JSON-LD author (a Person working for the site's Organization). A hub (`byline: false`) has neither. Stand-ins for the chrome and the
 * database reads, as in seo-article.approved.test.tsx.
 */
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ArticleContent } from './seo-article'

vi.mock('./header', () => ({ Header: () => null }))
vi.mock('./footer', () => ({ Footer: () => null }))
vi.mock('@/components/marketplace/cross-site-promo', () => ({ CrossSitePromo: () => null }))
vi.mock('./seo-article-related', () => ({ keepReading: (related?: unknown[]) => related ?? [] }))
vi.mock('./seo-listing-rail', () => ({ SeoListingRail: () => null }))
vi.mock('./here-link', () => ({ HereLink: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }))
vi.mock('@/components/marketplace/live-count', () => ({ LiveCounts: () => null }))

let SeoArticle: typeof import('./seo-article').SeoArticle

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
  vi.resetModules()
  ;({ SeoArticle } = await import('./seo-article'))
})
afterAll(() => {
  vi.unstubAllEnvs()
})

const BASE: ArticleContent = {
  eyebrow: 'Guide',
  h1: 'A guide heading',
  intro: 'The lede paragraph.',
  canonical: '/guides/a-guide',
  published: '2026-11-12',
  lang: 'en',
  sections: [{ id: 'one', title: 'Section one', body: createElement('p', null, 'first') }],
  faqs: [],
}

async function render(content: ArticleContent) {
  const html = renderToStaticMarkup(await SeoArticle({ content }))
  const nodes = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]))
  const article = nodes.find((n) => n['@type'] === 'Article') as Record<string, unknown> & { mainEntityOfPage: Record<string, unknown> }
  return { html, article }
}

describe('SeoArticle — the author byline', () => {
  it('an English article: Shanazar Babakulyyev, COO, with his photo, under the article — and the same Person in the JSON-LD', async () => {
    const { html, article } = await render(BASE)
    expect(html).toMatch(/<section aria-label="Written by"[^>]*>/)
    expect(html).toContain('Shanazar Babakulyyev')
    expect(html).toContain('COO, eno.vn')
    expect(html).toMatch(/<img[^>]*src="\/team\/shanazar-babakulyyev\.webp"[^>]*alt="Shanazar Babakulyyev"|<img[^>]*alt="Shanazar Babakulyyev"[^>]*src="\/team\/shanazar-babakulyyev\.webp"/)
    expect(article.author).toEqual({
      '@type': 'Person', name: 'Shanazar Babakulyyev', jobTitle: 'COO', image: 'https://eno.vn/team/shanazar-babakulyyev.webp',
      url: 'https://www.linkedin.com/in/babakulyyev-shanazar-8068b1188/',
      sameAs: ['https://www.linkedin.com/in/babakulyyev-shanazar-8068b1188/'],
      worksFor: { '@type': 'Organization', '@id': 'https://eno.vn/#organization', name: 'eno.vn', url: 'https://eno.vn' },
    })
    // The name links to his LinkedIn (owner 2026-11-27), in a new tab, marked as the author's link.
    expect(html).toMatch(/<a href="https:\/\/www\.linkedin\.com\/in\/babakulyyev-shanazar-8068b1188\/" target="_blank" rel="author noopener noreferrer"[^>]*>Shanazar Babakulyyev<svg/)
    expect(html).toContain('<span class="sr-only"> (LinkedIn)</span>')
    // The byline sits under the article body, before "Keep reading" and the FAQ.
    expect(html.indexOf('Section one')).toBeLessThan(html.indexOf('aria-label="Written by"'))
  })

  it('a Vietnamese article — by its own language, not the visitor\'s — is Nguyễn Quốc Lập, Chuyên viên Marketing', async () => {
    const { html, article } = await render({ ...BASE, lang: 'vi', canonical: '/huong-dan/a-guide' })
    expect(html).toMatch(/<section aria-label="Tác giả"[^>]*>/)
    expect(html).toContain('Nguyễn Quốc Lập')
    expect(html).toContain('Chuyên viên Marketing, eno.vn')
    expect(html).not.toContain('CEO')
    expect(html).not.toContain('Shanazar Babakulyyev')
    expect(article.author).toMatchObject({
      '@type': 'Person', name: 'Nguyễn Quốc Lập', jobTitle: 'Chuyên viên Marketing', image: 'https://eno.vn/team/nguyen-quoc-lap.webp',
      url: 'https://www.linkedin.com/in/lap-nguyen-233219265/', sameAs: ['https://www.linkedin.com/in/lap-nguyen-233219265/'],
    })
    expect(html).toContain('href="https://www.linkedin.com/in/lap-nguyen-233219265/"')
    expect(html).not.toContain('babakulyyev-shanazar')
  })

  it('a hub (byline: false) prints no byline and keeps the Organization as author', async () => {
    const { html, article } = await render({ ...BASE, byline: false })
    expect(html).not.toContain('Shanazar Babakulyyev')
    expect(html).not.toContain('Written by')
    expect(html).not.toContain('linkedin.com/in/')
    expect(article.author).toEqual({ '@type': 'Organization', '@id': 'https://eno.vn/#organization', name: 'eno.vn', url: 'https://eno.vn' })
  })

  it('⛔ eno.forum (the visa and itinerary desk) prints no byline and declares no Person: the authors are eno.vn\'s officers', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'services')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.eno.forum')
    vi.resetModules()
    try {
      const { SeoArticle: ForumArticle } = await import('./seo-article')
      const html = renderToStaticMarkup(await ForumArticle({ content: BASE }))
      expect(html).not.toContain('Shanazar Babakulyyev')
      expect(html).not.toContain('Written by')
      const article = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1])).find((n) => n['@type'] === 'Article')
      expect(article.author['@type']).toBe('Organization')
    } finally {
      vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
      vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
      vi.resetModules()
    }
  })
})
