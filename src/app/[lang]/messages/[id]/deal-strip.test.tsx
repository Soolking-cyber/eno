// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

/**
 * THE THREAD PAGE'S SERVICE-DEAL CONTROL (src/lib/service-deal.ts, owner 2026-11-11) — against the real landmine page with
 * its network replaced (the offer-undo.test.tsx harness). The SELLER's existing strip slot is extended, never a new row:
 * on a live rental the 'Đã cho thuê' pill becomes a menu (confirm, then the old mark-rented item, whose old dialog is
 * unchanged); on a teacher thread or a rented listing it is one pill in the same slot; the undo exists only while the
 * server says so. A refusal rolls back and says why. The BUYER never gets the control — they get the review card's
 * "did you…?" — and the deal lines read in the viewer's language.
 * ⚠️ EXPLICIT CLEANUP — no vitest `globals`, so Testing Library registers no afterEach of its own.
 */

const toasts = vi.hoisted(() => {
  const state = { errors: [] as string[], successes: [] as string[] }
  const toast = Object.assign(() => 0, {
    dismiss: () => {},
    error: (msg: string) => { state.errors.push(msg); return 0 },
    success: (msg: string) => { state.successes.push(msg); return 0 },
    loading: () => 0,
    message: () => 0,
  })
  return { state, toast }
})
vi.mock('sonner', () => ({ toast: toasts.toast }))

const chat = vi.hoisted(() => ({
  cached: null as unknown,
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
// ⚠️ STABLE IDENTITIES (offer-undo.test.tsx): a fresh router, user or tr() per render re-runs every effect forever.
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
vi.mock('@/context/auth-context', () => ({ useAuth: () => stable.auth, preloadSignIn: () => {} }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => stable.lang,
  useTr: () => stable.lang.tr,
  Tr: ({ en, text }: { en?: string; text?: string }) => en ?? text ?? '',
}))
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowser: () => ({ auth: { getSession: () => Promise.resolve({ data: { session: null } }) } }),
}))

import ThreadPage from './page'

/** The words under test, held as constants (the ui-strings harvester reads test files too). */
const W = {
  markRented: 'Mark rented', markAsRented: 'Mark as rented', confirmRented: 'Confirm Buyer rented it',
  confirmLesson: 'Confirm lesson', confirmRental: 'Confirm rental', confirmed: 'Confirmed', withdraw: 'Withdraw',
  withdrawItem: 'Withdraw confirmation', confirm: 'Confirm', cancel: 'Cancel',
  tooFew: 'Chat with Buyer here first — you can confirm once you have both written in this chat.',
  didYouRent: 'Did you rent from Landlord?',
  declinedLine: 'Buyer said this didn’t happen',
  declinedLineVi: 'Buyer cho biết việc này không diễn ra',
  declinedRefusal: 'Buyer said this didn’t happen, so it can’t be confirmed again.',
  declinedRefusalVi: 'Buyer cho biết việc này không diễn ra nên không thể xác nhận nữa.',
}

type Row = Record<string, any>
let threadBody: Row = {}
let dealReply: { status: number; body: unknown } = { status: 200, body: {} }
let calls: { url: string; method: string; body?: unknown }[] = []

const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }) as unknown as Response
class NoopObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } }

