// @vitest-environment jsdom
/**
 * ⛔ FOCUS (WCAG 2.4.3, 2026-11-17): the row's ⋯ → Discount opens the REAL price-cut dialog (QuickDiscount) WITH the focus —
 * the row is `opensLayer`, so the closing menu (the action sheet on a phone, whose return to the ⋯ is an explicit ref) no
 * longer puts focus back on the ⋯ BEHIND the dialog — and the dialog gives it back to the ⋯ on close (`finalFocus`). A plain
 * row (Copy link) still returns focus to the ⋯ through the menu's own close. The real-browser proof (Chromium and WebKit,
 * touch, mouse and keys) is the 2026-11-17 Playwright harness; these pin the wiring in jsdom.
 * ⚠️ EXPLICIT CLEANUP: no vitest `globals`, so Testing Library registers no afterEach of its own.
 */
import * as React from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SerializedListing } from '@/lib/types'
import { LanguageProvider } from '@/context/language-context'
import { __resetBackToCloseForTests } from '@/lib/back-to-close'
import { installDrawerPolyfills, setViewport } from '@/test/drawer-env'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('./use-listing-actions', () => ({ useListingActions: () => ({ gone: false, status: 'active', setStatus: vi.fn(), markSold: vi.fn(), del: vi.fn() }) }))
vi.mock('./mark-sold-flow', () => ({ soldSheetApplies: () => false, MarkSoldFlow: () => null }))
vi.mock('./listing-sparkline', () => ({ ListingSparkline: () => null }))
vi.mock('./price', () => ({ Price: () => null }))
vi.mock('@/lib/copy-text', () => ({ copyText: async () => true }))

import { DashboardListingRow } from './dashboard-listing-row'

beforeAll(() => installDrawerPolyfills())
afterEach(() => {
  cleanup()
  __resetBackToCloseForTests()
  setViewport('desktop')
})

const listing = {
  id: 'l1', title: 'Road bike', titleVi: null, images: [], price: 1_000_000, currency: '₫', priceUnit: null, listingType: 'sell',
  category: { slug: 'electronics' }, verified: true, status: 'active', views: 3, contactCount: 0, savedCount: 0,
} as unknown as SerializedListing

const mount = () => render(
  <LanguageProvider initialLang="en" initialViDict={{}}>
    <DashboardListingRow listing={listing} onChanged={() => {}} />
  </LanguageProvider>,
)
const more = () => screen.getByRole('button', { name: 'More actions' })
const row = async (viewport: 'phone' | 'desktop', name: string) => viewport === 'phone'
  ? within(await screen.findByRole('dialog', { name: 'Road bike' })).getByRole('button', { name })
  : within(await screen.findByRole('menu')).getByRole('menuitem', { name })
const menuGone = (viewport: 'phone' | 'desktop') => (viewport === 'phone' ? screen.queryByRole('dialog', { name: 'Road bike' }) : screen.queryByRole('menu'))

describe('DashboardListingRow — the ⋯\'s Discount keeps focus in the price-cut dialog and gives it back to the ⋯', () => {
  for (const viewport of ['phone', 'desktop'] as const) {
    it(`${viewport}: Discount → focus in "Lower the price" once the menu has gone; Escape → back on the ⋯; a plain row after it still returns to the ⋯`, async () => {
      setViewport(viewport)
      const user = userEvent.setup()
      mount()
      await user.click(more())
      await user.click(await row(viewport, 'Discount'))
      const dialog = await screen.findByRole('dialog', { name: 'Lower the price' })
      await waitFor(() => expect(menuGone(viewport)).toBeNull())
      await new Promise((r) => setTimeout(r, 50))
      expect(dialog.contains(document.activeElement)).toBe(true)
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Lower the price' })).toBeNull())
      await waitFor(() => expect(document.activeElement).toBe(more()))
      // The next open is an ordinary one: the menu's own close returns focus to the ⋯ again.
      await user.click(more())
      await user.click(await row(viewport, 'Copy link'))
      await waitFor(() => expect(menuGone(viewport)).toBeNull())
      await waitFor(() => expect(document.activeElement).toBe(more()))
    })
  }
})
