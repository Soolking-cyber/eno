// @vitest-environment jsdom
/**
 * App Store gate `app-ai-notice` — the `trip` family (src/lib/ai-consent.ts): in the apps, a stay suggestion sends this
 * trip and the reasons typed to Google (Gemini) only after "Allow", and the question carries the trip family's own words
 * (trip-ai-consent.tsx — aliased away on eno.vn). Gate off ⇒ sent at once. The stop dialog, "Build my plan" and the
 * trip chat's concierge take the same two lines; the edition-stubs parity test pins the stub those shared files get.
 */
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { registerAiConsentAsker, setAiConsentAccount, type AiConsentCopy } from '@/lib/ai-consent'

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en, t: (k: string) => k, setLang: () => {} }),
  useTr: (s: string) => s,
  Tr: ({ text }: { text?: string | null }) => <>{text}</>,
}))
vi.mock('@/context/currency-context', () => ({
  useDualMoney: () => (n: number) => ({ main: String(n), alt: null }),
  useCurrency: () => ({ currency: 'VND', rates: null, ratesPending: false, format: (n: number) => String(n) }),
}))

import { StayRefineDialog } from './stay-refine-dialog'
import { StopRefineDialog } from './stop-refine-dialog'

const IOS_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'
const ME = '11111111-1111-4111-8111-111111111111'

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
  })
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ suggestions: [], remaining: 4 }) }))
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IOS_APP)
  setAiConsentAccount(ME)
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  setAiConsentAccount(null)
  registerAiConsentAsker(null)
})

const suggestCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/stays/suggest'))
const stopSuggestCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/stops/suggest'))
const mountStop = () =>
  render(<StopRefineDialog itineraryId="it1" target={{ dayId: 'd1', stopId: 'st1', name: 'Ben Thanh Market', place: 'District 1' }} onClose={vi.fn()} onRemove={vi.fn()} onApply={vi.fn()} />)
async function askForOtherPlaces() {
  render(<StayRefineDialog itineraryId="it1" target={{ stayId: 's1', name: 'Riverside Hotel', area: 'District 1' }} onClose={vi.fn()} onApply={vi.fn()} />)
  const button = await screen.findByRole('button', { name: /Suggest other places/ })
  await act(async () => { fireEvent.click(button) })
}

describe('trip stay suggestions and the Google AI question', () => {
  it('gate OFF, in the app: sent at once', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    const asker = vi.fn(async () => 'off' as const)
    registerAiConsentAsker(asker)
    await askForOtherPlaces()
    await waitFor(() => expect(suggestCalls()).toHaveLength(1))
    expect(asker).not.toHaveBeenCalled()
  })

  it('gate ON, in the app, "Not now": nothing sent — and the question carried the trip family\'s own words', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    const asker = vi.fn(async (_f: string, _u: string, _c?: AiConsentCopy) => 'off' as const)
    registerAiConsentAsker(asker)
    await askForOtherPlaces()
    await waitFor(() => expect(asker).toHaveBeenCalledTimes(1))
    const [family, userId, copy] = asker.mock.calls[0]
    expect([family, userId]).toEqual(['trip', ME])
    expect(copy?.title).toBe('Use Google AI to plan your trip?')
    expect(copy?.body).toMatch(/sent to Google \(Gemini\)/)
    expect(suggestCalls()).toHaveLength(0)
  })

  it('gate ON, in the app, "Allow": sent', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    registerAiConsentAsker(vi.fn(async () => 'on' as const))
    await askForOtherPlaces()
    await waitFor(() => expect(suggestCalls()).toHaveLength(1))
  })

  it('gate ON: a second tap while the question is open does nothing — "Allow" sends ONE request', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    let answer!: (ok: boolean) => void
    const asker = vi.fn(() => new Promise<'on' | 'off' | null>((resolve) => { answer = (ok) => resolve(ok ? 'on' : 'off') }))
    registerAiConsentAsker(asker)
    render(<StayRefineDialog itineraryId="it1" target={{ stayId: 's1', name: 'Riverside Hotel', area: 'District 1' }} onClose={vi.fn()} onApply={vi.fn()} />)
    const button = await screen.findByRole('button', { name: /Suggest other places/ })
    await act(async () => { fireEvent.click(button) })
    await act(async () => { fireEvent.click(button) })
    expect(asker).toHaveBeenCalledTimes(1)
    await act(async () => { answer(true) })
    await waitFor(() => expect(suggestCalls()).toHaveLength(1))
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(suggestCalls()).toHaveLength(1)
  })
})

