// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

/**
 * THE THREAD PAGE, ANSWERING AN OFFER — owner, 2026-09-25: "Undo toast, 5 seconds" for Accept/Decline:
 * the card shows the choice immediately; the POST goes out only when the toast expires, or at once if
 * the user leaves (never silently dropped); Undo restores the card.
 *
 * useUndoWindow and offer-choices are unit-tested on their own. THIS file pins the WIRING in the
 * landmine page, against the real component with its network replaced: which request goes out, when,
 * with what body, and what the card shows meanwhile — including the 15s poll landing inside the window,
 * which used to be free to resurrect the buttons.
 *
 * ⚠️ EXPLICIT CLEANUP — no vitest `globals`, so Testing Library registers no afterEach of its own.
 */

const toasts = vi.hoisted(() => {
  type Opts = { description?: string; duration?: number; action?: unknown }
  const state = { seq: 0, shown: [] as { id: number; title: string; opts: Opts }[], dismissed: [] as (string | number)[], errors: [] as string[] }
  const toast = Object.assign(
    (title: string, opts: Opts) => { const id = ++state.seq; state.shown.push({ id, title, opts }); return id },
    {
      dismiss: (id: string | number) => { state.dismissed.push(id) },
      error: (msg: string) => { state.errors.push(msg); return 0 },
      success: () => 0,
      loading: () => 0,
      message: () => 0,
    },
  )
  return { state, toast }
})
vi.mock('sonner', () => ({ toast: toasts.toast }))

const chat = vi.hoisted(() => ({
  cached: null as unknown,
  // Read through the object at CALL time — the page destructures it, so no `this`.
  getCachedThread: (): unknown => chat.cached,
  cacheThread: vi.fn(),
  prefetchThread: vi.fn(),
  refreshUnread: vi.fn(),
  refreshConvos: vi.fn(),
  // The inbox list, as the chat context holds it (the page reads it to skip the strip placeholder).
  convos: null as unknown,
}))
vi.mock('@/context/chat-context', () => ({ useChat: () => chat }))
// The bell (si-04): the page refetches it when a thread read reports cleared notifications.
const notifs = vi.hoisted(() => ({ items: [], unread: 0, refresh: vi.fn() }))
vi.mock('@/context/notifications-context', () => ({ useNotifications: () => notifs }))
// The item strip prices the listing through <Price> (inbox-03), which reads the display currency.
const currency = vi.hoisted(() => ({ currency: 'VND', rates: {}, ratesPending: false, format: (n: number) => String(n) }))
vi.mock('@/context/currency-context', async () => {
  const real = await vi.importActual<typeof import('@/context/currency-context')>('@/context/currency-context')
  return { vndPerUsd: real.vndPerUsd, useCurrency: () => currency }
})
// ⚠️ EVERY MOCKED HOOK RETURNS A STABLE IDENTITY, the way the real providers do. A fresh router, user
// or tr() per render re-runs every effect that lists it — the page then refetches and re-renders forever
// (measured: the first draft of this file ran the worker out of heap).
const stable = vi.hoisted(() => ({
  params: { id: 'c1' },
  router: { push: () => {}, replace: () => {}, back: () => {}, prefetch: () => {} },
  search: new URLSearchParams(),
  auth: { user: { id: 'u-seller' }, loading: false, openSignIn: () => {} },
  lang: { lang: 'en', tr: (en: string) => en, t: (k: string) => k, setLang: () => {} },
}))
vi.mock('next/navigation', () => ({
  useParams: () => stable.params,
  useRouter: () => stable.router,
  usePathname: () => '/messages/c1',
  useSearchParams: () => stable.search,
}))
vi.mock('@/context/auth-context', () => ({
  useAuth: () => stable.auth,
  preloadSignIn: () => {},
}))
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
import { unconfirmedOfferChoices } from '@/lib/offer-choices'

const OFFER_ID = 'm-offer'
const thread = (offerStatus: string) => ({
  id: 'c1',
  me: 'p-seller',
  kind: 'listing',
  iAmSeller: true,
  hasReviewed: false,
  listing: { id: 'l1', title: 'Road bike', image: null, price: 15_000_000, negotiable: true, status: 'active' },
  counterpart: { name: 'Buyer', avatarColor: '#888', avatarUrl: null, sellerId: null, locale: 'en', trust: null },
  messages: [
    { id: 'm-hi', mine: false, body: 'Hi, is it available?', createdAt: '2026-09-25T08:00:00.000Z', kind: 'text' },
    { id: OFFER_ID, mine: false, body: '', createdAt: '2026-09-25T08:01:00.000Z', kind: 'offer', offerAmount: 12_000_000, offerStatus },
  ],
})

type Call = { url: string; method: string; body?: unknown; keepalive?: boolean }
let calls: Call[] = []
let serverStatus = 'pending'
let offerReply: { status: number; body: unknown } = { status: 200, body: { ok: true } }
/** While true, every thread GET is held until the test releases it, in whatever order it chooses. */
let holdGets = false
let heldGets: (() => void)[] = []
/** While true, every thread GET rejects (the network is gone). */
let failGets = false
/** Status the NEXT held GET answers with (a superseded request that comes back 403). */
let nextGetStatus: number | null = null
/** When set, the offer POST is held until the test releases it (a request still in flight). */
let holdPost: null | { release?: () => void } = null
/** Merged into every thread GET body (e.g. `counterpartSeen`). */
let extraThread: Record<string, unknown> = {}
/** `notificationsCleared` the OPEN (`?opened=1`) reports; every other read reports 0. */
let clearedOnOpen = 0
/** `openCleared` the OPEN reports — false = the server's fail-soft clear failed. */
let openClearedReply = true
/** The next N thread GETs reject (the network drops them). */
let failFirstGets = 0
/** Status code the listing-status POST (the strip's "Mark sold") answers with. */
let statusReplyCode = 200
/** B6 — who messaged about l1 (GET /api/listings/l1/buyers?scope=listing): this thread's buyer, then another. */
const BUYER_ROWS = [
  { conversationId: 'c1', profileId: 'p-buyer', name: 'Buyer', avatarUrl: null, avatarColor: '#888', lastMessageAt: '2026-09-25T08:01:00.000Z' },
  { conversationId: 'c9', profileId: 'p-other', name: 'Huy', avatarUrl: null, avatarColor: '#888', lastMessageAt: '2026-09-25T09:00:00.000Z' },
]
let buyersReply: { status: number; body: unknown } = { status: 200, body: { buyers: BUYER_ROWS } }
/** Status code POST /api/listings/l1/sold answers with; `holdSold` keeps it in flight until released. */
let soldReplyCode = 200
let holdSold: null | { release?: () => void } = null
/** The BUYER's side of the loop — GET /api/conversations/c1/sale-question answers with these. */
let saleQuestions: unknown[] = []
/** How that GET answers: 200 (the list above), another status (a failure), or 'hold' (never answers). */
let saleQuestionReply: number | 'hold' = 200
/** The thread GET, open or refetch — matched on the path, since the open carries `?opened=1`. */
const isThreadGet = (c: { url: string; method: string }) => c.method === 'GET' && c.url.split('?')[0] === '/api/conversations/c1'

