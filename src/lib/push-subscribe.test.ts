// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PUSH_SUBSCRIBE_URL,
  PUSH_SW_URL,
  SW_READY_TIMEOUT_MS,
  hasPushSubscription,
  iosSupportsWebPush,
  iosVersionFromUa,
  optInState,
  pushSupport,
  readPushEnv,
  sameApplicationServerKey,
  subscribeToPush,
  urlBase64ToUint8Array,
  type PushEnv,
} from './push-subscribe'

// ── UX2 W2 B2-NOTIFY: the push rules, as tables over a browser snapshot, and the one subscribe call ──────

/** A desktop browser that supports push, with nothing decided yet. */
const env = (over: Partial<PushEnv> = {}): PushEnv => ({
  capacitor: false, nativeUa: false, inAppBrowser: false,
  serviceWorker: true, pushManager: true, notification: true,
  vapidKey: 'BPk', permission: 'default', subscribed: null,
  ios: false, iosVersion: null, standalone: false,
  ...over,
})

/** Safari in an iPhone tab: no PushManager and no Notification until the site is on the Home Screen. */
const iosTab = (over: Partial<PushEnv> = {}) =>
  env({ ios: true, iosVersion: [17, 5], standalone: false, pushManager: false, notification: false, permission: null, ...over })

describe('optInState — the card never becomes a dead button', () => {
  it('supported + not decided → ask', () => {
    expect(optInState(env())).toBe('ask')
  })

  it('denied → hidden', () => {
    expect(optInState(env({ permission: 'denied' }))).toBe('hidden')
  })

  it('granted with a live subscription → hidden; granted, unknown → hidden (the spec\'s "granted")', () => {
    expect(optInState(env({ permission: 'granted', subscribed: true }))).toBe('hidden')
    expect(optInState(env({ permission: 'granted', subscribed: null }))).toBe('hidden')
  })

  it('⛔ granted with NO subscription (torn down at sign-out) → ask again, so the next sign-in has a way back', () => {
    expect(optInState(env({ permission: 'granted', subscribed: false }))).toBe('ask')
  })

  it('iOS outside a Home Screen app → the install hint, even with no PushManager in the tab', () => {
    expect(optInState(iosTab())).toBe('ios-install')
    expect(optInState(iosTab({ iosVersion: null }))).toBe('ios-install') // iPad desktop UA without a Version token
  })

  it('iOS before 16.4 → hidden: an installed web app cannot get push there either', () => {
    expect(optInState(iosTab({ iosVersion: [16, 3] }))).toBe('hidden')
    expect(optInState(iosTab({ iosVersion: [15, 8] }))).toBe('hidden')
    expect(optInState(iosTab({ iosVersion: [16, 4] }))).toBe('ios-install')
  })

  it('iOS inside the installed web app → the normal ask; an old installed app with no PushManager → hidden', () => {
    expect(optInState(env({ ios: true, iosVersion: [16, 4], standalone: true }))).toBe('ask')
    expect(optInState(env({ ios: true, iosVersion: [16, 2], standalone: true, pushManager: false }))).toBe('hidden')
  })

  it('inside the Capacitor app → hidden, whatever the browser supports (native push is separate)', () => {
    expect(optInState(env({ capacitor: true }))).toBe('hidden')
    expect(optInState(iosTab({ capacitor: true }))).toBe('hidden')
  })

  it('inside the eno apps by UA (EnoNativeApp / EnoNativeTabs) → hidden — never "Add to Home Screen" there', () => {
    expect(optInState(iosTab({ nativeUa: true }))).toBe('hidden')
    expect(optInState(env({ nativeUa: true }))).toBe('hidden')
  })

  it('another app\'s built-in browser → hidden (no push, and no Add to Home Screen from Zalo or Facebook)', () => {
    expect(optInState(env({ inAppBrowser: true }))).toBe('hidden')
    expect(optInState(iosTab({ inAppBrowser: true }))).toBe('hidden')
  })

  it('no VAPID key on this build → hidden, including the iOS hint (it would lead to a dead end)', () => {
    expect(optInState(env({ vapidKey: '' }))).toBe('hidden')
    expect(optInState(iosTab({ vapidKey: '' }))).toBe('hidden')
  })

  it('a browser missing any of service worker / PushManager / Notification → hidden', () => {
    expect(optInState(env({ serviceWorker: false }))).toBe('hidden')
    expect(optInState(env({ pushManager: false }))).toBe('hidden')
    expect(optInState(env({ notification: false, permission: null }))).toBe('hidden')
  })
})

