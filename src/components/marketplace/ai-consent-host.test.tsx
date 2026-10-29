// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { LanguageProvider } from '@/context/language-context'
import { aiConsentKey, askAiConsent, askAiConsentAnswer, forgetAiConsentMemory, setAiConsentAccount, registerAiConsentAsker, type AiConsent, type AiConsentCopy } from '@/lib/ai-consent'

// ── App Store gate `app-ai-notice`, the Google half: the one-time notice, its Settings switches, and gate off ─────────

const toastMock = vi.fn()
vi.mock('sonner', () => ({ toast: (...a: unknown[]) => toastMock(...a) }))
// A button-less message is the subtle pill (src/lib/subtle-toast.ts — owner, 2026-09-21), not the solid card.
const SUBTLE_PILL = expect.objectContaining({ className: expect.stringContaining('material') })
const ME = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
let authUser: { id: string } | null = { id: ME }
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: authUser, loading: false, openSignIn: vi.fn() }) }))
let pathname = '/post'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))

import { AiConsentHost } from './ai-consent-host'
import { AiFeaturesSetting } from './ai-features-setting'
import { setConciergeAvailable } from '@/lib/concierge/client'

const IOS_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'
const ANDROID_APP = 'Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 EnoNativeApp/1'
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const TRIP_COPY: AiConsentCopy = { title: 'Trip question', body: 'Trip body naming Google (Gemini)', declined: 'Trip declined', off: 'Trip off' }

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
  pathname = '/post'
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
const inApp = (ua = IOS_APP) => {
  vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
}
const mountHost = () => render(<LanguageProvider><AiConsentHost /></LanguageProvider>)