const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }) as unknown as Response

// jsdom has no layout observers; the thread measures its footer and watches the list's bottom.
class NoopObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', NoopObserver)
  vi.stubGlobal('IntersectionObserver', NoopObserver)
  if (!window.matchMedia) {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  }
  Element.prototype.scrollIntoView ??= function () {}
  Element.prototype.scrollTo ??= function () {} as never
  // The "Who bought it?" sheet is a Base UI Drawer, which asks the platform about running animations.
  Element.prototype.getAnimations ??= () => []
  vi.useFakeTimers({ shouldAdvanceTime: true })
  calls = []
  serverStatus = 'pending'
  offerReply = { status: 200, body: { ok: true } }
  toasts.state.seq = 0
  toasts.state.shown.length = 0
  toasts.state.dismissed.length = 0
  toasts.state.errors.length = 0
  chat.prefetchThread.mockClear()
  chat.cached = null
  chat.convos = null
  holdGets = false
  heldGets = []
  failGets = false
  nextGetStatus = null
  holdPost = null
  extraThread = {}
  clearedOnOpen = 0
  openClearedReply = true
  failFirstGets = 0
  statusReplyCode = 200
  buyersReply = { status: 200, body: { buyers: BUYER_ROWS } }
  soldReplyCode = 200
  holdSold = null
  saleQuestions = []
  saleQuestionReply = 200
  notifs.refresh.mockClear()
  // Module-level on purpose (it outlives a page — see offer-choices.ts), so each test starts clean.
  unconfirmedOfferChoices.clear()
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined, keepalive: init?.keepalive })
    if (isThreadGet({ url, method })) {
      if (failFirstGets > 0) { failFirstGets -= 1; return Promise.reject(new TypeError('Failed to fetch')) }
      // The body is what the server holds WHEN THE REQUEST ARRIVES, even if the reply lands later.
      const isOpen = url.endsWith('?opened=1')
      const body = { ...thread(serverStatus), ...extraThread, notificationsCleared: isOpen ? clearedOnOpen : 0, openCleared: isOpen && openClearedReply }
      if (failGets) return Promise.reject(new TypeError('Failed to fetch'))
      const status = nextGetStatus ?? 200
      nextGetStatus = null
      if (holdGets) return new Promise<Response>((resolve) => { heldGets.push(() => resolve(json(status, status === 200 ? body : { error: 'forbidden' }))) })
      return Promise.resolve(json(200, body))
    }
    if (url === '/api/conversations/c1/offer' && method === 'POST') {
      const settle = () => {
        if (offerReply.status === 200) serverStatus = (init!.body as string).includes('"accept"') ? 'accepted' : 'declined'
        return json(offerReply.status, offerReply.body)
      }
      if (holdPost) { const h = holdPost; return new Promise<Response>((resolve) => { h.release = () => resolve(settle()) }) }
      return Promise.resolve(settle())
    }
    if (url === '/api/listings/l1/status' && method === 'POST') {
      return Promise.resolve(json(statusReplyCode, statusReplyCode === 200 ? { ok: true, status: 'sold' } : { error: 'server_error' }))
    }
    if (url === '/api/listings/l1/buyers?scope=listing' && method === 'GET') {
      return Promise.resolve(json(buyersReply.status, buyersReply.body))
    }
    if (url === '/api/listings/l1/sold' && method === 'POST') {
      const reply = () => json(soldReplyCode, soldReplyCode === 200 ? { ok: true } : { error: 'server_error' })
      if (holdSold) { const h = holdSold; return new Promise<Response>((resolve) => { h.release = () => resolve(reply()) }) }
      return Promise.resolve(reply())
    }
    if (url === '/api/conversations/c1/sale-question' && method === 'GET') {
      if (saleQuestionReply === 'hold') return new Promise<Response>(() => {})
      if (saleQuestionReply !== 200) return Promise.resolve(json(saleQuestionReply, { error: 'internal_error' }))
      return Promise.resolve(json(200, { questions: saleQuestions }))
    }
    if (url === '/api/listings/l1/sale-confirmation' && method === 'POST') {
      const { answer } = JSON.parse(String(init!.body)) as { answer: string }
      // Answered: the question is no longer open on the server.
      saleQuestions = []
      return Promise.resolve(json(200, { ok: true, status: answer === 'confirm' ? 'confirmed' : 'declined' }))
    }
    if (url === '/api/conversations/c1/messages' && method === 'POST') {
      // A text send: the server's copy of the message, as the route returns it.
      const sent = JSON.parse(String(init!.body)) as { body: string }
      return Promise.resolve(json(200, { id: 'm-sent', mine: true, body: sent.body, createdAt: '2026-09-25T08:02:00.000Z', kind: 'text', reactions: [], deleted: false, replyTo: null }))
    }
    return Promise.resolve(json(200, {}))
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const offerPosts = () => calls.filter((c) => c.url.endsWith('/offer'))

async function openThread() {
  const view = render(<ThreadPage />)
  await act(async () => { await vi.advanceTimersByTimeAsync(50) })
  await screen.findByRole('button', { name: 'Accept' })
  return view
}