describe('pushSupport — the Settings row keeps its original rule', () => {
  it('Capacitor → native (the row hides)', () => {
    expect(pushSupport(env({ capacitor: true }))).toBe('native')
  })

  it('no service worker, no PushManager or no VAPID key → unsupported', () => {
    expect(pushSupport(env({ serviceWorker: false }))).toBe('unsupported')
    expect(pushSupport(env({ pushManager: false }))).toBe('unsupported')
    expect(pushSupport(env({ vapidKey: '' }))).toBe('unsupported')
    // An iPhone tab reads "unsupported" — that row's own copy already says "add eno.vn to your Home Screen".
    expect(pushSupport(iosTab())).toBe('unsupported')
  })

  it('otherwise the permission, as it was: granted / denied / default — with or without a subscription', () => {
    expect(pushSupport(env({ permission: 'granted' }))).toBe('granted')
    expect(pushSupport(env({ permission: 'granted', subscribed: false }))).toBe('granted')
    expect(pushSupport(env({ permission: 'denied' }))).toBe('denied')
    expect(pushSupport(env({ permission: 'default' }))).toBe('default')
  })

  it('the row does not hide in the iOS app\'s web tabs or in-app browsers (it never did)', () => {
    expect(pushSupport(env({ nativeUa: true }))).toBe('default')
    expect(pushSupport(env({ inAppBrowser: true }))).toBe('default')
  })
})

describe('iOS version from the UA', () => {
  it('reads iPhone / iPad-mobile / Chrome-on-iOS UAs', () => {
    expect(iosVersionFromUa('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')).toEqual([17, 5])
    expect(iosVersionFromUa('Mozilla/5.0 (iPad; CPU OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1')).toEqual([16, 3])
    expect(iosVersionFromUa('Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1')).toEqual([16, 4])
  })

  it('an iPad asking for desktop pages falls back to Safari\'s Version — never the frozen "Mac OS X 10_15"', () => {
    expect(iosVersionFromUa('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15')).toEqual([17, 5])
    expect(iosVersionFromUa('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)')).toBeNull()
  })

  it('16.4 is the first version with web push', () => {
    expect(iosSupportsWebPush([16, 4])).toBe(true)
    expect(iosSupportsWebPush([17, 0])).toBe(true)
    expect(iosSupportsWebPush([16, 3])).toBe(false)
    expect(iosSupportsWebPush(null)).toBe(true)
  })
})

describe('key helpers', () => {
  it('base64url → bytes, padding and the url alphabet included', () => {
    expect([...urlBase64ToUint8Array('AQID')]).toEqual([1, 2, 3])
    expect([...urlBase64ToUint8Array('-_8')]).toEqual([251, 255]) // '+/8=' in plain base64
  })

  it('compares an existing subscription\'s key byte for byte', () => {
    const k = new Uint8Array([1, 2, 3])
    expect(sameApplicationServerKey(new Uint8Array([1, 2, 3]).buffer, k)).toBe(true)
    expect(sameApplicationServerKey(new Uint8Array([1, 2, 4]).buffer, k)).toBe(false)
    expect(sameApplicationServerKey(new Uint8Array([1, 2]).buffer, k)).toBe(false)
    expect(sameApplicationServerKey(null, k)).toBe(false)
  })
})

// ── The live browser ─────────────────────────────────────────────────────────────────────────────────────

const ownProps: Array<[object, string]> = []
function define(target: object, key: string, value: unknown) {
  Object.defineProperty(target, key, { value, configurable: true, writable: true })
  ownProps.push([target, key])
}
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

