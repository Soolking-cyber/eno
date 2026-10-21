/**
 * The Article JSON-LD `image` (teacher visibility plan §3a item 16): SeoArticle emits the paths an article hands it as
 * absolute URLs on this deployment's origin, and nothing when it hands none. The last two tests render what the REAL
 * teach hub and a real guide give it — each page's share card in Google's three shapes (src/lib/teach-guides/share-cards.ts).
 * The chrome, the related-guides picker and the database reads are stand-ins (as in seo-article.lang.test.tsx).
 */
import { createElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ArticleContent } from './seo-article'

const h = vi.hoisted(() => ({ now: new Date('2026-10-18T05:00:00Z') }))
vi.mock('./header', () => ({ Header: () => null }))
vi.mock('./footer', () => ({ Footer: () => null }))
vi.mock('@/components/marketplace/cross-site-promo', () => ({ CrossSitePromo: () => null }))
vi.mock('./seo-article-related', () => ({ keepReading: (related?: unknown[]) => related ?? [] }))
vi.mock('./seo-listing-rail', () => ({ SeoListingRail: () => null }))
vi.mock('./here-link', () => ({ HereLink: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }))
vi.mock('@/lib/teach-guides/request-clock', () => ({ requestNow: () => h.now }))
vi.mock('@/lib/teach-guides/district-links', () => ({ districtLinksAsText: async () => new Set<string>() }))
vi.mock('@/components/marketplace/live-count', () => ({ LiveCounts: () => null }))
vi.mock('@/lib/schools/queries', () => ({ listSchools: async () => [] }))
vi.mock('@/app/[lang]/hcmc-rent-index/load-rent-index', () => ({ loadRentIndex: async () => ({ known: false }) }))

// The first import of a teach page pulls the registry and all 41 guides' content (parsed and digest-checked) — slow cold.
vi.setConfig({ testTimeout: 30_000 })

let SeoArticle: typeof import('./seo-article').SeoArticle
let hubPage: typeof import('@/app/[lang]/teach-in-vietnam/page')
let guidePage: typeof import('@/app/[lang]/teach-in-vietnam/[slug]/page')

beforeAll(async () => {
  // The teach library is a marketplace surface (eno.forum 308s it to eno.vn); the origin the JSON-LD is written on.
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
  vi.resetModules()
  ;({ SeoArticle } = await import('./seo-article'))
  hubPage = await import('@/app/[lang]/teach-in-vietnam/page')
  guidePage = await import('@/app/[lang]/teach-in-vietnam/[slug]/page')
  const { TEACH_GUIDES } = await import('@/lib/teach-guides/registry')
  // The day every registered guide is live (as hub-page.test.tsx computes it).
  h.now = new Date(`${TEACH_GUIDES.flatMap((e) => [e.published, e.reviewed ?? e.published]).sort().at(-1)}T05:00:00Z`)
})
afterAll(() => {
  vi.unstubAllEnvs()
})

/** The Article node of a rendered article. */
async function articleLd(content: ArticleContent): Promise<Record<string, unknown>> {
  const html = renderToStaticMarkup(await SeoArticle({ content }))
  const nodes = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]))
  const article = nodes.find((n) => n['@type'] === 'Article')
  if (!article) throw new Error('no Article JSON-LD')
  return article
}

const BASE: ArticleContent = {
  eyebrow: 'Guide',
  h1: 'A guide heading',
  intro: 'The lede paragraph.',
  canonical: '/a-guide',
  published: '2026-10-11',
  lang: 'en',
  sections: [{ id: 'one', title: 'Section one', body: createElement('p', null, 'first') }],
  faqs: [],
}

describe('SeoArticle — the Article JSON-LD image', () => {
  it('emits the paths it is handed as absolute URLs, in order', async () => {
    const ld = await articleLd({ ...BASE, image: ['/og/a/1200x630.png', '/og/a/1200x900.png'] })
    expect(ld.image).toEqual(['https://eno.vn/og/a/1200x630.png', 'https://eno.vn/og/a/1200x900.png'])
  })

  it('emits no image for an article with none — it never borrows the site’s card', async () => {
    expect(await articleLd(BASE)).not.toHaveProperty('image')
    expect(await articleLd({ ...BASE, image: [] })).not.toHaveProperty('image')
  })
})

describe('the real teach pages: their share card in Google’s three shapes — 16x9, 4x3, 1x1', () => {
  const shapes = (dir: string) => ['1200x675', '1200x900', '1200x1200'].map((s) => `https://eno.vn/og/teach-in-vietnam${dir}/${s}.png`)

  it('the hub', async () => {
    const el = (await hubPage.default()) as ReactElement<{ content: ArticleContent }>
    expect((await articleLd(el.props.content)).image).toEqual(shapes(''))
  })

  it('a guide', async () => {
    const slug = 'vietnam-work-permit-for-english-teachers'
    const el = (await guidePage.default({ params: Promise.resolve({ lang: 'en', slug }) })) as ReactElement<{ content: ArticleContent }>
    expect((await articleLd(el.props.content)).image).toEqual(shapes(`/${slug}`))
  })
})