const sellerThread = (over: Row = {}): Row => ({
  id: 'c1', me: 'u-seller', kind: 'listing', iAmSeller: true, hasReviewed: false, teacher: null,
  listing: { id: 'l1', title: 'Studio D3', image: null, price: 9_000_000, negotiable: true, status: 'active', listingType: 'rent', categorySlug: 'rentals' },
  counterpart: { name: 'Buyer', avatarColor: '#888', avatarUrl: null, sellerId: null, locale: 'en', trust: null },
  messages: [
    { id: 'm1', mine: false, body: 'Is it free from December?', createdAt: '2026-11-10T08:00:00.000Z', kind: 'text' },
    { id: 'm2', mine: true, body: 'Yes it is', createdAt: '2026-11-10T08:01:00.000Z', kind: 'text' },
  ],
  deal: { kind: 'rental', state: 'none', confirmsLeft: 2 },
  ...over,
})

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', NoopObserver)
  vi.stubGlobal('IntersectionObserver', NoopObserver)
  if (!window.matchMedia) {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  }
  Element.prototype.scrollIntoView ??= function () {}
  Element.prototype.scrollTo ??= function () {} as never
  Element.prototype.getAnimations ??= () => []
  vi.useFakeTimers({ shouldAdvanceTime: true })
  stable.auth = { user: { id: 'u-seller' }, loading: false, openSignIn: () => {} }
  stable.lang = { lang: 'en', tr: (en: string) => en, t: (k: string) => k, setLang: () => {} }
  toasts.state.errors.length = 0
  toasts.state.successes.length = 0
  chat.cached = null
  chat.convos = null
  calls = []
  threadBody = sellerThread()
  dealReply = { status: 200, body: { deal: { kind: 'rental', state: 'confirmed', confirmsLeft: 1 } } }
  vi.stubGlobal('fetch', vi.fn((input: string, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (method === 'GET' && url.split('?')[0] === '/api/conversations/c1') return Promise.resolve(json(200, { ...threadBody, notificationsCleared: 0, openCleared: true }))
    if (url === '/api/conversations/c1/deal' && method === 'POST') return Promise.resolve(json(dealReply.status, dealReply.body))
    if (url === '/api/conversations/c1/sale-question' && method === 'GET') return Promise.resolve(json(200, { questions: [] }))
    return Promise.resolve(json(200, {}))
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function openThread() {
  const view = render(<ThreadPage />)
  await act(async () => { await vi.advanceTimersByTimeAsync(50) })
  await screen.findByText('Studio D3')
  return view
}
const dealPosts = () => calls.filter((c) => c.url === '/api/conversations/c1/deal')

describe('the seller on a live rental: the existing pill becomes a menu', () => {
  it('the pill opens a menu with the confirm and the old mark-rented item — which still opens the old dialog', async () => {
    await openThread()
    const pill = screen.getByRole('button', { name: W.markRented })
    expect(pill.getAttribute('aria-haspopup')).toBe('menu')
    fireEvent.click(pill)
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: W.confirmRented })).toBeTruthy()
    fireEvent.click(within(menu).getByRole('menuitem', { name: W.markAsRented }))
    expect(await screen.findByRole('alertdialog', { name: 'Mark "Studio D3" as rented?' })).toBeTruthy()
    expect(dealPosts()).toEqual([])
  })

  it('confirm: the dialog names the person and the listing, then POSTs the listing it showed', async () => {
    await openThread()
    fireEvent.click(screen.getByRole('button', { name: W.markRented }))
    fireEvent.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: W.confirmRented }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Confirm Buyer rented "Studio D3"?' })
    // A2: both edges of the 10 minutes — the undo now, the review after.
    expect(within(dialog).getByText(/You can undo this in the next 10 minutes; after that Buyer can review you\. Your listing stays up\./)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: W.confirm }))
    await waitFor(() => expect(dealPosts()).toHaveLength(1))
    expect(dealPosts()[0]!.body).toEqual({ action: 'confirm', listingId: 'l1' })
    await waitFor(() => expect(toasts.state.successes).toEqual(['Rental confirmed — Buyer can review you in 10 minutes']))
  })

  it('⛔ a goods thread (no `deal` from the server) keeps the plain pill — no menu', async () => {
    threadBody = sellerThread({ deal: undefined, listing: { ...sellerThread().listing, listingType: 'sell', categorySlug: 'electronics' } })
    await openThread()
    const pill = screen.getByRole('button', { name: 'Mark sold' })
    expect(pill.getAttribute('aria-haspopup')).toBeNull()
  })
})

