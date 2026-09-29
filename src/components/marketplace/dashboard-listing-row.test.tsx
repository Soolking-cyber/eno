// @vitest-environment jsdom
/**
 * The seller dashboard's row thumbnail goes through next/image (the optimizer) at a FIXED 80px, not
 * the stored original — and a source the optimizer would refuse is left unoptimized, never broken.
 */
import * as React from 'react'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { SerializedListing } from '@/lib/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('./use-listing-actions', () => ({ useListingActions: () => ({ gone: false, status: 'active', setStatus: vi.fn(), del: vi.fn() }) }))
vi.mock('./quick-discount', () => ({ QuickDiscount: () => null }))
vi.mock('./listing-sparkline', () => ({ ListingSparkline: () => null }))
vi.mock('./price', () => ({ Price: () => null }))
vi.mock('next/image', () => ({
  default: ({ src, quality, unoptimized, width, height }: { src: string; quality?: number; unoptimized?: boolean; width?: number; height?: number }) => (
    <img data-next-image src={src} data-quality={quality} data-unoptimized={String(!!unoptimized)} width={width} height={height} alt="" />
  ),
}))

// listing-image.ts pins its first-party prefix at module load, so the host is stubbed BEFORE the import.
vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://sb.example.test')
const { DashboardListingRow } = await import('./dashboard-listing-row')

afterEach(cleanup)
afterAll(() => { vi.unstubAllEnvs() })

const row = (image: string) => ({
  id: 'l1', title: 'Road bike', titleVi: null, images: [image], price: 1_000_000, currency: '₫', priceUnit: null,
  verified: true, status: 'active', views: 3, contactCount: 0, savedCount: 0,
}) as unknown as SerializedListing

describe('DashboardListingRow thumbnail', () => {
  it('sends a first-party image through the optimizer at a fixed 80px, quality 60', () => {
    const { container } = render(<DashboardListingRow listing={row('https://sb.example.test/storage/v1/object/public/listings/a/b.webp')} onChanged={() => {}} />)
    const img = container.querySelector('img[data-next-image]') as HTMLImageElement
    expect(img.dataset.unoptimized).toBe('false')
    expect(img.dataset.quality).toBe('60')
    expect(img.getAttribute('width')).toBe('80')
    expect(container.querySelectorAll('img:not([data-next-image])')).toHaveLength(0)
  })

  it('leaves a foreign or mock source unoptimized — it would 400 at the optimizer', () => {
    const { container } = render(<DashboardListingRow listing={row('https://picsum.photos/400')} onChanged={() => {}} />)
    const img = container.querySelector('img[data-next-image]') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('https://picsum.photos/400')
    expect(img.dataset.unoptimized).toBe('true')
  })
})
