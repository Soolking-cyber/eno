// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'

// ── Sweep 2026-10-22: eno AI's greeting was STORED as text in the language of the first visit, so a reader who
// switched language found an English bubble on a Vietnamese page (and the reverse). It is stored as a mark now and
// worded at render; a chat stored before the mark is recognised by its exact greeting. ─────────────────────────────
vi.mock('sonner', () => ({ toast: vi.fn() }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, loading: false, openSignIn: vi.fn() }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/messages/ai',
  useSearchParams: () => new URLSearchParams(),
}))

import AiThreadPage from './page'

const EN = "Hi! I'm eno AI. Tell me what you're looking for — e.g. “a road bike under 8M near Thảo Điền” — and I'll find it."
const VI = 'Chào bạn! Mình là eno AI. Bạn đang tìm gì? Ví dụ "xe đạp dưới 8 triệu gần Thảo Điền" — mình sẽ tìm giúp.'
let store: Map<string, string>
beforeEach(() => {
  store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  })
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  if (!HTMLElement.prototype.scrollTo) HTMLElement.prototype.scrollTo = () => {}
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['vi-VN'])
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const renderIn = (lang: 'en' | 'vi') => render(<LanguageProvider initialLang={lang} initialViDict={{}}><AiThreadPage /></LanguageProvider>)

describe('eno AI greeting — in the language of the page, not of the first visit', () => {
  it('a chat begun in English greets in Vietnamese on a Vietnamese page', async () => {
    renderIn('en')
    await screen.findByText(EN)
    expect(JSON.parse(store.get('eno:ai_chat_v1')!)[0]).toMatchObject({ greeting: true, content: '' })
    cleanup()
    renderIn('vi')
    expect(await screen.findByText(VI)).toBeTruthy()
    expect(screen.queryByText(EN)).toBeNull()
  })

  it('a chat stored before the mark (the greeting as English text) is recognised and worded for the page', async () => {
    store.set('eno:ai_chat_v1', JSON.stringify([{ role: 'assistant', content: EN, createdAt: '2026-10-01T00:00:00.000Z' }, { role: 'user', content: 'a bike', createdAt: '2026-10-01T00:01:00.000Z' }]))
    renderIn('vi')
    expect(await screen.findByText(VI)).toBeTruthy()
    expect(screen.getByText('a bike')).toBeTruthy()
  })
})
