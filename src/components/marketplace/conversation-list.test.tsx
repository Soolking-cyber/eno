// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

/**
 * A CONFIRMED DELETE LEAVES, THEN IS DELETED. The row used to be removed in the same commit as the
 * confirm, so it vanished and every row below jumped a slot. It now collapses (grid-rows 1fr→0fr +
 * opacity) for 150ms and only then calls deleteConvo — pinned here because the order is the fix: a
 * delete fired first would unmount the row before its exit could play.
 */
const chat = {
  convos: [
    { id: 'c1', kind: 'listing', counterpart: { name: 'An', avatarUrl: null }, lastMessageText: 'hi', unread: 0, listingTitle: 'Bike', lastOffer: null },
    { id: 'c2', kind: 'listing', counterpart: { name: 'Binh', avatarUrl: null }, lastMessageText: 'yo', unread: 0, listingTitle: 'Desk', lastOffer: null },
  ],
  deleteConvo: vi.fn(),
  refreshConvos: vi.fn(),
  prefetchThread: vi.fn(),
}

vi.mock('next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/messages' }))
vi.mock('next/link', () => ({
  default: ({ href, children, scroll: _scroll, ...rest }: { href: string; children: ReactNode; scroll?: boolean }) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1' }, loading: false }) }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ tr: (en: string) => en, lang: 'en' }) }))
vi.mock('@/context/chat-context', () => ({ useChat: () => chat }))
vi.mock('@/components/marketplace/account-actions', () => ({ SignInPrompt: () => null }))
vi.mock('./mascot', () => ({ Mascot: () => null }))

import { ConversationList } from './conversation-list'

const wrapperOf = (id: string) => document.querySelector(`a[href="/messages/${id}"]`)!.closest('.grid')!

describe('ConversationList delete', () => {
  beforeEach(() => { vi.useFakeTimers(); chat.deleteConvo.mockClear() })
  afterEach(() => { vi.useRealTimers() })

  it('collapses the row first and deletes it after the 150ms exit', () => {
    render(<ConversationList />)
    expect(wrapperOf('c1').className).toContain('grid-rows-[1fr]')

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete conversation' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    const leaving = wrapperOf('c1')
    expect(leaving.className).toContain('grid-rows-[0fr]')
    expect(leaving.className).toContain('opacity-0')
    expect(leaving.className).toContain('pointer-events-none')
    // Unreachable by keyboard while it leaves — a Tab must not land in a thread being deleted.
    expect(leaving.hasAttribute('inert')).toBe(true)
    // The row's own box clips only while it collapses, so focus rings are never cut at rest.
    expect(leaving.firstElementChild!.className).toContain('overflow-hidden')
    expect(wrapperOf('c2').className).toContain('grid-rows-[1fr]')
    expect(wrapperOf('c2').hasAttribute('inert')).toBe(false)
    // The confirm stays up while the row leaves — clearing it first flashed the trash icon back.
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy()
    expect(chat.deleteConvo).not.toHaveBeenCalled()

    // A second confirm during the fade (a repeated Enter) is not a second delete.
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    act(() => { vi.advanceTimersByTime(149) })
    expect(chat.deleteConvo).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(chat.deleteConvo).toHaveBeenCalledExactlyOnceWith('c1')
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    act(() => { vi.advanceTimersByTime(500) })
    expect(chat.deleteConvo).toHaveBeenCalledTimes(1)
  })

  it('a row track can shrink below its content, so a long preview still truncates', () => {
    render(<ConversationList />)
    // A bare `grid` sizes its one `auto` column to the row's min-content (the full one-line preview).
    expect(wrapperOf('c1').className).toContain('grid-cols-[minmax(0,1fr)]')
  })
})
