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
