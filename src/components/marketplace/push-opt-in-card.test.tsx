// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { PushEnv, SubscribeOutcome } from '@/lib/push-subscribe'

// ── UX2 W2 B2-NOTIFY: the "turn on notifications" card — who sees it, once per device, one ask at a time ──

const h = vi.hoisted(() => ({
  lang: 'en' as 'en' | 'vi',
  auth: { user: { id: 'u1' } as { id: string } | null, loading: false },
  pathname: '/post',
  consent: true,
  env: null as unknown as PushEnv,
  subscribed: null as boolean | null,
  outcome: 'granted' as SubscribeOutcome,
  subscribe: null as unknown as Mock<(opts?: { permissionFirst?: boolean }) => Promise<SubscribeOutcome>>,
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: h.lang, tr: (en: string, vi?: string) => (h.lang === 'vi' && vi != null ? vi : en), setLang: () => {} }),
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => h.auth }))
vi.mock('next/navigation', () => ({ usePathname: () => h.pathname }))
vi.mock('sonner', () => ({ toast: h.toast }))
vi.mock('@/lib/consent', () => ({ consentAnswered: () => h.consent }))
vi.mock('@/lib/push-subscribe', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/push-subscribe')>()
  return {
    ...real,
    readPushEnv: () => ({ ...h.env }),
    hasPushSubscription: async () => h.subscribed,
    subscribeToPush: (opts?: { permissionFirst?: boolean }) => h.subscribe(opts),
  }
})

import { PUSH_OPTIN_DISMISSED_KEY, PushOptInCard, __resetPushOptInForTests } from './push-opt-in-card'
import { __resetPageAsksForTests, askHidden, askShown, mayAsk, notePageView } from '@/lib/page-asks'

const supported = (over: Partial<PushEnv> = {}): PushEnv => ({
  capacitor: false, nativeUa: false, inAppBrowser: false,
  serviceWorker: true, pushManager: true, notification: true,
  vapidKey: 'BPk', permission: 'default', subscribed: null,
  ios: false, iosVersion: null, standalone: false,
  ...over,
})

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  }
}

const POST_EN = 'Get notified when the first buyer messages or makes an offer'
const POST_VI = 'Nhận thông báo khi có người mua đầu tiên nhắn tin hoặc trả giá'
const card = () => document.querySelector('[data-push-optin]')
const turnOn = () => screen.queryByRole('button', { name: /Turn on notifications|Bật thông báo/ })

/** Mount and let the async decision (the subscription probe) settle. */
async function mount(ui: React.ReactElement) {
  let r!: ReturnType<typeof render>
  await act(async () => { r = render(ui) })
  await act(async () => { await Promise.resolve() })
  return r
}

