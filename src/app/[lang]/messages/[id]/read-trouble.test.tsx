// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

/**
 * ⛔ A THREAD THAT CANNOT LOAD SAYS SO (Emil-skills audit — split out of the 3b send guard). A first read that failed,
 * or never answered, left the skeletons up for good while the 15s poll retried in silence. The page now says which:
 * couldn't load (Try again), slow (Try again, and the read still lands), or the session ended (sign in).
 *
 * Harness after offer-undo.test.tsx, with plain fake timers: the 10s patience clock is asserted to the second, so no
 * real time may leak into the fake clock (no `shouldAdvanceTime`, hence no findBy/waitFor — every step is an act()).
 * ⚠️ EXPLICIT CLEANUP — no vitest `globals`, so Testing Library registers no afterEach of its own.
 */

vi.mock('sonner', () => ({
  toast: Object.assign(() => 0, { dismiss: () => {}, error: () => 0, success: () => 0, loading: () => 0, message: () => 0 }),
}))
const chat = vi.hoisted(() => ({
  cached: null as unknown,
  // Read through the object at CALL time — the page destructures it, so no `this`.
  getCachedThread: (): unknown => chat.cached,
  cacheThread: vi.fn(),
  prefetchThread: vi.fn(),
  refreshUnread: vi.fn(),
  refreshConvos: vi.fn(),
  convos: null as unknown,
}))
vi.mock('@/context/chat-context', () => ({ useChat: () => chat }))
const notifs = vi.hoisted(() => ({ items: [], unread: 0, refresh: vi.fn() }))
vi.mock('@/context/notifications-context', () => ({ useNotifications: () => notifs }))
const currency = vi.hoisted(() => ({ currency: 'VND', rates: {}, ratesPending: false, format: (n: number) => String(n) }))
vi.mock('@/context/currency-context', async () => {
  const real = await vi.importActual<typeof import('@/context/currency-context')>('@/context/currency-context')
  return { vndPerUsd: real.vndPerUsd, useCurrency: () => currency }
})
// ⚠️ Every mocked hook returns a STABLE identity, as the real providers do (see offer-undo.test.tsx) — except
// `auth`, which a test swaps for a new object on purpose: that is what a sign-in looks like to the page.
type Auth = { user: { id: string } | null; loading: boolean; openSignIn: () => void }
const stable = vi.hoisted(() => ({
  params: { id: 'c1' },
  router: { push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {} },
  search: new URLSearchParams(),
  auth: null as unknown as Auth,
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
// The realtime socket is a backstop this test does not exercise: no session → the effect bails.
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowser: () => ({ auth: { getSession: () => Promise.resolve({ data: { session: null } }) } }),
}))

import ThreadPage from './page'

const signedIn = (): Auth => ({ user: { id: 'u-seller' }, loading: false, openSignIn: () => {} })
const thread = (id = 'c1', body = 'Hi, is it available?') => ({
  id,
  me: 'u-seller',
  kind: 'listing',
  iAmSeller: true,
  hasReviewed: false,
  listing: { id: 'l1', title: 'Road bike', image: null, price: 15_000_000, negotiable: true, status: 'active' },
  counterpart: { name: 'Buyer', avatarColor: '#888', avatarUrl: null, sellerId: null, locale: 'en', trust: null },
  messages: [{ id: 'm-hi', mine: false, body, createdAt: '2026-09-25T08:00:00.000Z', kind: 'text' }],
})

type Answer = { status: number; body?: unknown } | 'reject'
/** How each thread GET answers, in order: an answer, or 'hold' (open until the test answers it). Then `rest`. */
let replies: (Answer | 'hold')[] = []
let rest: Answer | 'hold' = { status: 200 }
/** The thread GETs held open, oldest first — answered in whatever order a test chooses. */
let held: ((a: Answer) => void)[] = []
let gets: { url: string; signal: AbortSignal | null | undefined }[] = []

const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }) as unknown as Response
// `me` is the account the server read it for: whoever's cookie the request carried — the account signed in when it
// went out, however late it is answered.
const settle = (a: Answer, me: string | undefined) =>
  a === 'reject' ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve(json(a.status, a.body ?? (a.status === 200 ? { ...thread(), me } : { error: 'x' })))

class NoopObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', NoopObserver)
  vi.stubGlobal('IntersectionObserver', NoopObserver)
  if (!window.matchMedia) {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  }
  Element.prototype.scrollIntoView ??= function () {}
  Element.prototype.scrollTo ??= function () {} as never
  Element.prototype.getAnimations ??= () => []
  vi.useFakeTimers()
  stable.auth = signedIn()
  chat.cached = null
  chat.cacheThread.mockClear() // a plain vi.fn: restoreAllMocks keeps its calls, so each test starts from none
  replies = []
  rest = { status: 200 }
  held = []
  gets = []
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    const url = String(input)
    if ((init?.method ?? 'GET') === 'GET' && url.split('?')[0] === '/api/conversations/c1') {
      gets.push({ url, signal: init?.signal })
      const me = stable.auth.user?.id // the cookie this request carries
      const r = replies.length ? replies.shift()! : rest
      // Held open — and, like a real fetch, ended by its signal (the 2-minute ceiling).
      if (r === 'hold') {
        return new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
          held.push((a) => { settle(a, me).then(resolve, reject) })
        })
      }
      return settle(r, me)
    }
    return Promise.resolve(json(200, {}))
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const painted = () => screen.queryByText('Hi, is it available?') !== null
const shown = (text: RegExp) => screen.queryAllByText(text).length > 0
const couldNotLoad = () => shown(/Couldn.t load this conversation/)
const slow = () => shown(/taking longer than usual to load/)
const sessionEnded = () => shown(/Your session has ended/)
const tryAgain = () => screen.queryByRole('button', { name: /Try again/ })
const signOut = (view: ReturnType<typeof render>) => act(async () => { stable.auth = { user: null, loading: false, openSignIn: () => {} }; view.rerender(<ThreadPage />) })
const signIn = (view: ReturnType<typeof render>) => act(async () => { stable.auth = signedIn(); view.rerender(<ThreadPage />) })

describe('a thread that cannot load says so', () => {
  it('⛔ a first read that fails says it could not load — and Try again loads it', async () => {
    replies = ['reject']
    render(<ThreadPage />)
    await tick(50)
    expect(couldNotLoad()).toBe(true)
    expect(painted()).toBe(false)
    await act(async () => { fireEvent.click(tryAgain()!) })
    await tick(50)
    expect(painted()).toBe(true)
    expect(couldNotLoad()).toBe(false)
  })

  it('⛔ a first read that never answers says it is slow at 10s, is NOT aborted there, and paints when it lands', async () => {
    replies = ['hold']
    render(<ThreadPage />)
    await tick(9_000)
    expect(slow()).toBe(false)
    await tick(1_100)
    expect(slow()).toBe(true)
    expect(tryAgain()).not.toBeNull()
    // Bounded only by the 2-minute ceiling, never by the notice: a slow thread still loads.
    expect(gets[0].signal?.aborted).toBe(false)
    await act(async () => { held[0]({ status: 200 }) })
    await tick(50)
    expect(painted()).toBe(true)
    expect(slow()).toBe(false)
  })

  it('the notice is drawn INSIDE the thread’s tree — the log that held the skeletons holds it, then the messages', async () => {
    // Not a screen of its own: swapping the tree out and back would leave what binds to it at mount (the footer's
    // ResizeObserver) on a detached node. And the log is a live region from the first paint, so the notice that
    // appears in it is announced.
    replies = ['reject']
    render(<ThreadPage />)
    const log = screen.getByRole('log')
    expect(log.getAttribute('aria-live')).toBe('polite')
    await tick(50)
    expect(screen.getByRole('log')).toBe(log)
    expect(log.textContent).toMatch(/Couldn.t load this conversation/)
    await act(async () => { fireEvent.click(tryAgain()!) })
    await tick(50)
    expect(screen.getByRole('log')).toBe(log)
    expect(log.textContent).toMatch(/Hi, is it available\?/)
  })

  it('a read that never answers is dropped at the 2-minute ceiling, and that is said as "couldn’t load"', async () => {
    replies = ['hold']
    rest = 'hold' // the polls hang too
    render(<ThreadPage />)
    await tick(10_100)
    expect(slow()).toBe(true)
    await tick(109_000) // 119.1s
    expect(gets[0].signal?.aborted).toBe(false)
    await tick(1_100) // 120.2s
    expect(gets[0].signal?.aborted).toBe(true)
    expect(couldNotLoad()).toBe(true)
  })

  it('the ceiling’s timer is let go when the read settles — a poll leaves no two-minute timer behind', async () => {
    replies = [{ status: 200 }]
    render(<ThreadPage />)
    await tick(50)
    expect(painted()).toBe(true)
    const first = gets[0].signal!
    await tick(130_000)
    expect(first.aborted).toBe(false)
  })

  it('an older answer landing after a newer 401 does not replace it — not with not-found, not with a paint', async () => {
    replies = ['hold', 'hold', { status: 401 }] // the open and the first poll hang; the second poll answers 401
    render(<ThreadPage />)
    await tick(30_050)
    expect(sessionEnded()).toBe(true)
    await act(async () => { held[0]({ status: 404 }) })
    await act(async () => { held[1]({ status: 200 }) })
    await tick(50)
    expect(sessionEnded()).toBe(true)
    expect(screen.queryByText('Conversation not found.')).toBeNull()
    expect(painted()).toBe(false)
  })

  it('an older read failing late does not replace a newer read’s word', async () => {
    replies = ['hold', { status: 401 }] // the open hangs; the 15s poll answers 401
    render(<ThreadPage />)
    await tick(15_050)
    expect(sessionEnded()).toBe(true)
    await act(async () => { held[0]('reject') }) // the open, failing after the poll that left later
    await tick(50)
    expect(sessionEnded()).toBe(true)
    expect(couldNotLoad()).toBe(false)
  })

  it('an older read that fails after Try again does not put the notice back over the retry', async () => {
    replies = ['hold', 'hold']
    render(<ThreadPage />)
    await tick(10_100)
    expect(slow()).toBe(true)
    await act(async () => { fireEvent.click(tryAgain()!) })
    expect(gets).toHaveLength(2)
    expect(slow()).toBe(false)
    await act(async () => { held[0]('reject') }) // the read from BEFORE the Try again, failing late
    await tick(50)
    expect(couldNotLoad()).toBe(false)
    await act(async () => { held[1]({ status: 200 }) })
    await tick(50)
    expect(painted()).toBe(true)
  })

  it('⛔ a 401 says the session ended and offers sign-in, not Try again', async () => {
    replies = [{ status: 401 }]
    render(<ThreadPage />)
    await tick(50)
    expect(sessionEnded()).toBe(true)
    expect(screen.queryByRole('button', { name: /Sign in/ })).not.toBeNull()
    expect(tryAgain()).toBeNull()
  })

  it('a 403/404 is still the not-found screen, not a notice', async () => {
    replies = [{ status: 404 }]
    render(<ThreadPage />)
    await tick(50)
    expect(screen.queryByText('Conversation not found.')).not.toBeNull()
    expect(couldNotLoad()).toBe(false)
    await tick(10_100) // the patience clock runs out behind it: nothing is said beside "not found"
    expect(screen.queryByText('Conversation not found.')).not.toBeNull()
    expect(slow()).toBe(false)
  })

  it('a painted thread is never covered: a later failed poll leaves it on screen', async () => {
    rest = 'reject'
    replies = [{ status: 200 }]
    render(<ThreadPage />)
    await tick(50)
    expect(painted()).toBe(true)
    await tick(15_000)
    expect(gets.length).toBeGreaterThan(1)
    expect(painted()).toBe(true)
    expect(couldNotLoad()).toBe(false)
  })
})

