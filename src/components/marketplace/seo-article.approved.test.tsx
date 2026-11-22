/**
 * The approval line and its markup (owner 2026-11-22: tell search engines the guides are checked and approved by a person). An
 * article that hands SeoArticle an approval on record says so in its date line, linked to how guides are made, and its WebPage
 * carries `reviewedBy` + `lastReviewed`; one that hands none says nothing of the kind, on the page or in the markup. Its sources
 * become the Article's `citation`. Stand-ins for the chrome and the database reads, as in seo-article.image.test.tsx.
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

describe('SeoArticle — an approval on record', () => {
  it('says who approved it and when, linked to how guides are made, and the WebPage says the same', async () => {
    const { html, article } = await render({ ...BASE, approved: { on: '2026-11-13', how: '/guides#how' } })
    expect(html).toContain('Approved by the eno.vn team on')
    expect(html).toMatch(/<a[^>]*href="\/guides#how"[^>]*>Approved by the eno\.vn team on <time dateTime="2026-11-13">/)
    expect(article.mainEntityOfPage).toMatchObject({ '@type': 'WebPage', reviewedBy: { '@type': 'Organization', name: 'eno.vn' }, lastReviewed: '2026-11-13' })
  })

  it('in the article\'s language: a Vietnamese guide says "Đội ngũ eno.vn duyệt ngày"', async () => {
    const { html } = await render({ ...BASE, lang: 'vi', canonical: '/huong-dan/a-guide', approved: { on: '2026-11-13', how: '/huong-dan#how' } })
    expect(html).toContain('Đội ngũ eno.vn duyệt ngày')
    expect(html).not.toContain('Approved by')
  })

  it('no approval on record: no line and no reviewedBy — a review nobody did is never claimed', async () => {
    const { html, article } = await render(BASE)
    expect(html).not.toContain('Approved by')
    expect(article.mainEntityOfPage).toEqual({ '@type': 'WebPage', '@id': 'https://eno.vn/guides/a-guide' })
  })

  it('its sources are the Article\'s citation; none given, none claimed', async () => {
    const { article } = await render({ ...BASE, citations: [{ name: 'Law on Road Traffic 2024, Article 57', url: 'https://example.gov.vn/a57' }] })
    expect(article.citation).toEqual([{ '@type': 'CreativeWork', name: 'Law on Road Traffic 2024, Article 57', url: 'https://example.gov.vn/a57' }])
    expect((await render(BASE)).article).not.toHaveProperty('citation')
    expect((await render({ ...BASE, citations: [] })).article).not.toHaveProperty('citation')
  })
})
