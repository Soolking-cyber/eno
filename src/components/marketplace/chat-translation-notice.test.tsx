// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'

// ── App Store gate `app-ai-notice` (plan R8, D14): the one-time chat notice and its Settings row ─────
// The notice names the provider and offers two equal answers; the Settings row exists ONLY in either app
// with the gate on, and writes the same per-account answer the chat hook reads.

const toastMock = vi.fn()
vi.mock('sonner', () => ({ toast: (...a: unknown[]) => toastMock(...a) }))
const ME = '11111111-1111-4111-8111-111111111111'
let authUser: { id: string } | null = { id: ME }
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: authUser, loading: false }) }))

import { ChatTranslationNotice } from './chat-translation-notice'
import { ChatTranslationSetting } from './chat-translation-setting'

const IOS_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'
const ANDROID_APP = 'Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 EnoNativeApp/1'
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

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
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
  authUser = { id: ME }
  toastMock.mockClear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const wrap = (node: React.ReactNode, lang: 'en' | 'vi' = 'en') => (
  <LanguageProvider initialLang={lang} initialViDict={{}}>{node}</LanguageProvider>
)

describe('ChatTranslationNotice', () => {
  it('names Microsoft (Azure AI Translator), says the answer covers every chat and what it does not stop, and offers both answers', () => {
    render(wrap(<ChatTranslationNotice onAnswer={() => {}} />))
    expect(screen.getByText(/To translate your chats, messages are sent to Microsoft \(Azure AI Translator\)/)).toBeTruthy()
    expect(screen.getByText(/Your answer applies to all your chats in this app/)).toBeTruthy()
    expect(screen.getByText(/the other person decides for the messages you send them/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Turn off translation' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'OK' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Chat translation' })).toBeTruthy()
  })

  it('OK answers "on"; Turn off answers "off" and says where to turn it back on', () => {
    const onAnswer = vi.fn()
    render(wrap(<ChatTranslationNotice onAnswer={onAnswer} />))
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(onAnswer).toHaveBeenLastCalledWith('on')
    expect(toastMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Turn off translation' }))
    expect(onAnswer).toHaveBeenLastCalledWith('off')
    expect(String(toastMock.mock.calls[0][0])).toContain('Settings → Preferences')
  })

  it('is bilingual', () => {
    render(wrap(<ChatTranslationNotice onAnswer={() => {}} />, 'vi'))
    expect(screen.getByText(/tin nhắn được gửi đến Microsoft \(Azure AI Translator\)/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Tắt dịch tin nhắn' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Đồng ý' })).toBeTruthy()
  })
})

describe('ChatTranslationSetting', () => {
  const as = (ua: string) => vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
  const mountRow = async () => {
    const r = render(wrap(<ChatTranslationSetting />))
    await act(async () => {}) // useMounted
    return r
  }
  const sw = () => screen.queryByRole('switch', { name: 'Translate chat messages' })

  it.each([['iOS app', IOS_APP], ['Android app', ANDROID_APP], ['web', DESKTOP]])('gate OFF: renders nothing in the %s', async (_, ua) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    as(ua)
    const { container } = await mountRow()
    expect(container.innerHTML).toBe('')
  })

  it('gate ON: still nothing on the web', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    as(DESKTOP)
    const { container } = await mountRow()
    expect(container.innerHTML).toBe('')
  })

  it('gate ON: nothing for a signed-out viewer', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    as(IOS_APP)
    authUser = null
    const { container } = await mountRow()
    expect(container.innerHTML).toBe('')
  })

  it.each([['iOS app', IOS_APP], ['Android app', ANDROID_APP]])('gate ON in the %s: OFF until permission is given, and the switch writes the answer the chat reads', async (_, ua) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    as(ua)
    await mountRow()
    expect(sw()).toBeTruthy()
    // Not asked yet ⇒ no permission ⇒ OFF, with a line saying the chat will ask.
    expect(sw()!.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText(/a chat will ask you the first time/)).toBeTruthy()
    expect(screen.getByText(/sent to Microsoft \(Azure AI Translator\)/)).toBeTruthy()
    fireEvent.click(sw()!)
    expect(store.get(`chat-tr:consent:${ME}`)).toBe('on')
    expect(sw()!.getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByText(/a chat will ask you the first time/)).toBeNull()
    fireEvent.click(sw()!)
    expect(store.get(`chat-tr:consent:${ME}`)).toBe('off')
    expect(sw()!.getAttribute('aria-checked')).toBe('false')
  })

  it('gate ON in the app: shows a stored "off" as off', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    as(IOS_APP)
    store.set(`chat-tr:consent:${ME}`, 'off')
    await mountRow()
    expect(sw()!.getAttribute('aria-checked')).toBe('false')
  })
})