describe('a notice belongs to the session that raised it', () => {
  it('⛔ after a sign-out, the old session’s read failing late says nothing over the next sign-in', async () => {
    replies = ['hold', 'hold']
    const view = render(<ThreadPage />)
    await tick(50)
    await signOut(view)
    expect(screen.queryByText('Sign in to view this conversation.')).not.toBeNull()
    await act(async () => { held[0]('reject') }) // the signed-out session's read, failing late
    await tick(50)
    await signIn(view)
    await tick(50)
    expect(held).toHaveLength(2) // the new session's read, in flight
    expect(couldNotLoad()).toBe(false)
    await act(async () => { held[1]({ status: 200 }) })
    await tick(50)
    expect(painted()).toBe(true)
  })

  it('a notice raised before a sign-out is gone after the next sign-in, and the clock starts again from there', async () => {
    replies = ['hold', 'hold']
    const view = render(<ThreadPage />)
    await tick(10_100)
    expect(slow()).toBe(true)
    await signOut(view)
    await signIn(view)
    await tick(50)
    expect(slow()).toBe(false) // not the old session's word…
    await tick(9_000)
    expect(slow()).toBe(false)
    await tick(1_100)
    expect(slow()).toBe(true) // …the new session's, 10s into its wait
  })

  it('signed out (or still settling) there is no reader to be patient with: no clock, no notice', async () => {
    stable.auth = { user: null, loading: true, openSignIn: () => {} }
    const view = render(<ThreadPage />)
    await tick(11_000)
    expect(gets).toHaveLength(0)
    expect(slow()).toBe(false)
    replies = ['hold']
    await signIn(view) // auth settles signed in: the read leaves, and the clock starts with it
    await tick(50)
    expect(slow()).toBe(false)
    await tick(10_100)
    expect(slow()).toBe(true)
  })

  it('a token refresh (a new user object, the same account) leaves a notice where it is', async () => {
    replies = [{ status: 401 }, 'hold']
    const view = render(<ThreadPage />)
    await tick(50)
    expect(sessionEnded()).toBe(true)
    await signIn(view) // the same account, a new object — what a refresh or a re-sign-in looks like
    await tick(50)
    expect(held).toHaveLength(1) // the effect re-ran and asked again…
    expect(sessionEnded()).toBe(true) // …and the notice stays until that read answers
    await act(async () => { held[0]({ status: 200 }) })
    await tick(50)
    expect(painted()).toBe(true)
    expect(sessionEnded()).toBe(false)
  })
})