describe('a stay dialog that moves on while the question is open', () => {
  it('"Allow" afterwards sends nothing for the old place, and the new place\'s button is not left busy', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    let answer!: (ok: boolean) => void
    registerAiConsentAsker(vi.fn(() => new Promise<'on' | 'off' | null>((resolve) => { answer = (ok) => resolve(ok ? 'on' : 'off') })))
    const props = { itineraryId: 'it1', onClose: vi.fn(), onApply: vi.fn() }
    const view = render(<StayRefineDialog {...props} target={{ stayId: 's1', name: 'Riverside Hotel', area: 'District 1' }} />)
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Suggest other places/ })) })
    view.rerender(<StayRefineDialog {...props} target={{ stayId: 's2', name: 'Old Quarter Inn', area: 'Hoan Kiem' }} />)
    await act(async () => { answer(true) })
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(suggestCalls()).toHaveLength(0)
    expect((screen.getByRole('button', { name: /Suggest other places/ }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('a stay dialog CLOSED while the question is open', () => {
  it('"Allow" afterwards sends nothing', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    let answer!: (ok: boolean) => void
    registerAiConsentAsker(vi.fn(() => new Promise<'on' | 'off' | null>((resolve) => { answer = (ok) => resolve(ok ? 'on' : 'off') })))
    const props = { itineraryId: 'it1', onClose: vi.fn(), onApply: vi.fn() }
    const view = render(<StayRefineDialog {...props} target={{ stayId: 's1', name: 'Riverside Hotel', area: 'District 1' }} />)
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Suggest other places/ })) })
    view.rerender(<StayRefineDialog {...props} target={null} />)
    await act(async () => { answer(true) })
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(suggestCalls()).toHaveLength(0)
  })
})

describe('trip stop suggestions and the Google AI question', () => {
  it('gate OFF, in the app: sent at once', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    const asker = vi.fn(async () => 'off' as const)
    registerAiConsentAsker(asker)
    mountStop()
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Suggest replacements/ })) })
    await waitFor(() => expect(stopSuggestCalls()).toHaveLength(1))
    expect(asker).not.toHaveBeenCalled()
  })

  it('gate ON, in the app: "Not now" sends nothing and frees the button; a double tap asks once; "Allow" sends once', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    registerAiConsentAsker(vi.fn(async () => 'off' as const))
    mountStop()
    const button = await screen.findByRole('button', { name: /Suggest replacements/ })
    await act(async () => { fireEvent.click(button) })
    expect(stopSuggestCalls()).toHaveLength(0)
    await waitFor(() => expect((screen.getByRole('button', { name: /Suggest replacements/ }) as HTMLButtonElement).disabled).toBe(false))

    let answer!: (ok: boolean) => void
    const asker = vi.fn((_f: string, _u: string, _c?: AiConsentCopy) => new Promise<'on' | 'off' | null>((resolve) => { answer = (ok) => resolve(ok ? 'on' : 'off') }))
    registerAiConsentAsker(asker)
    await act(async () => { fireEvent.click(button) })
    await act(async () => { fireEvent.click(button) })
    expect(asker).toHaveBeenCalledTimes(1)
    expect(asker.mock.calls[0][2]?.title).toBe('Use Google AI to plan your trip?')
    await act(async () => { answer(true) })
    await waitFor(() => expect(stopSuggestCalls()).toHaveLength(1))
  })
})