describe('Accept waits out the undo window', () => {
  it('flips the card at once, shows the toast with the amount, and sends NOTHING for 5 seconds', async () => {
    await openThread()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(screen.getByText('Accepted')).toBeTruthy()
    expect(toasts.state.shown.map((t) => t.title)).toEqual(['Offer accepted'])
    expect(toasts.state.shown[0].opts.description).toMatch(/12,000,000/)
    await act(async () => { await vi.advanceTimersByTimeAsync(4900) })
    expect(offerPosts()).toEqual([])
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    // keepalive even on the timer path: a reload a moment later must not abort the request in flight.
    expect(offerPosts()).toEqual([{ url: '/api/conversations/c1/offer', method: 'POST', body: { messageId: OFFER_ID, action: 'accept' }, keepalive: true }])
    expect(toasts.state.dismissed).toContain(1)
  })

  it('a poll that LEFT before the POST and lands after the reconcile is dropped (latest refetch wins)', async () => {
    await openThread()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    holdGets = true
    // A focus refetch leaves now, while the server still says pending, and is slow to come back…
    await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(10) })
    // …the window closes, the POST lands, and the reconcile refetch leaves (server: accepted)…
    await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
    expect(offerPosts()).toHaveLength(1)
    expect(heldGets).toHaveLength(2)
    const [stale, fresh] = heldGets
    await act(async () => { fresh(); await vi.advanceTimersByTimeAsync(10) })
    // …and only then does the stale `pending` arrive.
    await act(async () => { stale(); await vi.advanceTimersByTimeAsync(10) })
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(screen.getByText('Accepted')).toBeTruthy()
  })

  it('a stale `pending` landing between the POST and its reconcile does not bring the buttons back', async () => {
    await openThread()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    holdGets = true
    await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(10) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
    const [stale, fresh] = heldGets
    // The stale reply is the NEWEST applied so far here, so it is painted — with the answer laid over it.
    await act(async () => { stale(); await vi.advanceTimersByTimeAsync(10) })
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(screen.getByText('Accepted')).toBeTruthy()
    await act(async () => { fresh(); await vi.advanceTimersByTimeAsync(10) })
    expect(screen.getByText('Accepted')).toBeTruthy()
    expect(offerPosts()).toHaveLength(1)
  })

  it('a poll landing INSIDE the window does not bring the Accept/Decline buttons back', async () => {
    await openThread()
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    // Focus refetch = the same load() the 15s poll and the realtime nudge call.
    await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(50) })
    expect(calls.filter(isThreadGet).length).toBeGreaterThan(1)
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
    expect(screen.getByText('Declined')).toBeTruthy()
    expect(offerPosts()).toEqual([])
  })

  it('Undo restores the card and nothing is ever sent', async () => {
    const { unmount } = await openThread()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    const undo = render(toasts.state.shown[0].opts.action as React.ReactElement)
    fireEvent.click(undo.getByRole('button', { name: 'Undo' }))
    undo.unmount()
    expect(screen.getByRole('button', { name: 'Accept' })).toBeTruthy()
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    unmount()
    expect(offerPosts()).toEqual([])
  })
})

describe('leaving sends — never a silent drop', () => {
  it('navigating away inside the window sends the answer at once, with keepalive', async () => {
    const { unmount } = await openThread()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    unmount()
    expect(offerPosts()).toEqual([{ url: '/api/conversations/c1/offer', method: 'POST', body: { messageId: OFFER_ID, action: 'accept' }, keepalive: true }])
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(offerPosts()).toHaveLength(1)
    // Off-screen: the cached copy is refreshed so reopening the thread does not paint it pending.
    expect(chat.prefetchThread).toHaveBeenCalledWith('c1')
  })

  it('coming straight BACK while that answer is still in flight shows it answered — no live buttons, no second POST', async () => {
    const first = await openThread()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    holdPost = {}
    first.unmount() // leave → the POST goes out and hangs
    expect(offerPosts()).toHaveLength(1)
    // Back again at once: the cache and the refetch both still say pending (the server has not seen it).
    chat.cached = thread('pending')
    render(<ThreadPage />)
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull() // the cached paint
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull() // the refetch
    expect(screen.getByText('Accepted')).toBeTruthy()
    await act(async () => { holdPost!.release!(); await vi.advanceTimersByTimeAsync(50) })
    expect(offerPosts()).toHaveLength(1)
    expect(toasts.state.errors).toEqual([])
  })
})

describe('the server’s word', () => {
  it('a refusal after the window is said out loud and the card reverts to what the server holds', async () => {
    offerReply = { status: 409, body: { error: 'listing_unavailable' } }
    await openThread()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(5100) })
    expect(offerPosts()).toHaveLength(1)
    expect(toasts.state.errors).toEqual(['The listing is no longer available, so the offer was not accepted.'])
    expect(screen.getByRole('button', { name: 'Accept' })).toBeTruthy()
  })

  it('a refusal is still said out loud when the reconcile refetch fails too (the tunnel case)', async () => {
    offerReply = { status: 409, body: { error: 'not_actionable' } }
    await openThread()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    failGets = true
    await act(async () => { await vi.advanceTimersByTimeAsync(5100) })
    expect(offerPosts()).toHaveLength(1)
    expect(toasts.state.errors).toEqual(['That offer changed before your answer was sent, so it was not accepted.'])
  })

  it('a superseded refetch answering 403 does not replace a live thread with "not found"', async () => {
    await openThread()
    holdGets = true
    nextGetStatus = 403
    await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(10) })
    await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(10) })
    expect(heldGets).toHaveLength(2)
    const [older403, newer200] = heldGets
    await act(async () => { newer200(); await vi.advanceTimersByTimeAsync(10) })
    await act(async () => { older403(); await vi.advanceTimersByTimeAsync(10) })
    expect(screen.queryByText('Conversation not found.')).toBeNull()
    expect(screen.getByRole('button', { name: 'Accept' })).toBeTruthy()
  })

  it('an offer answered elsewhere during the window closes it WITHOUT sending, and says so', async () => {
    await openThread()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    serverStatus = 'countered'
    await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(50) })
    expect(screen.getByText('Countered')).toBeTruthy()
    expect(toasts.state.dismissed).toContain(1)
    expect(toasts.state.errors).toEqual(['That offer changed before your answer was sent, so it was not accepted.'])
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(offerPosts()).toEqual([])
  })
})

describe('what did not change', () => {
  it('⛔ Counter stays gated on negotiable', async () => {
    const orig = thread('pending')
    vi.stubGlobal('fetch', vi.fn((input: string) => Promise.resolve(json(200, String(input).split('?')[0] === '/api/conversations/c1'
      ? { ...orig, listing: { ...orig.listing, negotiable: false } }
      : {}))))
    render(<ThreadPage />)
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    await screen.findByRole('button', { name: 'Accept' })
    expect(screen.queryByRole('button', { name: 'Counter' })).toBeNull()
  })
})

/**
 * UX program 2 (A7) wiring in the same page, against the same harness: the one-time OPEN that clears the
 * bell (si-04), and the read receipt (inbox-07).
 */
describe('the bell clears with the thread (si-04)', () => {
  it('the OPEN is the one read that carries ?opened=1 — the poll and the focus refetch never do', async () => {
    await openThread()
    await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(50) })
    await act(async () => { await vi.advanceTimersByTimeAsync(15_100) })
    const gets = calls.filter(isThreadGet).map((c) => c.url)
    expect(gets.length).toBeGreaterThanOrEqual(3)
    expect(gets.filter((u) => u.includes('opened=1'))).toEqual(['/api/conversations/c1?opened=1'])
    expect(gets[0]).toBe('/api/conversations/c1?opened=1')
  })

  it('the bell refetches when a read reports cleared notifications — and only then', async () => {
    clearedOnOpen = 2
    await openThread()
    expect(notifs.refresh).toHaveBeenCalledTimes(1)
    await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(50) })
    expect(notifs.refresh).toHaveBeenCalledTimes(1)
  })

  it('nothing cleared, no bell refetch', async () => {
    await openThread()
    expect(notifs.refresh).not.toHaveBeenCalled()
  })
})

