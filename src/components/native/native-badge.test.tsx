// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'

/**
 * THE APP-ICON BADGE NEVER ASKS FOR NOTIFICATION PERMISSION (audit 1.3, native-badge.tsx).
 * iOS gives an app ONE prompt, and native-push.tsx is the one asker. NativeBadge only READS the answer —
 * and because @capawesome/capacitor-badge's iOS set/clear call requestAuthorization themselves, it must
 * not even write until that answer is 'granted'.
 */

const h = vi.hoisted(() => {
  const s = {
    user: { id: 'p1' } as { id: string } | null,
    notifUnread: 2,
    chatUnread: 1,
    display: 'prompt' as 'prompt' | 'granted' | 'denied',
    onAppState: undefined as ((e: { isActive: boolean }) => void) | undefined,
  }
  return {
    s,
    Badge: {
      checkPermissions: vi.fn(async () => ({ display: s.display })),
      requestPermissions: vi.fn(async () => ({ display: 'granted' as const })),
      set: vi.fn(async (_options: { count: number }) => {}),
      clear: vi.fn(async () => {}),
    },
  }
})
vi.mock('@capawesome/capacitor-badge', () => ({ Badge: h.Badge }))
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (_event: string, fn: (e: { isActive: boolean }) => void) => {
      h.s.onAppState = fn
      return { remove: async () => {} }
    },
  },
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: h.s.user }) }))
vi.mock('@/context/notifications-context', () => ({ useNotifications: () => ({ unread: h.s.notifUnread }) }))
vi.mock('@/context/chat-context', () => ({ useChat: () => ({ unread: h.s.chatUnread }) }))

import { NativeBadge } from './native-badge'

type Win = { Capacitor?: { isNativePlatform: () => boolean } }

/** Wait until the badge has read the permission `times` times, then let the rest of that write run out. */
async function afterCheck(times: number) {
  await vi.waitFor(() => expect(h.Badge.checkPermissions).toHaveBeenCalledTimes(times))
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}

/** The app comes back to the foreground (also what answering a system prompt does). */
async function foreground() {
  await vi.waitFor(() => expect(h.s.onAppState).toBeTypeOf('function'))
  act(() => h.s.onAppState!({ isActive: true }))
}

const untouched = () => {
  expect(h.Badge.requestPermissions).not.toHaveBeenCalled()
  expect(h.Badge.set).not.toHaveBeenCalled()
  expect(h.Badge.clear).not.toHaveBeenCalled()
}

beforeEach(() => {
  Object.assign(h.s, { user: { id: 'p1' }, notifUnread: 2, chatUnread: 1, display: 'prompt', onAppState: undefined })
  for (const fn of Object.values(h.Badge)) fn.mockClear()
  ;(window as unknown as Win).Capacitor = { isNativePlatform: () => true }
})
afterEach(() => {
  cleanup()
  delete (window as unknown as Win).Capacitor
})

describe('NativeBadge — never the permission asker', () => {
  it("does not ask and does not write while iOS has not asked yet ('prompt'), even signed in with unread items", async () => {
    render(<NativeBadge />)
    await afterCheck(1)
    untouched()

    // The foreground re-assert reads the answer again — and still neither asks nor writes.
    await foreground()
    await afterCheck(2)
    untouched()
  })

  it.each(['prompt', 'denied'] as const)("%s: a guest's launch touches nothing — not even clear(), which prompts on iOS", async (display) => {
    h.s.display = display
    h.s.user = null
    render(<NativeBadge />)
    await afterCheck(1)
    untouched()
  })

  it("stays silent after a denial ('denied')", async () => {
    h.s.display = 'denied'
    render(<NativeBadge />)
    await afterCheck(1)
    untouched()
  })

  it('writes the count once granted, and clears it when the count reaches zero', async () => {
    h.s.display = 'granted'
    const { rerender } = render(<NativeBadge />)
    await vi.waitFor(() => expect(h.Badge.set).toHaveBeenCalledWith({ count: 3 }))
    expect(h.Badge.clear).not.toHaveBeenCalled()

    h.s.notifUnread = 0
    h.s.chatUnread = 0
    rerender(<NativeBadge />)
    await vi.waitFor(() => expect(h.Badge.clear).toHaveBeenCalledTimes(1))
    expect(h.Badge.requestPermissions).not.toHaveBeenCalled()
  })

  it('signing out clears the icon when granted', async () => {
    h.s.display = 'granted'
    h.s.user = null
    render(<NativeBadge />)
    await vi.waitFor(() => expect(h.Badge.clear).toHaveBeenCalledTimes(1))
    expect(h.Badge.set).not.toHaveBeenCalled()
    expect(h.Badge.requestPermissions).not.toHaveBeenCalled()
  })

  it("picks up native push's grant on the next foreground", async () => {
    render(<NativeBadge />)
    await afterCheck(1)
    untouched()

    h.s.display = 'granted' // the user allowed native-push's prompt
    await foreground()
    await vi.waitFor(() => expect(h.Badge.set).toHaveBeenCalledWith({ count: 3 }))
    expect(h.Badge.requestPermissions).not.toHaveBeenCalled()
  })

  it('does nothing outside the native app', async () => {
    delete (window as unknown as Win).Capacitor
    h.s.display = 'granted'
    render(<NativeBadge />)
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(h.Badge.checkPermissions).not.toHaveBeenCalled()
    untouched()
  })
})

