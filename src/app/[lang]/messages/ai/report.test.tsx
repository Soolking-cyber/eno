// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'

// ── Google Play, AI-Generated Content: a Report under every line in the AI's place but the greeting (src/lib/ai-report.ts).
// It reports what was on screen and never claims who wrote it: a saved chat cannot tell an answer from eno's own line. ──
vi.mock('sonner', () => ({ toast: vi.fn() }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, loading: false, openSignIn: vi.fn() }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/messages/ai',
  useSearchParams: () => new URLSearchParams(),
}))

import AiThreadPage from './page'

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
  vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ugc-safety')
})
afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const AT = '2026-10-29T10:00:00.000Z'

describe('eno AI chat — Report', () => {
  it("one Report under each line in the AI's place, none under the greeting or the person's own; each files its own line", async () => {
    store.set('eno:ai_chat_v1', JSON.stringify([
      { role: 'assistant', content: '', greeting: true, createdAt: AT },
      { role: 'user', content: 'a road bike', createdAt: AT },
      { role: 'assistant', content: 'Try District 2.', createdAt: AT },
      { role: 'user', content: 'near Thảo Điền?', createdAt: AT },
      { role: 'assistant', content: 'Here are 3 road bikes near Thảo Điền.', createdAt: AT },
      { role: 'user', content: 'cheaper?', createdAt: AT },
      { role: 'assistant', content: 'Network error — please try again.', createdAt: AT },
    ]))
    render(<LanguageProvider initialLang="en" initialViDict={{}}><AiThreadPage /></LanguageProvider>)
    await screen.findByText('Here are 3 road bikes near Thảo Điền.')
    const reports = screen.getAllByRole('button', { name: /^Report$/ })
    expect(reports).toHaveLength(3)
    fireEvent.click(reports[1])
    expect(await screen.findByRole('dialog', { name: 'Report this answer' })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Offensive or harmful' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit report' })) })
    const filed = vi.mocked(fetch).mock.calls.find(([u]) => u === '/api/feedback')
    expect(JSON.parse((filed![1] as RequestInit).body as string).message).toBe('Reported in eno AI chat: offensive\n\nThe answer:\nHere are 3 road bikes near Thảo Điền.')
  })
})