beforeEach(() => {
  h.lang = 'en'
  h.auth = { user: { id: 'u1' }, loading: false }
  h.pathname = '/post'
  h.consent = true
  h.env = supported()
  h.subscribed = null
  h.outcome = 'granted'
  // The browser after the answer: granted → a live subscription; denied → the permission says so.
  h.subscribe = vi.fn(async (_opts?: { permissionFirst?: boolean }) => {
    if (h.outcome === 'granted') { h.env = { ...h.env, permission: 'granted' }; h.subscribed = true }
    if (h.outcome === 'denied') h.env = { ...h.env, permission: 'denied' }
    return h.outcome
  })
  h.toast.success.mockClear()
  h.toast.error.mockClear()
  vi.stubGlobal('localStorage', memoryStorage())
  __resetPageAsksForTests()
  __resetPushOptInForTests()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('PushOptInCard — copy names only what the server pushes', () => {
  it('post-success: the first buyer message or an offer, and a Turn-on button', async () => {
    await mount(<PushOptInCard surface="post" />)
    expect(screen.getByRole('region', { name: POST_EN })).toBeTruthy()
    expect(turnOn()).not.toBeNull()
  })

  it('Vietnamese, word for word', async () => {
    h.lang = 'vi'
    await mount(<PushOptInCard surface="post" />)
    expect(screen.getByRole('region', { name: POST_VI })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Bật thông báo' })).toBeTruthy()
  })

  it('⛔ a fixed-price post: no offers promised — the server refuses offers there', async () => {
    await mount(<PushOptInCard surface="post" offers={false} />)
    expect(screen.getByRole('region', { name: 'Get notified when the first buyer messages you' })).toBeTruthy()
    h.lang = 'vi'
    cleanup()
    await mount(<PushOptInCard surface="post" offers={false} />)
    expect(screen.getByRole('region', { name: 'Nhận thông báo khi có người mua đầu tiên nhắn tin cho bạn' })).toBeTruthy()
  })

  it('a job post: candidates, and no offers (jobs take none)', async () => {
    await mount(<PushOptInCard surface="job-post" />)
    expect(card()!.textContent).toContain('Get notified when the first candidate messages you')
    expect(card()!.textContent).not.toMatch(/offer/i)
  })

  it('the inbox: offers and a listing\'s first message — never "new messages"', async () => {
    h.pathname = '/messages'
    await mount(<PushOptInCard surface="inbox" />)
    expect(card()!.textContent).toContain('Get notified about offers, and when a listing of yours gets its first message')
  })
})

describe('PushOptInCard — who sees it', () => {
  it('signed-in only: nothing for a guest, nothing while the session loads, then it appears', async () => {
    h.auth = { user: null, loading: false }
    const r = await mount(<PushOptInCard surface="post" />)
    expect(card()).toBeNull()
    h.auth = { user: null, loading: true }
    r.rerender(<PushOptInCard surface="post" />)
    expect(card()).toBeNull()
    h.auth = { user: { id: 'u1' }, loading: false }
    await act(async () => { r.rerender(<PushOptInCard surface="post" />) })
    await act(async () => { await Promise.resolve() })
    expect(card()).not.toBeNull()
  })

  it('signing out while it is up takes it away', async () => {
    const r = await mount(<PushOptInCard surface="post" />)
    expect(card()).not.toBeNull()
    h.auth = { user: null, loading: false }
    await act(async () => { r.rerender(<PushOptInCard surface="post" />) })
    expect(card()).toBeNull()
  })

  it('iOS outside the Home Screen app: the install hint, and no button to press', async () => {
    h.env = supported({ ios: true, iosVersion: [17, 5], standalone: false, pushManager: false, notification: false, permission: null })
    await mount(<PushOptInCard surface="post" />)
    expect(card()!.textContent).toContain('tap Share, then “Add to Home Screen”')
    expect(turnOn()).toBeNull()
  })

  it('iOS hint in Vietnamese names the iOS menu item as iOS does', async () => {
    h.lang = 'vi'
    h.env = supported({ ios: true, iosVersion: [17, 5], standalone: false, pushManager: false, notification: false, permission: null })
    await mount(<PushOptInCard surface="post" />)
    expect(card()!.textContent).toContain('nhấn Chia sẻ, rồi chọn “Thêm vào MH chính”')
  })

  it('inside the Capacitor app: nothing (native push is separate)', async () => {
    h.env = supported({ capacitor: true })
    await mount(<PushOptInCard surface="post" />)
    expect(card()).toBeNull()
  })

  it('permission denied: nothing; granted with a live subscription: nothing', async () => {
    h.env = supported({ permission: 'denied' })
    await mount(<PushOptInCard surface="post" />)
    expect(card()).toBeNull()
    cleanup()
    h.env = supported({ permission: 'granted' })
    h.subscribed = true
    await mount(<PushOptInCard surface="post" />)
    expect(card()).toBeNull()
  })

  it('⛔ hidden while a subscription is held — and asks once the sign-in guard drops one that was not this account\'s (F7)', async () => {
    h.env = supported({ permission: 'granted' })
    h.subscribed = true
    await mount(<PushOptInCard surface="post" />)
    expect(card()).toBeNull()
    h.subscribed = false
    await act(async () => { window.dispatchEvent(new Event('eno:push-subscription-changed')) })
    expect(turnOn()).not.toBeNull()
  })

  it('granted but the subscription was torn down at sign-out: it asks again (the tap re-subscribes, no prompt)', async () => {
    h.env = supported({ permission: 'granted' })
    h.subscribed = false
    await mount(<PushOptInCard surface="post" />)
    expect(turnOn()).not.toBeNull()
  })
})

describe('PushOptInCard — once per device, storage or not', () => {
  it('✕ is remembered on the device: gone now, gone on a remount, gone on the other surface', async () => {
    const r = await mount(<PushOptInCard surface="post" />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(card()).toBeNull()
    expect(localStorage.getItem(PUSH_OPTIN_DISMISSED_KEY)).toBe('1')
    r.unmount()
    __resetPushOptInForTests() // a new page life: only storage remembers
    __resetPageAsksForTests()
    await mount(<PushOptInCard surface="post" />)
    expect(card()).toBeNull()
    cleanup()
    h.pathname = '/messages'
    await mount(<PushOptInCard surface="inbox" />)
    expect(card()).toBeNull()
  })

  it('⛔ storage that cannot be READ: no card, and the page around it renders', async () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new DOMException('denied', 'SecurityError') }, setItem: () => {} })
    await mount(<div><p data-testid="page-body" /><PushOptInCard surface="post" /></div>)
    expect(screen.getByTestId('page-body')).toBeTruthy()
    expect(card()).toBeNull()
  })

  it('⛔ storage that refuses the WRITE: ✕ still closes it, nothing throws, and it stays closed for this page life', async () => {
    const store = memoryStorage()
    vi.stubGlobal('localStorage', { ...store, getItem: store.getItem, setItem: () => { throw new DOMException('full', 'QuotaExceededError') } })
    const r = await mount(<PushOptInCard surface="post" />)
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))).not.toThrow()
    expect(card()).toBeNull()
    r.unmount()
    __resetPageAsksForTests()
    await mount(<PushOptInCard surface="post" />)
    expect(card()).toBeNull()
  })
})

