// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ A WEB PUSH SUBSCRIPTION THAT IS NOT THE SIGNED-IN ACCOUNT'S IS DROPPED (F7) — and nothing else ever is: every doubt
 * (an error, another account's answer, an account that moved on, a subscription replaced meanwhile, a refused
 * unsubscribe) keeps it.
 */

const native = vi.hoisted(() => ({ shell: false }))
vi.mock('./native-browser', () => ({ isNativeShell: () => native.shell }))

const { dropForeignPushSubscription, PUSH_GUARD_ASK_TIMEOUT_MS, PUSH_SUBSCRIPTION_CHANGED } = await import('./push-account-guard')

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-1'
type Reply = { status: number; body?: unknown } | 'throw'
let sub: { endpoint: string; unsubscribe: ReturnType<typeof vi.fn> } | null
/** The notifications this registration still has on screen, and whether the app badge was cleared. */
let shown: { close: ReturnType<typeof vi.fn> }[] = []
let badgeCleared = 0
/** When true, the server never answers (until the request is aborted). */
let stall = false
/** What the server holds for the endpoint, as the signed-in account sees it — unless `reply` overrides it. */
let serverMine = false
/** Whether the server holds any row for the endpoint (another account's, when not mine). */
let serverKnown = true
let reply: Reply | null = null
let onAsk: () => void = () => {}
let asks = 0
let changed = 0
const onChanged = () => { changed += 1 }

beforeEach(() => {
  native.shell = false
  asks = 0
  changed = 0
  serverMine = false
  serverKnown = true
  reply = null
  onAsk = () => {}
  stall = false
  badgeCleared = 0
  shown = [{ close: vi.fn() }, { close: vi.fn() }]
  sub = { endpoint: ENDPOINT, unsubscribe: vi.fn(async () => true) }
  Object.defineProperty(navigator, 'clearAppBadge', { configurable: true, value: async () => { badgeCleared += 1 } })
  sessionStorage.clear()
  window.addEventListener(PUSH_SUBSCRIPTION_CHANGED, onChanged)
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: async () => ({ pushManager: { getSubscription: async () => sub }, getNotifications: async () => shown }) },
  })
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    asks += 1
    onAsk()
    if (stall) return new Promise((_, reject) => { init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))) })
    const r = reply ?? { status: 200, body: { me: 'u-b', mine: serverMine, known: serverMine || serverKnown } }
    if (r === 'throw') throw new TypeError('Failed to fetch')
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body }
  }))
})
afterEach(() => {
  window.removeEventListener(PUSH_SUBSCRIPTION_CHANGED, onChanged)
  vi.unstubAllGlobals()
})

const now = () => true

describe('dropForeignPushSubscription', () => {
  it('⛔ another account\'s row (a definite answer, made for the account that asked): unsubscribed here, and the UI is told', async () => {
    expect(await dropForeignPushSubscription('u-b', now)).toBe('dropped')
    expect(sub!.unsubscribe).toHaveBeenCalledTimes(1)
    expect(changed).toBe(1)
  })

  it('⛔ what that account\'s pushes left on the device goes with it: the notifications still listed, and the badge', async () => {
    expect(await dropForeignPushSubscription('u-b', now)).toBe('dropped')
    expect(shown.every((n) => n.close.mock.calls.length === 1)).toBe(true)
    expect(badgeCleared).toBe(1)
  })

  it('⛔ a subscription with NO row is kept — an opt-in still being posted (this tab or another), or an unsaved one', async () => {
    serverKnown = false
    expect(await dropForeignPushSubscription('u-b', now)).toBe('unknown')
    expect(sub!.unsubscribe).not.toHaveBeenCalled()
    expect(changed).toBe(0)
  })

  it('this account\'s own subscription is kept — and not asked about again in this tab', async () => {
    serverMine = true
    expect(await dropForeignPushSubscription('u-b', now)).toBe('kept')
    expect(await dropForeignPushSubscription('u-b', now)).toBe('kept')
    expect(asks).toBe(1)
    expect(sub!.unsubscribe).not.toHaveBeenCalled()
  })

  it('every doubt keeps it — and a failure is never remembered', async () => {
    for (const r of ['throw', { status: 500 }, { status: 401 }, { status: 200, body: 'nope' }, { status: 200, body: { me: 'u-a', mine: false, known: true } }, { status: 200, body: { me: 'u-b', mine: false } }] as Reply[]) {
      reply = r
      expect(await dropForeignPushSubscription('u-b', now)).toBe('unknown')
    }
    expect(sub!.unsubscribe).not.toHaveBeenCalled()
    reply = null
    serverMine = true
    expect(await dropForeignPushSubscription('u-b', now)).toBe('kept') // asked again: nothing was memoized
  })

  it('⛔ an account that moved on while it was asked, or a subscription replaced meanwhile, drops nothing', async () => {
    let current = true
    onAsk = () => { current = false }
    expect(await dropForeignPushSubscription('u-b', () => current)).toBe('unknown')
    const first = sub!
    onAsk = () => { sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/device-2', unsubscribe: vi.fn(async () => true) } }
    expect(await dropForeignPushSubscription('u-b', now)).toBe('unknown')
    expect(first.unsubscribe).not.toHaveBeenCalled()
    expect(sub!.unsubscribe).not.toHaveBeenCalled()
  })

  it('⛔ an unsubscribe the push service refused (resolves false) is not reported as dropped, and nobody is told', async () => {
    sub!.unsubscribe.mockResolvedValue(false)
    expect(await dropForeignPushSubscription('u-b', now)).toBe('unknown')
    expect(changed).toBe(0)
  })

  it('no subscription, or the native shell (its own token follows the account), asks nothing', async () => {
    sub = null
    expect(await dropForeignPushSubscription('u-b', now)).toBe('none')
    sub = { endpoint: ENDPOINT, unsubscribe: vi.fn(async () => true) }
    native.shell = true
    expect(await dropForeignPushSubscription('u-b', now)).toBe('none')
    expect(asks).toBe(0)
  })
})

describe('a server that never answers', () => {
  it('⛔ the ask gives up after PUSH_GUARD_ASK_TIMEOUT_MS, and nothing is dropped (a stalled ask is a doubt)', async () => {
    vi.useFakeTimers()
    try {
      stall = true
      const guard = dropForeignPushSubscription('u-b', now)
      await vi.advanceTimersByTimeAsync(PUSH_GUARD_ASK_TIMEOUT_MS + 100)
      expect(await guard).toBe('unknown')
      expect(sub!.unsubscribe).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