describe('the read receipt (inbox-07)', () => {
  // The server's read instant: the fixture's messages (08:00, 08:01) and 'm-mine' (08:01:30) are before it.
  const AS_OF = '2026-09-25T08:01:45.000Z'
  const myText = { id: 'm-mine', mine: true, body: 'Still here', createdAt: '2026-09-25T08:01:30.000Z', kind: 'text' }

  it('"Seen" sits under my newest message when the other side has read everything', async () => {
    const t = thread('pending')
    extraThread = { counterpartSeen: true, seenAsOf: AS_OF, messages: [...t.messages, myText] }
    await openThread()
    expect(document.querySelectorAll('[data-seen]')).toHaveLength(1)
    expect(document.querySelector('[data-seen]')!.textContent).toBe('Seen')
  })

  it('⛔ a text that just landed is "Sent", never "Seen" — the thread\'s receipt predates it', async () => {
    extraThread = { counterpartSeen: true, seenAsOf: AS_OF }
    await openThread()
    // Nothing of mine yet, so no receipt at all.
    expect(document.querySelector('[data-seen]')).toBeNull()
    // The seller's quick reply auto-sends through send() — the text path that appends WITHOUT a refetch.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yes, still available' })); await vi.advanceTimersByTimeAsync(50) })
    expect(calls.some((c) => c.url === '/api/conversations/c1/messages' && c.method === 'POST')).toBe(true)
    expect(screen.getByText('Yes, still available', { selector: 'p, span, div' })).toBeTruthy()
    expect(document.querySelectorAll('[data-seen]')).toHaveLength(1)
    expect(document.querySelector('[data-seen]')!.textContent).toBe('Sent')
  })

  it('⛔ NOT ONLY TEXT: my offer card created after the read is "Sent" too — the bound is the message, not its path', async () => {
    const t = thread('pending')
    const myOffer = { id: 'm-my-offer', mine: true, body: '', createdAt: '2026-09-25T08:02:10.000Z', kind: 'offer', offerAmount: 13_000_000, offerStatus: 'pending' }
    extraThread = { counterpartSeen: true, seenAsOf: AS_OF, messages: [...t.messages, myOffer] }
    render(<ThreadPage />)
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(document.querySelectorAll('[data-seen]')).toHaveLength(1)
    expect(document.querySelector('[data-seen]')!.textContent).toBe('Sent')
  })

  it('no receipt from a payload that predates the field', async () => {
    const t = thread('pending')
    extraThread = { messages: [...t.messages, myText] }
    await openThread()
    expect(document.querySelector('[data-seen]')).toBeNull()
  })
})

/**
 * THE ITEM STRIP'S GATES, WIRED (inbox-03). threadStripGates is unit-tested on its own (src/lib/thread-chrome.test.ts);
 * this pins that the page renders what it decides — on the real component, both sides of the thread.
 */
