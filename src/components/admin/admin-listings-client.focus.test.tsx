// @vitest-environment jsdom
import * as React from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ FOCUS (WCAG 2.4.3, 2026-11-17): a row's ⋯ → Remove opens the confirm WITH the focus (the row is `opensLayer`), and the
 * confirm gives it back to THAT row's ⋯ on close. The confirm has no trigger of its own: where a press never focuses the ⋯
 * (Safari's mouse — simulated here by a mousedown that is prevented, as Safari never focuses a clicked button) its close
 * used to drop focus on <body>. The real-browser proof is the 2026-11-17 Playwright harness; this pins the wiring.
 * ⚠️ EXPLICIT CLEANUP: no vitest `globals`, so Testing Library registers no afterEach of its own.
 */
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), info: vi.fn(), error: vi.fn() } }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))

import { AdminListingsClient } from './admin-listings-client'

const row = (i: number) => ({ id: `l${i}`, title: `Listing ${i}`, status: 'active', verified: false, price: 1000, currency: '₫', image: null, featured: false, sellerName: 'Shop', category: 'Phones', subcategory: 'phones-tablets', createdAt: new Date(Date.UTC(2026, 9, 14, 12, 0) - i * 60_000).toISOString() })
const noFocusOnPress = (e: MouseEvent) => { if ((e.target as Element).closest?.('button,[role="menuitem"]')) e.preventDefault() }
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ listings: [0, 1, 2].map(row), total: 3 }) })))
  document.addEventListener('mousedown', noFocusOnPress, true)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.removeEventListener('mousedown', noFocusOnPress, true) })

const moreOf = (title: string) => within(screen.getByText(title).closest('tr')!).getByRole('button', { name: 'More actions' })

describe('AdminListingsClient — a row\'s Remove gives focus back to that row\'s ⋯', () => {
  for (const close of ['Cancel', 'Escape'] as const) {
    it(`⋯ → Remove → focus in "Remove listings"; ${close} → focus on the ⋯ it came from (a press that never focused it)`, async () => {
      const user = userEvent.setup()
      render(<AdminListingsClient pageSize={3} />)
      await screen.findByText('Listing 1')
      await user.click(moreOf('Listing 1'))
      expect(document.activeElement).not.toBe(moreOf('Listing 1'))
      await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Remove' }))
      const dialog = await screen.findByRole('alertdialog', { name: 'Remove listings' })
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
      await new Promise((r) => setTimeout(r, 50))
      expect(dialog.contains(document.activeElement)).toBe(true)
      if (close === 'Cancel') await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      else await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
      await waitFor(() => expect(document.activeElement).toBe(moreOf('Listing 1')))
    })
  }
})
