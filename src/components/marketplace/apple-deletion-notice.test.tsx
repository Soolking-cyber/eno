// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { APPLE_NOTICE_KEY, AppleDeletionNoticeHost, handOffAppleNotice } from './apple-deletion-notice'

/**
 * The page a deletion lands on shows the Apple notice it was handed (apple-deletion-notice.tsx: why it is handed on
 * rather than held on a live session) — once, in the reader's language — and nothing at all otherwise.
 */
function storage(name: 'sessionStorage' | 'localStorage', entries: Array<[string, string]> = [], works = true): Map<string, string> {
  const map = new Map<string, string>(entries)
  const refuse = () => { throw new DOMException('denied', 'SecurityError') }
  vi.stubGlobal(name, {
    get length() { return map.size },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => { if (!works) refuse(); return map.has(k) ? map.get(k)! : null },
    setItem: (k: string, v: string) => { if (!works) refuse(); map.set(k, String(v)) },
    removeItem: (k: string) => { if (!works) refuse(); map.delete(k) },
    clear: () => { map.clear() },
  })
  return map
}

async function land(lang: 'en' | 'vi' = 'en') {
  storage('localStorage', [['lang', lang]]) // LanguageProvider agrees with `lang` (Node 25's own localStorage has no methods)
  render(<LanguageProvider initialLang={lang} initialViDict={{}}><AppleDeletionNoticeHost /></LanguageProvider>)
  await act(async () => {})
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AppleDeletionNoticeHost', () => {
  it.each([
    ['manual', /eno could not be removed from your Apple Account automatically/],
    ['queued', /We have asked Apple to remove eno/],
  ] as const)('`%s` handed over: the notice shows, linking Apple’s page in a new tab — kept until it is closed', async (notice, text) => {
    const session = storage('sessionStorage', [[APPLE_NOTICE_KEY, notice]])
    await land()
    expect(await screen.findByText('Your account is deleted')).toBeTruthy()
    expect(screen.getByText(text)).toBeTruthy()
    const link = screen.getByRole('link', { name: 'How to stop using Sign in with Apple for an app' })
    expect(link.getAttribute('href')).toBe('https://support.apple.com/en-us/102571')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(session.get(APPLE_NOTICE_KEY)).toBe(notice) // a page that goes before it paints leaves it for the next
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await vi.waitFor(() => expect(screen.queryByText('Your account is deleted')).toBeNull())
    expect(session.has(APPLE_NOTICE_KEY)).toBe(false) // closed: a reload, or the next page, shows nothing
  })

  it('⛔ the app’s `/` that is already leaving for `/vi` shows nothing and leaves the notice for `/vi` (B3)', async () => {
    const session = storage('sessionStorage', [[APPLE_NOTICE_KEY, 'manual']])
    ;(window as Window & { __enoLeaving?: number }).__enoLeaving = 1
    try {
      await land('vi')
      expect(screen.queryByText('Tài khoản của bạn đã được xóa')).toBeNull()
      expect(session.get(APPLE_NOTICE_KEY)).toBe('manual')
    } finally {
      delete (window as Window & { __enoLeaving?: number }).__enoLeaving
    }
    cleanup()
    await land('vi') // …and `/vi` shows it
    expect(await screen.findByText('Tài khoản của bạn đã được xóa')).toBeTruthy()
  })

  it('in Vietnamese: the Vietnamese notice and Apple’s vi-vn page', async () => {
    storage('sessionStorage', [[APPLE_NOTICE_KEY, 'manual']])
    await land('vi')
    expect(await screen.findByText('Tài khoản của bạn đã được xóa')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Cách ngừng dùng Đăng nhập bằng Apple cho một ứng dụng' }).getAttribute('href')).toBe('https://support.apple.com/vi-vn/102571')
  })

  it('nothing handed over, an unknown value, or a tab whose storage refuses: nothing shows, nothing throws', async () => {
    storage('sessionStorage')
    await land()
    expect(screen.queryByText('Your account is deleted')).toBeNull()
    cleanup()
    const session = storage('sessionStorage', [[APPLE_NOTICE_KEY, 'revoked']])
    await land()
    expect(screen.queryByText('Your account is deleted')).toBeNull()
    expect(session.has(APPLE_NOTICE_KEY)).toBe(false)
    cleanup()
    storage('sessionStorage', [], false)
    await land()
    expect(screen.queryByText('Your account is deleted')).toBeNull()
  })
})

describe('handOffAppleNotice', () => {
  it('true when this tab kept it; false when the tab cannot store it (the caller then shows it in place)', () => {
    const session = storage('sessionStorage')
    expect(handOffAppleNotice('manual')).toBe(true)
    expect(session.get(APPLE_NOTICE_KEY)).toBe('manual')
    storage('sessionStorage', [], false)
    expect(handOffAppleNotice('queued')).toBe(false)
  })
})
