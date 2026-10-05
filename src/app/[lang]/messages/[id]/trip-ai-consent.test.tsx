// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { aiConsentKey, forgetAiConsentMemory, registerAiConsentAsker, setAiConsentAccount } from '@/lib/ai-consent'

/**
 * THE TRIP CHAT'S ENO CONCIERGE UNDER APP STORE GATE `app-ai-notice` (the `trip` family, src/lib/ai-consent.ts).
 * Off ⇒ an armed composer sends the question to /api/trips/concierge as it always did. On, in the app, "Not now" ⇒
 * nothing is sent, the question stays, and the composer is DISARMED — so the next Send reaches the desk's people.
 * The harness is ios-hide-visa.test.tsx's (itself offer-undo.test.tsx's).
 */

vi.mock('sonner', () => ({ toast: Object.assign(() => 0, { error: () => 0, success: () => 0, dismiss: () => {}, loading: () => 0, message: () => 0 }) }))
const chat = vi.hoisted(() => ({
  getCachedThread: (): unknown => null,
  cacheThread: () => {},
  prefetchThread: () => {},
  refreshUnread: () => {},
  refreshConvos: () => {},
}))
vi.mock('@/context/chat-context', () => ({ useChat: () => chat }))
// The thread page refreshes the bell after an offer action (main, 2026-10-05) — the same stub offer-undo.test.tsx uses.
vi.mock('@/context/notifications-context', () => ({ useNotifications: () => ({ items: [], unread: 0, refresh: () => {} }) }))
// The item strip prices the listing through <Price> (main, inbox-03), which reads the display currency —
// the same stub offer-undo.test.tsx uses.
const currency = vi.hoisted(() => ({ currency: 'VND', rates: {}, ratesPending: false, format: (n: number) => String(n) }))
vi.mock('@/context/currency-context', async () => {
  const real = await vi.importActual<typeof import('@/context/currency-context')>('@/context/currency-context')
  return { vndPerUsd: real.vndPerUsd, useCurrency: () => currency }
})
const stable = vi.hoisted(() => ({
  params: { id: 'c1' },
  router: { push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {} },
  search: new URLSearchParams(),
  auth: { user: { id: 'p-traveller' }, loading: false, openSignIn: () => {} },
  lang: { lang: 'en', tr: (en: string) => en, t: (k: string) => k, setLang: () => {} },
}))
vi.mock('next/navigation', () => ({
  useParams: () => stable.params,
  useRouter: () => stable.router,
  usePathname: () => '/messages/c1',
  useSearchParams: () => stable.search,
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => stable.auth, preloadSignIn: () => {} }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => stable.lang,
  useTr: () => stable.lang.tr,
  Tr: ({ en }: { en: string }) => en,
}))
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowser: () => ({ auth: { getSession: () => Promise.resolve({ data: { session: null } }) } }),
}))

import ThreadPage from './page'

const IOS_APP = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 EnoNativeApp/1'
const QUESTION = 'Is Hoi An worth two nights?'

const tripThread = () => ({
  id: 'c1',
  me: 'p-traveller',
  kind: 'itinerary',
  iAmSeller: false,
  hasReviewed: false,
  listing: { id: 'l-trip', title: 'Plan my Vietnam trip', image: null, price: 0, negotiable: false, status: 'active' },
  counterpart: { name: 'Trip desk', avatarColor: '#888', avatarUrl: null, sellerId: 's-desk', locale: 'en', trust: null },
  messages: [{ id: 'm-hi', mine: true, body: 'Hello, I want to plan a trip', createdAt: '2026-10-01T08:00:00.000Z', kind: 'text' }],
})