afterEach(() => {
  for (const [t, k] of ownProps.splice(0)) delete (t as Record<string, unknown>)[k]
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('readPushEnv', () => {
  it('a bare browser (jsdom): no push, nothing native, permission unknown', () => {
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', '')
    const e = readPushEnv()
    expect(e).toMatchObject({ capacitor: false, nativeUa: false, inAppBrowser: false, serviceWorker: false, pushManager: false, notification: false, vapidKey: '', permission: null, subscribed: null, standalone: false })
  })

  it('reads Capacitor through the house check, and the permission, the key and the installed-app flag', () => {
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'BPk')
    define(window, 'Capacitor', { isNativePlatform: () => true })
    vi.stubGlobal('Notification', { permission: 'denied' })
    define(navigator, 'standalone', true)
    define(navigator, 'serviceWorker', {})
    define(window, 'PushManager', function PushManager() {})
    const e = readPushEnv()
    expect(e).toMatchObject({ capacitor: true, permission: 'denied', notification: true, vapidKey: 'BPk', standalone: true, serviceWorker: true, pushManager: true })
  })

  it('an iPhone; an in-app browser; the eno apps\' UA tokens', () => {
    define(navigator, 'userAgent', IPHONE_UA)
    expect(readPushEnv()).toMatchObject({ ios: true, iosVersion: [17, 5], inAppBrowser: false, nativeUa: false })
    define(navigator, 'userAgent', `${IPHONE_UA} [FBAN/FBIOS;FBAV/450.0]`)
    expect(readPushEnv().inAppBrowser).toBe(true)
    define(navigator, 'userAgent', `${IPHONE_UA} EnoNativeTabs/1`)
    expect(readPushEnv()).toMatchObject({ nativeUa: true, inAppBrowser: false })
  })
})

type Sub = { options: { applicationServerKey: ArrayBuffer | null }; unsubscribe: ReturnType<typeof vi.fn>; toJSON: () => unknown }
function browser(opts: { permission?: NotificationPermission; existing?: Sub | null; fetchOk?: boolean; fetchStatus?: number; registerThrows?: boolean } = {}) {
  const order: string[] = []
  const fresh: Sub = { options: { applicationServerKey: urlBase64ToUint8Array('AQID').buffer as ArrayBuffer }, unsubscribe: vi.fn(async () => true), toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/new', keys: { p256dh: 'p', auth: 'a' } }) }
  const pushManager = {
    getSubscription: vi.fn(async () => opts.existing ?? null),
    subscribe: vi.fn(async () => { order.push('subscribe'); return fresh }),
  }
  const reg = { pushManager }
  const sw = {
    register: vi.fn(async () => { order.push('register'); if (opts.registerThrows) throw new Error('SecurityError'); return reg }),
    ready: Promise.resolve(reg),
    getRegistration: vi.fn(async () => reg),
  }
  define(navigator, 'serviceWorker', sw)
  const requestPermission = vi.fn(async () => { order.push('permission'); return opts.permission ?? 'granted' })
  vi.stubGlobal('Notification', { permission: 'default', requestPermission })
  const fetchMock = vi.fn(async () => { order.push('post'); return { ok: opts.fetchStatus ? opts.fetchStatus < 300 : opts.fetchOk ?? true, status: opts.fetchStatus ?? 200 } })
  vi.stubGlobal('fetch', fetchMock)
  return { order, sw, pushManager, requestPermission, fetchMock, fresh }
}

describe('subscribeToPush — the one subscribe call', () => {
  beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'AQID') })

  it('default order (the Settings row\'s, unchanged): service worker first, then the prompt, then subscribe + POST', async () => {
    const b = browser()
    expect(await subscribeToPush()).toBe('granted')
    expect(b.order).toEqual(['register', 'permission', 'subscribe', 'post'])
    expect(b.sw.register).toHaveBeenCalledWith(PUSH_SW_URL)
    expect(b.pushManager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array('AQID') })
    expect(b.fetchMock).toHaveBeenCalledWith(PUSH_SUBSCRIBE_URL, expect.objectContaining({ method: 'POST', body: JSON.stringify(b.fresh.toJSON()) }))
  })

  it('⛔ the POST names the account signed in at the tap (F9) — and none when no account is known', async () => {
    const b = browser()
    expect(await subscribeToPush({ permissionFirst: true, account: 'u-a' })).toBe('granted')
    expect(((b.fetchMock.mock.calls as unknown as [string, RequestInit][])[0][1]).headers).toMatchObject({ 'x-eno-acting-account': 'u-a' })
    expect(await subscribeToPush({ permissionFirst: true })).toBe('granted')
    expect(((b.fetchMock.mock.calls as unknown as [string, RequestInit][])[1][1]).headers).not.toHaveProperty('x-eno-acting-account')
  })

  it('⛔ refused for another account (409): a subscription this call created is dropped; one it reused stays', async () => {
    const made = browser({ fetchStatus: 409 })
    expect(await subscribeToPush({ permissionFirst: true, account: 'u-a' })).toBe('account_changed')
    expect(made.fresh.unsubscribe).toHaveBeenCalledTimes(1)
    const existing = { options: { applicationServerKey: urlBase64ToUint8Array('AQID').buffer as ArrayBuffer }, unsubscribe: vi.fn(async () => true), toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/old', keys: { p256dh: 'p', auth: 'a' } }) }
    browser({ fetchStatus: 409, existing })
    expect(await subscribeToPush({ permissionFirst: true, account: 'u-a' })).toBe('account_changed')
    expect(existing.unsubscribe).not.toHaveBeenCalled()
  })

  it('permissionFirst (the card): the prompt is the first thing the tap does', async () => {
    const b = browser()
    expect(await subscribeToPush({ permissionFirst: true })).toBe('granted')
    expect(b.order).toEqual(['permission', 'register', 'subscribe', 'post'])
  })

  it('a refused prompt stops there — with permissionFirst the service worker is never touched', async () => {
    const b = browser({ permission: 'denied' })
    expect(await subscribeToPush({ permissionFirst: true })).toBe('denied')
    expect(b.order).toEqual(['permission'])
    const c = browser({ permission: 'default' })
    expect(await subscribeToPush()).toBe('default')
    expect(c.order).toEqual(['register', 'permission'])
    expect(c.fetchMock).not.toHaveBeenCalled()
  })

  it('reuses a subscription made with this key; drops one made with a rotated key first', async () => {
    const same: Sub = { options: { applicationServerKey: urlBase64ToUint8Array('AQID').buffer as ArrayBuffer }, unsubscribe: vi.fn(async () => true), toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/old' }) }
    const b = browser({ existing: same })
    expect(await subscribeToPush()).toBe('granted')
    expect(b.pushManager.subscribe).not.toHaveBeenCalled()
    expect(same.unsubscribe).not.toHaveBeenCalled()
    expect(b.fetchMock).toHaveBeenCalledWith(PUSH_SUBSCRIBE_URL, expect.objectContaining({ body: JSON.stringify(same.toJSON()) }))

    const rotated: Sub = { ...same, options: { applicationServerKey: new Uint8Array([9, 9, 9]).buffer }, unsubscribe: vi.fn(async () => true) }
    const c = browser({ existing: rotated })
    expect(await subscribeToPush()).toBe('granted')
    expect(rotated.unsubscribe).toHaveBeenCalledTimes(1)
    expect(c.pushManager.subscribe).toHaveBeenCalledTimes(1)
  })

  it('a POST the server did not accept is "unsaved"; anything that throws is "failed"', async () => {
    browser({ fetchOk: false })
    expect(await subscribeToPush()).toBe('unsaved')
    browser({ registerThrows: true })
    expect(await subscribeToPush()).toBe('failed')
    const d = browser()
    d.fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await subscribeToPush()).toBe('failed')
  })
})

