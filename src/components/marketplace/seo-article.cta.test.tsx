// @vitest-environment jsdom
/**
 * A11-SEO-CTA (2026-10-04): a guide can carry ONE brand CTA under its lede (optionally repeated after the
 * last section) and place its live rail right after a named section. Pinned on the rendered markup, with
 * the chrome and the database-backed rail stubbed.
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./header', () => ({ Header: () => null }))
vi.mock('./footer', () => ({ Footer: () => null }))
vi.mock('@/components/marketplace/cross-site-promo', () => ({ CrossSitePromo: () => null }))
vi.mock('./seo-article-related', () => ({ keepReading: () => [] }))
vi.mock('./seo-listing-rail', () => ({
  SeoListingRail: ({ title, browseLink }: { title: string; browseLink?: { rel?: string; prefetch?: boolean } }) => (
    <section data-rail="" data-browse-rel={browseLink?.rel ?? ''} data-browse-prefetch={String(browseLink?.prefetch)}>{title}</section>
  ),
}))

const { SeoArticle } = await import('./seo-article')
type Content = Parameters<typeof SeoArticle>[0]['content']

const BASE: Content = {
  eyebrow: 'Guide',
  h1: 'Secondhand furniture',
  intro: 'The lede paragraph.',
  canonical: '/secondhand-furniture-ho-chi-minh-city',
  published: '2026-09-23',
  lang: 'en',
  sections: [
    { id: 'one', title: 'Section one', body: React.createElement('p', null, 'first') },
    { id: 'two', title: 'Section two', body: React.createElement('p', null, 'second') },
    { id: 'three', title: 'Section three', body: React.createElement('p', null, 'third') },
  ],
  faqs: [],
}

async function html(patch: Partial<Content>) {
  return renderToStaticMarkup(await SeoArticle({ content: { ...BASE, ...patch } }))
}

describe('SeoArticle — cta', () => {
  it('renders one brand CTA right after the lede, nofollow and unprefetched when asked', async () => {
    const out = await html({ cta: { href: '/?category=furniture-appliances&condition=used', label: 'Browse used furniture', nofollow: true } })
    const doc = new DOMParser().parseFromString(out, 'text/html')
    const links = [...doc.querySelectorAll('a')].filter((a) => a.textContent?.includes('Browse used furniture'))
    expect(links).toHaveLength(1)
    expect(links[0].getAttribute('href')).toBe('/?category=furniture-appliances&condition=used')
    expect(links[0].getAttribute('rel')).toBe('nofollow')
    expect(links[0].getAttribute('data-slot')).toBe('button') // the ui/button primitive, variant="cta"
    // Under the lede: after the intro paragraph, before the first section.
    expect(out.indexOf('The lede paragraph.')).toBeLessThan(out.indexOf('Browse used furniture'))
    expect(out.indexOf('Browse used furniture')).toBeLessThan(out.indexOf('Section one'))
  })

  it('repeats it after the last section with repeatAtEnd, and carries no rel otherwise', async () => {
    const out = await html({ cta: { href: '/post', label: 'Đăng tin miễn phí', repeatAtEnd: true } })
    const doc = new DOMParser().parseFromString(out, 'text/html')
    const links = [...doc.querySelectorAll('a[href="/post"]')]
    expect(links).toHaveLength(2)
    expect(links.every((a) => !a.hasAttribute('rel'))).toBe(true)
    expect(out.lastIndexOf('Đăng tin miễn phí')).toBeGreaterThan(out.indexOf('Section three'))
  })

  it('renders no CTA when none is given', async () => {
    expect(await html({})).not.toContain('data-slot="button"')
  })
})

describe('SeoArticle — railAfter', () => {
  const rail = { target: { categorySlug: 'furniture-appliances', condition: 'used' as const }, title: 'Used furniture now', cta: 'Browse' }

  it('places the rail right after the named section', async () => {
    const out = await html({ rail, railAfter: 'one' })
    expect(out.match(/data-rail/g)).toHaveLength(1)
    expect(out.indexOf('Section one')).toBeLessThan(out.indexOf('Used furniture now'))
    expect(out.indexOf('Used furniture now')).toBeLessThan(out.indexOf('Section two'))
  })

  it('hands the rail its browse-link props (the hub passes the CTA\'s nofollow / no prefetch)', async () => {
    const out = await html({ rail: { ...rail, browseLink: { rel: 'nofollow', prefetch: false } }, railAfter: 'one' })
    expect(out).toContain('data-browse-rel="nofollow"')
    expect(out).toContain('data-browse-prefetch="false"')
    expect(await html({ rail })).toContain('data-browse-rel=""')
  })

  it('falls back to after the last section for an unknown id, or with no railAfter', async () => {
    for (const patch of [{ rail, railAfter: 'nope' }, { rail }]) {
      const out = await html(patch)
      expect(out.match(/data-rail/g)).toHaveLength(1)
      expect(out.indexOf('Section three')).toBeLessThan(out.indexOf('Used furniture now'))
    }
  })
})
