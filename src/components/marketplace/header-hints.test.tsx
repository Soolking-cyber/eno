// @vitest-environment jsdom
/**
 * THE HEADER'S ICON-ONLY CONTROLS NAME THEMSELVES ON HOVER (UI climb 2026-11-09: judges found the cluster right of the search
 * unexplained to a first-time visitor). ui/tooltip, not `title=`, which no keyboard reveals. The bell's hint is OFF while its
 * panel is open: the panel is the answer, and a hint under the bell would sit over it. The popup is stubbed (tooltip.test.tsx).
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'

vi.mock('@/components/ui/tooltip-popup', () => ({
  TooltipPopup: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div role="tooltip">{children}</div> : null,
}))
vi.mock('./tooltip-popup', () => ({
  TooltipPopup: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div role="tooltip">{children}</div> : null,
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1' }, loading: false, openSignIn: vi.fn() }) }))
vi.mock('@/context/notifications-context', () => ({
  useNotifications: () => ({ items: [], unread: 0, markRead: vi.fn(), markAllRead: vi.fn(), remove: vi.fn(), clearAll: vi.fn() }),
}))

const { NotificationBell } = await import('./notification-bell')
const { AISearchButton } = await import('./ai-concierge')

const hover = async (el: Element) => {
  fireEvent.pointerEnter(el, { pointerType: 'mouse' })
  await act(async () => { await vi.advanceTimersByTimeAsync(700) })
}
const inEnglish = (node: React.ReactNode) => render(<LanguageProvider initialLang="en" initialViDict={{}}>{node}</LanguageProvider>)

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US'])
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('header hints', () => {
  it('the AI button names itself on hover, and carries no native title', async () => {
    inEnglish(<AISearchButton active={false} onClick={() => {}} />)
    const btn = screen.getByRole('button', { name: 'AI shopping assistant' })
    expect(btn.hasAttribute('title')).toBe(false)
    await hover(btn)
    expect(screen.getByRole('tooltip').textContent).toBe('Ask eno AI')
  })

  it('the bell names itself on hover while its panel is closed', async () => {
    inEnglish(<NotificationBell />)
    await hover(screen.getByRole('button', { name: 'Notifications' }))
    expect(screen.getByRole('tooltip').textContent).toBe('Notifications')
  })

  it('no bell hint while the panel is open, even when the pointer comes back to the bell', async () => {
    inEnglish(<NotificationBell />)
    const bell = screen.getByRole('button', { name: 'Notifications' })
    await act(async () => { fireEvent.click(bell) })
    expect(screen.getByRole('dialog')).toBeTruthy()
    await hover(bell)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
