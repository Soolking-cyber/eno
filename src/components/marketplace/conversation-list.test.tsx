// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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

// No vitest globals → Testing Library registers no cleanup of its own; every test starts from an empty DOM.
afterEach(cleanup)

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

describe('ConversationList rows (inbox-02)', () => {
  const withRow = (over: Record<string, unknown>) => {
    const before = chat.convos
    chat.convos = [{ ...before[0], ...over } as never, before[1]]
    return () => { chat.convos = before }
  }

  it('right-aligns the time beside the unread badge, as a <time> the screen reader can read', () => {
    const restore = withRow({ lastMessageAt: new Date(Date.now() - 3 * 3600_000).toISOString(), unread: 2 })
    try {
      render(<ConversationList />)
      const time = document.querySelector('a[href="/messages/c1"] time')!
      expect(time.textContent).toBe('3h ago')
      expect(time.className).toContain('tabular-nums')
      // Time first, then the count, in one right-hand cluster.
      expect(time.nextElementSibling?.textContent).toBe('2')
    } finally { restore() }
  })

  it('paints the counterpart\'s own avatar colour', () => {
    const restore = withRow({ counterpart: { name: 'An', avatarUrl: null, avatarColor: '#123456' } })
    try {
      render(<ConversationList />)
      const link = document.querySelector('a[href="/messages/c1"]')!
      expect(link.innerHTML.toLowerCase()).toMatch(/#123456|rgb\(18, 52, 86\)/)
    } finally { restore() }
  })

  it('shows the listing thumbnail at the trailing edge, decorative', () => {
    const restore = withRow({ listingImage: 'https://picsum.photos/200' })
    try {
      render(<ConversationList />)
      const link = document.querySelector('a[href="/messages/c1"]')!
      const img = link.querySelector('img')!
      expect(img.getAttribute('alt')).toBe('')
      expect(link.lastElementChild).toBe(img)
    } finally { restore() }
  })

  it('touch gets a row overflow; the bare trash can is for a hovering mouse only', () => {
    render(<ConversationList />)
    const more = screen.getAllByRole('button', { name: 'More actions' })[0]
    expect(more.className).toContain('hover-pointer:hidden')
    const trash = screen.getAllByRole('button', { name: 'Delete conversation' })[0]
    expect(trash.className).toMatch(/(^|\s)hidden(\s|$)/)
    expect(trash.className).toContain('hover-pointer:flex')
  })
})

describe('ConversationList header (inbox-01)', () => {
  it('the phone gets a visible "Messages" title — and conversation search behind a button, not a second permanent box', () => {
    render(<ConversationList />)
    const h1 = screen.getByRole('heading', { name: 'Messages' })
    expect(h1.className).not.toContain('sr-only')
    const field = screen.getByRole('textbox', { name: 'Search messages' }) as HTMLInputElement
    const box = field.closest('div.relative')!
    // Folded away on a phone until asked for; desktop keeps the always-on field (the button is lg:hidden).
    expect(box.className).toContain('max-lg:hidden')
    const btn = screen.getByRole('button', { name: 'Search messages' })
    expect(btn.className).toContain('lg:hidden')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(btn.getAttribute('aria-controls')).toBe(field.id)
  })

  it('the button reveals the field AND focuses it in the same tap; typing filters; Esc clears and folds it away', () => {
    render(<ConversationList />)
    const field = screen.getByRole('textbox', { name: 'Search messages' }) as HTMLInputElement
    const box = field.closest('div.relative')!
    const btn = screen.getByRole('button', { name: 'Search messages' })
    fireEvent.click(btn)
    expect(box.className).not.toContain('max-lg:hidden')
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(field)
    fireEvent.change(field, { target: { value: 'zzz-no-such-conversation' } })
    expect(document.querySelector('a[href="/messages/c1"]')).toBeNull()
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(box.className).toContain('max-lg:hidden')
    expect(field.value).toBe('')
    expect(document.querySelector('a[href="/messages/c1"]')).not.toBeNull()
  })

  it('✕ clears the query and folds the field back', () => {
    render(<ConversationList />)
    const field = screen.getByRole('textbox', { name: 'Search messages' }) as HTMLInputElement
    fireEvent.click(screen.getByRole('button', { name: 'Search messages' }))
    fireEvent.change(field, { target: { value: 'An' } })
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(field.value).toBe('')
    expect(field.closest('div.relative')!.className).toContain('max-lg:hidden')
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
  })
})
