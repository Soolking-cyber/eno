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
  images,
  sellerId: 's1',
  subcategorySlug: 'bicycles',
  brandSlug: null,
  category: { slug: 'vehicles' },
}) as unknown as SerializedListing
const cards = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}` })) as unknown as SerializedListingCard[]
const renderSold = (images: string[], more: number) =>
  render(<SoldListing listing={listing(images)} moreFromSeller={cards(more)} sellerName="Shop" sellerHref="/sellers/s1" />)

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
})
