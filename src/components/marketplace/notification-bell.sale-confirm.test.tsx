// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

/**
 * The bell row for 'sale_confirm' — a seller named this person as who bought something (POST
 * /api/listings/[id]/sold). The row's stored title is a bilingual composite (it is written server-side,
 * where tr() cannot run); the bell shows its own translated label instead, and the row opens the THREAD
 * with that seller, where the question is answered (sale-questions.tsx).
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
const auth = vi.hoisted(() => ({ user: { id: 'p-buyer' }, openSignIn: () => {} }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => auth }))
const notifs = vi.hoisted(() => ({
  items: [{
    id: 'n1', type: 'sale_confirm', title: 'Xác nhận đã mua · Confirm your purchase', body: 'Minh Shop: Honda Vision 2021 · 11.200.000 đ',
    actorName: 'Minh Shop', conversationId: 'c1', listingId: 'L1', url: null, read: false, createdAt: new Date().toISOString(),
  }],
  unread: 1, markRead: () => {}, markAllRead: () => {}, remove: () => {}, clearAll: () => {},
}))
vi.mock('@/context/notifications-context', () => ({ useNotifications: () => notifs }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))

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
})

async function open() {
  render(<NotificationBell />)
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Notifications|Thông báo/ })) })
}

describe('the bell row for "did you buy this?"', () => {
  it('reads as a question, names the seller and the item, and opens the thread with that seller', async () => {
    await open()
    expect(screen.getByText('Did you buy this?')).toBeTruthy()
    expect(screen.getByText('Minh Shop: Honda Vision 2021 · 11.200.000 đ')).toBeTruthy()
    expect(screen.getByText('Did you buy this?').closest('a')?.getAttribute('href')).toBe('/messages/c1')
  })

  it('and in Vietnamese', async () => {
    langs.current = 'vi'
    await open()
    expect(screen.getByText('Bạn đã mua món này chưa?')).toBeTruthy()
  })
})
