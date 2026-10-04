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

  it('is unchanged without it', () => {
    const a = browse(wrap(<SeoListingGrid listings={[]} title="Homes for rent now" cta="Browse rentals" href="/c/rentals" />), '/c/rentals')
    expect(a).not.toBeNull()
    expect(a!.hasAttribute('rel')).toBe(false)
  })
})