describe('the notice', () => {
  it('asks once, names Google and what is sent, offers two equal answers; Allow lets the request go', async () => {
    inApp()
    mountHost()
    let answer: boolean | undefined
    await act(async () => { void askAiConsent('photo_search', { userId: ME }).then((a) => { answer = a }) })
    expect(await screen.findByText('Use Google AI to search by photo?')).toBeTruthy()
    expect(screen.getByText(/sends the photo you choose to Google \(Gemini\)/)).toBeTruthy()
    expect(screen.getByText(/Settings → Preferences/)).toBeTruthy()
    const notNow = screen.getByRole('button', { name: 'Not now' })
    const allow = screen.getByRole('button', { name: 'Allow' })
    expect(notNow.className).toBe(allow.className) // equal weight — not a primary "Allow" beside a ghost "Not now"
    expect(answer).toBeUndefined() // nothing may be sent while the question is open
    fireEvent.click(allow)
    await waitFor(() => expect(answer).toBe(true))
    expect(store.get(aiConsentKey('photo_search', ME))).toBe('on')
    await waitFor(() => expect(screen.queryByText('Use Google AI to search by photo?')).toBeNull())
    // Asked once: the next request goes straight through.
    expect(await askAiConsent('photo_search', { userId: ME })).toBe(true)
  })

  it('Not now: no, remembered, and says what is left', async () => {
    inApp(ANDROID_APP)
    mountHost()
    let answer: boolean | undefined
    await act(async () => { void askAiConsent('listing', { userId: ME }).then((a) => { answer = a }) })
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(answer).toBe(false))
    expect(store.get(aiConsentKey('listing', ME))).toBe('off')
    expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('Fill in the details yourself'), SUBTLE_PILL)
    // Remembered: the next tap asks nothing — it says the feature is off.
    toastMock.mockClear()
    expect(await askAiConsent('listing', { userId: ME })).toBe(false)
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull()
    expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('AI help is off'), SUBTLE_PILL)
  })

  it('teacher_bio ("Improve with AI" under About you): names Google (Gemini), what goes, and what never does', async () => {
    inApp()
    mountHost()
    let answer: boolean | undefined
    await act(async () => { void askAiConsent('teacher_bio', { userId: ME }).then((a) => { answer = a }) })
    expect(await screen.findByText('Use Google AI to improve your About text?')).toBeTruthy()
    expect(screen.getByText(/sends your About text, in your own words .* to Google \(Gemini\) on Google Cloud, outside Vietnam, to rewrite it — with your answers in the teacher profile form\. Those are your subjects, .* would move to\./)).toBeTruthy()
    // Exact, never an absolute "your name is never sent": a name written in the About text goes with it (gate review, 2026-10-22).
    expect(screen.getByText(/Your profile’s name and phone number fields, photo, video and CV are never sent/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(answer).toBe(false))
    expect(store.get(aiConsentKey('teacher_bio', ME))).toBe('off')
    expect(toastMock).toHaveBeenCalledWith(expect.stringContaining('Write it yourself'), SUBTLE_PILL)
  })

  it('the assistant works without AI, so its "off" is silent', async () => {
    inApp()
    store.set(aiConsentKey('assistant', ME), 'off')
    mountHost()
    expect(await askAiConsent('assistant', { userId: ME })).toBe(false)
    expect(toastMock).not.toHaveBeenCalled()
  })

  it('Escape is not an answer: no, nothing stored, asked again next time', async () => {
    inApp()
    mountHost()
    let answer: boolean | undefined
    await act(async () => { void askAiConsent('assistant', { userId: ME }).then((a) => { answer = a }) })
    await screen.findByRole('button', { name: 'Allow' })
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() => expect(answer).toBe(false))
    expect(store.has(aiConsentKey('assistant', ME))).toBe(false)
    expect(toastMock).not.toHaveBeenCalled()
  })

  it('two requests while it is open share one question and one answer', async () => {
    inApp()
    mountHost()
    const answers: boolean[] = []
    await act(async () => {
      void askAiConsent('listing', { userId: ME }).then((a) => answers.push(a))
      void askAiConsent('listing', { userId: ME }).then((a) => answers.push(a))
    })
    expect(await screen.findAllByRole('button', { name: 'Allow' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(answers).toEqual([true, true]))
  })

  it('trip: shows the words its call site passes; with none (eno.vn\'s stub) it refuses without asking', async () => {
    inApp()
    mountHost()
    expect(await askAiConsent('trip', { userId: ME })).toBe(false)
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull()
    let answer: boolean | undefined
    await act(async () => { void askAiConsent('trip', { userId: ME, copy: TRIP_COPY }).then((a) => { answer = a }) })
    expect(await screen.findByText('Trip question')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(answer).toBe(false))
    expect(toastMock).toHaveBeenCalledWith('Trip declined', SUBTLE_PILL)
  })

  it('BLOCKED storage: "Allow" holds for the page — the next request (the visual-search chokepoint) asks nothing', async () => {
    const blocked = () => { throw new Error('blocked') }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked, clear: blocked, key: () => null, length: 0 })
    inApp()
    mountHost()
    let answer: boolean | undefined
    await act(async () => { void askAiConsent('photo_search', { userId: ME }).then((a) => { answer = a }) })
    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(answer).toBe(true))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull())
    expect(await askAiConsent('photo_search', { userId: ME })).toBe(true)
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull()
  })

  it('an ACCOUNT SWITCH while the question is open voids it: no, nothing stored for either account', async () => {
    inApp()
    const view = mountHost()
    let answer: boolean | undefined
    await act(async () => { void askAiConsent('listing', { userId: ME }).then((a) => { answer = a }) })
    await screen.findByRole('button', { name: 'Allow' })
    authUser = { id: OTHER }
    view.rerender(<LanguageProvider><AiConsentHost /></LanguageProvider>)
    await waitFor(() => expect(answer).toBe(false))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull())
    expect(store.has(aiConsentKey('listing', ME))).toBe(false)
    expect(store.has(aiConsentKey('listing', OTHER))).toBe(false)
    // …and a question asked in the old account's name after the switch is refused without being shown.
    expect(await askAiConsent('listing', { userId: ME })).toBe(false)
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull()
  })

  it('LEAVING THE PAGE while the question is open voids it: no, nothing stored, nothing resumes', async () => {
    inApp()
    const view = mountHost()
    let answer: boolean | undefined
    await act(async () => { void askAiConsent('listing', { userId: ME }).then((a) => { answer = a }) })
    await screen.findByRole('button', { name: 'Allow' })
    pathname = '/messages'
    view.rerender(<LanguageProvider><AiConsentHost /></LanguageProvider>)
    await waitFor(() => expect(answer).toBe(false))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull())
    expect(store.has(aiConsentKey('listing', ME))).toBe(false)
    // On the new page the next request asks afresh.
    let again: boolean | undefined
    await act(async () => { void askAiConsent('listing', { userId: ME }).then((a) => { again = a }) })
    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(again).toBe(true))
  })

  it('a voided question answers NULL, not "Not now" — so the assistant can tell the two apart', async () => {
    inApp()
    const view = mountHost()
    let answer: AiConsent | undefined
    await act(async () => { void askAiConsentAnswer('assistant', { userId: ME }).then((a) => { answer = a }) })
    await screen.findByRole('button', { name: 'Allow' })
    pathname = '/c/vehicles'
    view.rerender(<LanguageProvider><AiConsentHost /></LanguageProvider>)
    await waitFor(() => expect(answer).toBeNull())
  })

  it('a double tap on "Not now" answers once: one store, one toast', async () => {
    inApp()
    mountHost()
    await act(async () => { void askAiConsent('listing', { userId: ME }) })
    const notNow = await screen.findByRole('button', { name: 'Not now' })
    // Both taps inside ONE act: React applies no update between them, so the second sees the same open question —
    // the "before the re-render" case.
    act(() => { notNow.click(); notNow.click() })
    await waitFor(() => expect(store.get(aiConsentKey('listing', ME))).toBe('off'))
    expect(toastMock).toHaveBeenCalledTimes(1)
  })

  it('signing OUT while the question is open voids it too', async () => {
    inApp()
    const view = mountHost()
    let answer: boolean | undefined
    await act(async () => { void askAiConsent('assistant', { userId: ME }).then((a) => { answer = a }) })
    await screen.findByRole('button', { name: 'Allow' })
    authUser = null
    view.rerender(<LanguageProvider><AiConsentHost /></LanguageProvider>)
    await waitFor(() => expect(answer).toBe(false))
    expect(store.has(aiConsentKey('assistant', ME))).toBe(false)
  })

  it('mirrors the signed-in account for call sites without one (visual-search.ts)', async () => {
    inApp()
    mountHost()
    let answer: boolean | undefined
    await act(async () => { void askAiConsent('photo_search').then((a) => { answer = a }) })
    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(answer).toBe(true))
    expect(store.get(aiConsentKey('photo_search', ME))).toBe('on')
  })
})

