// @vitest-environment jsdom
/**
 * Deleting a conversation from the inbox waits out the house undo window (src/hooks/use-undo-window.tsx):
 * ONE clock, the toast only its view. Until 2026-10-06 it ran its own 5s setTimeout beside a sonner toast
 * of `duration: 5000` — and sonner pauses that toast while it is touched or hovered and while the tab is
 * hidden, so the DELETE could go out with "Undo" still on screen, and the tap re-pulled an inbox the
 * conversation had already left.
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const toastFn = vi.hoisted(() => {
  let seq = 0
  return Object.assign(vi.fn((_title?: unknown, _opts?: unknown) => ++seq), { error: vi.fn(), dismiss: vi.fn() })
})
// A STABLE user: a fresh object per render would re-run every [user] effect on every render.
const auth = vi.hoisted(() => ({ user: { id: 'u1' } }))
vi.mock('sonner', () => ({ toast: toastFn }))
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

// A tiny server: a DELETE hides the conversation from later pulls.
function stubFetch() {
  const hidden = new Set<string>()
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') { hidden.add(url.split('/').pop()!); return { ok: true, json: async () => ({}) } }
    if (url === '/api/conversations') {
      return { ok: true, json: async () => ({ conversations: ['c1', 'c2', 'c3'].filter((id) => !hidden.has(id)).map((id) => ({ id })) }) }
    }
    return { ok: true, json: async () => ({ unread: 0 }) }
  })
  vi.stubGlobal('fetch', f)
  return f
}
const inboxPulls = (f: ReturnType<typeof stubFetch>) => f.mock.calls.filter(([url, init]) => url === '/api/conversations' && !init?.method).length // GETs only
const deletes = (f: ReturnType<typeof stubFetch>) => f.mock.calls.filter(([, init]) => init?.method === 'DELETE')
const undoCall = () => toastFn.mock.calls.findIndex(([title]) => title === 'Conversation removed')
const undoToast = () => toastFn.mock.calls[undoCall()][1] as unknown as { duration: number; action: { props: { onClick: () => void } } }

async function mountWithInbox() {
  const f = stubFetch()
  const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  expect(hook.result.current.convos?.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
  return { f, chat: () => hook.result.current }
}

// A FRESH in-memory Storage per test: Node 25's own localStorage global has no working methods inside a
// jsdom test, while CI's Node 24 gives a real one that persists across a file's tests — a stub is the
// only way the two agree (the cached inbox written by one test must not seed the next).
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

beforeEach(() => {
  vi.useFakeTimers()
  stubStorage()
  toastFn.mockClear(); toastFn.error.mockClear(); toastFn.dismiss.mockClear()
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('deleteConvo — the undo window cannot outlive the DELETE', () => {
  it('⛔ the toast keeps no clock of its own: it comes down when the DELETE goes out, and a late Undo does nothing', async () => {
    const { f, chat } = await mountWithInbox()
    act(() => { chat().deleteConvo('c1') })
    expect(chat().convos?.map((c) => c.id)).toEqual(['c2', 'c3']) // gone from the list at once
    expect(undoToast().duration).toBe(Infinity)
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(deletes(f)).toEqual([['/api/conversations/c1', { method: 'DELETE', keepalive: true }]])
    expect(toastFn.dismiss).toHaveBeenCalledWith(toastFn.mock.results[undoCall()].value)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) }) // the post-DELETE re-pull settles
    const pullsBefore = inboxPulls(f)
    act(() => { undoToast().action.props.onClick() })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(inboxPulls(f)).toBe(pullsBefore) // no "restore" of a conversation that was already removed
    expect(deletes(f)).toHaveLength(1)
  })

  it('Undo inside the window re-pulls the inbox, and the DELETE is never sent', async () => {
    const { f, chat } = await mountWithInbox()
    act(() => { chat().deleteConvo('c1') })
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    const pullsBefore = inboxPulls(f)
    act(() => { undoToast().action.props.onClick() })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(inboxPulls(f)).toBe(pullsBefore + 1)
    expect(chat().convos?.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(deletes(f)).toHaveLength(0)
  })

  /**
   * Two windows at once (the old code kept a Map of them). Undoing one re-pulls the inbox — and the server
   * still lists the OTHER one, whose DELETE has not gone out yet. That pull used to put it back on screen
   * with its delete still pending; a conversation inside its window now stays out of every pull.
   */
  it('⛔ undoing one delete does not resurrect another still inside its window, and each sends on its own clock', async () => {
    const { f, chat } = await mountWithInbox()
    act(() => { chat().deleteConvo('c1') })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    act(() => { chat().deleteConvo('c2') })
    expect(chat().convos?.map((c) => c.id)).toEqual(['c3'])
    const undoC1 = toastFn.mock.calls.filter(([title]) => title === 'Conversation removed')[0][1] as unknown as { action: { props: { onClick: () => void } } }
    act(() => { undoC1.action.props.onClick() })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(chat().convos?.map((c) => c.id)).toEqual(['c1', 'c3']) // c1 back, c2 still out
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(deletes(f)).toEqual([['/api/conversations/c2', { method: 'DELETE', keepalive: true }]])
  })

  // The house hook's deliberate trade: a phone may discard a backgrounded tab without pagehide, so the tab
  // going HIDDEN sends what is waiting (the conversation delete used to flush on pagehide only).
  it('the tab going hidden inside the window sends the DELETE at once; visible sends nothing', async () => {
    const { f, chat } = await mountWithInbox()
    act(() => { chat().deleteConvo('c1') })
    const setVisibility = (v: 'visible' | 'hidden') => {
      Object.defineProperty(document, 'visibilityState', { value: v, configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))
    }
    act(() => { setVisibility('visible') })
    expect(deletes(f)).toHaveLength(0)
    act(() => { setVisibility('hidden') })
    expect(deletes(f)).toEqual([['/api/conversations/c1', { method: 'DELETE', keepalive: true }]])
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  })

  it('the page going away inside the window sends the DELETE at once, with keepalive', async () => {
    const { f, chat } = await mountWithInbox()
    act(() => { chat().deleteConvo('c1') })
    act(() => { window.dispatchEvent(new Event('pagehide')) })
    expect(deletes(f)).toEqual([['/api/conversations/c1', { method: 'DELETE', keepalive: true }]])
    expect(toastFn.dismiss).toHaveBeenCalledWith(toastFn.mock.results[undoCall()].value)
  })
})
