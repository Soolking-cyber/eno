// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

/**
 * The bell row for 'trustpilot_invite' (src/lib/trustpilot-invite.ts) — the one ask per account. Its stored title is a
 * bilingual composite; the bell shows its own translated label. The row leaves eno: a new tab with no referrer on the
 * web, and in the iOS/Android shell the in-app browser — handleExternalClick, which no-ops on the web.
 *
 * ⚠️ EXPLICIT `cleanup` — no vitest globals, so Testing Library registers no afterEach of its own.
 */

const langs = vi.hoisted(() => ({
  en: { lang: 'en', tr: (en: string) => en, t: (k: string) => k, setLang: () => {} },
  vi: { lang: 'vi', tr: (_en: string, vi: string) => vi, t: (k: string) => k, setLang: () => {} },
  current: 'en' as 'en' | 'vi',
}))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => langs[langs.current],
  useTr: () => langs[langs.current].tr,
  Tr: ({ text }: { text?: string | null }) => <>{text}</>,
}))
const auth = vi.hoisted(() => ({ user: { id: 'p1' }, openSignIn: () => {} }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => auth }))
const notifs = vi.hoisted(() => ({
  items: [{
    id: 'trustpilot-bell-p1', type: 'trustpilot_invite', title: 'Đánh giá eno trên Trustpilot? · Review eno on Trustpilot?', body: null,
    actorName: null, conversationId: null, listingId: null, url: 'https://www.trustpilot.com/evaluate/eno.vn', read: false,
    createdAt: new Date().toISOString(),
  }],
  unread: 1, markRead: vi.fn(), markAllRead: () => {}, remove: () => {}, clearAll: () => {},
}))
vi.mock('@/context/notifications-context', () => ({ useNotifications: () => notifs }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
const external = vi.hoisted(() => ({ handleExternalClick: vi.fn() }))
vi.mock('@/lib/native-browser', () => external)

import { NotificationBell } from './notification-bell'

beforeAll(() => {
  Element.prototype.getAnimations ??= () => []
  if (!('ResizeObserver' in globalThis)) {
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
  }
})
afterEach(() => {
  cleanup()
  langs.current = 'en'
  external.handleExternalClick.mockReset()
  notifs.markRead.mockReset()
})

async function open() {
  render(<NotificationBell />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Notifications|Thông báo/ })) })
}

describe('the bell row for the Trustpilot invite', () => {
  it('asks in English and opens Trustpilot in a new tab with no referrer', async () => {
    await open()
    const a = screen.getByText('Review eno on Trustpilot?').closest('a')!
    expect(a.getAttribute('href')).toBe('https://www.trustpilot.com/evaluate/eno.vn')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('and in Vietnamese', async () => {
    langs.current = 'vi'
    await open()
    expect(screen.getByText('Đánh giá eno trên Trustpilot?')).toBeTruthy()
  })

  it('a tap marks it read and hands the click to handleExternalClick (the in-app browser in the native shell)', async () => {
    await open()
    fireEvent.click(screen.getByText('Review eno on Trustpilot?').closest('a')!)
    expect(notifs.markRead).toHaveBeenCalledWith('trustpilot-bell-p1')
    expect(external.handleExternalClick).toHaveBeenCalledTimes(1)
  })
})
