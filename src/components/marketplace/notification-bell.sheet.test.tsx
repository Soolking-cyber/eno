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

/**
 * ⛔ THE PHONE HEADER'S TWO BELLS (header.tsx passes `quiet={homeRoute}`): build 8's quiet 22px muted bell on the home route
 * (owner-approved 2026-11-15), r05's 24px ink bell on every other route (owner-approved 2026-11-14) — round 13 (2026-11-17)
 * left both as they were. Below `sm` the header overhangs the bell's row so its painted glyph keeps the mark's 12px edge; the
 * keyboard ring is drawn inside the box (it lost its right side off the screen), and the quiet bell — 1px further out —
 * nudges its 44px hit area 1px back so it ends on the screen edge. jsdom has no layout: the classes are what is pinned here,
 * the geometry in e2e/guest/chrome-phone.spec.ts.
 */
describe('NotificationBell · the phone header\'s quiet and ink bells', () => {
  const tokens = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/)
  beforeEach(() => { h.user = null })

  it('quiet: 22px and muted below sm, its hit area nudged 1px back, the keyboard ring inside the box', () => {
    render(<LanguageProvider><NotificationBell quiet /></LanguageProvider>)
    expect(tokens(bell())).toEqual(expect.arrayContaining(['h-10', 'w-10', 'tap-44', 'text-foreground', 'max-sm:text-muted-foreground', 'max-sm:before:-translate-x-px', 'max-sm:focus-visible:-outline-offset-2!']))
    // 28px from sm; below sm the 22px `size-5.5` (tailwind-merge drops the 24px `max-sm:h-6 max-sm:w-6` it replaces).
    const g = tokens(bell().querySelector('svg'))
    expect(g).toEqual(expect.arrayContaining(['h-7', 'w-7', 'max-sm:size-5.5']))
    expect(g).not.toContain('max-sm:h-6')
  })

  it('not quiet (every route but home): r05\'s 24px ink bell, its hit area centred — only the inside keyboard ring added', () => {
    render(<LanguageProvider><NotificationBell /></LanguageProvider>)
    const b = tokens(bell())
    expect(b).toEqual(expect.arrayContaining(['text-foreground', 'max-sm:focus-visible:-outline-offset-2!']))
    expect(b.filter((c) => c === 'max-sm:text-muted-foreground' || c.startsWith('max-sm:before:'))).toEqual([])
    const g = tokens(bell().querySelector('svg'))
    expect(g).toEqual(expect.arrayContaining(['max-sm:h-6', 'max-sm:w-6']))
    expect(g).not.toContain('max-sm:size-5.5')
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
