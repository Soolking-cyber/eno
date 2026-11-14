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
// The tile's price needs the currency context; the tests below look only at where it sits, so it is a stand-in span.
vi.mock('./price', () => ({ Price: () => <span data-price="" /> }))
import { CARD_BODY, CARD_META, TITLE_LINE } from '@/lib/card-text'

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

// ⛔ THE SEO TILE'S PHOTO FILLS ITS SQUARE, as <ListingCard>'s does (owner-approved 2026-11-14, cook r05: "photo fills its
// square (cover)"; it reverses the 2026-11-12 whole photo over a blurred fill) — and it carries the card's text block.
describe('SeoListingGrid — the photo and the text block', () => {
  const tile = (listingType: string) => {
    const l = { id: 'l1', sellerId: 's1', title: 'Flat', images: ['https://picsum.photos/seed/a/400'], price: 1, currency: '₫', priceUnit: 'VND/month', listingType, isPartnerBooking: false, location: 'Hồ Chí Minh', city: 'Hồ Chí Minh' }
    const doc = new DOMParser().parseFromString(wrap(<SeoListingGrid listings={[l] as never} title="Homes" cta="Browse" href="/c/rentals" />), 'text/html')
    return { imgs: doc.querySelectorAll('img'), photo: doc.querySelector('img')!, doc }
  }
  it('one photo, covering its square — no decorative fill', () => {
    for (const type of ['rent', 'teacher']) {
      const { imgs, photo } = tile(type)
      expect(imgs).toHaveLength(1)
      expect(photo.hasAttribute('aria-hidden')).toBe(false)
      expect(photo.getAttribute('class')).toContain('object-cover')
      expect(photo.getAttribute('class')).not.toContain('object-contain')
    }
  })
  it('the body, title and meta are the card\'s own strings (src/lib/card-text.ts)', () => {
    const { doc } = tile('rent')
    const link = doc.querySelector('a[href="/listings/l1"]')!
    const body = link.children[1] as HTMLElement
    expect(body.getAttribute('class')).toBe(CARD_BODY)
    expect(body.children[1].getAttribute('class')).toBe(TITLE_LINE)
    expect(body.children[2].getAttribute('class')).toBe(`truncate ${CARD_META}`)
  })
})

