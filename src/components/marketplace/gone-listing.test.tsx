// @vitest-environment jsdom
/**
 * THE GONE PAGE (B8-GONE-LANDERS) — what a visitor who followed a link to an import shop's hidden row is
 * shown: the heading, the item's name, live second-hand alternatives, a search for the same thing — and
 * nothing else about the row (src/lib/gone-listing.ts).
 */
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import type { GoneListingView } from '@/lib/gone-listing'

vi.mock('./header', () => ({ Header: () => null }))
vi.mock('./footer', () => ({ Footer: () => null }))
vi.mock('./mascot', () => ({ Mascot: () => null }))
vi.mock('./related-listings', () => ({
  RelatedListings: (p: Record<string, unknown>) => <section data-testid="related" data-props={JSON.stringify(p)} />,
}))
vi.mock('./listing-content', () => ({
  LocalizedTitle: ({ title, titleVi, i18n }: { title: string; titleVi: string | null; i18n?: Record<string, string> | null }) => (
    <span data-localized-title data-vi={titleVi ?? ''} data-i18n={i18n ? JSON.stringify(i18n) : ''}>{title}</span>
  ),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, prefetch: _p, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => <a href={href} {...rest}>{children}</a>,
}))

const { GoneListing } = await import('./gone-listing')

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(navigator, 'languages')
})

const VIEW: GoneListingView = {
  id: 'L1', title: 'OPPO A6c 4GB 128GB', titleVi: 'Điện thoại OPPO A6c 4GB/128GB',
  categorySlug: 'electronics', subcategorySlug: 'phones-tablets', brandSlug: 'oppo', model: 'A6c',
}
function renderIn(lang: 'en' | 'vi', node: React.ReactNode, Provider = LanguageProvider) {
  Object.defineProperty(navigator, 'languages', { configurable: true, get: () => (lang === 'vi' ? ['vi-VN', 'vi'] : ['en-US', 'en']) })
  return render(<Provider initialLang={lang} initialViDict={{}}>{node}</Provider>)
}

describe('GoneListing', () => {
  it('heading → the item’s name → second-hand alternatives → the search, in that DOM order', () => {
    const { container, getByTestId } = renderIn('en', <GoneListing listing={VIEW} searchQuery="OPPO A6c" lang="en" />)
    const h1 = container.querySelector('h1')!
    expect(h1.textContent).toBe('This listing is no longer on eno')
    expect(container.querySelectorAll('h1')).toHaveLength(1)
    const name = container.querySelector('[data-gone-title]')!
    const related = getByTestId('related')
    const search = container.querySelector('a[data-gone-search]')!
    expect(h1.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(name.compareDocumentPosition(related) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(related.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(container.innerHTML).not.toMatch(/\border-\d|sm:order-/)
  })

  it('names the item in the reader’s language (LocalizedTitle with titleVi and the embedded translations)', () => {
    const { container } = renderIn('en', <GoneListing listing={VIEW} searchQuery="OPPO A6c" titleI18n={{ ko: '오포 A6c' }} />)
    const t = container.querySelector('[data-gone-title] [data-localized-title]') as HTMLElement
    expect(t.textContent).toBe('OPPO A6c 4GB 128GB')
    expect(t.dataset.vi).toBe('Điện thoại OPPO A6c 4GB/128GB')
    expect(JSON.parse(t.dataset.i18n!)).toEqual({ ko: '오포 A6c' })
  })

  it('the alternatives are the gone rail — the row’s own category, shelf, brand and model, nobody’s rows left out', () => {
    const { getByTestId } = renderIn('en', <GoneListing listing={VIEW} searchQuery="OPPO A6c" />)
    expect(JSON.parse(getByTestId('related').dataset.props!)).toEqual({
      listingId: 'L1', categorySlug: 'electronics', subcategorySlug: 'phones-tablets', brandSlug: 'oppo', model: 'A6c', variant: 'gone',
    })
  })

  it('the search link prefills the query, and both copies are authored in Vietnamese', () => {
    const en = renderIn('en', <GoneListing listing={VIEW} searchQuery="OPPO A6c" lang="en" />)
    const a = en.container.querySelector('a[data-gone-search]') as HTMLAnchorElement
    expect(a.getAttribute('href')).toBe('/?q=OPPO%20A6c')
    expect(a.textContent).toBe('Search for “OPPO A6c”')
    cleanup()
    const vi_ = renderIn('vi', <GoneListing listing={VIEW} searchQuery="OPPO A6c" lang="vi" />)
    expect(vi_.container.querySelector('h1')!.textContent).toBe('Tin này không còn trên eno')
    expect(vi_.container.querySelector('a[data-gone-search]')!.textContent).toBe('Tìm “OPPO A6c”')
  })

  it('on eno.vn a Vietnamese reader’s search stays in Vietnamese (the /vi twin, localizedHref)', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
    vi.resetModules()
    try {
      const { GoneListing: Gone } = await import('./gone-listing')
      const { LanguageProvider: Provider } = await import('@/context/language-context')
      const href = (lang: 'en' | 'vi') => renderIn(lang, <Gone listing={VIEW} searchQuery="OPPO A6c" lang={lang} />, Provider)
        .container.querySelector('a[data-gone-search]')!.getAttribute('href')
      expect(href('vi')).toBe('/vi?q=OPPO%20A6c')
      cleanup()
      expect(href('en')).toBe('/?q=OPPO%20A6c')
    } finally {
      vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'services')
      vi.resetModules()
    }
  })

  it('no query (a title of nothing but symbols), no search link — never a “Search for “”” button', () => {
    const { container, getByTestId } = renderIn('en', <GoneListing listing={{ ...VIEW, title: '★★★' }} searchQuery="  " />)
    expect(container.querySelector('a[data-gone-search]')).toBeNull()
    expect(getByTestId('related')).toBeTruthy()
  })

  it('⛔ shows nothing else about the row — no photo, price, seller or contact, even when a caller passes them', () => {
    // A caller that hands over the whole row (TypeScript would refuse it; a cast is how it would sneak in).
    const leaky = {
      ...VIEW, price: 3_990_000, currency: '₫', images: ['https://cdn.example.test/a.jpg'], description: 'Hàng chính hãng, bảo hành 12 tháng',
      seller: { name: 'CellphoneS', phone: '0901234567' }, affiliateUrl: 'https://go.isclix.com/x', location: 'Quận 1',
    } as unknown as GoneListingView
    const { container } = renderIn('vi', <GoneListing listing={leaky} searchQuery="OPPO A6c" lang="vi" />)
    expect(container.querySelector('img, video, picture')).toBeNull()
    const html = container.innerHTML
    for (const leak of ['3.990.000', '3,990,000', '3990000', '₫', 'cdn.example.test', 'bảo hành', 'CellphoneS', '0901234567', 'tel:', 'isclix', 'Quận 1']) {
      expect(html, leak).not.toContain(leak)
    }
    // The only links are the search (the header and footer are mocked out here).
    expect([...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/?q=OPPO%20A6c'])
    expect(container.querySelector('button')).toBeNull()
  })
})
