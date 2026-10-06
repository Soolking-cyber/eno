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

  /**
   * ⛔ FROM THE TAP UNTIL ITS DELETE LANDS, THE CONVERSATION STAYS OUT OF THE LIST. Between the window closing and
   * the DELETE landing the server still lists it, so a pull answered in that gap (a realtime bump, the tab coming
   * back) used to put it back on screen, tappable (branch review, 2026-10-06). It now stays out while the DELETE
   * is in flight, and the inbox re-pulls once it lands; a DELETE that fails brings it back.
   */
  function heldDeleteServer(deleteOk = true) {
    let releaseDelete = null as (() => void) | null
    let deleted = false
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        await new Promise<void>((res) => { releaseDelete = () => { deleted = deleteOk; res() } })
        return { ok: deleteOk, json: async () => ({}) }
      }
      if (url === '/api/conversations') {
        return { ok: true, json: async () => ({ conversations: ['c1', 'c2', 'c3'].filter((id) => !(deleted && id === 'c1')).map((id) => ({ id })) }) }
      }
      return { ok: true, json: async () => ({ unread: 0 }) }
    })
    vi.stubGlobal('fetch', f)
    return { f, release: () => releaseDelete?.() }
  }

  it('⛔ a pull answered while the DELETE is in flight does not bring the conversation back — and the inbox re-pulls once it lands', async () => {
    const { chat } = await mountWithInbox()
    const server = heldDeleteServer()
    act(() => { chat().deleteConvo('c1') })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) }) // the window closes: the DELETE goes out, and waits
    act(() => { chat().refreshConvos() }) // a realtime bump while it waits — the server still lists c1
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(chat().convos?.map((c) => c.id)).toEqual(['c2', 'c3']) // not back on screen, not tappable
    const pullsBefore = inboxPulls(server.f as unknown as ReturnType<typeof stubFetch>)
    await act(async () => { server.release(); await vi.advanceTimersByTimeAsync(0) })
    expect(inboxPulls(server.f as unknown as ReturnType<typeof stubFetch>)).toBe(pullsBefore + 1) // the re-pull, once it landed
    expect(chat().convos?.map((c) => c.id)).toEqual(['c2', 'c3'])
  })

  it('⛔ a pull STARTED while the DELETE was in flight, answering just after it lands, does not bring it back', async () => {
    const { chat } = await mountWithInbox()
    let releaseDelete = null as (() => void) | null
    let deleted = false
    const heldPulls: (() => void)[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        await new Promise<void>((res) => { releaseDelete = () => { deleted = true; res() } })
        return { ok: true, json: async () => ({}) }
      }
      if (url === '/api/conversations') {
        // The answer is what the server held WHEN ASKED, even if it arrives later.
        const body = { conversations: ['c1', 'c2', 'c3'].filter((id) => !(deleted && id === 'c1')).map((id) => ({ id })) }
        await new Promise<void>((res) => { heldPulls.push(res) })
        return { ok: true, json: async () => body }
      }
      return { ok: true, json: async () => ({ unread: 0 }) }
    }))
    act(() => { chat().deleteConvo('c1') })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) }) // the DELETE goes out, and waits
    act(() => { chat().refreshConvos() }) // a bump: asked while the server still lists c1
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    await act(async () => { releaseDelete?.(); await vi.advanceTimersByTimeAsync(0) }) // lands → the re-pull is asked
    expect(heldPulls).toHaveLength(2)
    await act(async () => { heldPulls[0](); await vi.advanceTimersByTimeAsync(0) }) // the bump answers FIRST, listing c1
    expect(chat().convos?.map((c) => c.id)).toEqual(['c2', 'c3'])
    await act(async () => { heldPulls[1](); await vi.advanceTimersByTimeAsync(0) })
    expect(chat().convos?.map((c) => c.id)).toEqual(['c2', 'c3'])
  })

  /** A server whose inbox answers wait for the test, each holding what the server listed WHEN ASKED. */
  function heldPullServer(onDelete: () => Promise<{ ok: boolean }> = async () => ({ ok: true })) {
    const heldPulls: (() => void)[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') { const r = await onDelete(); return { ok: r.ok, json: async () => ({}) } }
      if (url === '/api/conversations') {
        const body = { conversations: ['c1', 'c2', 'c3'].map((id) => ({ id })) }
        await new Promise<void>((res) => { heldPulls.push(res) })
        return { ok: true, json: async () => body }
      }
      return { ok: true, json: async () => ({ unread: 0 }) }
    }))
    return heldPulls
  }

  it('⛔ an UNDONE delete is not hidden by an older pull answering after the Undo — even if Undo\'s own re-pull never lands', async () => {
    const { chat } = await mountWithInbox()
    const heldPulls = heldPullServer()
    act(() => { chat().deleteConvo('c1') })
    act(() => { chat().refreshConvos() }) // a bump inside the window: c1 is pending when it starts
    act(() => { undoToast().action.props.onClick() }) // Undo — its own re-pull goes out too
    expect(heldPulls).toHaveLength(2)
    await act(async () => { heldPulls[0](); await vi.advanceTimersByTimeAsync(0) }) // the OLDER pull answers
    expect(chat().convos?.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
  })

  it('⛔ a FAILED delete is not hidden by an older pull answering after the failure', async () => {
    const { chat } = await mountWithInbox()
    let fail = null as (() => void) | null
    const heldPulls = heldPullServer(() => new Promise((res) => { fail = () => res({ ok: false }) }))
    act(() => { chat().deleteConvo('c1') })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) }) // the DELETE goes out, and waits
    act(() => { chat().refreshConvos() }) // a pull started while it is pending
    await act(async () => { fail?.(); await vi.advanceTimersByTimeAsync(0) }) // it fails: the rollback re-pull goes out
    expect(heldPulls).toHaveLength(2)
    await act(async () => { heldPulls[0](); await vi.advanceTimersByTimeAsync(0) }) // the OLDER pull answers
    expect(chat().convos?.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
  })

  it('⛔ delete, Undo, delete again: once the second DELETE lands, a pull from the FIRST attempt cannot bring it back', async () => {
    const { chat } = await mountWithInbox()
    let landed = false
    let release = null as (() => void) | null
    const heldPulls = heldPullServer(() => new Promise((res) => { release = () => { landed = true; res({ ok: true }) } }))
    act(() => { chat().deleteConvo('c1') })
    act(() => { chat().refreshConvos() }) // pull A, asked during the first attempt
    act(() => { undoToast().action.props.onClick() }) // Undo — its re-pull goes out too
    act(() => { chat().deleteConvo('c1') }) // and delete again
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) }) // the second DELETE goes out, and waits
    await act(async () => { release?.(); await vi.advanceTimersByTimeAsync(0) }) // it lands → the re-pull is asked
    expect(landed).toBe(true)
    await act(async () => { heldPulls[0](); heldPulls[1](); await vi.advanceTimersByTimeAsync(0) }) // A and Undo's re-pull answer, listing c1
    expect(chat().convos?.map((c) => c.id)).toEqual(['c2', 'c3'])
  })

  it('a DELETE that fails brings the conversation back, and says so', async () => {
    const { chat } = await mountWithInbox()
    const server = heldDeleteServer(false)
    act(() => { chat().deleteConvo('c1') })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(chat().convos?.map((c) => c.id)).toEqual(['c2', 'c3'])
    await act(async () => { server.release(); await vi.advanceTimersByTimeAsync(0) })
    expect(chat().convos?.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
    expect(toastFn.error).toHaveBeenCalledWith("Couldn't delete — try again")
  })

  it('the page going away inside the window sends the DELETE at once, with keepalive', async () => {
    const { f, chat } = await mountWithInbox()
    act(() => { chat().deleteConvo('c1') })
    act(() => { window.dispatchEvent(new Event('pagehide')) })
    expect(deletes(f)).toEqual([['/api/conversations/c1', { method: 'DELETE', keepalive: true }]])
    expect(toastFn.dismiss).toHaveBeenCalledWith(toastFn.mock.results[undoCall()].value)
  })
})
