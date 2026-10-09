// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

/**
 * ⛔ THE INSTALLED-PWA ICON BADGE: THE CURRENT COUNT WINS, AND NO CALL CAN FREEZE IT (pwa-badge.tsx — the same
 * mechanism as NativeBadge, F8). The writes used to be chained, so one setAppBadge that never settled froze every later
 * write, the foreground re-assert included, and the previous account's count could stay on the icon for the rest of the
 * page's life. `icon` models the app icon: a write changes it when it lands (resolves).
 */

const h = vi.hoisted(() => ({ s: { user: { id: 'p1' } as { id: string } | null, notifUnread: 2, chatUnread: 1 } }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: h.s.user }) }))
vi.mock('@/context/notifications-context', () => ({ useNotifications: () => ({ unread: h.s.notifUnread }) }))
vi.mock('@/context/chat-context', () => ({ useChat: () => ({ unread: h.s.chatUnread }) }))

import { PwaBadge } from './pwa-badge'

let icon: number | null
const setAppBadge = vi.fn(async (n: number) => { icon = n })
const clearAppBadge = vi.fn(async () => { icon = 0 })

beforeEach(() => {
  Object.assign(h.s, { user: { id: 'p1' }, notifUnread: 2, chatUnread: 1 })
  icon = null
  setAppBadge.mockReset().mockImplementation(async (n: number) => { icon = n })
  clearAppBadge.mockReset().mockImplementation(async () => { icon = 0 })
  Object.defineProperty(navigator, 'setAppBadge', { configurable: true, value: setAppBadge })
  Object.defineProperty(navigator, 'clearAppBadge', { configurable: true, value: clearAppBadge })
  // An installed PWA: display-mode standalone.
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('standalone'), media: q, addEventListener() {}, removeEventListener() {} }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (navigator as unknown as Record<string, unknown>).setAppBadge
  delete (navigator as unknown as Record<string, unknown>).clearAppBadge
})

const as = (rerender: (ui: React.ReactElement) => void, over: Partial<typeof h.s>) => { Object.assign(h.s, over); rerender(<PwaBadge />) }

describe('PwaBadge — writes the count to the installed app icon', () => {
  it('writes the count, clears it at zero, and skips a write that would change nothing', async () => {
    const { rerender } = render(<PwaBadge />)
    await vi.waitFor(() => expect(icon).toBe(3))
    as(rerender, { notifUnread: 0, chatUnread: 0 })
    await vi.waitFor(() => expect(icon).toBe(0))
    as(rerender, { chatUnread: 0 }) // same total: no new write
    await new Promise((r) => setTimeout(r, 20))
    expect(setAppBadge).toHaveBeenCalledTimes(1)
    expect(clearAppBadge).toHaveBeenCalledTimes(1)
  })

  it('signing out clears the icon', async () => {
    const { rerender } = render(<PwaBadge />)
    await vi.waitFor(() => expect(icon).toBe(3))
    as(rerender, { user: null })
    await vi.waitFor(() => expect(icon).toBe(0))
  })
})

describe('PwaBadge — a switch in the middle of a write', () => {
  it('⛔ a call that never answers blocks only itself — and leaves the icon unknown, not "unchanged"', async () => {
    Object.assign(h.s, { notifUnread: 0, chatUnread: 0 })
    const { rerender } = render(<PwaBadge />)
    await vi.waitFor(() => expect(icon).toBe(0)) // cleared: 0 was last written
    // p1's 3 reaches the icon, and its answer never comes back.
    setAppBadge.mockImplementationOnce((n: number) => { icon = n; return new Promise<void>(() => {}) })
    as(rerender, { notifUnread: 2, chatUnread: 1 })
    await vi.waitFor(() => expect(setAppBadge).toHaveBeenCalledWith(3))
    as(rerender, { user: { id: 'p2' }, notifUnread: 0, chatUnread: 0 }) // p2: the same 0 written before the hung 3
    await vi.waitFor(() => expect(clearAppBadge).toHaveBeenCalledTimes(2))
    expect(icon).toBe(0)
    as(rerender, { notifUnread: 1 }) // later writes still go through (a chain would have frozen here)
    await vi.waitFor(() => expect(icon).toBe(1))
  })

  it('⛔ a write that lands after the next account\'s is corrected', async () => {
    let land!: () => void
    setAppBadge.mockImplementationOnce((n: number) => new Promise<void>((r) => { land = () => { icon = n; r() } }))
    const { rerender } = render(<PwaBadge />) // p1: setAppBadge(3) on its way
    await vi.waitFor(() => expect(setAppBadge).toHaveBeenCalledWith(3))
    as(rerender, { user: { id: 'p2' }, notifUnread: 0, chatUnread: 0 })
    await vi.waitFor(() => expect(clearAppBadge).toHaveBeenCalledTimes(1)) // p2's clear has landed…
    land() // …and p1's 3 lands after it
    await vi.waitFor(() => expect(icon).toBe(0))
  })

  it('a call that fails after it changed the icon, once the count has moved on, is corrected too', async () => {
    let fail!: () => void
    setAppBadge.mockImplementationOnce((n: number) => new Promise<void>((_, reject) => { fail = () => { icon = n; reject(new Error('platform')) } }))
    const { rerender } = render(<PwaBadge />)
    await vi.waitFor(() => expect(setAppBadge).toHaveBeenCalledWith(3))
    as(rerender, { user: { id: 'p2' }, notifUnread: 0, chatUnread: 0 })
    await vi.waitFor(() => expect(clearAppBadge).toHaveBeenCalledTimes(1))
    fail()
    await vi.waitFor(() => expect(icon).toBe(0))
  })
})

describe('PwaBadge — only in an installed web app', () => {
  it('a plain browser tab never touches the icon', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }))
    render(<PwaBadge />)
    await new Promise((r) => setTimeout(r, 20))
    expect(setAppBadge).not.toHaveBeenCalled()
    expect(clearAppBadge).not.toHaveBeenCalled()
  })
})
