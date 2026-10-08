// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE BELL SHOWS AN ACCOUNT ONLY ITS OWN ROWS (F6 — found by the F5 verification). After a switch with no sign-out
 * between, the next account saw the previous one's rows (offer amounts and notes) and unread count until its own first
 * poll answered — for good if that poll failed — and a poll still in flight at the switch landed the previous
 * account's rows over the next one's. Harness after chat-context.thread-cache.test.tsx.
 */

const auth = vi.hoisted(() => ({ user: { id: 'u-a' } as { id: string } | null }))
vi.mock('./auth-context', () => ({ useAuth: () => auth }))

const { NotificationsProvider, useNotifications } = await import('./notifications-context')

const CACHE_KEY = 'eno-notifs'
const row = (id: string, body: string, read = false) => ({ id, type: 'offer', title: 'Buyer', body, actorName: null, conversationId: 'c1', listingId: null, url: null, read, createdAt: '2026-10-08T00:00:00.000Z' })

type Answer = { me: string; notifications: ReturnType<typeof row>[]; unread: number; convoUnread?: number }
/** What GET /api/notifications answers next, in order; 'hold' keeps it open until the test answers it. */
let answers: (Answer | 'hold' | 'fail')[] = []
let held: ((a: Answer) => void)[] = []
let broadcasts: unknown[] = []
/** What the mark-read / delete endpoints answer (409 = the server refused another account's tap). */
let mutationStatus = 200
const onBroadcast = (e: Event) => { broadcasts.push((e as CustomEvent).detail) }

function stubStorage() {
  const m = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  })
}
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const as = async (hook: { rerender: () => void }, id: string | null) => { auth.user = id ? { id } : null; hook.rerender(); await settle() }
const A_ROWS = { me: 'u-a', notifications: [row('n1', 'Offered 3.000.000 ₫ — call me')], unread: 1, convoUnread: 2 }

