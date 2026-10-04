// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

/**
 * THE THREAD PAGE UNDER APP STORE GATE `app-ai-notice` (R8, Guideline 5.1.2(i), D14) — the WIRING in the landmine
 * page; the hook's rules are unit-tested in src/hooks/use-chat-translation.test.tsx. Off ⇒ a language mismatch
 * translates at once, as before. On, in either app ⇒ the notice stands where the strip would be and NOTHING goes to
 * POST /api/messages/translate until "OK"; "Turn off translation" sends nothing and removes the strip.
 * The harness is offer-undo.test.tsx's.
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
  auth: { user: { id: 'p-buyer' }, loading: false, openSignIn: () => {} },
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
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'

const thread = () => ({
  id: 'c1',
  me: 'p-buyer',
  kind: 'listing',
  iAmSeller: false,
  hasReviewed: false,
  listing: { id: 'l1', title: 'Căn hộ 2PN', image: null, price: 9_000_000, negotiable: true, status: 'active' },
  // The counterpart writes in Vietnamese; the viewer reads English ⇒ a translation would apply.
  counterpart: { name: 'Chủ nhà', avatarColor: '#888', avatarUrl: null, sellerId: 's1', locale: 'vi', trust: null },
  messages: [
    { id: 'm1', mine: false, body: 'Căn hộ vẫn còn trống nhé', createdAt: '2026-10-01T08:00:00.000Z', kind: 'text' },
  ],
})

let calls: { url: string; method: string }[] = []
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
  calls = []
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method })
    if (url === '/api/conversations/c1' && method === 'GET') return Promise.resolve(json(200, thread()))
    if (url === '/api/messages/translate') return Promise.resolve(json(200, { items: [{ id: 'm1', text: 'The flat is still free', translated: true }] }))
    return Promise.resolve(json(200, {}))
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

async function open(ua: string) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
  render(<ThreadPage />)
  await screen.findByText('Căn hộ vẫn còn trống nhé')
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
}
const translatePosts = () => calls.filter((c) => c.url === '/api/messages/translate')
const notice = () => screen.queryByRole('region', { name: 'Chat translation' })
const strip = () => screen.queryByText(/Translate messages to/)

describe('gate OFF (the shipped default)', () => {
  it.each([['iOS app', IOS_APP], ['Android app', ANDROID_APP], ['web', DESKTOP]])('%s: translates at once, no notice', async (_, ua) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', '')
    await open(ua)
    expect(translatePosts()).toHaveLength(1)
    expect(notice()).toBeNull()
    expect(strip()).not.toBeNull()
  })
})

describe('gate ON', () => {
  it.each([['iOS app', IOS_APP], ['Android app', ANDROID_APP]])('%s: the notice first, nothing sent; OK sends', async (_, ua) => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    await open(ua)
    expect(notice()).not.toBeNull()
    expect(screen.getByText(/messages are sent to Microsoft \(Azure AI Translator\)/)).toBeTruthy()
    expect(strip()).toBeNull()
    expect(translatePosts()).toEqual([])
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'OK' })) })
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(translatePosts()).toHaveLength(1)
    expect(notice()).toBeNull()
    expect(strip()).not.toBeNull()
  })

  it('"Turn off translation": nothing is sent, and neither the notice nor the strip stays', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    await open(IOS_APP)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Turn off translation' })) })
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(translatePosts()).toEqual([])
    expect(notice()).toBeNull()
    expect(strip()).toBeNull()
  })

  it('web: unchanged', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_REVIEW_GATES', 'app-ai-notice')
    await open(DESKTOP)
    expect(translatePosts()).toHaveLength(1)
    expect(notice()).toBeNull()
  })
})