describe('a conversation belongs to the account that read it (F5)', () => {
  const signInAs = (view: ReturnType<typeof render>, id: string) => act(async () => { stable.auth = { user: { id }, loading: false, openSignIn: () => {} }; view.rerender(<ThreadPage />) })

  it('⛔ after A signs out, the next account to sign in never sees A’s conversation — not for one frame', async () => {
    replies = [{ status: 200 }, 'hold']
    const view = render(<ThreadPage />)
    await tick(50)
    expect(painted()).toBe(true)
    await signOut(view)
    await signInAs(view, 'u-other')
    expect(painted()).toBe(false) // in the very render the account changed in, before anything else answers
    await tick(50)
    expect(painted()).toBe(false)
    await act(async () => { held[0]({ status: 404 }) }) // the other account's own read: not theirs to open
    await tick(50)
    expect(screen.queryByText('Conversation not found.')).not.toBeNull()
    expect(painted()).toBe(false)
  })

  it('A’s read still out at the switch lands in nothing — not on screen, not in the cache', async () => {
    replies = ['hold', 'hold']
    const view = render(<ThreadPage />)
    await tick(50)
    await signOut(view)
    await signInAs(view, 'u-other')
    await tick(50)
    chat.cacheThread.mockClear()
    await act(async () => { held[0]({ status: 200 }) }) // A's open, answered (for A) after the switch
    await tick(50)
    expect(painted()).toBe(false)
    expect(chat.cacheThread).not.toHaveBeenCalled()
  })

  it('an answer read under another account’s cookie (a switch in another tab) is neither painted nor cached — and is said', async () => {
    replies = [{ status: 200, body: { ...thread(), me: 'u-other' } }]
    render(<ThreadPage />)
    await tick(50)
    expect(painted()).toBe(false)
    expect(chat.cacheThread).not.toHaveBeenCalled()
    // Not skeletons until the patience clock, then a Try again that can never work: this tab's session is not the
    // one the browser holds any more, which is what a 401 says, with its way out.
    expect(sessionEnded()).toBe(true)
    expect(screen.queryByRole('button', { name: /Sign in/ })).not.toBeNull()
  })

  it('the same account signing back in keeps its view: its conversation is there at once, before its new read answers', async () => {
    // (The sign-in card replaces the thread's tree while signed out, as it always has — so not the same DOM; the same
    // instance, whose state is still this account's.)
    replies = [{ status: 200 }, 'hold']
    const view = render(<ThreadPage />)
    await tick(50)
    await signOut(view)
    await signIn(view)
    expect(held).toHaveLength(1) // the new session's read, still out…
    expect(painted()).toBe(true) // …and the conversation already on screen
  })

  it('a cold load (auth settling: nobody, then A) mounts the view once', async () => {
    stable.auth = { user: null, loading: true, openSignIn: () => {} }
    replies = [{ status: 200 }]
    const view = render(<ThreadPage />)
    const log = screen.getByRole('log')
    await signIn(view)
    await tick(50)
    expect(screen.getByRole('log')).toBe(log)
    expect(painted()).toBe(true)
  })
})

describe('only THIS thread is painted as this thread', () => {
  it('a cached copy of another thread is not painted', async () => {
    chat.cached = thread('c9', 'From another thread')
    replies = ['hold']
    render(<ThreadPage />)
    await tick(50)
    expect(screen.queryByText('From another thread')).toBeNull()
  })

  it('an answer carrying another thread is a failed read, not a paint', async () => {
    replies = [{ status: 200, body: thread('c9', 'From another thread') }]
    render(<ThreadPage />)
    await tick(50)
    expect(screen.queryByText('From another thread')).toBeNull()
    expect(couldNotLoad()).toBe(true)
  })
})
