// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

/**
 * THE THREAD PAGE UNDER APP STORE GATE `ios-hide-visa` (D5 = b; src/lib/ios-hide-visa.ts).
 * Off ⇒ an e-Visa thread is what it always was: its cards render, the composer is there, and opening it POSTs
 * /advance. On, in the iOS app ⇒ READ-ONLY: each card is one line, the composer and the chip row give way to a notice,
 * and nothing is POSTed on open. Android and the web are untouched. The harness is offer-undo.test.tsx's.
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
const stable = vi.hoisted(() => ({
  params: { id: 'c1' },
  router: { push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {} },
  search: new URLSearchParams(),
  auth: { user: { id: 'p-applicant' }, loading: false, openSignIn: () => {} },
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
const ANDROID_APP = 'Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 EnoNativeApp/1'

const visaThread = () => ({
  id: 'c1',
  me: 'p-applicant',
  kind: 'visa',
  iAmSeller: false,
  hasReviewed: false,
  listing: { id: 'l-visa', title: 'Vietnam e-Visa', image: null, price: 1_500_000, negotiable: false, status: 'active' },
  counterpart: { name: 'Eno', avatarColor: '#888', avatarUrl: null, sellerId: 's-desk', locale: 'en', trust: null },
  visa: { applicationId: 'app1', mode: 'ai' },
  messages: [
    { id: 'm-hi', mine: true, body: 'Hello, I need an e-Visa', createdAt: '2026-10-01T08:00:00.000Z', kind: 'text' },
    { id: 'm-step', mine: false, body: '', createdAt: '2026-10-01T08:01:00.000Z', kind: 'visa_step', meta: { step: 1, applicationId: 'app1', state: 'active' } },
  ],
})

/** A PARTNER's e-Visa product thread (kind 'listing'); the server flags it only for the iOS app with the gate on. */
const partnerThread = (flagged: boolean) => ({
  id: 'c1',
  me: 'p-applicant',
  kind: 'listing',
  ...(flagged ? { eVisaProduct: true } : {}),
  iAmSeller: false,
  hasReviewed: false,
  listing: { id: 'l-vk', title: 'Vietnam E-Visa - Single Entry - 1 Hour', image: null, price: 3_000_000, negotiable: false, status: 'active' },
  counterpart: { name: 'VietKite', avatarColor: '#888', avatarUrl: null, sellerId: 's-vk', locale: 'en', trust: null },
  messages: [{ id: 'm-hi', mine: true, body: 'Hello, I need an e-Visa', createdAt: '2026-10-01T08:00:00.000Z', kind: 'text' }],
})
let payload: () => unknown = visaThread

type Call = { url: string; method: string }
let calls: Call[] = []
const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }) as unknown as Response
class NoopObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }
type Win = { Capacitor?: { getPlatform?: () => string; isNativePlatform?: () => boolean } }

function platform(kind: 'ios' | 'android' | 'web') {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(kind === 'ios' ? IOS_APP : kind === 'android' ? ANDROID_APP : 'Mozilla/5.0 (Macintosh) Chrome/140.0.0.0 Safari/537.36')
  if (kind === 'web') delete (window as unknown as Win).Capacitor
  else (window as unknown as Win).Capacitor = { getPlatform: () => kind, isNativePlatform: () => true }
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', NoopObserver)
  vi.stubGlobal('IntersectionObserver', NoopObserver)
  if (!window.matchMedia) {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  }
  Element.prototype.scrollIntoView ??= function () {}
  Element.prototype.scrollTo ??= function () {} as never
  calls = []
  payload = visaThread
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method })
    if (url === '/api/conversations/c1' && method === 'GET') return Promise.resolve(json(200, payload()))
    return Promise.resolve(json(200, {}))
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  delete (window as unknown as Win).Capacitor
})

async function openThread() {
  const view = render(<ThreadPage />)
  await screen.findByText('Hello, I need an e-Visa')
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  return view
}
const composer = () => document.querySelector('.chat-composer')
const advancePosts = () => calls.filter((c) => c.url.endsWith('/advance') && c.method === 'POST')
const THREAD_NOTE = 'This e-Visa application continues at www.eno.forum in a web browser. You can still read the conversation here.'
const STEP_NOTE = 'This e-Visa step is available at www.eno.forum in a web browser.'

describe('gate OFF (the shipped default) — the e-Visa thread is unchanged', () => {
  it.each(['ios', 'android', 'web'] as const)('%s: composer present, card rendered, /advance posted, no notice', async (kind) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    platform(kind)
    await openThread()
    expect(composer()).not.toBeNull()
    expect(screen.queryByText(THREAD_NOTE)).toBeNull()
    expect(screen.queryByText(STEP_NOTE)).toBeNull()
    expect(advancePosts()).toHaveLength(1)
  })
})

describe('gate ON', () => {
  it('iOS app: read-only — no composer, a notice instead, the card is one line, nothing posted on open', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    platform('ios')
    await openThread()
    expect(composer()).toBeNull()
    expect(screen.getByText(THREAD_NOTE)).toBeTruthy()
    expect(screen.getByText(STEP_NOTE)).toBeTruthy()
    expect(advancePosts()).toEqual([])
    // The history itself stays readable.
    expect(screen.getByText('Hello, I need an e-Visa')).toBeTruthy()
  })

  it.each(['android', 'web'] as const)('%s: unchanged', async (kind) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    platform(kind)
    await openThread()
    expect(composer()).not.toBeNull()
    expect(screen.queryByText(THREAD_NOTE)).toBeNull()
    expect(advancePosts()).toHaveLength(1)
  })
})

describe('a PARTNER e-Visa product thread (kind listing)', () => {
  it('gate ON, iOS app, flagged by the server: read-only like the desk thread', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    platform('ios')
    payload = () => partnerThread(true)
    await openThread()
    expect(composer()).toBeNull()
    expect(screen.getByText(THREAD_NOTE)).toBeTruthy()
  })

  it('not flagged (gate off, or not the iOS app on the server side): an ordinary chat', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    platform('ios')
    payload = () => partnerThread(false)
    await openThread()
    expect(composer()).not.toBeNull()
    expect(screen.queryByText(THREAD_NOTE)).toBeNull()
  })

  it('the SELLER side of a flagged thread (the partner answering) keeps its composer', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa')
    platform('ios')
    payload = () => ({ ...partnerThread(true), iAmSeller: true })
    await openThread()
    expect(composer()).not.toBeNull()
    expect(screen.queryByText(THREAD_NOTE)).toBeNull()
  })

  // ugc-safety + ios-hide-visa together: a BLOCK closes the thread on the web too, so the visa note's "continues at
  // www.eno.forum" would be false — the closed banner (and the blocker's way back) wins.
  it.each(['you_blocked', 'blocked'] as const)('flagged AND closed by a block (%s): the closed banner, not the visa note', async (closed) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'ios-hide-visa,ugc-safety')
    platform('ios')
    payload = () => ({ ...partnerThread(true), closed })
    await openThread()
    expect(composer()).toBeNull()
    expect(screen.queryByText(THREAD_NOTE)).toBeNull()
    // The blocker's banner links the way back; the blocked side's only says the thread is closed.
    if (closed === 'you_blocked') expect(screen.getByText('Manage blocked users')).toBeTruthy()
    else {
      expect(screen.getByText(/This conversation is closed\./)).toBeTruthy()
      expect(screen.queryByText('Manage blocked users')).toBeNull()
    }
  })

  it('flagged but the gate is off in this build: an ordinary chat', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    platform('ios')
    payload = () => partnerThread(true)
    await openThread()
    expect(composer()).not.toBeNull()
  })
})
