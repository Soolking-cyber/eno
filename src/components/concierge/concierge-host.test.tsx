// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE HOST IS THE ONE PLACE THE APPS' "YES" IS ENFORCED (owner, 2026-10-29: the guide in the apps; commit review round 5).
 * In an app built for the guide the window is open only while the person's answer to the voice guide's notice is "yes":
 * checked at every open — the ✨'s event, an open carried from the messenger — and on every change after (withdrawn,
 * the page hidden). The website keeps its tap-to-start.
 */
vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
const ME = 'p-me'
const nav = vi.hoisted(() => ({ path: '/' }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: { id: 'p-me' }, loading: false, openSignIn: () => {} }) }))
vi.mock('next/navigation', () => ({ usePathname: () => nav.path, useRouter: () => ({ push: () => {} }) }))

const { LanguageProvider } = await import('@/context/language-context')
const { ConciergeHost } = await import('./concierge-host')
const { askForHelp, openConcierge, setConciergeAvailable } = await import('@/lib/concierge/client')
const { forgetAiConsentMemory, registerAiConsentAsker, setAiConsentAccount, writeAiConsent } = await import('@/lib/ai-consent')

const BROWSER = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
const VOICE_APP = `${BROWSER} EnoNativeApp/1 EnoVoice/1`
const windowOpen = () => !!document.querySelector('iframe[data-concierge-window]')

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
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ open: true }) })))
  forgetAiConsentMemory()
  nav.path = '/'
  window.history.pushState({}, '', '/')
})
afterEach(() => {
  cleanup()
  registerAiConsentAsker(null)
  setAiConsentAccount(null)
  setConciergeAvailable(false)
  vi.restoreAllMocks()
})
const ua = (s: string) => vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(s)
const mount = () => render(<LanguageProvider><ConciergeHost /></LanguageProvider>)

describe('in an app built for the guide', () => {
  it('no "yes" on this device: an open asked for any way but the notice never opens the window', async () => {
    ua(VOICE_APP)
    mount()
    await act(async () => { openConcierge() })
    expect(windowOpen()).toBe(false)
  })

  it('with the "yes": it opens — and closes the moment the answer is taken back', async () => {
    ua(VOICE_APP)
    writeAiConsent('voice_guide', ME, 'on')
    mount()
    await act(async () => { openConcierge() })
    expect(windowOpen()).toBe(true)
    await act(async () => { writeAiConsent('voice_guide', ME, 'off') })
    expect(windowOpen()).toBe(false)
  })

  it('the page going hidden (the app to the background) closes it', async () => {
    ua(VOICE_APP)
    writeAiConsent('voice_guide', ME, 'on')
    mount()
    await act(async () => { openConcierge() })
    expect(windowOpen()).toBe(true)
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(windowOpen()).toBe(false)
    hidden.mockRestore()
  })

  it('an open carried from the messenger, the answer taken back on the way: the window stays shut', async () => {
    ua(VOICE_APP)
    writeAiConsent('voice_guide', ME, 'on')
    setConciergeAvailable(true)
    nav.path = '/messages'
    window.history.pushState({}, '', '/messages')
    registerAiConsentAsker(async () => 'on') // the notice host, mounted in the app (AiConsentHost), which also mirrors the account
    setAiConsentAccount(ME)
    const view = mount()
    const go = { push: vi.fn((to: string) => { nav.path = new URL(to, 'https://eno.vn').pathname; window.history.pushState({}, '', to) }) }
    await act(async () => { await askForHelp(go, 'en') })
    expect(go.push).toHaveBeenCalledWith('/')
    await act(async () => { writeAiConsent('voice_guide', ME, 'off') })
    await act(async () => { view.rerender(<LanguageProvider><ConciergeHost /></LanguageProvider>) })
    expect(windowOpen()).toBe(false)
  })
})

describe('the website — no notice, as before', () => {
  it('a browser: the ✨ opens the window with no "yes" asked or stored', async () => {
    ua(BROWSER)
    mount()
    await act(async () => { openConcierge() })
    expect(windowOpen()).toBe(true)
  })
})
