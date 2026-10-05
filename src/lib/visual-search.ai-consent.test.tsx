// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { forgetAiConsentMemory, registerAiConsentAsker, setAiConsentAccount, writeAiConsent } from '@/lib/ai-consent'

// ── App Store gate `app-ai-notice`: search by photo sends the photo to Google (Gemini Vision) only after "Allow" ─────────
// All three entrances: runVisualSearch (the chokepoint), the camera button, and pasting an image into a search bar.

const { toastMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), { loading: vi.fn(), error: vi.fn(), dismiss: vi.fn(), success: vi.fn() }),
}))
vi.mock('sonner', () => ({ toast: toastMock }))
vi.mock('./normalize-image', () => ({ compressImageFile: async (f: File) => f }))

import { AI_DECLINED, isAiDeclined, runVisualSearch } from './visual-search'
import { visualSearchFromPaste } from '@/hooks/use-search-box'
import { ImageSearchButton } from '@/components/marketplace/image-search-button'

const IOS_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'
const ME = '11111111-1111-4111-8111-111111111111'

let fetchMock: ReturnType<typeof vi.fn>
let store: Map<string, string>
beforeEach(() => {
  store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
  })
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ query: 'road bike', category: null, brand: null }) }))
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IOS_APP)
  setAiConsentAccount(ME)
  forgetAiConsentMemory()
  toastMock.mockClear(); toastMock.loading.mockClear(); toastMock.error.mockClear(); toastMock.dismiss.mockClear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  setAiConsentAccount(null)
  registerAiConsentAsker(null)
})

const photo = () => new File([new Uint8Array([1, 2, 3])], 'bike.jpg', { type: 'image/jpeg' })
const visualCalls = () => fetchMock.mock.calls.filter(([url]) => String(url) === '/api/ai/visual-search')
const answer = (ok: boolean) => { const asker = vi.fn(async () => (ok ? 'on' as const : 'off' as const)); registerAiConsentAsker(asker); return asker }
/** A notice that stays open until `release` — and, like the real host, stores the answer it is given. */
function openNotice() {
  let release!: (ok: boolean) => void
  const asker = vi.fn((family: 'photo_search', userId: string) => new Promise<'on' | 'off' | null>((resolve) => {
    release = (ok) => { writeAiConsent(family, userId, ok ? 'on' : 'off'); resolve(ok ? 'on' : 'off') }
  }))
  registerAiConsentAsker(asker as never)
  return { asker, release: (ok: boolean) => release(ok) }
}
const pasteEvent = (f: File) => ({
  clipboardData: { items: [{ type: f.type, getAsFile: () => f }] } as unknown as DataTransfer,
  preventDefault: vi.fn(),
})
const tr = (en: string) => en

describe('runVisualSearch', () => {
  it('gate OFF, in the app: sent at once, nobody asked', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    const asker = answer(false)
    const r = await runVisualSearch(photo())
    expect(r).toEqual({ query: 'road bike', category: null, brand: null })
    expect(visualCalls()).toHaveLength(1)
    expect(asker).not.toHaveBeenCalled()
  })
  it('gate ON, in the app: nothing leaves on "Not now" — and nothing leaves with no notice to ask', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    answer(false)
    expect(await runVisualSearch(photo())).toBe(AI_DECLINED)
    registerAiConsentAsker(null)
    expect(isAiDeclined(await runVisualSearch(photo()))).toBe(true)
    expect(visualCalls()).toHaveLength(0)
  })
  it('gate ON, in the app: "Allow" sends it', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    answer(true)
    await runVisualSearch(photo())
    expect(visualCalls()).toHaveLength(1)
  })
})

describe('the camera button', () => {
  const mount = (onStart: () => void, onError: () => void) =>
    render(<LanguageProvider><ImageSearchButton onResult={vi.fn()} onStart={onStart} onError={onError} /></LanguageProvider>)
  const pick = async (container: HTMLElement) => {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await act(async () => { fireEvent.change(input, { target: { files: [photo()] } }) })
  }

  it('gate OFF: starts and sends as before', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    const onStart = vi.fn(); const onError = vi.fn()
    const { container } = mount(onStart, onError)
    await pick(container)
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(visualCalls()).toHaveLength(1)
  })
  it('gate ON, "Not now": no spinner, no onStart, nothing sent, no "try a clearer photo"', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    answer(false)
    const onStart = vi.fn(); const onError = vi.fn()
    const { container } = mount(onStart, onError)
    await pick(container)
    expect(onStart).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(visualCalls()).toHaveLength(0)
  })
})

describe('pasting an image into search', () => {
  it('gate OFF: "Reading your photo…" and the request, as before', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    const onResult = vi.fn()
    await visualSearchFromPaste(pasteEvent(photo()), tr, onResult)
    expect(toastMock.loading).toHaveBeenCalled()
    expect(visualCalls()).toHaveLength(1)
    expect(onResult).toHaveBeenCalled()
  })
  it('gate ON, "Not now": no loading toast, no error toast, nothing sent', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    answer(false)
    await visualSearchFromPaste(pasteEvent(photo()), tr, vi.fn())
    expect(toastMock.loading).not.toHaveBeenCalled()
    expect(toastMock.error).not.toHaveBeenCalled()
    expect(visualCalls()).toHaveLength(0)
  })
  it('gate ON: a second paste while the question is open is ignored — "Allow" sends ONE photo', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    const { asker, release } = openNotice()
    const first = visualSearchFromPaste(pasteEvent(photo()), tr, vi.fn())
    const second = visualSearchFromPaste(pasteEvent(photo()), tr, vi.fn())
    await second
    expect(asker).toHaveBeenCalledTimes(1)
    release(true)
    await first
    expect(visualCalls()).toHaveLength(1)
  })
})

describe('the camera button — one question at a time', () => {
  it('gate ON: a second pick while the question is open is ignored — "Allow" sends ONE photo', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    const { asker, release } = openNotice()
    const { container } = render(<LanguageProvider><ImageSearchButton onResult={vi.fn()} /></LanguageProvider>)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await act(async () => { fireEvent.change(input, { target: { files: [photo()] } }) })
    await act(async () => { fireEvent.change(input, { target: { files: [photo()] } }) })
    expect(asker).toHaveBeenCalledTimes(1)
    await act(async () => { release(true) })
    await waitFor(() => expect(visualCalls()).toHaveLength(1))
  })
})
