// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { aiConsentKey, forgetAiConsentMemory, registerAiConsentAsker, setAiConsentAccount } from '@/lib/ai-consent'

// ── App Store gate `app-ai-notice`: eno AI asks before Google sees anything typed; "Not now" keeps a keyword assistant ────
// The assertion is on fetch — what /api/ai/concierge receives, and when.

const toastMock = vi.fn()
vi.mock('sonner', () => ({ toast: (...a: unknown[]) => toastMock(...a) }))
const ME = '11111111-1111-4111-8111-111111111111'
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: { id: ME }, loading: false, openSignIn: vi.fn() }) }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/messages/ai',
  useSearchParams: () => new URLSearchParams(),
}))

import AiThreadPage from './page'
import { AiConsentHost } from '@/components/marketplace/ai-consent-host'

const IOS_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'
const QUESTION = 'a road bike under 8M near Thao Dien'

let store: Map<string, string>
let fetchMock: ReturnType<typeof vi.fn>
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
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ reply: 'Here you go', listings: [] }) }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  // jsdom has no layout: the page pins its message list with scrollTo.
  if (!HTMLElement.prototype.scrollTo) HTMLElement.prototype.scrollTo = () => {}
  toastMock.mockClear()
  forgetAiConsentMemory()
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  setAiConsentAccount(null)
  registerAiConsentAsker(null)
})

const conciergeCalls = () => fetchMock.mock.calls.filter(([url]) => String(url) === '/api/ai/concierge')
const sentBody = (i = 0) => JSON.parse(String((conciergeCalls()[i][1] as RequestInit).body)) as { messages: unknown[]; lang: string; ai?: unknown }

async function mountAndAsk(ua: string, gates: string) {
  vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', gates)
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
  render(<LanguageProvider><AiThreadPage /><AiConsentHost /></LanguageProvider>)
  const box = await screen.findByPlaceholderText('Ask for anything…')
  fireEvent.change(box, { target: { value: QUESTION } })
  await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }) })
}

describe('eno AI — gate OFF: exactly as before', () => {
  it('in the iOS app: sent at once, no question, no `ai` field', async () => {
    await mountAndAsk(IOS_APP, '')
    await waitFor(() => expect(conciergeCalls()).toHaveLength(1))
    expect(sentBody()).not.toHaveProperty('ai')
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull()
  })
})

describe('eno AI — gate ON, in the app', () => {
  it('asks first and sends NOTHING until the answer; Allow ⇒ the usual request', async () => {
    await mountAndAsk(IOS_APP, 'app-ai-notice')
    expect(await screen.findByText('Use Google AI for eno AI?')).toBeTruthy()
    expect(screen.getByText(/to Google \(Gemini\).*Google \(Vertex AI Search\)/)).toBeTruthy()
    expect(conciergeCalls()).toHaveLength(0)
    expect((screen.getByPlaceholderText('Ask for anything…') as HTMLTextAreaElement).value).toBe(QUESTION)
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(conciergeCalls()).toHaveLength(1))
    expect(sentBody()).not.toHaveProperty('ai')
    expect(store.get(aiConsentKey('assistant', ME))).toBe('on')
  })

  it('Not now ⇒ still answered, with `ai: false` (no Google), and the header says so', async () => {
    await mountAndAsk(IOS_APP, 'app-ai-notice')
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(conciergeCalls()).toHaveLength(1))
    expect(sentBody().ai).toBe(false)
    expect(await screen.findByText('Keyword search · Google AI off')).toBeTruthy()
  })

  it('a second Return while the question is open does nothing — "Allow" sends the message ONCE', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IOS_APP)
    render(<LanguageProvider><AiThreadPage /><AiConsentHost /></LanguageProvider>)
    const box = await screen.findByPlaceholderText('Ask for anything…')
    fireEvent.change(box, { target: { value: QUESTION } })
    await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }) })
    await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }) })
    expect(await screen.findAllByRole('button', { name: 'Allow' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(conciergeCalls()).toHaveLength(1))
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(conciergeCalls()).toHaveLength(1)
  })

  it('no answer (Escape) sends NOTHING — not even the keyword-only request — and keeps the text', async () => {
    await mountAndAsk(IOS_APP, 'app-ai-notice')
    await screen.findByRole('button', { name: 'Allow' })
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull())
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(conciergeCalls()).toHaveLength(0)
    expect((screen.getByPlaceholderText('Ask for anything…') as HTMLTextAreaElement).value).toBe(QUESTION)
  })

  it('already "off" ⇒ no question, `ai: false` at once', async () => {
    store.set(aiConsentKey('assistant', ME), 'off')
    await mountAndAsk(IOS_APP, 'app-ai-notice')
    await waitFor(() => expect(conciergeCalls()).toHaveLength(1))
    expect(sentBody().ai).toBe(false)
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull()
  })
})