describe('hasPushSubscription', () => {
  it('no service worker → cannot tell (null)', async () => {
    expect(await hasPushSubscription()).toBeNull()
  })

  it('a registration with / without a subscription; none at all; a probe that throws', async () => {
    const live: Sub = { options: { applicationServerKey: null }, unsubscribe: vi.fn(), toJSON: () => ({}) }
    const b = browser({ existing: live })
    expect(await hasPushSubscription()).toBe(true)
    b.pushManager.getSubscription.mockResolvedValueOnce(null)
    expect(await hasPushSubscription()).toBe(false)
    b.sw.getRegistration.mockResolvedValueOnce(undefined as never)
    expect(await hasPushSubscription()).toBe(false)
    b.sw.getRegistration.mockRejectedValueOnce(new Error('InvalidStateError'))
    expect(await hasPushSubscription()).toBeNull()
  })

  it('⛔ a subscription made with a ROTATED VAPID key counts as none — the card offers to replace it', async () => {
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'AQID') // bytes 1,2,3
    try {
      const current: Sub = { options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer }, unsubscribe: vi.fn(), toJSON: () => ({}) }
      const b = browser({ existing: current })
      expect(await hasPushSubscription()).toBe(true)
      b.pushManager.getSubscription.mockResolvedValueOnce({ ...current, options: { applicationServerKey: new Uint8Array([9, 9, 9]).buffer } } as never)
      expect(await hasPushSubscription()).toBe(false)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('subscribeToPush — a service worker that never becomes ready', () => {
  it('⛔ gives up after SW_READY_TIMEOUT_MS ("failed") — no endless spinner, no stuck ✕ (gate, 2026-10-05)', async () => {
    vi.useFakeTimers()
    try {
      const b = browser()
      b.sw.ready = new Promise(() => {}) as never
      const outcome = subscribeToPush({ permissionFirst: true, vapidKey: 'AQID' })
      await vi.advanceTimersByTimeAsync(SW_READY_TIMEOUT_MS + 1)
      expect(await outcome).toBe('failed')
      expect(b.pushManager.subscribe).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('subscribeToPush — a subscription the server did not confirm stays (the bounded contract)', () => {
  beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'AQID') })

  it('never unsubscribes on an unconfirmed POST — a retry reuses it and POSTs it again', async () => {
    const b = browser({ fetchOk: false })
    expect(await subscribeToPush({ permissionFirst: true })).toBe('unsaved')
    expect(b.fresh.unsubscribe).not.toHaveBeenCalled()
    // The retry: the browser now holds that subscription with this key — reused, not re-created.
    b.pushManager.getSubscription.mockResolvedValue(b.fresh as never)
    b.fetchMock.mockResolvedValueOnce({ ok: true, status: 200 })
    expect(await subscribeToPush({ permissionFirst: true })).toBe('granted')
    expect(b.pushManager.subscribe).toHaveBeenCalledTimes(1)
    expect(b.fetchMock).toHaveBeenLastCalledWith(PUSH_SUBSCRIBE_URL, expect.objectContaining({ body: JSON.stringify(b.fresh.toJSON()) }))
  })
})

describe('onPushSubscriptionChanged (F7: the sign-in guard dropped a subscription under the UI)', () => {
  it('hears this tab\'s announcement and another tab\'s (they share the subscription), and stops when asked', async () => {
    const { announcePushSubscriptionChanged, onPushSubscriptionChanged } = await import('./push-subscribe')
    const look = vi.fn()
    const stop = onPushSubscriptionChanged(look)
    announcePushSubscriptionChanged() // this tab: the window event at once (+ its channel post, which other tabs hear —
    expect(look).toHaveBeenCalled() //  and this tab's own listener too, a moment later: a second look is harmless)
    await new Promise((r) => setTimeout(r, 20))
    look.mockClear()
    const otherTab = new BroadcastChannel('eno:push-subscription')
    otherTab.postMessage('changed')
    await new Promise((r) => setTimeout(r, 20))
    expect(look).toHaveBeenCalledTimes(1)
    stop()
    look.mockClear()
    otherTab.postMessage('changed')
    await new Promise((r) => setTimeout(r, 20))
    expect(look).not.toHaveBeenCalled()
    otherTab.close()
  })
})