describe('gate OFF', () => {
  it('the host renders nothing and registers nothing; every ask is yes at once', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IOS_APP)
    const { container } = mountHost()
    expect(container.innerHTML).toBe('')
    store.set(aiConsentKey('listing', ME), 'off')
    expect(await askAiConsent('listing', { userId: ME })).toBe(true)
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull()
  })
})

describe('Settings → Preferences → Google AI', () => {
  const mountSettings = () => render(<LanguageProvider><AiFeaturesSetting /></LanguageProvider>)

  it('BLOCKED storage: the switch still moves, and holds for the page', async () => {
    const blocked = () => { throw new Error('blocked') }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked, clear: blocked, key: () => null, length: 0 })
    inApp()
    mountSettings()
    const search = await screen.findByRole('switch', { name: 'Search by photo' })
    expect(search.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(search)
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Search by photo' }).getAttribute('aria-checked')).toBe('true'))
  })

  it('⛔ an app built for the voice guide (EnoVoice): its switch is there, under "AI features" — its answer the guide\'s own key; every earlier binary sees no such row', async () => {
    inApp(`${ANDROID_APP} EnoVoice/1`)
    setConciergeAvailable(true)
    mountSettings()
    expect(await screen.findByText('AI features')).toBeTruthy()
    const voice = screen.getByRole('switch', { name: 'Voice guide' })
    expect(voice.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(voice)
    await waitFor(() => expect(store.get(aiConsentKey('voice_guide', ME))).toBe('on'))
    expect(aiConsentKey('voice_guide', ME)).toBe(`ai:consent:voice_guide@1:${ME}`)
    cleanup()
    vi.restoreAllMocks()
    inApp(ANDROID_APP)
    mountSettings()
    expect(await screen.findByText('Google AI')).toBeTruthy()
    expect(screen.queryByRole('switch', { name: 'Voice guide' })).toBeNull()
    // …and in an app built for it while the guide is CLOSED to this account (commit review, opus): no consent asked for it…
    cleanup()
    vi.restoreAllMocks()
    inApp(`${ANDROID_APP} EnoVoice/1`)
    setConciergeAvailable(false)
    store.delete(aiConsentKey('voice_guide', ME))
    forgetAiConsentMemory() // the page's own copy of the answer given above, too
    mountSettings()
    expect(await screen.findByText('Google AI')).toBeTruthy()
    expect(screen.queryByRole('switch', { name: 'Voice guide' })).toBeNull()
    // …unless a "yes" of theirs is stored: then the switch is there, to take it back (round 3, codex).
    cleanup()
    store.set(aiConsentKey('voice_guide', ME), 'on')
    mountSettings()
    const back = await screen.findByRole('switch', { name: 'Voice guide' })
    expect(back.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(back)
    await waitFor(() => expect(store.get(aiConsentKey('voice_guide', ME))).toBe('off'))
  })

  it('⛔ the voice guide\'s notice is asked in an app built for it, naming who gets what', async () => {
    inApp(`${IOS_APP} EnoVoice/1`)
    mountHost()
    let answer: unknown
    void askAiConsentAnswer('voice_guide', { userId: ME }).then((a) => { answer = a })
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('Talk to the eno voice guide?')
    for (const named of ['Soniox', 'OpenAI', 'Google (Gemini)', 'eno keeps no recording and no transcript']) expect(dialog.textContent).toContain(named)
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(answer).toBe('on'))
    expect(store.get(aiConsentKey('voice_guide', ME))).toBe('on')
  })

  it('in either app with the gate on: one switch per family, off until permission is given, and the switch IS the answer', async () => {
    inApp()
    mountSettings()
    expect(await screen.findByText('Google AI')).toBeTruthy()
    for (const label of ['eno AI assistant', 'AI help when posting', 'Search by photo', 'Reading your CV', 'Improving your About text', 'Trip planning', 'e-Visa photo check']) {
      expect(screen.getByRole('switch', { name: label })).toBeTruthy()
    }
    expect(screen.getAllByText('Not set yet — you will be asked the first time you use it.')).toHaveLength(7)
    const posting = screen.getByRole('switch', { name: 'AI help when posting' })
    expect(posting.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(posting)
    await waitFor(() => expect(store.get(aiConsentKey('listing', ME))).toBe('on'))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'AI help when posting' }).getAttribute('aria-checked')).toBe('true'))
    expect(screen.getAllByText('Not set yet — you will be asked the first time you use it.')).toHaveLength(6)
    fireEvent.click(screen.getByRole('switch', { name: 'AI help when posting' }))
    await waitFor(() => expect(store.get(aiConsentKey('listing', ME))).toBe('off'))
  })

  it('renders nothing with the gate off, on the web, or signed out', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IOS_APP)
    const off = mountSettings()
    await act(async () => {})
    expect(off.container.innerHTML).toBe('')
    cleanup()
    vi.restoreAllMocks()
    inApp(DESKTOP)
    const web = mountSettings()
    await act(async () => {})
    expect(web.container.innerHTML).toBe('')
    cleanup()
    vi.restoreAllMocks()
    inApp()
    authUser = null
    const out = mountSettings()
    await act(async () => {})
    expect(out.container.innerHTML).toBe('')
  })
})