describe('the single pill in the same slot', () => {
  it('a teacher thread: "Confirm lesson" — the dialog asks "Confirm you taught Buyer?"', async () => {
    threadBody = sellerThread({
      listing: { ...sellerThread().listing, listingType: 'teacher', categorySlug: 'teachers', price: undefined },
      teacher: { shared: false, live: true, hasPhone: true, phoneShared: false, video: null, writerVerified: null },
      deal: { kind: 'lesson', state: 'none', confirmsLeft: 2 },
    })
    await openThread()
    expect(screen.queryByRole('button', { name: W.markRented })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: W.confirmLesson }))
    expect(await screen.findByRole('alertdialog', { name: 'Confirm you taught Buyer?' })).toBeTruthy()
  })

  it('a rental already rented: "Confirm rental"', async () => {
    threadBody = sellerThread({ listing: { ...sellerThread().listing, status: 'sold' } })
    await openThread()
    expect(screen.getByRole('button', { name: W.confirmRental })).toBeTruthy()
  })

  it('confirmed with the undo open: "Confirmed" opens the withdraw dialog; Withdraw POSTs the undo', async () => {
    threadBody = sellerThread({ listing: { ...sellerThread().listing, status: 'sold' }, deal: { kind: 'rental', state: 'confirmed', confirmsLeft: 1, withdrawUntil: new Date(Date.now() + 5 * 60_000).toISOString() } })
    dealReply = { status: 200, body: { deal: { kind: 'rental', state: 'none', confirmsLeft: 1 } } }
    await openThread()
    fireEvent.click(screen.getByRole('button', { name: `${W.confirmed} — ${W.withdrawItem}` }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Withdraw your confirmation?' })
    expect(within(dialog).getByText('Buyer will no longer be able to review you from this chat. You can confirm again once.')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: W.withdraw }))
    await waitFor(() => expect(dealPosts().map((c) => c.body)).toEqual([{ action: 'withdraw' }]))
  })

  it('confirmed, the undo closed: a plain "Confirmed" — nothing to tap', async () => {
    threadBody = sellerThread({ listing: { ...sellerThread().listing, status: 'sold' }, deal: { kind: 'rental', state: 'confirmed', confirmsLeft: 1 } })
    await openThread()
    expect(screen.getByText(W.confirmed)).toBeTruthy()
    expect(screen.queryByRole('button', { name: new RegExp(W.confirmed) })).toBeNull()
  })

  it('⛔ a refusal rolls the optimistic flip back and toasts its own words', async () => {
    threadBody = sellerThread({ listing: { ...sellerThread().listing, status: 'sold' } })
    dealReply = { status: 403, body: { error: 'too_few_messages' } }
    await openThread()
    fireEvent.click(screen.getByRole('button', { name: W.confirmRental }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: W.confirm }))
    await waitFor(() => expect(toasts.state.errors).toEqual([W.tooFew]))
    expect(screen.getByRole('button', { name: W.confirmRental })).toBeTruthy()
  })

  it('⛔ a deal_declined refusal toasts the seller "{name} said this didn’t happen, so it can’t be confirmed again."', async () => {
    threadBody = sellerThread({ listing: { ...sellerThread().listing, status: 'sold' } })
    dealReply = { status: 409, body: { error: 'deal_declined' } }
    await openThread()
    fireEvent.click(screen.getByRole('button', { name: W.confirmRental }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: W.confirm }))
    await waitFor(() => expect(toasts.state.errors).toEqual([W.declinedRefusal]))
  })

  it('…in Vietnamese: "{name} cho biết việc này không diễn ra nên không thể xác nhận nữa."', async () => {
    stable.lang = { lang: 'vi', tr: (_en: string, vi?: string) => vi ?? _en, t: (k: string) => k, setLang: () => {} } as typeof stable.lang
    threadBody = sellerThread({ listing: { ...sellerThread().listing, status: 'sold' } })
    dealReply = { status: 409, body: { error: 'deal_declined' } }
    await openThread()
    fireEvent.click(screen.getByRole('button', { name: 'Xác nhận đã cho thuê' }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Xác nhận' }))
    await waitFor(() => expect(toasts.state.errors).toEqual([W.declinedRefusalVi]))
  })

  it('⛔ reviewed: no control at all', async () => {
    threadBody = sellerThread({ listing: { ...sellerThread().listing, status: 'sold' }, deal: { kind: 'rental', state: 'reviewed', confirmsLeft: 1 } })
    await openThread()
    expect(screen.queryByRole('button', { name: W.confirmRental })).toBeNull()
    expect(screen.queryByText(W.confirmed)).toBeNull()
    expect(screen.queryByText(W.declinedLine)).toBeNull()
  })

  it('⛔ A8 declined: the slot keeps ONLY the line "{name} said this didn’t happen" — plain text, nothing to tap', async () => {
    threadBody = sellerThread({ listing: { ...sellerThread().listing, status: 'sold' }, deal: { kind: 'rental', state: 'declined', confirmsLeft: 0 } })
    await openThread()
    const line = screen.getByText(W.declinedLine)
    expect(line.closest('button')).toBeNull()
    expect(screen.queryByRole('button', { name: W.confirmRental })).toBeNull()
    expect(screen.queryByText(W.confirmed)).toBeNull()
    expect(dealPosts()).toEqual([])
  })

  it('…in Vietnamese: "{name} cho biết việc này không diễn ra"', async () => {
    stable.lang = { lang: 'vi', tr: (_en: string, vi?: string) => vi ?? _en, t: (k: string) => k, setLang: () => {} } as typeof stable.lang
    threadBody = sellerThread({ listing: { ...sellerThread().listing, listingType: 'teacher', categorySlug: 'teachers', price: undefined }, teacher: { shared: false, live: true, hasPhone: true, phoneShared: false, video: null, writerVerified: null }, deal: { kind: 'lesson', state: 'declined', confirmsLeft: 0 } })
    await openThread()
    expect(screen.getByText(W.declinedLineVi).closest('button')).toBeNull()
  })

  it('⛔ A8 declined on a LIVE rental: the menu keeps the old mark-rented item; the deal\'s place is the line, disabled — no confirm', async () => {
    threadBody = sellerThread({ deal: { kind: 'rental', state: 'declined', confirmsLeft: 0 } })
    await openThread()
    fireEvent.click(screen.getByRole('button', { name: W.markRented }))
    const menu = await screen.findByRole('menu')
    const line = within(menu).getByRole('menuitem', { name: W.declinedLine })
    expect(line.getAttribute('aria-disabled')).toBe('true')
    expect(within(menu).queryByRole('menuitem', { name: W.confirmRented })).toBeNull()
    expect(within(menu).getByRole('menuitem', { name: W.markAsRented })).toBeTruthy()
  })
})

