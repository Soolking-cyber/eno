// @vitest-environment jsdom
/**
 * THE SOLD PAGE — what a visitor who arrived too late is offered, and in what order.
 *
 * Pinned: a similar-items shelf renders BEFORE the seller's own stock (the visitor came for THIS kind
 * of item, and it is gone), it leaves the seller's rows out only when the seller's rail is actually on
 * the page, the retired 'Sold' kicker stays retired, and the thumbnail goes through next/image rather
 * than downloading the stored original into a 64px box.
 */
import * as React from 'react'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SerializedListing, SerializedListingCard } from '@/lib/types'

vi.mock('./header', () => ({ Header: () => null }))
vi.mock('./footer', () => ({ Footer: () => null }))
vi.mock('./mascot', () => ({ Mascot: () => null }))
vi.mock('./related-listings', () => ({
  RelatedListings: (p: { excludeSellerId?: string | null; variant?: string }) => (
    <section data-testid="related" data-exclude={p.excludeSellerId ?? ''} data-variant={p.variant} />
  ),
}))
vi.mock('./same-seller-shelf', () => ({ SameSellerShelf: () => <section data-testid="seller" /> }))
vi.mock('@/context/language-context', () => ({ Tr: ({ text }: { text: string }) => <>{text}</> }))
vi.mock('./listing-content', () => ({
  LocalizedTitle: ({ title, titleVi, i18n }: { title: string; titleVi: string | null; i18n?: Record<string, string> | null }) => (
    <span data-localized-title data-vi={titleVi ?? ''} data-i18n={i18n ? JSON.stringify(i18n) : ''}>{title}</span>
  ),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, prefetch: _p, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('next/image', () => ({
  default: ({ src, quality, unoptimized, width, height }: { src: string; quality?: number; unoptimized?: boolean; width?: number; height?: number }) => (
    <img data-next-image src={src} data-quality={quality} data-unoptimized={String(!!unoptimized)} width={width} height={height} alt="" />
  ),
}))

// listing-image.ts pins its first-party prefix at module load, so the host is stubbed BEFORE the import.
vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://sb.example.test')
const { SoldListing } = await import('./sold-listing')

afterEach(cleanup)
afterAll(() => { vi.unstubAllEnvs() })

const FIRST_PARTY = 'https://sb.example.test/storage/v1/object/public/listings/a/b.webp'
const listing = (images: string[]) => ({
  id: 'l1',
  title: 'Road bike',
  titleVi: 'Xe đạp đua',
  images,
  sellerId: 's1',
  subcategorySlug: 'bicycles',
  brandSlug: null,
  category: { slug: 'vehicles' },
}) as unknown as SerializedListing
const cards = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}` })) as unknown as SerializedListingCard[]
const renderSold = (images: string[], more: number, lang?: string, titleI18n?: Record<string, string>) =>
  render(<SoldListing listing={listing(images)} moreFromSeller={cards(more)} sellerName="Shop" sellerHref="/sellers/s1" lang={lang} titleI18n={titleI18n} />)

describe('SoldListing', () => {
  it('offers similar items first, then the seller’s other stock, without repeating the seller', () => {
    const { getByTestId } = renderSold([FIRST_PARTY], 3)
    const related = getByTestId('related')
    const seller = getByTestId('seller')
    expect(related.compareDocumentPosition(seller) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(related.dataset.variant).toBe('sold')
    // The seller rail is showing (3 ≥ 2), so the similar rail leaves that seller's rows out.
    expect(related.dataset.exclude).toBe('s1')
  })

  it('keeps the seller’s rows in the similar rail when their own rail is not on the page', () => {
    const { getByTestId, queryByTestId } = renderSold([FIRST_PARTY], 1)
    expect(queryByTestId('seller')).toBeNull()
    expect(getByTestId('related').dataset.exclude).toBe('')
  })

  it('has no kicker eyebrow over the heading', () => {
    const { container } = renderSold([FIRST_PARTY], 0)
    expect(container.querySelector('.eyebrow')).toBeNull()
    expect(container.querySelector('h1')?.textContent).toBe('This item has been sold')
  })

  it('sends a first-party thumbnail through the image optimizer at a fixed 64px', () => {
    const { container } = renderSold([FIRST_PARTY], 0)
    const img = container.querySelector('img[data-next-image]') as HTMLImageElement
    expect(img).not.toBeNull()
    expect(img.dataset.unoptimized).toBe('false')
    expect(img.dataset.quality).toBe('60')
    expect(img.getAttribute('width')).toBe('64')
  })

  it('leaves a source the optimizer would refuse unoptimized, rather than a broken image', () => {
    const { container } = renderSold(['https://cdn.example.org/x.jpg'], 0)
    expect((container.querySelector('img[data-next-image]') as HTMLImageElement).dataset.unoptimized).toBe('true')
  })

  /**
   * ⛔ ALTERNATIVES ABOVE THE FOLD ON A PHONE (pdp-06 / auth-07): the first similar card sat under the tab
   * bar. Below sm the mascot is h-20, the top padding pt-4, and the button row comes AFTER the rails.
   * ⚠️ DOM ORDER IS THE VISUAL ORDER AT EVERY WIDTH (review, 2026-10-04 — WCAG 2.4.3): no `order-*`; the row
   * is rendered twice, `hidden sm:flex` under the heading and `flex sm:hidden` after the rails, so only one
   * copy is ever displayed — and focusable.
   */
  it('below sm: small mascot, pt-4, rails before the buttons; from sm the buttons under the heading — each copy in its own DOM place', () => {
    const { container, getByTestId, getAllByText } = renderSold([FIRST_PARTY], 0)
    const section = container.querySelector('section:not([data-testid])') as HTMLElement
    expect(section.className).toMatch(/(^| )pt-4( |$)/)
    expect(section.className).toContain('sm:pt-14')
    const rows = getAllByText('More from this seller').map((el) => el.closest('div') as HTMLElement)
    expect(rows).toHaveLength(2)
    const [wide, phone] = rows
    const related = getByTestId('related')
    // heading → (sm) buttons → rails → (phone) buttons, in the DOM itself.
    expect(section.compareDocumentPosition(wide) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(wide.compareDocumentPosition(related) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(related.compareDocumentPosition(phone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // One copy per breakpoint, never both: each is display:none where the other shows.
    expect(wide.className.split(/\s+/)).toEqual(expect.arrayContaining(['hidden', 'sm:flex']))
    expect(wide.className.split(/\s+/)).not.toContain('flex')
    expect(phone.className.split(/\s+/)).toEqual(expect.arrayContaining(['flex', 'sm:hidden']))
    expect(container.innerHTML).not.toMatch(/\border-\d|sm:order-/)
    const SRC = readFileSync(join(process.cwd(), 'src/components/marketplace/sold-listing.tsx'), 'utf8')
    expect(SRC).toContain('<Mascot name="success" className="mx-auto h-20 w-20 sm:h-60 sm:w-60" />')
    expect(SRC).not.toMatch(/sm:order-|\border-\d/)
  })

  it('names the item in the reader’s language (LocalizedTitle with titleVi and the embedded translations), not the raw title', () => {
    const { container } = renderSold([FIRST_PARTY], 0, 'vi', { ko: '로드 바이크' })
    const t = container.querySelector('[data-localized-title]') as HTMLElement
    expect(t.dataset.vi).toBe('Xe đạp đua')
    expect(JSON.parse(t.dataset.i18n!)).toEqual({ ko: '로드 바이크' })
    // …which the page fetches beside the seller's other stock, as the live PDP embeds them.
    const PAGE = readFileSync(join(process.cwd(), 'src/app/[lang]/listings/[id]/(pdp)/page.tsx'), 'utf8')
    expect(PAGE).toContain('cachedTranslations([sold.title]),')
    expect(PAGE).toContain('titleI18n={soldI18n[sold.title] ?? null}')
  })

  it('the category and Home links keep a Vietnamese reader in Vietnamese (localizedHref)', () => {
    const SRC = readFileSync(join(process.cwd(), 'src/components/marketplace/sold-listing.tsx'), 'utf8')
    expect(SRC).toContain('localizedHref(categoryBrowsePath(listing.category.slug), lang)')
    expect(SRC).toContain("const homeHref = localizedHref('/', lang)")
    expect(SRC).not.toMatch(/href="\/"/)
    // English stays plain — in both copies of the row.
    const { getAllByText } = renderSold([FIRST_PARTY], 0, 'en')
    expect(getAllByText('Home').map((el) => el.closest('a')!.getAttribute('href'))).toEqual(['/', '/'])
  })

  it('on eno.vn a Vietnamese reader gets the /vi twins (the pilot lists are the marketplace edition’s)', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
    vi.resetModules()
    try {
      const { SoldListing: Sold } = await import('./sold-listing')
      const at = (lang: string) => render(<Sold listing={listing([FIRST_PARTY])} moreFromSeller={[]} sellerName="Shop" sellerHref="/sellers/s1" lang={lang} />)
      const hrefs = (r: ReturnType<typeof at>, text: string) => r.getAllByText(text).map((el) => el.closest('a')!.getAttribute('href'))
      const vi_ = at('vi')
      expect(hrefs(vi_, 'Home')).toEqual(['/vi', '/vi'])
      // Vehicles is a retired shelf: it browses in the explorer (`/?category=`), whose Vietnamese twin is /vi.
      expect(hrefs(vi_, 'Browse this category')).toEqual(['/vi?category=vehicles', '/vi?category=vehicles'])
      cleanup()
      expect(hrefs(at('en'), 'Home')).toEqual(['/', '/'])
    } finally {
      vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'services')
      vi.resetModules()
    }
  })
})
