// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'

/**
 * ⛔ AFTER A DELETION, WHEN APPLE MAY STILL LIST eno, THE PERSON IS TOLD (plan D9 / B9, TN3194). The server answers
 * `{ ok, apple }` (account-erasure.ts AppleEraseStatus). `queued` and `manual`: the notice is HANDED to the next page
 * (sessionStorage — apple-deletion-notice.tsx says why) and the sign-out and the trip home happen at once, as for every
 * deletion; only a tab that cannot store it falls back to showing it here, signing out on the way out of it.
 * `revoked` and `none` sign out and go straight home, as before.
 */

const signOut = vi.fn(async () => ({ error: null }))
vi.mock('@/lib/supabase/browser', () => ({ createSupabaseBrowser: () => ({ auth: { signOut: () => signOut() } }) }))

import { DeleteAccount } from './delete-account'

const realLocation = window.location
let apple: string | undefined
beforeEach(() => {
  signOut.mockClear()
  apple = undefined
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, ...(apple ? { apple } : {}) }) })))
  Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, href: 'http://localhost:3000/dashboard/settings', reload: vi.fn(), assign: vi.fn() } })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
})

/** A stored language choice, so LanguageProvider's mount effect agrees with `lang` instead of reconciling to jsdom's
 *  navigator.language (Node's own global localStorage has no working methods here). */
function storedLang(lang: string): void {
  const map = new Map<string, string>([['lang', lang]])
  vi.stubGlobal('localStorage', {
    get length() { return map.size },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => { map.clear() },
  })
}

/** This tab's sessionStorage: a working one (the hand-off), or one that refuses (the in-place fallback). */
function session(works: boolean): Map<string, string> {
  const map = new Map<string, string>()
  const refuse = () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError') }
  vi.stubGlobal('sessionStorage', {
    get length() { return map.size },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => (works && map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { if (!works) refuse(); map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => { map.clear() },
  })
  return map
}

async function deleteAs(lang: 'en' | 'vi', status?: string) {
  apple = status
  storedLang(lang)
  render(<LanguageProvider initialLang={lang} initialViDict={{}}><DeleteAccount /></LanguageProvider>)
  await act(async () => {})
  fireEvent.click(screen.getByRole('button', { name: lang === 'vi' ? 'Xóa tài khoản của tôi' : 'Delete my account' }))
  fireEvent.change(await screen.findByPlaceholderText('DELETE'), { target: { value: 'DELETE' } })
  fireEvent.click(screen.getByRole('button', { name: lang === 'vi' ? 'Xóa vĩnh viễn' : 'Permanently delete' }))
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}

describe('deleting an account that used Sign in with Apple', () => {
  it.each(['manual', 'queued'] as const)('`%s`: the notice is handed to the next page — signed out and home AT ONCE, nothing left open here', async (status) => {
    const stored = session(true)
    await deleteAs('en', status)
    await vi.waitFor(() => expect(window.location.href).toBe('/'))
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(stored.get('eno:apple-deletion-notice')).toBe(status)
    expect(screen.queryByText('Your account is deleted')).toBeNull()
  })

  it.each(['manual', 'queued'] as const)('`%s`, a tab that cannot store it: the notice shows HERE, linking Apple’s page — sign-out and home only on Done', async (status) => {
    session(false)
    await deleteAs('en', status)
    expect(await screen.findByText('Your account is deleted')).toBeTruthy()
    expect(signOut).not.toHaveBeenCalled()
    expect(screen.getByText(status === 'manual' ? /eno could not be removed from your Apple Account automatically/ : /We have asked Apple to remove eno/)).toBeTruthy()
    const link = screen.getByRole('link', { name: 'How to stop using Sign in with Apple for an app' })
    expect(link.getAttribute('href')).toBe('https://support.apple.com/en-us/102571')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(window.location.href).toBe('http://localhost:3000/dashboard/settings')
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await vi.waitFor(() => expect(window.location.href).toBe('/'))
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('the fallback in Vietnamese: the Vietnamese notice and Apple’s vi-vn page', async () => {
    session(false)
    await deleteAs('vi', 'manual')
    expect(await screen.findByText('Tài khoản của bạn đã được xóa')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Cách ngừng dùng Đăng nhập bằng Apple cho một ứng dụng' }).getAttribute('href')).toBe('https://support.apple.com/vi-vn/102571')
  })

  it.each([['revoked'], ['none'], [undefined]] as const)('`%s`: signs out and goes straight home, as before — nothing handed on', async (status) => {
    const stored = session(true)
    await deleteAs('en', status)
    await vi.waitFor(() => expect(window.location.href).toBe('/'))
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(stored.size).toBe(0)
    expect(screen.queryByText('Your account is deleted')).toBeNull()
  })
})
