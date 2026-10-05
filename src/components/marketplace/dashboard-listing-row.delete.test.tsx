// @vitest-environment jsdom
/**
 * THE HOST KEEPS THE UNDO WINDOW OPEN. useListingActions' delete waits out the house undo window
 * (src/hooks/use-undo-window.tsx), and that hook treats an UNMOUNT as leaving: it sends the DELETE at once
 * and withdraws the Undo. So the row must stay mounted while its listing is "gone" — it renders nothing —
 * or the five seconds collapse to zero. This drives the REAL row and the REAL hook through the menu's
 * Delete, and pins that nothing is sent inside the window and that it is sent when the window closes.
 */
import * as React from 'react'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SerializedListing } from '@/lib/types'

const toastFn = vi.hoisted(() => {
  let seq = 0
  return Object.assign(vi.fn((_title?: unknown, _opts?: unknown) => ++seq), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() })
})
vi.mock('sonner', () => ({ toast: toastFn }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('./mark-sold-flow', async () => {
  const real = await vi.importActual<typeof import('./mark-sold-flow')>('./mark-sold-flow')
  return { soldSheetApplies: real.soldSheetApplies, MarkSoldFlow: () => null }
})
vi.mock('./quick-discount', () => ({ QuickDiscount: () => null }))
vi.mock('./listing-sparkline', () => ({ ListingSparkline: () => null }))
vi.mock('./price', () => ({ Price: () => null }))
vi.mock('next/image', () => ({ default: ({ src }: { src: string }) => <img src={src} alt="" /> }))

vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://sb.example.test')
const { DashboardListingRow } = await import('./dashboard-listing-row')

const listing = {
  id: 'l1', title: 'Road bike', titleVi: null, images: ['https://picsum.photos/400'], price: 1_000_000, currency: '₫',
  priceUnit: null, verified: true, status: 'active', views: 3, contactCount: 0, savedCount: 0,
} as unknown as SerializedListing

beforeEach(() => {
  vi.useFakeTimers()
  toastFn.mockClear(); toastFn.dismiss.mockClear()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) })))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })
afterAll(() => { vi.unstubAllEnvs() })

describe('DashboardListingRow — Delete keeps its undo window', () => {
  it('⛔ the row hides but stays mounted: nothing is sent inside the window, the DELETE goes out when it closes', async () => {
    const onChanged = vi.fn()
    const { container } = render(<DashboardListingRow listing={listing} onChanged={onChanged} />)
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete listing/ }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(container.textContent).not.toContain('Road bike') // hidden at once
    expect(toastFn).toHaveBeenCalledWith('Listing deleted', expect.objectContaining({ duration: Infinity }))

    await act(async () => { await vi.advanceTimersByTimeAsync(4900) })
    expect(fetch).not.toHaveBeenCalled() // an unmount would have sent it already

    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    expect(fetch).toHaveBeenCalledWith('/api/listings/l1', { method: 'DELETE', keepalive: true })
  })
})
