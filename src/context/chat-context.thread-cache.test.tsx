// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⛔ THE THREAD CACHE SERVES A CONVERSATION ONLY TO THE ACCOUNT THE SERVER READ IT FOR (F5). Its in-memory copy
 * carried no account: a read still in flight at a sign-out refilled it after the clear, and the next account's thread
 * page painted it on its first frame. Every entry is now labelled by the payload's own `me` (the account whose cookie
 * the server saw), not by the account the callback closed over (codex, F5 plan review). Harness after
 * chat-context.inbox.test.tsx.
 */

const auth = vi.hoisted(() => ({ user: { id: 'u-a' } as { id: string } | null }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(() => 1), { error: vi.fn(), dismiss: vi.fn() }) }))
vi.mock('./auth-context', () => ({ useAuth: () => auth }))
vi.mock('./language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowser: () => ({
    auth: { getSession: async () => ({ data: { session: null } }) },
    realtime: { setAuth: async () => {}, connect: () => {}, disconnect: () => {} },
    removeChannel: () => {},
  }),
}))

const { ChatProvider, useChat } = await import('./chat-context')
const THREAD_KEY = 'eno-thr2:c1'

/** A thread payload as GET /api/conversations/[id] answers it — `me` is the account it was read for. */
const payload = (me: string, body = 'Hello from the thread') => ({ id: 'c1', me, counterpart: { name: 'Buyer' }, messages: [{ id: 'm1', body }] })

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
let fetchMock: ReturnType<typeof vi.fn>
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
const as = async (hook: { rerender: () => void }, id: string | null) => { auth.user = id ? { id } : null; hook.rerender(); await settle() }

beforeEach(() => {
  vi.useFakeTimers()
  stubStorage()
  auth.user = { id: 'u-a' }
  // The server answers for whoever's cookie the request carries: the account signed in when it goes out.
  fetchMock = vi.fn(async (url: string) => {
    const me = auth.user?.id ?? ''
    return { ok: true, status: 200, json: async () => (url.startsWith('/api/conversations/c1') ? payload(me) : url === '/api/conversations' ? [] : { unread: 0 }) }
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('the thread cache belongs to the account the server read each entry for', () => {
  it('⛔ a read that lands after its account signed out is not kept — not in memory, not back on the device', async () => {
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    const lateWrite = hook.result.current.cacheThread // A's read, still in flight…
    await as(hook, null) // …when A signs out (the cache is cleared)…
    act(() => { lateWrite('c1', payload('u-a')) }) // …and then lands
    expect(localStorage.getItem(THREAD_KEY)).toBeNull() // the device sign-out cleared stays clear
    await as(hook, 'u-b')
    expect(hook.result.current.getCachedThread('c1')).toBeNull()
    await as(hook, 'u-a')
    expect(hook.result.current.getCachedThread('c1')).toBeNull()
  })

  it('an answer read under ANOTHER account\'s cookie (a switch in another tab) is not kept for this one', async () => {
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    act(() => { hook.result.current.cacheThread('c1', payload('u-b')) }) // the cookie had switched; this tab had not
    expect(hook.result.current.getCachedThread('c1')).toBeNull()
    expect(localStorage.getItem(THREAD_KEY)).toBeNull()
  })

  it('⛔ an account switch with no sign-out between: the previous account\'s entries stay theirs — not served to the next', async () => {
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    act(() => { hook.result.current.cacheThread('c1', payload('u-a')) })
    expect(hook.result.current.getCachedThread('c1')).toMatchObject({ me: 'u-a' })
    await as(hook, 'u-b') // straight from A to B: nothing clears the memory
    expect(hook.result.current.getCachedThread('c1')).toBeNull()
    await as(hook, 'u-a')
    expect(hook.result.current.getCachedThread('c1')).toMatchObject({ me: 'u-a' })
  })

  it('⛔ a read that lands in the moment between signOut\'s device clear and the commit is taken away again at the commit', async () => {
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    // signOut clears the device, then React commits `user: null` a task later: a read answering in between is still
    // the old account's, and is kept — memory and device…
    act(() => { hook.result.current.cacheThread('c1', payload('u-a')) })
    expect(localStorage.getItem(THREAD_KEY)).not.toBeNull()
    await as(hook, null) // …until the commit, where the account goes and its copies go with it
    expect(localStorage.getItem(THREAD_KEY)).toBeNull()
    await as(hook, 'u-a')
    expect(hook.result.current.getCachedThread('c1')).toBeNull()
  })

  it('⛔ a device copy written before this change, labelled for A but holding another account\'s answer, is dropped — not served', async () => {
    // The old cacheThread labelled a copy with the writing callback's account, which a closure a render behind its
    // cookie could get wrong. The label alone is not enough to trust.
    localStorage.setItem(THREAD_KEY, JSON.stringify({ userId: 'u-a', data: payload('u-b', 'From B\'s conversation') }))
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    expect(hook.result.current.getCachedThread('c1')).toBeNull()
    expect(localStorage.getItem(THREAD_KEY)).toBeNull()
  })

  it('a device copy that is A\'s by label AND by `me` is served to A (the instant paint after a reload)', async () => {
    localStorage.setItem(THREAD_KEY, JSON.stringify({ userId: 'u-a', data: payload('u-a') }))
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    expect(hook.result.current.getCachedThread('c1')).toMatchObject({ me: 'u-a' })
  })

  it('a payload with no `me` is not kept — the same rule the thread page applies to an answer', async () => {
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    act(() => { hook.result.current.cacheThread('c1', { id: 'c1', counterpart: { name: 'Buyer' }, messages: [] }) })
    expect(hook.result.current.getCachedThread('c1')).toBeNull()
    expect(localStorage.getItem(THREAD_KEY)).toBeNull()
  })

  it('signed out, nothing is served — in the very render the account went, before any clear has run', async () => {
    const seen: unknown[] = []
    const hook = renderHook(() => { const c = useChat(); seen.push(c.getCachedThread('c1')); return c }, { wrapper: ChatProvider })
    await settle()
    act(() => { hook.result.current.cacheThread('c1', payload('u-a')) })
    auth.user = null
    hook.rerender() // the signed-out RENDER: what a page reading the cache in it (the thread page's first state) gets
    expect(seen.at(-1)).toBeNull()
  })

  it('a prefetch warms a thread held only for ANOTHER account, and skips one already held for this one', async () => {
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    act(() => { hook.result.current.cacheThread('c1', payload('u-a')) })
    await as(hook, 'u-b')
    const peeks = () => fetchMock.mock.calls.filter(([u]) => u === '/api/conversations/c1?peek=1').length
    const before = peeks()
    act(() => { hook.result.current.prefetchThread('c1') })
    await settle()
    expect(peeks()).toBe(before + 1)
    expect(hook.result.current.getCachedThread('c1')).toMatchObject({ me: 'u-b' }) // its answer: this account's
    act(() => { hook.result.current.prefetchThread('c1') })
    await settle()
    expect(peeks()).toBe(before + 1)
  })
})