beforeEach(() => {
  vi.useFakeTimers()
  stubStorage()
  auth.user = { id: 'u-a' }
  answers = []
  held = []
  broadcasts = []
  mutationStatus = 200
  window.addEventListener('eno:convo-unread', onBroadcast)
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if ((init?.method ?? 'GET') !== 'GET') return { ok: mutationStatus < 300, status: mutationStatus, json: async () => ({}) }
    if (url !== '/api/notifications') return { ok: true, status: 200, json: async () => ({}) }
    const a = answers.shift() ?? { me: auth.user?.id ?? '', notifications: [], unread: 0 }
    if (a === 'fail') return { ok: false, status: 500, json: async () => ({}) }
    if (a === 'hold') return new Promise((resolve) => { held.push((x) => resolve({ ok: true, status: 200, json: async () => x })) })
    return { ok: true, status: 200, json: async () => a }
  }))
})
afterEach(() => {
  cleanup()
  window.removeEventListener('eno:convo-unread', onBroadcast)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const mount = () => renderHook(() => useNotifications(), { wrapper: NotificationsProvider })

describe('the bell belongs to the account signed in', () => {
  it('⛔ a switch with no sign-out between: the next account never sees the previous one\'s rows — not in the switching render', async () => {
    answers = [A_ROWS, 'fail'] // the next account's first poll FAILS: before this, the previous rows stayed for good
    const seen: { items: number; unread: number }[] = []
    const hook = renderHook(() => { const n = useNotifications(); seen.push({ items: n.items.length, unread: n.unread }); return n }, { wrapper: NotificationsProvider })
    await settle()
    expect(hook.result.current.items.map((n) => n.id)).toEqual(['n1'])
    const before = seen.length
    await as(hook, 'u-b')
    expect(seen.slice(before).every((s) => s.items === 0 && s.unread === 0)).toBe(true) // every render since the switch
    expect(hook.result.current.unread).toBe(0)
  })

  it('⛔ a poll that left before the switch lands in nothing: not on the bell, not broadcast, not cached', async () => {
    answers = ['hold']
    const hook = mount()
    await settle()
    await as(hook, 'u-b')
    broadcasts = []
    await act(async () => { held[0](A_ROWS) }) // A's answer, landing after B is signed in
    await settle()
    expect(hook.result.current.items).toEqual([])
    expect(broadcasts).toEqual([])
    expect(JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null')?.me).not.toBe('u-a') // B's own (empty) copy, not A's
  })

  it('after the switch, the next account\'s OWN rows are shown (the state moved to it, not just hidden)', async () => {
    answers = [A_ROWS, { me: 'u-b', notifications: [row('b1', 'for B')], unread: 1 }]
    const hook = mount()
    await settle()
    await as(hook, 'u-b')
    expect(hook.result.current.items.map((n) => n.id)).toEqual(['b1'])
    expect(hook.result.current.unread).toBe(1)
  })

  it('⛔ a poll that answers between sign-out\'s device clear and the commit is taken away again at the commit', async () => {
    answers = [A_ROWS] // A's poll lands (and is cached) while A is still the account on record…
    const hook = mount()
    await settle()
    expect(JSON.parse(localStorage.getItem(CACHE_KEY)!).me).toBe('u-a')
    await as(hook, null) // …then the sign-out commits: the copy goes with the account
    expect(localStorage.getItem(CACHE_KEY)).toBeNull()
  })

  it('an answer made for another account (a cookie switched in another tab) is not applied', async () => {
    answers = [{ me: 'u-other', notifications: [row('n9', 'not yours')], unread: 1, convoUnread: 5 }]
    const hook = mount()
    await settle()
    expect(hook.result.current.items).toEqual([])
    expect(broadcasts).toEqual([])
  })

  it('this account\'s own answer is shown, broadcast with its account, and cached for it', async () => {
    answers = [A_ROWS]
    const hook = mount()
    await settle()
    expect(hook.result.current.unread).toBe(1)
    expect(broadcasts).toEqual([{ unread: 2, me: 'u-a' }])
    expect(JSON.parse(localStorage.getItem(CACHE_KEY)!)).toMatchObject({ userId: 'u-a', me: 'u-a' })
  })

  it('the device copy paints instantly for its own account, and a copy from before this change (no `me`) is passed over', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ userId: 'u-a', me: 'u-a', items: [row('n1', 'cached')], unread: 1 }))
    answers = ['hold']
    const mine = mount()
    await settle()
    expect(mine.result.current.items.map((n) => n.body)).toEqual(['cached'])
    cleanup()
    localStorage.setItem(CACHE_KEY, JSON.stringify({ userId: 'u-a', items: [row('n1', 'legacy')], unread: 1 }))
    answers = ['hold']
    const legacy = mount()
    await settle()
    expect(legacy.result.current.items).toEqual([])
  })

  it('an optimistic edit changes only the rows it was made on: markRead after a switch does not touch the next account', async () => {
    answers = [A_ROWS]
    const hook = mount()
    await settle()
    const markReadAsA = hook.result.current.markRead
    await as(hook, 'u-b')
    await act(async () => { await markReadAsA('n1') })
    expect(hook.result.current.items).toEqual([])
    expect(hook.result.current.unread).toBe(0)
  })

  it('⛔ every edit\'s request names the account whose rows it was made on — so the server refuses it under another cookie', async () => {
    answers = [{ me: 'u-a', notifications: [row('n1', 'x'), row('n2', 'y')], unread: 2 }]
    const hook = mount()
    await settle()
    const sent = () => (fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls
      .filter(([u, init]) => u !== '/api/notifications' || init?.method === 'DELETE')
      .map(([u, init]) => [u, init?.method, (init?.headers as Record<string, string> | undefined)?.['x-eno-acting-account']])
    await act(async () => { await hook.result.current.markRead('n1') })
    await act(async () => { await hook.result.current.markAllRead() })
    await act(async () => { await hook.result.current.remove('n2') })
    await act(async () => { await hook.result.current.clearAll() })
    expect(sent()).toEqual([
      ['/api/notifications/read', 'POST', 'u-a'],
      ['/api/notifications/read', 'POST', 'u-a'],
      ['/api/notifications/n2', 'DELETE', 'u-a'],
      ['/api/notifications', 'DELETE', 'u-a'],
    ])
  })

  it('the four edits keep one identity across polls (a consumer may list them in an effect)', async () => {
    answers = [A_ROWS, { ...A_ROWS, notifications: [row('n1', 'x'), row('n2', 'y')], unread: 2 }]
    const hook = mount()
    await settle()
    const before = hook.result.current
    await act(async () => { hook.result.current.refresh() })
    await settle()
    expect(hook.result.current.items).toHaveLength(2) // a poll did land
    for (const k of ['markRead', 'markAllRead', 'remove', 'clearAll'] as const) expect(hook.result.current[k]).toBe(before[k])
  })

  it('signed out, an edit sends nothing — no account owns the rows (an unnamed request would act as whoever signs in)', async () => {
    auth.user = null
    const hook = mount()
    await settle()
    await act(async () => { await hook.result.current.markAllRead(); await hook.result.current.clearAll() })
    const mutations = (fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls.filter(([, init]) => (init?.method ?? 'GET') !== 'GET')
    expect(mutations).toEqual([])
  })

  it('an edit on A\'s rows never takes away another account\'s device copy (written by another tab)', async () => {
    answers = [A_ROWS]
    const hook = mount()
    await settle()
    // Another tab, signed in as B on the shared device, has cached B's bell; this tab still shows A for a moment.
    localStorage.setItem(CACHE_KEY, JSON.stringify({ userId: 'u-b', me: 'u-b', items: [], unread: 0 }))
    await act(async () => { await hook.result.current.clearAll() })
    expect(JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null')?.me).toBe('u-b')
  })

  it('markRead still drops the count by one for an unread row, once', async () => {
    answers = [{ me: 'u-a', notifications: [row('n1', 'x'), row('n2', 'y')], unread: 2 }]
    const hook = mount()
    await settle()
    await act(async () => { await hook.result.current.markRead('n1') })
    await act(async () => { await hook.result.current.markRead('n1') })
    expect(hook.result.current.unread).toBe(1)
    expect(hook.result.current.items.find((n) => n.id === 'n1')?.read).toBe(true)
  })
})
