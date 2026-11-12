// @vitest-environment jsdom
/**
 * A11-SEO-CTA review fix (2026-10-04): a guide whose CTA already points at a narrowed feed URL hands the
 * rail's own browse link the same props (`rel: 'nofollow'`, `prefetch: false`), so the same
 * `/?category=…` URL is not followed from the rail while the button above it says nofollow. Left out,
 * the link is exactly what it was. The database-backed loader is stubbed; this pins the markup.
 */
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: unknown) => w }))
vi.mock('@/lib/translate', () => ({ localizeListingTitles: async (x: unknown) => x }))
// The tile's price needs the currency context; the photo tests below do not look at it.
vi.mock('./price', () => ({ Price: () => null }))

const { SeoListingGrid } = await import('./seo-listing-rail')
// The grid's links are LocalizedLink (A1-LANG), which reads the language context — render inside a provider.
const { LanguageProvider } = await import('@/context/language-context')
const wrap = (el: React.ReactElement) => renderToStaticMarkup(<LanguageProvider initialLang="en">{el}</LanguageProvider>)

// By attribute value, not an `a[href="…"]` selector: jsdom's selector engine does not match an href holding `?…&…`.
const browse = (html: string, href: string) =>
  [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('a')].find((a) => a.getAttribute('href') === href) ?? null

describe('SeoListingGrid — the browse link', () => {
  it('carries the rel it is handed', () => {
    const href = '/?category=furniture-appliances&condition=used'
    const a = browse(wrap(<SeoListingGrid listings={[]} title="Used furniture now" cta="Browse all used furniture" href={href} heading="h-title" browseLink={{ rel: 'nofollow', prefetch: false }} />), href)
    expect(a).not.toBeNull()
    expect(a!.getAttribute('rel')).toBe('nofollow')
  })

  it('marks its heading and browse link with the article language it is handed — never a card — and nothing without one', () => {
    const marks = (lang?: 'en' | 'vi') =>
      [...new DOMParser().parseFromString(wrap(<SeoListingGrid listings={[]} title="Teaching jobs now" cta="Browse jobs" href="/c/jobs" heading="h-title" lang={lang} />), 'text/html').querySelectorAll('[lang]')]
        .map((e) => `${e.tagName.toLowerCase()}:${e.textContent?.trim()}:${e.getAttribute('lang')}`)
    expect(marks('en')).toEqual(['h2:Teaching jobs now:en', 'a:Browse jobs:en'])
    expect(marks()).toEqual([])
  })

  it('is unchanged without it', () => {
    const a = browse(wrap(<SeoListingGrid listings={[]} title="Homes for rent now" cta="Browse rentals" href="/c/rentals" />), '/c/rentals')
    expect(a).not.toBeNull()
    expect(a!.hasAttribute('rel')).toBe(false)
  })
})

// ⛔ THE SEO TILE SHOWS THE WHOLE PHOTO OVER ITS OWN BLURRED FILL, as <ListingCard> does (owner, 2026-11-12; photo-fill.tsx).
describe('SeoListingGrid — the whole photo', () => {
  const tile = (listingType: string) => {
    const l = { id: 'l1', sellerId: 's1', title: 'Flat', images: ['https://picsum.photos/seed/a/400'], price: 1, currency: '₫', priceUnit: 'VND/month', listingType, isPartnerBooking: false, location: 'Hồ Chí Minh', city: 'Hồ Chí Minh' }
    const doc = new DOMParser().parseFromString(wrap(<SeoListingGrid listings={[l] as never} title="Homes" cta="Browse" href="/c/rentals" />), 'text/html')
    return { fill: doc.querySelector('img[aria-hidden]'), photo: doc.querySelector('img:not([aria-hidden])')! }
  }
  it('fits the photo over a fill made from the same file', () => {
    const { fill, photo } = tile('rent')
    expect(photo.getAttribute('class')).toContain('object-contain')
    expect(fill).not.toBeNull()
    expect(fill!.getAttribute('src')).toBe(photo.getAttribute('src'))
    expect(fill!.getAttribute('srcset') ?? '').toBe(photo.getAttribute('srcset') ?? '')
  })
  it('a teacher keeps the cover crop and gets no fill', () => {
    const { fill, photo } = tile('teacher')
    expect(fill).toBeNull()
    expect(photo.getAttribute('class')).toContain('object-cover')
  })
})

