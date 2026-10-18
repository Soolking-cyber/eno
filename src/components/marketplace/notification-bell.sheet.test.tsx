// @vitest-environment jsdom
/**
 * THE BELL ON A PHONE IS A BOTTOM SHEET (owner, 2026-10-18: "also mobile all dropdowns should be bottom up card style
 * like the filter card"). Below `sm` (useIsPhone's real gate through a matchMedia stub) the same bell opens the filter
 * card titled "Notifications": Mark all read / Clear all beside the title (the panel's own header row is dropped, so
 * the title is never shown twice), the list filling the body. Signed out, the tap still goes to sign-in, not a sheet.
 * Desktop keeps the anchored panel.
 */
import * as React from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguageProvider } from '@/context/language-context'
import { __resetBackToCloseForTests } from '@/lib/back-to-close'
import { installDrawerPolyfills, setViewport } from '@/test/drawer-env'

const h = vi.hoisted(() => ({
  user: { id: '11111111-1111-4111-8111-111111111111' } as { id: string } | null,
  openSignIn: (() => {}) as (...args: unknown[]) => void,
  markAllRead: (() => {}) as () => void,
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: h.user, loading: false, openSignIn: h.openSignIn }) }))
const at = (min: number) => new Date(Date.now() - min * 60_000).toISOString()
const TITLE = 'Price drop'
vi.mock('@/context/notifications-context', () => ({
  useNotifications: () => ({
    items: [{ id: 'n1', type: 'price_drop', title: TITLE, body: '', read: false, createdAt: at(2), conversationId: null, listingId: 'l1', url: null, actorName: null }],
    unread: 1,
    markRead: vi.fn(),
    markAllRead: h.markAllRead,
    remove: vi.fn(),
    clearAll: vi.fn(),
  }),
}))

import { NotificationBell } from './notification-bell'

beforeAll(() => installDrawerPolyfills())
beforeEach(() => {
  h.user = { id: '11111111-1111-4111-8111-111111111111' }
  h.openSignIn = vi.fn()
  h.markAllRead = vi.fn()
})
afterEach(() => {
  cleanup()
  __resetBackToCloseForTests()
  setViewport('desktop')
})

const bell = () => screen.getByRole('button', { name: /^Notifications/, hidden: true })

describe('NotificationBell · phone', () => {
  beforeEach(() => { setViewport('phone') })

  it('opens the filter card titled Notifications, actions beside the title, the list in the body', async () => {
    render(<LanguageProvider><NotificationBell /></LanguageProvider>)
    await userEvent.setup().click(bell())
    const sheet = await screen.findByRole('dialog', { name: 'Notifications' })
    // The title is the sheet's, once — the panel's own heading row is dropped.
    expect(within(sheet).getAllByText('Notifications')).toHaveLength(1)
    const header = sheet.querySelector('[data-slot="drawer-header"]')!
    expect(within(header as HTMLElement).getByRole('button', { name: 'Mark all read' })).toBeTruthy()
    expect(within(sheet).getByRole('link', { name: new RegExp(TITLE) })).toBeTruthy()
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull()
    await userEvent.setup().click(within(header as HTMLElement).getByRole('button', { name: 'Mark all read' }))
    expect(h.markAllRead).toHaveBeenCalledTimes(1)
  })

  it('signed out, the tap goes to sign-in and no sheet opens', async () => {
    h.user = null
    render(<LanguageProvider><NotificationBell /></LanguageProvider>)
    await userEvent.setup().click(bell())
    await waitFor(() => expect(h.openSignIn).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('NotificationBell · desktop', () => {
  it('keeps the anchored panel with its own header row', async () => {
    render(<LanguageProvider><NotificationBell /></LanguageProvider>)
    await userEvent.setup().click(bell())
    const panel = await screen.findByRole('dialog', { name: 'Notifications' })
    expect(panel.getAttribute('data-slot')).toBe('popover-content')
    expect(panel.querySelector('[data-slot="popover-header"]')).not.toBeNull()
  })
})
