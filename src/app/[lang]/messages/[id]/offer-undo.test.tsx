// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

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
}))
vi.mock('@/context/chat-context', () => ({ useChat: () => chat }))
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
  holdGets = false
  heldGets = []
  failGets = false
  nextGetStatus = null
  holdPost = null
  // Module-level on purpose (it outlives a page — see offer-choices.ts), so each test starts clean.
  unconfirmedOfferChoices.clear()
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined, keepalive: init?.keepalive })
    if (url === '/api/conversations/c1' && method === 'GET') {
      // The body is what the server holds WHEN THE REQUEST ARRIVES, even if the reply lands later.
      const body = thread(serverStatus)
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
    expect(calls.filter((c) => c.url === '/api/conversations/c1' && c.method === 'GET').length).toBeGreaterThan(1)
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
    vi.stubGlobal('fetch', vi.fn((input: string) => Promise.resolve(json(200, String(input) === '/api/conversations/c1'
      ? { ...orig, listing: { ...orig.listing, negotiable: false } }
      : {}))))
    render(<ThreadPage />)
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    await screen.findByRole('button', { name: 'Accept' })
    expect(screen.queryByRole('button', { name: 'Counter' })).toBeNull()
  })
})
