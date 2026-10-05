// @vitest-environment jsdom
import * as React from 'react'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

// ── UX2 W2 B2-NOTIFY: the Settings push row after the subscribe logic moved to src/lib/push-subscribe.ts ──
// Extracted, then two fixes (2026-10-05): the PROMPT comes first, inside the tap (Safari ties it to the user's
// activation; a first service-worker install can outlast it), and "granted" without a subscription offers the button.

vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
// Set before the import: the pre-extraction row read the key at MODULE scope.
const prevVapid = vi.hoisted(() => { const prev = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY; process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'AQID'; return prev })

import { ReminderSettings } from './reminder-settings'

const own: Array<[object, string]> = []
function define(target: object, key: string, value: unknown) {
  Object.defineProperty(target, key, { value, configurable: true, writable: true })
  own.push([target, key])
}

function pushBrowser(opts: { permission?: NotificationPermission; registerThrows?: boolean; postOk?: boolean; current?: NotificationPermission } = {}) {
  const order: string[] = []
  const sub = { options: { applicationServerKey: null }, unsubscribe: vi.fn(async () => true), toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'p', auth: 'a' } }) }
  const reg = { pushManager: { getSubscription: vi.fn(async () => null), subscribe: vi.fn(async () => { order.push('subscribe'); return sub }) } }
  define(navigator, 'serviceWorker', {
    register: vi.fn(async () => { order.push('register'); if (opts.registerThrows) throw new Error('SecurityError'); return reg }),
    ready: Promise.resolve(reg),
    getRegistration: vi.fn(async () => reg),
  })
  define(window, 'PushManager', function PushManager() {})
  vi.stubGlobal('Notification', { permission: opts.current ?? 'default', requestPermission: vi.fn(async () => { order.push('permission'); return opts.permission ?? 'granted' }) })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/push/subscribe') { order.push('post'); return { ok: opts.postOk ?? true, json: async () => ({}) } }
    return { ok: false, json: async () => null } // digest prefs: not loaded → that row stays hidden
  }))
  return { order }
}

afterAll(() => {
  if (prevVapid === undefined) delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  else process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = prevVapid
})
afterEach(() => {
  cleanup()
  for (const [t, k] of own.splice(0)) delete (t as Record<string, unknown>)[k]
  vi.unstubAllGlobals()
})

const button = () => screen.queryByRole('button', { name: /Get reminders on this device/ })

async function mount() {
  await act(async () => { render(<ReminderSettings />) })
}

describe('ReminderSettings push row', () => {
  it('offers the button, asks permission FIRST, then subscribes and says it is on', async () => {
    const b = pushBrowser()
    await mount()
    await act(async () => { fireEvent.click(button()!) })
    expect(b.order).toEqual(['permission', 'register', 'subscribe', 'post'])
    expect(screen.getByText('Browser notifications are on for this device.')).toBeTruthy()
  })

  it('⛔ "granted" with no subscription on this device (signed out and back in) offers the button again', async () => {
    pushBrowser({ current: 'granted' })
    await mount()
    expect(button()).toBeTruthy()
  })

  it('a refused prompt shows the blocked line', async () => {
    pushBrowser({ permission: 'denied' })
    await mount()
    await act(async () => { fireEvent.click(button()!) })
    expect(screen.getByText(/Notifications are blocked/)).toBeTruthy()
  })

  it('a throw changes nothing — the button stays', async () => {
    pushBrowser({ registerThrows: true })
    await mount()
    await act(async () => { fireEvent.click(button()!) })
    expect(button()).not.toBeNull()
  })

  it('⛔ a subscription the server did not store keeps the button — it never reads "on" (gate, 2026-10-05)', async () => {
    pushBrowser({ postOk: false })
    await mount()
    await act(async () => { fireEvent.click(button()!) })
    expect(screen.queryByText('Browser notifications are on for this device.')).toBeNull()
    expect(button()).toBeTruthy()
  })

  it('no PushManager → the unsupported line (which tells iPhone users about the Home Screen)', async () => {
    pushBrowser()
    delete (window as unknown as Record<string, unknown>).PushManager
    await mount()
    expect(screen.getByText(/add eno.vn to your Home Screen first/)).toBeTruthy()
    expect(button()).toBeNull()
  })

  it('inside the Capacitor app the push row is gone; the daily check stays', async () => {
    pushBrowser()
    define(window, 'Capacitor', { isNativePlatform: () => true })
    await mount()
    expect(button()).toBeNull()
    expect(screen.queryByText(/aren’t available here/)).toBeNull()
    expect(screen.getByText('Daily availability check')).toBeTruthy()
  })
})
