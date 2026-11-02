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
const nav = vi.hoisted(() => ({ path: '/', push: (() => {}) as (href: string) => void }))
const auth = vi.hoisted(() => ({
  user: { id: 'p-me' } as { id: string } | null,
  loading: false,
  identityLoaded: true,
  accountType: 'individual' as string | null,
  openSignIn: (() => {}) as (ctx?: { onDismiss?: () => void; note?: string }) => void,
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => auth }))
const router = vi.hoisted(() => ({ push: (href: string) => nav.push(href) }))
vi.mock('next/navigation', () => ({ usePathname: () => nav.path, useRouter: () => router }))

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
  nav.push = () => {}
  Object.assign(auth, { user: { id: ME }, loading: false, identityLoaded: true, accountType: 'individual', openSignIn: () => {} })
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

describe('⛔ build 4 / vc4-5 — an app binary without EnoVoice (asked by the app session, 2026-10-29)', () => {
  it('the host decides "unavailable" without asking the server, and every ✨ — the search-bar guide icon, the header, the inbox — opens the text chat', async () => {
    ua(`${BROWSER} EnoNativeApp/1`)
    mount()
    await act(async () => { await new Promise((r) => setTimeout(r, 1_600)) })
    expect(fetch).not.toHaveBeenCalled()
    const go = { push: vi.fn() }
    await act(async () => { await askForHelp(go, 'en') })
    expect(go.push).toHaveBeenCalledWith('/messages/ai')
    expect(windowOpen()).toBe(false)
    // …and an open asked for directly never opens it either.
    await act(async () => { openConcierge() })
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

describe('`?guide=1`: the link that opens the guide', () => {
  const LINK = '/?guide=1&utm_source=fbgroups&utm_campaign=gp5'
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  beforeEach(() => { window.history.pushState({}, '', LINK) })

  it('signed in: the window opens, the link leaves the address, the campaign tags stay', async () => {
    mount()
    await settle()
    expect(windowOpen()).toBe(true)
    expect(window.location.search).toBe('?utm_source=fbgroups&utm_campaign=gp5')
  })

  it('⛔ the address is cleaned WITHOUT Next\'s __NA mark, so its router takes it too; the rest of the state stays', async () => {
    // With the mark, app-router.js skips the sync and the next router.refresh() wrote the link back (measured 2026-11-02).
    window.history.replaceState({ __NA: true, explorerMark: 'kept' }, '', LINK)
    const spy = vi.spyOn(window.history, 'replaceState')
    mount()
    await settle()
    const write = spy.mock.calls.find(([, , url]) => typeof url === 'string' && !url.includes('guide='))
    expect(write?.[0]).toEqual({ explorerMark: 'kept' })
  })

  it('no link: nothing opens by itself', async () => {
    window.history.pushState({}, '', '/?utm_source=fbgroups')
    mount()
    await settle()
    expect(windowOpen()).toBe(false)
  })

  it('signed out: the sign-in asks once and the link stays, because the sign-in returns to this address', async () => {
    auth.user = null
    const openSignIn = vi.fn()
    auth.openSignIn = openSignIn
    const { rerender } = mount()
    rerender(<LanguageProvider><ConciergeHost /></LanguageProvider>)
    await settle()
    expect(openSignIn).toHaveBeenCalledTimes(1)
    expect(window.location.search).toContain('guide=1')
    expect(windowOpen()).toBe(false)
  })

  it('signed out, popup closed: the link is answered, a later sign-in opens nothing', async () => {
    auth.user = null
    auth.openSignIn = (ctx) => ctx?.onDismiss?.()
    mount()
    await settle()
    expect(window.location.search).toBe('?utm_source=fbgroups&utm_campaign=gp5')
    auth.user = { id: ME }
    cleanup()
    mount()
    await settle()
    expect(windowOpen()).toBe(false)
  })

  it('a new account with no type yet: waits and keeps the link for /onboard to bring back', async () => {
    auth.accountType = null
    mount()
    await settle()
    expect(windowOpen()).toBe(false)
    expect(window.location.search).toContain('guide=1')
  })

  it('identity not loaded yet: waits too', async () => {
    auth.identityLoaded = false
    auth.accountType = null
    mount()
    await settle()
    expect(windowOpen()).toBe(false)
    expect(window.location.search).toContain('guide=1')
  })

  it('auth still loading: no sign-in is asked of someone who may already be signed in', async () => {
    auth.user = null
    auth.loading = true
    const openSignIn = vi.fn()
    auth.openSignIn = openSignIn
    mount()
    await settle()
    expect(openSignIn).not.toHaveBeenCalled()
  })

  it('only on the explorer', async () => {
    nav.path = '/listings/x'
    window.history.pushState({}, '', '/listings/x?guide=1')
    mount()
    await settle()
    expect(windowOpen()).toBe(false)
    expect(window.location.search).toBe('?guide=1')
  })

  it('an account the guide is closed to: a link is not a tap, so the explorer stays, never a move to the text chat', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ open: false }) })))
    const push = vi.fn()
    nav.push = push
    mount()
    await settle()
    await settle()
    expect(windowOpen()).toBe(false)
    expect(push).not.toHaveBeenCalled()
    expect(window.location.search).toContain('guide=1')
  })

  it('a slow answer: the link waits and holds nothing, a tap meanwhile still works, and the late answer opens the window', async () => {
    let answer: (v: unknown) => void = () => {}
    vi.stubGlobal('fetch', vi.fn(() => new Promise((r) => { answer = r })))
    const push = vi.fn()
    nav.push = push
    mount()
    await settle()
    expect(windowOpen()).toBe(false)
    expect(window.location.search).toContain('guide=1')
    // The lock is free: the tap's own 2 s wait starts now, and the answer lands inside it.
    const tap = askForHelp({ push }, 'en')
    await settle()
    await act(async () => { answer({ ok: true, json: () => Promise.resolve({ open: true }) }) })
    await act(async () => { await tap })
    await settle()
    expect(windowOpen()).toBe(true)
    expect(window.location.search).toBe('?utm_source=fbgroups&utm_campaign=gp5')
    expect(push).not.toHaveBeenCalled()
  })

  it('signed in, then out again on the same host: a later link still asks, the guard does not stick', async () => {
    auth.user = null
    const openSignIn = vi.fn()
    auth.openSignIn = openSignIn
    const { rerender } = mount()
    await settle()
    expect(openSignIn).toHaveBeenCalledTimes(1)
    auth.user = { id: ME }
    rerender(<LanguageProvider><ConciergeHost /></LanguageProvider>)
    await settle()
    auth.user = null
    window.history.pushState({}, '', LINK)
    rerender(<LanguageProvider><ConciergeHost /></LanguageProvider>)
    await settle()
    expect(openSignIn).toHaveBeenCalledTimes(2)
  })

  it('signing in inside the popup, on the same page (the emailed code): the guide opens with no new document', async () => {
    auth.user = null
    const openSignIn = vi.fn()
    auth.openSignIn = openSignIn
    const { rerender } = mount()
    await settle()
    expect(openSignIn).toHaveBeenCalledTimes(1)
    auth.user = { id: ME }
    rerender(<LanguageProvider><ConciergeHost /></LanguageProvider>)
    await settle()
    expect(windowOpen()).toBe(true)
    expect(window.location.search).toBe('?utm_source=fbgroups&utm_campaign=gp5')
  })

  it('the way back from /onboard: the same host, a new path, and the guide opens', async () => {
    nav.path = '/onboard'
    window.history.pushState({}, '', '/onboard?next=%2F%3Fguide%3D1')
    const { rerender } = mount()
    await settle()
    expect(windowOpen()).toBe(false)
    nav.path = '/'
    window.history.pushState({}, '', LINK)
    rerender(<LanguageProvider><ConciergeHost /></LanguageProvider>)
    await settle()
    expect(windowOpen()).toBe(true)
  })

  it('popup closed, then the link again without a new document: the sign-in asks again, it does not sit dead', async () => {
    auth.user = null
    let dismiss: (() => void) | undefined
    const openSignIn = vi.fn((ctx?: { onDismiss?: () => void }) => { dismiss = ctx?.onDismiss })
    auth.openSignIn = openSignIn
    const { rerender } = mount()
    await settle()
    expect(openSignIn).toHaveBeenCalledTimes(1)
    await act(async () => { dismiss?.() })
    nav.path = '/listings/x'
    window.history.pushState({}, '', '/listings/x')
    rerender(<LanguageProvider><ConciergeHost /></LanguageProvider>)
    nav.path = '/'
    window.history.pushState({}, '', LINK)
    rerender(<LanguageProvider><ConciergeHost /></LanguageProvider>)
    await settle()
    expect(openSignIn).toHaveBeenCalledTimes(2)
  })

  it('in an app: the link is ignored and dropped', async () => {
    ua(VOICE_APP)
    writeAiConsent('voice_guide', ME, 'on')
    mount()
    await settle()
    expect(windowOpen()).toBe(false)
    expect(window.location.search).not.toContain('guide=')
  })
})