type Call = { url: string; method: string }
let calls: Call[] = []
let store: Map<string, string>
const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }) as unknown as Response
class NoopObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', NoopObserver)
  vi.stubGlobal('IntersectionObserver', NoopObserver)
  if (!window.matchMedia) {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  }
  Element.prototype.scrollIntoView ??= function () {}
  Element.prototype.scrollTo ??= function () {} as never
  // jsdom has no innerText, which the contenteditable composer reads on `input`.
  if (!('innerText' in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      configurable: true,
      get() { return (this as HTMLElement).textContent ?? '' },
      set(v: string) { (this as HTMLElement).textContent = v },
    })
  }
  store = new Map<string, string>()
  forgetAiConsentMemory()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  })
  calls = []
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method })
    if (url.split('?')[0] === '/api/conversations/c1' && method === 'GET') return Promise.resolve(json(200, tripThread())) // the first load is ?opened=1 (main, 2026-10-05)
    return Promise.resolve(json(200, {}))
  }))
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IOS_APP)
  setAiConsentAccount(stable.auth.user.id)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  setAiConsentAccount(null)
  registerAiConsentAsker(null)
})

const conciergePosts = () => calls.filter((c) => c.url === '/api/trips/concierge' && c.method === 'POST')

async function openTheThread() {
  render(<ThreadPage />)
  await screen.findByText('Hello, I want to plan a trip')
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
}
async function openTheMenu() {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Get help with this trip' })) })
  return screen.findByRole('menuitem', { name: /Eno concierge/ })
}
async function askTheConcierge(taps = 1) {
  await openTheThread()
  // Arm the composer: "Get help" → "Eno concierge".
  fireEvent.click(await openTheMenu())
  const field = await screen.findByRole('textbox', { name: 'Ask Eno concierge' })
  field.textContent = QUESTION
  await act(async () => { fireEvent.input(field) })
  const send = screen.getByRole('button', { name: 'Ask Eno concierge' })
  for (let i = 0; i < taps; i++) await act(async () => { fireEvent.click(send) })
}

describe('the trip chat concierge and the Google AI question', () => {
  it('gate OFF, in the app: the question goes to the concierge as before', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    const asker = vi.fn(async () => 'off' as const)
    registerAiConsentAsker(asker)
    await askTheConcierge()
    await waitFor(() => expect(conciergePosts()).toHaveLength(1))
    expect(asker).not.toHaveBeenCalled()
  })

  it('gate ON, in the app, "Not now": nothing sent, question kept, composer disarmed (Send now reaches a person)', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    const asker = vi.fn(async () => 'off' as const)
    registerAiConsentAsker(asker)
    await askTheConcierge()
    await waitFor(() => expect(asker).toHaveBeenCalledWith('trip', 'p-traveller', expect.objectContaining({ title: 'Use Google AI to plan your trip?' })))
    expect(conciergePosts()).toHaveLength(0)
    expect(await screen.findByRole('textbox', { name: 'Write a message' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Write a message' }).textContent).toBe(QUESTION)
  })

  it('gate ON, in the app, "Allow": the question goes to the concierge', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    registerAiConsentAsker(vi.fn(async () => 'on' as const))
    await askTheConcierge()
    await waitFor(() => expect(conciergePosts()).toHaveLength(1))
  })

  it('gate ON: a second Send while the question is open does nothing — "Allow" sends the question ONCE', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    let answer!: (ok: boolean) => void
    const asker = vi.fn(() => new Promise<'on' | 'off' | null>((resolve) => { answer = (ok) => resolve(ok ? 'on' : 'off') }))
    registerAiConsentAsker(asker)
    await askTheConcierge(2)
    expect(asker).toHaveBeenCalledTimes(1)
    await act(async () => { answer(true) })
    await waitFor(() => expect(conciergePosts()).toHaveLength(1))
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(conciergePosts()).toHaveLength(1)
  })

  it('gate ON, trip AI already "off": the concierge cannot be armed, so there is no ask → toast → disarm loop', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    store.set(aiConsentKey('trip', 'p-traveller'), 'off')
    const asker = vi.fn(async () => 'off' as const)
    registerAiConsentAsker(asker)
    await openTheThread()
    const item = await openTheMenu()
    expect(item.getAttribute('aria-disabled')).not.toBeNull()
    fireEvent.click(item)
    expect(screen.queryByRole('textbox', { name: 'Ask Eno concierge' })).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Write a message' })).toBeTruthy()
    expect(asker).not.toHaveBeenCalled()
  })
})