/**
 * ⛔ AN ACCOUNT SWITCH NEVER LEAVES THE PREVIOUS ACCOUNT'S COUNT ON THE ICON (F8). A write awaits the plugin and the
 * permission before touching the icon, so one for the previous count could land after the next account's.
 * `icon` models the app icon: a native write changes it when it lands (resolves).
 */
describe('NativeBadge — a switch in the middle of a write', () => {
  let icon: number | null
  beforeEach(() => {
    icon = null
    h.s.display = 'granted'
    h.Badge.set.mockImplementation(async ({ count }: { count: number }) => { icon = count })
    h.Badge.clear.mockImplementation(async () => { icon = 0 })
  })
  afterEach(() => {
    h.Badge.checkPermissions.mockImplementation(async () => ({ display: h.s.display }))
    h.Badge.set.mockImplementation(async () => {})
    h.Badge.clear.mockImplementation(async () => {})
  })
  const settle = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)) })

  it('a write still reading the permission at the switch never reaches the icon', async () => {
    let release!: () => void
    h.Badge.checkPermissions.mockImplementationOnce(() => new Promise((r) => { release = () => r({ display: 'granted' }) }))
    const { rerender } = render(<NativeBadge />) // p1: 3 unread — its write is waiting on the permission
    await vi.waitFor(() => expect(h.Badge.checkPermissions).toHaveBeenCalledTimes(1))
    Object.assign(h.s, { user: { id: 'p2' }, notifUnread: 0, chatUnread: 0 })
    rerender(<NativeBadge />) // p2 signs in: nothing unread
    release()
    await settle()
    expect(h.Badge.set).not.toHaveBeenCalledWith({ count: 3 })
    expect(icon).toBe(0)
  })

  it('⛔ a native call that never answers blocks only itself, and leaves the icon unknown rather than "unchanged"', async () => {
    Object.assign(h.s, { notifUnread: 0, chatUnread: 0 })
    const { rerender } = render(<NativeBadge />)
    await vi.waitFor(() => expect(icon).toBe(0)) // cleared: 0 was last written
    // p1's set(3) reaches the icon, and its answer never comes back (a reply lost as the app is suspended)
    h.Badge.set.mockImplementationOnce(({ count }: { count: number }) => { icon = count; return new Promise<void>(() => {}) })
    Object.assign(h.s, { notifUnread: 2, chatUnread: 1 })
    rerender(<NativeBadge />)
    await vi.waitFor(() => expect(h.Badge.set).toHaveBeenCalledWith({ count: 3 }))
    Object.assign(h.s, { user: { id: 'p2' }, notifUnread: 0, chatUnread: 0 })
    rerender(<NativeBadge />) // p2 has 0 — the number written before the hung 3, which did reach the icon
    await vi.waitFor(() => expect(h.Badge.clear).toHaveBeenCalledTimes(2))
    expect(icon).toBe(0) // written again, not skipped as "unchanged"
    Object.assign(h.s, { notifUnread: 1 })
    rerender(<NativeBadge />) // later writes still go through
    await vi.waitFor(() => expect(icon).toBe(1))
  })

  it('a call that fails after it changed the icon, once the count has moved on, is corrected too', async () => {
    let fail!: () => void
    h.Badge.set.mockImplementationOnce(({ count }: { count: number }) => new Promise<void>((_, reject) => { fail = () => { icon = count; reject(new Error('bridge')) } }))
    const { rerender } = render(<NativeBadge />) // p1: set(3) on its way
    await vi.waitFor(() => expect(h.Badge.set).toHaveBeenCalledWith({ count: 3 }))
    Object.assign(h.s, { user: { id: 'p2' }, notifUnread: 0, chatUnread: 0 })
    rerender(<NativeBadge />)
    await vi.waitFor(() => expect(h.Badge.clear).toHaveBeenCalledTimes(1)) // p2's clear has landed…
    fail() // …and p1's 3 reaches the icon, then its call fails
    await vi.waitFor(() => expect(icon).toBe(0))
  })

  it('a write that already reached the plugin and lands late is corrected, not skipped as "unchanged"', async () => {
    Object.assign(h.s, { notifUnread: 0, chatUnread: 0 })
    const { rerender } = render(<NativeBadge />)
    await vi.waitFor(() => expect(icon).toBe(0)) // the icon was cleared: what the component last wrote is 0
    let land!: () => void
    h.Badge.set.mockImplementationOnce(({ count }: { count: number }) => new Promise<void>((r) => { land = () => { icon = count; r() } }))
    Object.assign(h.s, { notifUnread: 2, chatUnread: 1 })
    rerender(<NativeBadge />) // p1 gets 3 unread: set(3) is on its way to the icon
    await vi.waitFor(() => expect(h.Badge.set).toHaveBeenCalledWith({ count: 3 }))
    Object.assign(h.s, { user: { id: 'p2' }, notifUnread: 0, chatUnread: 0 })
    rerender(<NativeBadge />) // p2 signs in with 0 — the same number last written before the 3
    await vi.waitFor(() => expect(h.Badge.clear).toHaveBeenCalledTimes(2)) // p2's clear has landed…
    land() // …and p1's 3 lands after it
    await vi.waitFor(() => expect(icon).toBe(0))
  })
})
