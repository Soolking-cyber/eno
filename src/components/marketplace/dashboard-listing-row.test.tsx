// @vitest-environment jsdom
/**
 * The seller dashboard's row thumbnail goes through next/image (the optimizer) at a FIXED 80px, not
 * the stored original — and a source the optimizer would refuse is left unoptimized, never broken.
 */
import * as React from 'react'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SerializedListing } from '@/lib/types'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))
// Switchable for the demand-nudge cases below; every other case runs in English, as before.
const i18n = vi.hoisted(() => ({ lang: 'en' as 'en' | 'vi' }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: i18n.lang, tr: (en: string, viText?: string) => (i18n.lang === 'vi' && viText != null ? viText : en) }),
}))
const setStatus = vi.fn()
const markSold = vi.fn()
vi.mock('./use-listing-actions', () => ({ useListingActions: () => ({ gone: false, status: 'active', setStatus, markSold, del: vi.fn() }) }))
// B6: the "Who bought it?" flow, stubbed to what the row hands it (its own behaviour: mark-sold-flow.test.tsx).
// soldSheetApplies stays REAL — which listings get the sheet is the row's decision under test.
vi.mock('./mark-sold-flow', async () => {
  const real = await vi.importActual<typeof import('./mark-sold-flow')>('./mark-sold-flow')
  return {
    soldSheetApplies: real.soldSheetApplies,
    MarkSoldFlow: ({ open, listing, write }: { open: boolean; listing: { id: string; title: string; price: number }; write: unknown }) => (
      <span data-mark-sold-flow data-open={String(open)} data-listing={listing.id} data-title={listing.title} data-wired={String(write === markSold)} />
    ),
  }
})
vi.mock('./quick-discount', () => ({ QuickDiscount: ({ open, trigger }: { open?: boolean; trigger?: boolean }) => <span data-quick-discount data-open={String(!!open)} data-trigger={String(trigger !== false)} /> }))
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

/**
 * ONE ROW OF ACTIONS AT 360px (inbox-12): Sửa · Đã bán · •••, everything else in the overflow. jsdom has
 * no layout, so the 360px fit itself (scrollWidth === clientWidth) is a preview check; this pins what
 * makes it: which actions are inline, the tightened chip padding, and what moved into the menu.
 */
describe('DashboardListingRow actions', () => {
  const live = row('https://picsum.photos/400')

  it('inline: Edit, Mark sold and the overflow — nothing else', () => {
    const { container } = render(<DashboardListingRow listing={live} onChanged={() => {}} />)
    const edit = screen.getByRole('button', { name: 'Edit' })
    const sold = screen.getByRole('button', { name: 'Mark sold' })
    const more = screen.getByRole('button', { name: 'More actions' })
    const actionRow = edit.parentElement!
    expect(Array.from(actionRow.querySelectorAll(':scope > button'))).toEqual([edit, sold, more])
    for (const b of [edit, sold]) expect(b.className).toContain('px-2.5')
    // The price cut is NOT an inline chip any more: its dialog is mounted without a trigger.
    const qd = container.querySelector('[data-quick-discount]') as HTMLElement
    expect(qd.dataset.trigger).toBe('false')
    expect(qd.dataset.open).toBe('false')
  })

  it('the pencil steps out below sm (what buys the English row its fit)', () => {
    render(<DashboardListingRow listing={live} onChanged={() => {}} />)
    const svg = screen.getByRole('button', { name: 'Edit' }).querySelector('svg')!
    expect(svg.getAttribute('class')).toContain('max-sm:hidden')
  })

  /**
   * B6 — "MARK SOLD" ON A SALE ASKS WHO BOUGHT IT. The sheet opens (it is the confirm, and it pre-picks
   * "someone not on eno" when nobody messaged, so it stays one tap); the write is useListingActions'
   * markSold — optimistic, through POST /sold, rolled back on failure (use-listing-actions.test.ts).
   * Anything that is not a sale keeps the instant flip it had.
   */
  it('on a SALE, "Mark sold" opens "Who bought it?" wired to markSold — and marks nothing by itself', () => {
    setStatus.mockClear()
    const { container } = render(<DashboardListingRow listing={live} onChanged={() => {}} />)
    const flow = () => container.querySelector('[data-mark-sold-flow]') as HTMLElement
    expect(flow().dataset.open).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Mark sold' }))
    expect(flow().dataset.open).toBe('true')
    expect(flow().dataset.listing).toBe('l1')
    expect(flow().dataset.title).toBe('Road bike')
    expect(flow().dataset.wired).toBe('true')
    expect(setStatus).not.toHaveBeenCalled()
  })

  it('⛔ not a sale (a job, a rental, a free community post): no sheet — the instant flip it always had', () => {
    for (const extra of [{ listingType: 'job' }, { listingType: 'rent' }, { listingType: 'free', category: { slug: 'community-events' } }]) {
      setStatus.mockClear()
      const { container, unmount } = render(<DashboardListingRow listing={{ ...live, ...extra } as SerializedListing} onChanged={() => {}} />)
      expect(container.querySelector('[data-mark-sold-flow]')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Mark sold' }))
      expect(setStatus).toHaveBeenCalledWith('sold')
      unmount()
    }
  })

  it('the overflow carries Discount, Copy link, View, Hide and Delete — and Discount opens the dialog', async () => {
    const { container } = render(<DashboardListingRow listing={live} onChanged={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Discount' })).toBeTruthy())
    for (const name of ['Copy link', 'View listing', 'Hide', 'Delete listing']) {
      expect(screen.getByRole('menuitem', { name })).toBeTruthy()
    }
    expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hide' }))
    expect(setStatus).toHaveBeenCalledWith('hidden')
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Discount' })).toBeTruthy())
    fireEvent.click(screen.getByRole('menuitem', { name: 'Discount' }))
    await waitFor(() => expect((container.querySelector('[data-quick-discount]') as HTMLElement).dataset.open).toBe('true'))
  })
})

describe('DashboardListingRow demand nudge', () => {
  afterEach(() => { i18n.lang = 'en' })
  const saved = (savedCount: number) => ({ ...row('https://picsum.photos/400'), savedCount, views: 0, contactCount: 0 }) as unknown as SerializedListing

  it('groups the saved count like the meta line beside it: 1,234 (en) / 1.234 (vi), never 1234', () => {
    render(<DashboardListingRow listing={saved(1234)} onChanged={() => {}} />)
    expect(screen.getByText(/^1,234 people saved this — /)).toBeTruthy()
    cleanup()
    i18n.lang = 'vi'
    render(<DashboardListingRow listing={saved(1234)} onChanged={() => {}} />)
    expect(screen.getByText(/^1\.234 người đã lưu tin này — /)).toBeTruthy()
  })

  it('stays silent below 5 saves', () => {
    render(<DashboardListingRow listing={saved(4)} onChanged={() => {}} />)
    expect(screen.queryByText(/people saved this/)).toBeNull()
  })
})