describe('the buyer', () => {
  it('never gets the control; with `mayReviewService` the review card asks "did you…?" first', async () => {
    stable.auth = { user: { id: 'u-buyer' }, loading: false, openSignIn: () => {} }
    threadBody = sellerThread({
      me: 'u-buyer', iAmSeller: false, deal: undefined, mayReviewService: true, dealKind: 'rental',
      counterpart: { name: 'Landlord', avatarColor: '#888', avatarUrl: null, sellerId: 'shop-1', locale: 'en', trust: null },
    })
    await openThread()
    expect(await screen.findByText(W.didYouRent)).toBeTruthy()
    expect(screen.queryByRole('button', { name: W.confirmRental })).toBeNull()
    expect(screen.queryByRole('button', { name: W.markRented })).toBeNull()
  })
})

describe('the deal lines read in the viewer\'s language', () => {
  const lines = [
    { id: 'd1', mine: true, body: '✅ Đã xác nhận cho thuê · Rental confirmed', createdAt: '2026-11-10T09:00:00.000Z', kind: 'deal_confirmed' },
    { id: 'd2', mine: true, body: '↩️ Đã rút lại xác nhận · Confirmation withdrawn', createdAt: '2026-11-10T09:01:00.000Z', kind: 'deal_withdrawn' },
  ]
  it('English', async () => {
    threadBody = sellerThread({ messages: [...sellerThread().messages, ...lines] })
    await openThread()
    expect(screen.getByText('✅ Rental confirmed')).toBeTruthy()
    expect(screen.getByText('↩️ Confirmation withdrawn')).toBeTruthy()
  })
  it('Vietnamese', async () => {
    stable.lang = { lang: 'vi', tr: (_en: string, vi?: string) => vi ?? _en, t: (k: string) => k, setLang: () => {} } as typeof stable.lang
    threadBody = sellerThread({ messages: [...sellerThread().messages, ...lines] })
    await openThread()
    expect(screen.getByText('✅ Đã xác nhận cho thuê')).toBeTruthy()
    expect(screen.getByText('↩️ Đã rút lại xác nhận')).toBeTruthy()
  })
})