describe('the item strip (inbox-03) — the landmine gates, as rendered', () => {
  const base = () => thread('pending').listing
  async function openWith(extra: Record<string, unknown>) {
    extraThread = extra
    render(<ThreadPage />)
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    const strip = document.querySelector('[data-item-strip]') as HTMLElement | null
    expect(strip).not.toBeNull()
    return strip!
  }

  it('buyer, live listing that takes offers: "Make an offer" in the strip, and the composer tag only as the way back out', async () => {
    const strip = await openWith({ iAmSeller: false })
    expect(within(strip).getByRole('button', { name: 'Make an offer' })).toBeTruthy()
    // Exactly one "Make an offer" on screen — the tag is hidden while the strip offers.
    expect(screen.getAllByRole('button', { name: 'Make an offer' })).toHaveLength(1)
    expect(within(strip).queryByRole('button', { name: 'Mark sold' })).toBeNull()
    await act(async () => { fireEvent.click(within(strip).getByRole('button', { name: 'Make an offer' })); await vi.advanceTimersByTimeAsync(10) })
    expect(within(strip).getByRole('button', { name: 'Make an offer' }).getAttribute('aria-pressed')).toBe('true')
    // In offer mode the tag returns under its OWN name — never a second "Make an offer".
    expect(screen.getByRole('button', { name: 'Back to message' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Make an offer' })).toHaveLength(1)
  })

  it('⛔ a fixed-price listing: no offer entry point anywhere — strip or composer', async () => {
    await openWith({ iAmSeller: false, listing: { ...base(), negotiable: false } })
    expect(screen.queryByRole('button', { name: 'Make an offer' })).toBeNull()
  })

  it('⛔ a listing that is no longer live: no strip offer, no composer tag — the status says why', async () => {
    const strip = await openWith({ iAmSeller: false, listing: { ...base(), status: 'sold' } })
    expect(screen.queryByRole('button', { name: 'Make an offer' })).toBeNull()
    expect(within(strip).getByText('Sold')).toBeTruthy()
  })

  it('seller: no strip offer; "Mark sold" on an ordinary listing thread; the composer tag kept', async () => {
    const strip = await openWith({})
    expect(within(strip).queryByRole('button', { name: 'Make an offer' })).toBeNull()
    expect(within(strip).getByRole('button', { name: 'Mark sold' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Make an offer' })).toBeTruthy()
  })

  it('⛔ "Mark sold" never on a job, and never on a desk thread', async () => {
    let strip = await openWith({ listing: { ...base(), listingType: 'job' } })
    expect(within(strip).queryByRole('button', { name: 'Mark sold' })).toBeNull()
    cleanup()
    strip = await openWith({ kind: 'visa' })
    expect(within(strip).queryByRole('button', { name: 'Mark sold' })).toBeNull()
  })

  it('"Mark sold" on a NON-sale listing (a rental) still asks first (ui/alert-dialog), then makes the one status POST — and a "$&" in the title stays literal', async () => {
    const strip = await openWith({ listing: { ...base(), listingType: 'rent', title: 'Lamp $& $$ co' } })
    fireEvent.click(within(strip).getByRole('button', { name: 'Mark sold' }))
    const statusPosts = () => calls.filter((c) => c.url === '/api/listings/l1/status')
    expect(statusPosts()).toEqual([])
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Mark "Lamp $& $$ co" as sold?')).toBeTruthy()
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Mark as sold' })); await vi.advanceTimersByTimeAsync(50) })
    expect(statusPosts()).toEqual([{ url: '/api/listings/l1/status', method: 'POST', body: { status: 'sold' }, keepalive: undefined }])
    // "Who bought it?" describes a sale, not a tenancy: no sheet, no buyer lookup.
    expect(screen.queryByText('Who bought it?')).toBeNull()
    expect(calls.some((c) => c.url.startsWith('/api/listings/l1/buyers'))).toBe(false)
  })
})

/**
 * B6 — "WHO BOUGHT IT?" FROM THE THREAD. On a sale, every seller door to "sold" — the strip's 'Đã bán',
 * the "Deal! Mark as sold?" chip, the one-time prompt under an accepted offer — opens the same sheet with
 * THIS thread's buyer listed first, and the write goes through POST /sold (the same transition as the
 * status POST, plus who bought it), optimistic with a rollback.
 * ⚠️ The thread's buyer is PRE-PICKED only when the thread has a DEAL that still stands for this listing
 * (src/lib/thread-deal.ts) or the offer was just accepted — an open chat is not evidence they bought it
 * (B6 review). Without one, the seller taps the person.
 */
describe('"Who bought it?" from a thread (B6)', () => {
  const base = () => thread('pending').listing
  async function openWith(extra: Record<string, unknown>, status = 'pending') {
    serverStatus = status
    extraThread = extra
    render(<ThreadPage />)
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    return document.querySelector('[data-item-strip]') as HTMLElement
  }
  /** The open sheet — found from its title, so it never matches a "Mark as sold" outside it. */
  async function sheet() {
    const title = await screen.findByText('Who bought it?')
    await act(async () => { await vi.advanceTimersByTimeAsync(50) }) // the buyer lookup lands
    return title.closest('[role="dialog"]') as HTMLElement
  }
  const soldPosts = () => calls.filter((c) => c.url === '/api/listings/l1/sold')
  /** No deal in the thread → nobody is pre-picked: the seller taps this thread's buyer themselves. */
  const pickThreadBuyer = (s: HTMLElement) => fireEvent.click(within(s).getAllByRole('radio')[0])

  it('⛔ NO DEAL: the strip\'s "Mark sold" lists THIS thread\'s buyer first but picks NOBODY — one tap on them, one to file through /sold', async () => {
    const strip = await openWith({})
    fireEvent.click(within(strip).getByRole('button', { name: 'Mark sold' }))
    const s = await sheet()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(calls.filter((c) => c.url === '/api/listings/l1/buyers?scope=listing' && c.method === 'GET')).toHaveLength(1)
    // This thread's buyer first — but a pending offer is not a deal, so nobody is chosen for the seller.
    const radios = within(s).getAllByRole('radio')
    expect(radios[0].textContent).toContain('Buyer')
    expect(radios.every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true)
    const cta = within(s).getByRole('button', { name: 'Mark as sold' }) as HTMLButtonElement
    expect(cta.disabled).toBe(true)
    pickThreadBuyer(s)
    expect(cta.disabled).toBe(false)
    await act(async () => { fireEvent.click(cta); await vi.advanceTimersByTimeAsync(50) })
    expect(soldPosts()).toEqual([{ url: '/api/listings/l1/sold', method: 'POST', body: { buyerProfileId: 'p-buyer', salePrice: 15_000_000 }, keepalive: undefined }])
    expect(calls.some((c) => c.url === '/api/listings/l1/status')).toBe(false)
  })

  it('WITH A DEAL STANDING: the strip\'s "Mark sold" pre-picks THIS thread\'s buyer at the agreed price — one tap files it', async () => {
    const strip = await openWith({}, 'accepted')
    fireEvent.click(within(strip).getByRole('button', { name: 'Mark sold' }))
    const s = await sheet()
    const radios = within(s).getAllByRole('radio')
    expect(radios[0].getAttribute('aria-checked')).toBe('true')
    expect(within(s).getByRole('radio', { name: /Huy/ }).getAttribute('aria-checked')).toBe('false')
    expect((within(s).getByRole('textbox', { name: 'Agreed price' }) as HTMLInputElement).value).toBe('12,000,000')
    await act(async () => { fireEvent.click(within(s).getByRole('button', { name: 'Mark as sold' })); await vi.advanceTimersByTimeAsync(50) })
    expect(soldPosts().map((c) => c.body)).toEqual([{ buyerProfileId: 'p-buyer', salePrice: 12_000_000 }])
  })

  it('OPTIMISTIC: the strip says "Sold" while the write is out, and the sheet holds the spinner', async () => {
    const strip = await openWith({})
    fireEvent.click(within(strip).getByRole('button', { name: 'Mark sold' }))
    const s = await sheet()
    pickThreadBuyer(s)
    holdSold = {}
    await act(async () => { fireEvent.click(within(s).getByRole('button', { name: 'Mark as sold' })); await vi.advanceTimersByTimeAsync(10) })
    expect(soldPosts()).toHaveLength(1)
    expect(within(strip).getByText('Sold')).toBeTruthy()
    // `hidden: true` — the open (modal) sheet hides the page behind it from role queries; the button must be GONE, not hidden.
    expect(within(strip).queryByRole('button', { name: 'Mark sold', hidden: true })).toBeNull()
    // Still mounted through its own flip (the mount ignores status), still writing.
    expect((within(s).getByRole('button', { name: 'Mark as sold' }) as HTMLButtonElement).disabled).toBe(true)
    extraThread = { listing: { ...base(), status: 'sold' } } // what the server holds once it lands
    await act(async () => { holdSold!.release!(); await vi.advanceTimersByTimeAsync(50) })
    expect(within(strip).getByText('Sold')).toBeTruthy()
    expect(soldPosts()).toHaveLength(1)
  })

  it('⛔ ROLLBACK: the write fails AND the reconcile read fails — "Mark sold" is back, never a stale "Sold", and the sheet says why', async () => {
    const strip = await openWith({})
    fireEvent.click(within(strip).getByRole('button', { name: 'Mark sold' }))
    const s = await sheet()
    pickThreadBuyer(s)
    soldReplyCode = 500
    failGets = true // the same bad connection takes the reconcile refetch down too
    await act(async () => { fireEvent.click(within(s).getByRole('button', { name: 'Mark as sold' })); await vi.advanceTimersByTimeAsync(50) })
    expect(soldPosts()).toHaveLength(1)
    // `hidden: true` — the sheet is still open (modal) over the strip; the button is back in the strip itself.
    expect(within(strip).getByRole('button', { name: 'Mark sold', hidden: true })).toBeTruthy()
    expect(within(strip).queryByText('Sold')).toBeNull()
    // Said in the sheet (which stays open and re-arms its CTA for the retry), not as a toast.
    expect(within(s).getByRole('alert').textContent).toBe('Could not mark as sold — please try again.')
    expect((within(s).getByRole('button', { name: 'Mark as sold' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('⛔ a RETARGET while the sheet is open cannot change what it sells — the write goes to the listing tapped', async () => {
    const strip = await openWith({})
    fireEvent.click(within(strip).getByRole('button', { name: 'Mark sold' }))
    const s = await sheet()
    pickThreadBuyer(s)
    // The buyer asks the same seller about another item: the 15s poll brings the thread back about it.
    extraThread = { listing: { ...base(), id: 'l2', title: 'Table' } }
    await act(async () => { await vi.advanceTimersByTimeAsync(15_100) })
    expect(within(strip).getByText('Table')).toBeTruthy()
    expect(within(s).getByText('Road bike')).toBeTruthy() // the sheet still says what it is selling
    await act(async () => { fireEvent.click(within(s).getByRole('button', { name: 'Mark as sold' })); await vi.advanceTimersByTimeAsync(50) })
    expect(soldPosts()).toHaveLength(1)
    expect(calls.some((c) => c.url === '/api/listings/l2/sold')).toBe(false)
    // …and the strip, now about the table, was never flipped to "Sold".
    expect(within(strip).queryByText('Sold')).toBeNull()
  })

  it('the "Deal! Mark as sold?" chip appears once the thread agreed a price — and the price is the one agreed', async () => {
    await openWith({}, 'accepted')
    fireEvent.click(screen.getByRole('button', { name: 'Deal! Mark as sold?' }))
    const s = await sheet()
    const radios = within(s).getAllByRole('radio')
    expect(radios[0].getAttribute('aria-checked')).toBe('true')
    expect((within(s).getByRole('textbox', { name: 'Agreed price' }) as HTMLInputElement).value).toBe('12,000,000')
    await act(async () => { fireEvent.click(within(s).getByRole('button', { name: 'Mark as sold' })); await vi.advanceTimersByTimeAsync(50) })
    expect(soldPosts().map((c) => c.body)).toEqual([{ buyerProfileId: 'p-buyer', salePrice: 12_000_000 }])
  })

  it('the agreed price is the one AT THE TAP: a buyer message landing while the sheet is open does not move it', async () => {
    await openWith({}, 'accepted')
    fireEvent.click(screen.getByRole('button', { name: 'Deal! Mark as sold?' }))
    const s = await sheet()
    const price = () => (within(s).getByRole('textbox', { name: 'Agreed price' }) as HTMLInputElement).value
    expect(price()).toBe('12,000,000')
    // The buyer writes again — the deal no longer "stands" for the chip, but this sheet is about the tap.
    extraThread = { messages: [...thread('accepted').messages, { id: 'm-more', mine: false, body: 'Mấy giờ lấy được ạ?', createdAt: '2026-09-25T09:00:00.000Z', kind: 'text' }] }
    await act(async () => { await vi.advanceTimersByTimeAsync(15_100) })
    expect(screen.getByText('Mấy giờ lấy được ạ?')).toBeTruthy()
    expect(price()).toBe('12,000,000')
  })

  it('no agreement, no chip — a pending offer is not a deal', async () => {
    await openWith({})
    expect(screen.queryByRole('button', { name: 'Deal! Mark as sold?' })).toBeNull()
  })

  it('⛔ a deal the conversation has moved past is not offered: no chip, and the price starts at the ask', async () => {
    // The buyer wrote after the accepted offer — which is also exactly what a RETARGET leaves behind (the
    // sofa's accepted offer, now in a thread about the table). src/lib/thread-deal.ts has the full rule.
    const accepted = thread('accepted').messages
    const strip = await openWith({ messages: [...accepted, { id: 'm-next', mine: false, body: 'Còn cái bàn không ạ?', createdAt: '2026-09-25T09:00:00.000Z', kind: 'text' }] }, 'accepted')
    expect(screen.queryByRole('button', { name: 'Deal! Mark as sold?' })).toBeNull()
    fireEvent.click(within(strip).getByRole('button', { name: 'Mark sold' }))
    const s = await sheet()
    expect((within(s).getByRole('textbox', { name: 'Agreed price' }) as HTMLInputElement).value).toBe('15,000,000')
  })

  it('⛔ nor after a relist: the listing re-confirmed after the deal closes it', async () => {
    await openWith({ listing: { ...base(), availabilityConfirmedAt: '2026-09-26T08:00:00.000Z' } }, 'accepted')
    expect(screen.queryByRole('button', { name: 'Deal! Mark as sold?' })).toBeNull()
  })

  it('the prompt under the offer the seller just accepted opens the SAME sheet — and the chip stays away while it is up', async () => {
    await openThread()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(5200) }) // the undo window, then the POST
    expect(await screen.findByText('Deal! Mark "Road bike" as sold?')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Deal! Mark as sold?' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Mark as sold' }))
    const s = await sheet()
    expect(within(s).getAllByRole('radio')[0].getAttribute('aria-checked')).toBe('true')
    // The prompt knows ITS offer: the price is the one just accepted.
    expect((within(s).getByRole('textbox', { name: 'Agreed price' }) as HTMLInputElement).value).toBe('12,000,000')
    expect(calls.some((c) => c.url === '/api/listings/l1/status')).toBe(false)
  })

  it('⛔ the post-accept prompt is about the listing it was accepted ON — after a retarget it goes, never "mark the NEW item sold"', async () => {
    await openThread()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(5200) })
    expect(await screen.findByText('Deal! Mark "Road bike" as sold?')).toBeTruthy()
    // An accepted offer does not block a retarget: the buyer asks the same seller about another item, and
    // the poll brings the thread back about it — with the bike's accepted offer still in the timeline.
    extraThread = { listing: { ...thread('accepted').listing, id: 'l2', title: 'Table' } }
    await act(async () => { await vi.advanceTimersByTimeAsync(15_100) })
    expect(screen.getByText('Table')).toBeTruthy()
    expect(screen.queryByText('Deal! Mark "Table" as sold?')).toBeNull()
    expect(screen.queryByText('Deal! Mark "Road bike" as sold?')).toBeNull()
    expect(screen.queryByText('Who bought it?')).toBeNull()
  })

  it('a lookup that fails never becomes "nobody messaged": the sheet closes and says so, and nothing is filed', async () => {
    buyersReply = { status: 500, body: { error: 'server_error' } }
    const strip = await openWith({})
    fireEvent.click(within(strip).getByRole('button', { name: 'Mark sold' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(toasts.state.errors).toContain('Could not load who messaged you — please try again.')
    expect(soldPosts()).toEqual([])
  })

  it('⛔ no sheet for the buyer: no "Mark sold", no chip, no buyer lookup — even on an agreed deal', async () => {
    const strip = await openWith({ iAmSeller: false }, 'accepted')
    expect(within(strip).queryByRole('button', { name: 'Mark sold' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Deal! Mark as sold?' })).toBeNull()
    expect(screen.queryByText('Who bought it?')).toBeNull()
    expect(calls.some((c) => c.url.startsWith('/api/listings/l1/buyers'))).toBe(false)
  })
})

describe('the guest and not-found states keep a way back (phone: no site header on a thread)', () => {
  it('"Conversation not found" carries the Back bar', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json(404, { error: 'not_found' }))))
    render(<ThreadPage />)
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(screen.getByText('Conversation not found.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back' })).toBeTruthy()
  })

  it('the signed-out prompt carries the Back bar', async () => {
    const user = stable.auth.user
    ;(stable.auth as { user: unknown }).user = null
    try {
      render(<ThreadPage />)
      await act(async () => { await vi.advanceTimersByTimeAsync(50) })
      expect(screen.getByText('Sign in to view this conversation.')).toBeTruthy()
      expect(screen.getByRole('link', { name: 'Back' })).toBeTruthy()
    } finally {
      ;(stable.auth as { user: unknown }).user = user
    }
  })
})

describe('the one-time open, really once (si-04)', () => {
  it('⛔ re-running the thread effect — an answered offer, a new user object from a token refresh — never re-sends ?opened=1', async () => {
    const view = await openThread()
    // Answer the offer: the undo window opens, closes, and its reconcile refetch runs.
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(5_200) })
    const getsBefore = calls.filter(isThreadGet).length
    // A token refresh hands the page a NEW user object: the effect that sends the open runs again.
    const user = stable.auth.user
    ;(stable.auth as { user: unknown }).user = { id: 'u-seller' }
    try {
      view.rerender(<ThreadPage />)
      await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    } finally {
      ;(stable.auth as { user: unknown }).user = user
    }
    // The effect really ran again (it refetched)…
    expect(calls.filter(isThreadGet).length).toBeGreaterThan(getsBefore)
    // …and the open went out exactly once, on the first load.
    expect(calls.filter(isThreadGet).filter((c) => c.url.includes('opened=1')).map((c) => c.url)).toEqual(['/api/conversations/c1?opened=1'])
  })
})

describe('the strip placeholder while a thread loads (no jump on a listing-less thread)', () => {
  const row = (listingId: string | null | undefined) => ({ id: 'c1', listingId, listingTitle: '', listingImage: null, lastMessageAt: '2026-09-25T08:00:00.000Z', lastMessageText: null, unread: 0, counterpart: { name: 'Buyer', avatarColor: '#888', avatarUrl: null } })
  async function loading() {
    holdGets = true // the thread stays uncached: its loading state is what renders
    render(<ThreadPage />)
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    return document.querySelector('[data-strip-skeleton]')
  }

  it('an uncached thread paints the strip placeholder (as loading.tsx does)', async () => {
    expect(await loading()).not.toBeNull()
  })

  it('⛔ not for a thread the inbox list already knows has NO listing (support, the rental desk)', async () => {
    chat.convos = [row(null)]
    expect(await loading()).toBeNull()
  })

  it('a known listing thread, or an older cached row without the field, keeps it', async () => {
    chat.convos = [row('l1')]
    expect(await loading()).not.toBeNull()
    cleanup()
    chat.convos = [row(undefined)]
    expect(await loading()).not.toBeNull()
  })
})

/**
 * THE BUYER'S HALF — "did you buy this?" (trade loop, 2026-10-05). When a seller names this person as who
 * bought something, the notification and push bring them HERE, to their thread with that seller, and the
 * question is answered in one tap above the composer. The post-deal review card waits while it is open:
 * one card at a time, and the review only once both sides have spoken.
 */
describe('the buyer\'s "did you buy this?" in the thread', () => {
  const QUESTION = { saleId: 'l1:1000', listingId: 'l1', title: 'Road bike', price: 12_000_000, currency: '₫' }
  const asBuyer = () => ({
    iAmSeller: false,
    counterpart: { name: 'Minh Shop', avatarColor: '#888', avatarUrl: null, sellerId: 's1', locale: 'en', trust: null },
    listing: { ...thread('pending').listing, status: 'sold' },
  })
  const questionGets = () => calls.filter((c) => c.url === '/api/conversations/c1/sale-question')

  it('the seller\'s question is shown — and ONE tap answers it; the review card waits until it has', async () => {
    saleQuestions = [QUESTION]
    extraThread = asBuyer()
    render(<ThreadPage />)
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(questionGets()).toHaveLength(1)
    const group = screen.getByRole('group', { name: /says you bought/ })
    expect(group.textContent).toContain('Minh Shop says you bought Road bike for 12,000,000 đ.')
    // One card at a time: the review waits for the answer.
    expect(screen.queryByText('How was your experience with Minh Shop?')).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yes, I bought it' })); await vi.advanceTimersByTimeAsync(50) })
    expect(calls.filter((c) => c.url === '/api/listings/l1/sale-confirmation')).toEqual([
      { url: '/api/listings/l1/sale-confirmation', method: 'POST', body: { answer: 'confirm', price: 12_000_000 }, keepalive: undefined },
    ])
    expect(screen.getByText('Confirmed — this deal is now on record for both of you.')).toBeTruthy()
    // Both sides have spoken: now the review.
    expect(screen.getByText('How was your experience with Minh Shop?')).toBeTruthy()
  })

  it('⛔ the review card waits until "nothing is being asked" is KNOWN: not while the lookup is out…', async () => {
    saleQuestionReply = 'hold'
    extraThread = asBuyer()
    render(<ThreadPage />)
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(questionGets()).toHaveLength(1)
    expect(screen.queryByText('How was your experience with Minh Shop?')).toBeNull()
  })

  it('⛔ …and not when the lookup FAILED (a question may be open; the next open asks again)', async () => {
    saleQuestionReply = 500
    extraThread = asBuyer()
    render(<ThreadPage />)
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(screen.queryByText('How was your experience with Minh Shop?')).toBeNull()
  })

  it('with nothing asked, nothing changes: no card, and the review card shows as it always did', async () => {
    extraThread = asBuyer()
    render(<ThreadPage />)
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(questionGets()).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Yes, I bought it' })).toBeNull()
    expect(screen.getByText('How was your experience with Minh Shop?')).toBeTruthy()
  })

  it('⛔ never on the SELLER\'s side, and never in a thread with no seller identity (the rental desk)', async () => {
    saleQuestions = [QUESTION]
    await openThread() // the seller's view
    expect(questionGets()).toEqual([])
    cleanup()
    extraThread = { ...asBuyer(), counterpart: { ...asBuyer().counterpart, sellerId: null } }
    render(<ThreadPage />)
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(questionGets()).toEqual([])
  })
})

describe('the open is confirmed by the server, not by asking (si-04)', () => {
  const opens = () => calls.filter(isThreadGet).filter((c) => c.url.includes('opened=1')).length
  const refetch = async () => { await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(50) }) }

  it('⛔ a first load the network dropped: the NEXT refetch carries the open again — and once it lands, no more', async () => {
    failFirstGets = 1
    render(<ThreadPage />)
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(opens()).toBe(1)
    await refetch()
    expect(opens()).toBe(2) // retried — the first never reached the server
    await refetch()
    expect(opens()).toBe(2) // confirmed — every later read is plain
  })

  it('⛔ an open whose fail-soft clear FAILED on the server (openCleared false) is asked again', async () => {
    openClearedReply = false
    await openThread()
    expect(opens()).toBe(1)
    openClearedReply = true
    await refetch()
    expect(opens()).toBe(2)
    await refetch()
    expect(opens()).toBe(2)
  })

  it('never two opens at once: a refetch while the open is in flight is a plain read', async () => {
    holdGets = true
    render(<ThreadPage />)
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(10) })
    const gets = calls.filter(isThreadGet).map((c) => c.url)
    expect(gets).toEqual(['/api/conversations/c1?opened=1', '/api/conversations/c1'])
    await act(async () => { heldGets.forEach((r) => r()); heldGets = []; await vi.advanceTimersByTimeAsync(10) })
  })
})

describe('"Mark sold" rolls back on its own (inbox-03)', () => {
  it('⛔ the POST fails AND the reconcile read fails: the strip offers "Mark sold" again — never a stale "Sold"', async () => {
    // The AlertDialog path — a non-sale listing (a sale opens "Who bought it?"; its rollback is pinned in the B6 block).
    extraThread = { listing: { ...thread('pending').listing, listingType: 'rent' } }
    await openThread()
    const strip = document.querySelector('[data-item-strip]') as HTMLElement
    fireEvent.click(within(strip).getByRole('button', { name: 'Mark sold' }))
    const dialog = await screen.findByRole('alertdialog')
    statusReplyCode = 500
    failGets = true // the same bad connection takes the reconcile refetch down too
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Mark as sold' })); await vi.advanceTimersByTimeAsync(50) })
    expect(calls.some((c) => c.url === '/api/listings/l1/status' && c.method === 'POST')).toBe(true)
    expect(toasts.state.errors).toContain('Could not mark as sold — please try again.')
    expect(within(strip).getByRole('button', { name: 'Mark sold' })).toBeTruthy()
    expect(within(strip).queryByText('Sold')).toBeNull()
  })
})

describe('the payment-lure warning reaches only the payer (A7 item 8)', () => {
  const base = () => thread('pending')
  async function open(extra: Record<string, unknown>) {
    extraThread = extra
    render(<ThreadPage />)
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
  }

  it('⛔ the SELLER is never warned when the buyer offers money ("mình đặt cọc nhé")', async () => {
    await open({ messages: [...base().messages, { id: 'm-deposit', mine: false, body: 'Mình đặt cọc nhé', createdAt: '2026-09-25T08:02:00.000Z', kind: 'text' }] })
    expect(screen.getByText('Mình đặt cọc nhé')).toBeTruthy()
    expect(document.querySelector('[data-payment-lure]')).toBeNull()
  })

  it('the BUYER is warned when the seller asks for a transfer up front', async () => {
    await open({ iAmSeller: false, messages: [...base().messages, { id: 'm-ck', mine: false, body: 'Chuyen khoan truoc nhe', createdAt: '2026-09-25T08:02:00.000Z', kind: 'text' }] })
    expect(document.querySelectorAll('[data-payment-lure]')).toHaveLength(1)
  })

  it('a payload that does not say which side this is gets no warning', async () => {
    await open({ iAmSeller: undefined, messages: [...base().messages, { id: 'm-ck', mine: false, body: 'Chuyen khoan truoc nhe', createdAt: '2026-09-25T08:02:00.000Z', kind: 'text' }] })
    expect(document.querySelector('[data-payment-lure]')).toBeNull()
  })
})

/**
 * ⛔ SENDING BEFORE THE THREAD HAS LOADED (Emil-skills audit, 2026-10-06). Sent from an uncached thread's
 * skeleton, the composer emptied, no bubble was drawn, and a failed POST had nothing to mark — the words were
 * gone. Every send now waits for the thread, the text stays put, and Send says it is not ready yet.
 */
describe('sending waits for the thread (fix 3b)', () => {
  beforeEach(() => {
    // jsdom has no innerText, which the contenteditable composer reads on `input`.
    if (!('innerText' in HTMLElement.prototype)) {
      Object.defineProperty(HTMLElement.prototype, 'innerText', {
        configurable: true,
        get() { return (this as HTMLElement).textContent ?? '' },
        set(v: string) { (this as HTMLElement).textContent = v },
      })
    }
  })
  const messagePosts = () => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/messages'))
  const field = () => screen.getByRole('textbox', { name: 'Write a message' })
  const type = async (value: string) => {
    field().textContent = value
    await act(async () => { fireEvent.input(field()) })
  }

  it('⛔ Return and Send before an uncached thread loads send nothing and keep the text; it sends once the thread is here', async () => {
    holdGets = true
    render(<ThreadPage />)
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    await type('Is it still available?')
    await act(async () => { fireEvent.keyDown(field(), { key: 'Enter' }) })
    expect(messagePosts()).toEqual([]) // it used to POST with no bubble to show for it, and empty the field
    expect(field().textContent).toBe('Is it still available?')
    expect(screen.getByRole('button', { name: 'Send' }).getAttribute('aria-disabled')).toBe('true')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })) })
    expect(messagePosts()).toEqual([])
    expect(field().textContent).toBe('Is it still available?')
    await act(async () => { heldGets.splice(0).forEach((release) => release()); await vi.advanceTimersByTimeAsync(50) })
    expect(screen.getByRole('button', { name: 'Send' }).getAttribute('aria-disabled')).toBeNull()
    // Return reaches the latest send, not the one from the skeleton's render (the composer reads onSend via a ref)…
    await act(async () => { fireEvent.keyDown(field(), { key: 'Enter' }); await vi.advanceTimersByTimeAsync(50) })
    // …and so does the Send button.
    await type('Can I see it today?')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); await vi.advanceTimersByTimeAsync(50) })
    expect(messagePosts().map((c) => (c.body as { body: string }).body)).toEqual(['Is it still available?', 'Can I see it today?'])
  })

  // Insurance, not a state Next produces: each thread id is its own page instance (the [id] segment is keyed by its
  // value). If one were ever handed another id while still showing a thread, nothing may post to the new id from
  // under the old conversation.
  it('a thread on screen that is not this id\'s is not sendable', async () => {
    const view = await openThread() // c1
    const base = globalThis.fetch as unknown as (input: string, init?: RequestInit) => Promise<Response>
    vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => (
      String(input).split('?')[0] === '/api/conversations/c2' && (init?.method ?? 'GET') === 'GET' ? new Promise<Response>(() => {}) : base(input, init)
    )))
    stable.params.id = 'c2'
    try {
      view.rerender(<ThreadPage />)
      await act(async () => { await vi.advanceTimersByTimeAsync(50) })
      await type('Meant for c2')
      await act(async () => { fireEvent.keyDown(field(), { key: 'Enter' }) })
      expect(messagePosts()).toEqual([])
      expect(field().textContent).toBe('Meant for c2')
    } finally {
      stable.params.id = 'c1'
    }
  })
})