describe('PushOptInCard — one ask at a time (page-asks + the consent bar)', () => {
  it('the install card asked in this page view: the push card waits for the next one', async () => {
    askShown('install', '/messages')
    askHidden('install') // dismissed — but it appeared in THIS page view
    h.pathname = '/messages'
    const r = await mount(<PushOptInCard surface="inbox" />)
    expect(card()).toBeNull()
    h.pathname = '/messages/c1'
    await act(async () => { r.rerender(<PushOptInCard surface="inbox" />) })
    await act(async () => { await Promise.resolve() })
    expect(card()).not.toBeNull()
  })

  it('while the push card is up neither the join prompt nor the install card may ask — in this view, even after ✕', async () => {
    await mount(<PushOptInCard surface="post" />)
    expect(card()).not.toBeNull()
    expect(mayAsk('install', '/post')).toBe(false)
    expect(mayAsk('join', '/post')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(mayAsk('install', '/post')).toBe(false)
    notePageView('/c/phones')
    expect(mayAsk('install', '/c/phones')).toBe(true)
  })

  it('⛔ mounted with the session already known, it stays registered: still up after a route change, it blocks the install card there too', async () => {
    h.pathname = '/messages'
    const r = await mount(<PushOptInCard surface="inbox" />)
    expect(card()).not.toBeNull()
    // The inbox list persists across threads; the card is still on screen in the next page view.
    h.pathname = '/messages/c1'
    await act(async () => { r.rerender(<PushOptInCard surface="inbox" />) })
    expect(card()).not.toBeNull()
    expect(mayAsk('install', '/messages/c1')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(mayAsk('install', '/messages/c1')).toBe(false) // it appeared in this view
    notePageView('/messages')
    expect(mayAsk('install', '/messages')).toBe(true)
  })

  it('StrictMode\'s mount → unmount → mount leaves it registered exactly once', async () => {
    h.pathname = '/messages'
    const r = await mount(<React.StrictMode><PushOptInCard surface="inbox" /></React.StrictMode>)
    expect(card()).not.toBeNull()
    h.pathname = '/messages/c1'
    await act(async () => { r.rerender(<React.StrictMode><PushOptInCard surface="inbox" /></React.StrictMode>) })
    expect(mayAsk('install', '/messages/c1')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    notePageView('/')
    expect(mayAsk('install', '/')).toBe(true) // and once off, it is fully off — no stale second registration
  })

  it('unmounting reports it gone: the next page view is free for the others', async () => {
    const r = await mount(<PushOptInCard surface="post" />)
    expect(card()).not.toBeNull()
    r.unmount()
    notePageView('/')
    expect(mayAsk('install', '/')).toBe(true)
  })

  it('⛔ a page view that found the consent unanswered is the cookie bar\'s — the card sits it out even after the answer', async () => {
    h.consent = false
    h.auth = { user: null, loading: true } // the session resolves only after the visitor answered the bar
    h.pathname = '/messages'
    const r = await mount(<PushOptInCard surface="inbox" />)
    h.consent = true
    h.auth = { user: { id: 'u1' }, loading: false }
    await act(async () => { r.rerender(<PushOptInCard surface="inbox" />) })
    await act(async () => { await Promise.resolve() })
    expect(card()).toBeNull()
    // The next page view looks again — and A → B → A is a new view, so coming back looks again too.
    h.pathname = '/messages/c1'
    await act(async () => { r.rerender(<PushOptInCard surface="inbox" />) })
    await act(async () => { await Promise.resolve() })
    expect(card()).not.toBeNull()
  })
})

describe('PushOptInCard — Turn on', () => {
  it('asks first inside the tap (permissionFirst); granted → gone, with a confirmation', async () => {
    await mount(<PushOptInCard surface="post" />)
    await act(async () => { fireEvent.click(turnOn()!) })
    // permissionFirst: the prompt is the tap's first call (push-subscribe.test.ts pins the order).
    expect(h.subscribe).toHaveBeenCalledWith({ permissionFirst: true })
    expect(card()).toBeNull()
    expect(h.toast.success).toHaveBeenCalledWith('Notifications are on for this device')
  })

  it('failed or not saved → it stays for another try, with an error', async () => {
    h.outcome = 'failed'
    await mount(<PushOptInCard surface="post" />)
    await act(async () => { fireEvent.click(turnOn()!) })
    expect(card()).not.toBeNull()
    expect(h.toast.error).toHaveBeenCalledTimes(1)
    h.outcome = 'unsaved'
    await act(async () => { fireEvent.click(turnOn()!) })
    expect(card()).not.toBeNull()
    expect(h.toast.error).toHaveBeenCalledTimes(2)
  })

  it('denied → gone quietly; a prompt closed without an answer → it stays', async () => {
    h.outcome = 'default'
    await mount(<PushOptInCard surface="post" />)
    await act(async () => { fireEvent.click(turnOn()!) })
    expect(card()).not.toBeNull()
    h.outcome = 'denied'
    await act(async () => { fireEvent.click(turnOn()!) })
    expect(card()).toBeNull()
    expect(h.toast.success).not.toHaveBeenCalled()
    expect(h.toast.error).not.toHaveBeenCalled()
  })

  it('one tap, one subscribe: a second tap while the first is in flight does nothing', async () => {
    let answer!: (o: SubscribeOutcome) => void
    h.subscribe = vi.fn(() => new Promise<SubscribeOutcome>((r) => { answer = r }))
    await mount(<PushOptInCard surface="post" />)
    const btn = turnOn()!
    await act(async () => { fireEvent.click(btn); fireEvent.click(btn) })
    expect(h.subscribe).toHaveBeenCalledTimes(1)
    await act(async () => { answer('default') })
    expect(turnOn()).not.toBeNull()
  })

  it('⛔ ✕ works while a subscribe hangs (Chrome’s quiet prompt, a stalled POST) — and its late answer is ignored', async () => {
    let answer!: (o: SubscribeOutcome) => void
    h.subscribe = vi.fn(() => new Promise<SubscribeOutcome>((r) => { answer = r }))
    await mount(<PushOptInCard surface="post" />)
    await act(async () => { fireEvent.click(turnOn()!) })
    const close = screen.getByRole('button', { name: 'Dismiss' }) as HTMLButtonElement
    expect(close.disabled).toBe(false)
    await act(async () => { fireEvent.click(close) })
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
    await act(async () => { answer('failed') })
    expect(h.toast.error).not.toHaveBeenCalled()
  })

  it('⛔ an answer that lands after its card left cannot un-register the card that is on screen now', async () => {
    let answer!: (o: SubscribeOutcome) => void
    h.subscribe = vi.fn(() => new Promise<SubscribeOutcome>((r) => { answer = r }))
    const a = await mount(<PushOptInCard surface="post" />)
    await act(async () => { fireEvent.click(turnOn()!) }) // the browser prompt is open…
    a.unmount() // …and the seller walks to the inbox
    h.pathname = '/messages'
    const b = await mount(<PushOptInCard surface="inbox" />)
    expect(card()).not.toBeNull()
    await act(async () => { answer('granted') }) // the old card's tap resolves now
    expect(card()).not.toBeNull()
    h.pathname = '/messages/c1'
    await act(async () => { b.rerender(<PushOptInCard surface="inbox" />) })
    expect(mayAsk('install', '/messages/c1')).toBe(false) // the inbox card still holds the screen
  })
})
