// @vitest-environment jsdom
/**
 * The inbox pull and the unread count (chat-context.tsx), on the ways they used to go wrong:
 * ⛔ A FAILED PULL WAS AN EMPTY INBOX — a 401/500 JSON body read as `conversations ?? []`, so an outage said
 *    "No messages yet" and CACHED that; a non-JSON body left the skeletons up forever.
 * ⛔ AN ANSWER OUTLIVED ITS ACCOUNT — a pull in flight at sign-out landed afterwards (the previous user's
 *    inbox shown and cached while signed out); a stale callback could start a pull after a user change.
 * ⛔ A FAILED UNREAD READ AS ZERO — the badge vanished on any error.
 * ⛔ ONLY THE NEWEST PULL COULD LAND (review round 4) — a busy inbox on a slow link never updated, and a
 *    stale callback for the previous account cancelled the current account's pull.
 */
import * as React from 'react'
import { act, cleanup, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ user: { id: 'u1' } as { id: string } | null }))
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
const CONVOS_KEY = 'eno-convos-v2'

type Reply = { status?: number; body?: unknown; text?: string } | 'hang'
/** Per-URL replies; `hold()` makes the next inbox pull wait for `release()`. */
function stubFetch(inbox: () => Reply, unread: () => Reply = () => ({ body: { unread: 0 } })) {
  let held: (() => void) | null = null
  let holdNext = false
  const respond = (r: Reply) => {
    if (r === 'hang') return new Promise(() => {})
    const status = r.status ?? 200
    return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => (r.text !== undefined ? JSON.parse(r.text) : r.body) })
  }
  const f = vi.fn((url: string) => {
    if (url === '/api/conversations') {
      if (holdNext) { holdNext = false; const r = inbox(); return new Promise((res) => { held = () => res(respond(r)) }) }
      return respond(inbox())
    }
    if (url === '/api/conversations/unread') return respond(unread())
    return respond({ body: null })
  })
  vi.stubGlobal('fetch', f)
  return { f, hold: () => { holdNext = true }, release: () => held?.() }
}
const pulls = (f: ReturnType<typeof stubFetch>['f']) => f.mock.calls.filter(([u]) => u === '/api/conversations').length

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

beforeEach(() => { vi.useFakeTimers(); stubStorage(); auth.user = { id: 'u1' } })
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('the inbox pull', () => {
  it('⛔ a 500 keeps the inbox AND its cache, and raises convosError; the next success clears it', async () => {
    localStorage.setItem(CONVOS_KEY, JSON.stringify({ userId: 'u1', list: [{ id: 'c1' }] }))
    let fail = true
    stubFetch(() => (fail ? { status: 500, body: { error: 'boom' } } : { body: { conversations: [{ id: 'c1' }, { id: 'c2' }] } }))
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    expect(hook.result.current.convos?.map((c) => c.id)).toEqual(['c1']) // the cache, not "No messages yet"
    expect(hook.result.current.convosError).toBe('failed')
    expect(JSON.parse(localStorage.getItem(CONVOS_KEY)!).list).toEqual([{ id: 'c1' }]) // not overwritten with []
    fail = false
    act(() => { hook.result.current.refreshConvos() })
    await settle()
    expect(hook.result.current.convos?.map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(hook.result.current.convosError).toBeNull()
  })

  it('a 2xx without a conversations array is a failure too — never an empty inbox', async () => {
    stubFetch(() => ({ body: { error: 'maintenance' } }))
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    expect(hook.result.current.convos).toBeNull()
    expect(hook.result.current.convosError).toBe('failed')
  })

  it('a real empty inbox still reads as one', async () => {
    stubFetch(() => ({ body: { conversations: [] } }))
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    expect(hook.result.current.convos).toEqual([])
    expect(hook.result.current.convosError).toBeNull()
  })

  it('a pull that never answers gives up after 45s and says so, instead of skeletons forever', async () => {
    // A fetch that never answers on its own — it rejects only when the request's signal aborts, as a
    // real fetch does.
    const f = vi.fn((url: string, init?: RequestInit) => new Promise((_, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('timeout'))) }))
    vi.stubGlobal('fetch', f)
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    await act(async () => { await vi.advanceTimersByTimeAsync(44_999) })
    expect(hook.result.current.convosError).toBeNull() // still waiting — a slow link is not a failure
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(hook.result.current.convosError).toBe('failed')
  })

  it('a SLOW answer (30s, a big inbox on a weak link) still lands', async () => {
    // Honours its signal like a real fetch, so a give-up shorter than 30s would abort it.
    const f = vi.fn((url: string, init?: RequestInit) => new Promise((res, reject) => {
      const body = url === '/api/conversations' ? { conversations: [{ id: 'c1' }] } : { unread: 0 }
      const timer = setTimeout(() => res({ ok: true, status: 200, json: async () => body }), 30_000)
      init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')) })
    }))
    vi.stubGlobal('fetch', f)
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(hook.result.current.convos?.map((c) => c.id)).toEqual(['c1'])
    expect(hook.result.current.convosError).toBeNull()
  })

  it('⛔ a 401 (the session expired under a signed-in client) is "auth", not a retry that can never work', async () => {
    stubFetch(() => ({ status: 401, body: { error: 'unauthorized' } }))
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    expect(hook.result.current.convosError).toBe('auth')
  })

  it('⛔ a pull in flight when the user signs out never lands — no previous inbox shown or cached', async () => {
    const s = stubFetch(() => ({ body: { conversations: [{ id: 'c1' }] } }))
    s.hold()
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    auth.user = null
    hook.rerender()
    await settle()
    s.release()
    await settle()
    expect(hook.result.current.convos).toBeNull()
    expect(localStorage.getItem(CONVOS_KEY)).toBeNull()
  })

  it('⛔ a stale callback holding the previous user cannot land its answer — nothing shown or cached under either account', async () => {
    // The server answers for whoever the session cookie says — the CURRENT user.
    stubFetch(() => ({ body: { conversations: [{ id: `${auth.user?.id}-convo` }] } }))
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    const staleRefresh = hook.result.current.refreshConvos // closes over u1
    auth.user = { id: 'u2' }
    hook.rerender()
    await settle()
    expect(hook.result.current.convos?.map((c) => c.id)).toEqual(['u2-convo'])
    act(() => { staleRefresh() }) // fetches with u2's cookie, made "for" u1
    await settle()
    expect(hook.result.current.convos?.map((c) => c.id)).toEqual(['u2-convo'])
    expect(JSON.parse(localStorage.getItem(CONVOS_KEY)!).userId).toBe('u2') // u2's answer never filed under u1
  })
})

describe('the inbox pull — review round 2 (codex + opus, 2026-10-06)', () => {
  it('⛔ a CHILD that pulls on sign-in is not dropped as stale (children run their effects before the provider)', async () => {
    auth.user = null
    const s = stubFetch(() => ({ body: { conversations: [{ id: 'c1' }] } }))
    let childPulls = 0
    function Child() {
      const { refreshConvos } = useChat()
      const uid = auth.user?.id ?? null
      React.useEffect(() => { if (uid) { childPulls++; refreshConvos() } }, [uid, refreshConvos])
      return null
    }
    const view = render(<ChatProvider><Child /></ChatProvider>)
    await settle()
    expect(pulls(s.f)).toBe(0)
    auth.user = { id: 'u1' }
    view.rerender(<ChatProvider><Child /></ChatProvider>)
    await settle()
    expect(childPulls).toBe(1)
    // The provider's own pull AND the child's — the child's used to be dropped because its effect ran
    // before a passive-effect ref had learned the new user.
    expect(pulls(s.f)).toBe(2)
  })

  it('a child that pulls in a LAYOUT effect on sign-in is kept too (its layout effect runs before the provider\'s)', async () => {
    auth.user = null
    const s = stubFetch(() => ({ body: { conversations: [{ id: 'c1' }] } }))
    function Child() {
      const { refreshConvos } = useChat()
      const uid = auth.user?.id ?? null
      React.useLayoutEffect(() => { if (uid) refreshConvos() }, [uid, refreshConvos])
      return null
    }
    const view = render(<ChatProvider><Child /></ChatProvider>)
    await settle()
    auth.user = { id: 'u1' }
    view.rerender(<ChatProvider><Child /></ChatProvider>)
    await settle()
    expect(pulls(s.f)).toBe(2) // the child's and the provider's
  })

  it('⛔ a body that stalls after the headers still gives up at 45s — the timer covers the body', async () => {
    const f = vi.fn((url: string, init?: RequestInit) => Promise.resolve({
      ok: true, status: 200,
      json: () => new Promise((_, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))) }),
    }))
    vi.stubGlobal('fetch', f)
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    expect(hook.result.current.convosError).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(45_000) })
    expect(hook.result.current.convosError).toBe('failed')
  })

  it('a new user OBJECT for the same id (a token refresh) does not clear a real error without a successful pull', async () => {
    let mode: 'fail' | 'hang' = 'fail'
    const f = vi.fn((url: string) => {
      if (url !== '/api/conversations') return Promise.resolve({ ok: true, status: 200, json: async () => ({ unread: 0 }) })
      return mode === 'fail' ? Promise.resolve({ ok: false, status: 500, json: async () => ({}) }) : new Promise(() => {})
    })
    vi.stubGlobal('fetch', f)
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    expect(hook.result.current.convosError).toBe('failed')
    mode = 'hang'
    auth.user = { id: 'u1' } // same id, new object
    hook.rerender()
    await settle()
    expect(hook.result.current.convosError).toBe('failed')
  })

  it('⛔ an OLDER pull failing after a newer one succeeded does not mark the fresh list out of date', async () => {
    let answer: () => Promise<unknown> = () => Promise.resolve({ ok: true, status: 200, json: async () => ({ conversations: [{ id: 'c1' }] }) })
    let releaseOld: (() => void) | null = null
    const f = vi.fn((url: string) => (url === '/api/conversations' ? answer() : Promise.resolve({ ok: true, status: 200, json: async () => ({ unread: 0 }) })))
    vi.stubGlobal('fetch', f)
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    // Pull A hangs, then fails late; pull B (newer) succeeds first.
    answer = () => new Promise((_, reject) => { releaseOld = () => reject(new Error('timeout')) })
    act(() => { hook.result.current.refreshConvos() })
    answer = () => Promise.resolve({ ok: true, status: 200, json: async () => ({ conversations: [{ id: 'c1' }, { id: 'c2' }] }) })
    act(() => { hook.result.current.refreshConvos() })
    await settle()
    expect(hook.result.current.convosError).toBeNull()
    await act(async () => { releaseOld?.(); await vi.advanceTimersByTimeAsync(0) })
    expect(hook.result.current.convosError).toBeNull()
  })

  it('a browser without AbortSignal.timeout still pulls — and still gives up at 45s', async () => {
    vi.stubGlobal('AbortSignal', {})
    const f = vi.fn((url: string, init?: RequestInit) => new Promise((_, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('timeout'))) }))
    vi.stubGlobal('fetch', f)
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    expect(f.mock.calls.some(([u]) => u === '/api/conversations')).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(45_000) })
    expect(hook.result.current.convosError).toBe('failed')
  })

  it('⛔ an OLDER successful pull landing after a newer one is ignored — the newest answer stays', async () => {
    let answer: () => Promise<unknown> = () => Promise.resolve({ ok: true, status: 200, json: async () => ({ conversations: [{ id: 'c1' }] }) })
    let releaseOld: (() => void) | null = null
    const f = vi.fn((url: string) => (url === '/api/conversations' ? answer() : Promise.resolve({ ok: true, status: 200, json: async () => ({ unread: 0 }) })))
    vi.stubGlobal('fetch', f)
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    // Pull A was made before a delete landed (it still lists c2); pull B is the re-pull after it.
    answer = () => new Promise((res) => { releaseOld = () => res({ ok: true, status: 200, json: async () => ({ conversations: [{ id: 'c1' }, { id: 'c2' }] }) }) })
    act(() => { hook.result.current.refreshConvos() })
    answer = () => Promise.resolve({ ok: true, status: 200, json: async () => ({ conversations: [{ id: 'c1' }] }) })
    act(() => { hook.result.current.refreshConvos() })
    await settle()
    await act(async () => { releaseOld?.(); await vi.advanceTimersByTimeAsync(0) })
    expect(hook.result.current.convos?.map((c) => c.id)).toEqual(['c1'])
    expect(JSON.parse(localStorage.getItem(CONVOS_KEY)!).list).toEqual([{ id: 'c1' }])
  })

  it('⛔ a switch u1 → u2 never shows u1\'s inbox or unread under u2 — even when u2\'s pulls fail', async () => {
    let fail = false
    stubFetch(
      () => (fail ? { status: 500, body: {} } : { body: { conversations: [{ id: 'u1-convo' }] } }),
      () => (fail ? { status: 500, body: {} } : { body: { unread: 4 } }),
    )
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    expect(hook.result.current.convos?.map((c) => c.id)).toEqual(['u1-convo'])
    expect(hook.result.current.unread).toBe(4)
    fail = true
    auth.user = { id: 'u2' }
    hook.rerender()
    // The very first render as u2 — before any effect — must already be clean.
    expect(hook.result.current.convos).toBeNull()
    expect(hook.result.current.unread).toBe(0)
    await settle()
    expect(hook.result.current.convos).toBeNull() // the fault state, not u1's list
    expect(hook.result.current.convosError).toBe('failed')
    expect(hook.result.current.unread).toBe(0)
  })
})

/** A server whose inbox answers wait for the test: each pull parks a resolver, released by index. */
function manualInbox() {
  const parked: { resolve: (body: unknown) => void; reject: (status: number) => void }[] = []
  const f = vi.fn((url: string) => {
    if (url !== '/api/conversations') return Promise.resolve({ ok: true, status: 200, json: async () => ({ unread: 0 }) })
    return new Promise((res) => {
      parked.push({
        resolve: (body) => res({ ok: true, status: 200, json: async () => body }),
        reject: (status) => res({ ok: false, status, json: async () => ({}) }),
      })
    })
  })
  vi.stubGlobal('fetch', f)
  return { f, parked }
}
const ids = (hook: { result: { current: ReturnType<typeof useChat> } }) => hook.result.current.convos?.map((c) => c.id)

describe('the inbox pull — review round 4 (codex + opus, 2026-10-06)', () => {
  it('⛔ a busy inbox never starves: an answer lands while a newer pull is still out, then the newer one', async () => {
    const s = manualInbox()
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    act(() => { hook.result.current.refreshConvos() }) // a realtime bump
    act(() => { hook.result.current.refreshConvos() }) // another, before anything answered
    expect(s.parked).toHaveLength(3)
    await act(async () => { s.parked[0].resolve({ conversations: [{ id: 'c1' }] }); await vi.advanceTimersByTimeAsync(0) })
    expect(ids(hook)).toEqual(['c1']) // superseded twice, and still shown — nothing newer has landed
    await act(async () => { s.parked[2].resolve({ conversations: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }] }); await vi.advanceTimersByTimeAsync(0) })
    expect(ids(hook)).toEqual(['c1', 'c2', 'c3'])
    await act(async () => { s.parked[1].resolve({ conversations: [{ id: 'c1' }, { id: 'c2' }] }); await vi.advanceTimersByTimeAsync(0) })
    expect(ids(hook)).toEqual(['c1', 'c2', 'c3']) // older than what is shown: ignored
  })

  it('⛔ a stale callback for the PREVIOUS account cannot cancel the current account\'s pull', async () => {
    const s = manualInbox()
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    await act(async () => { s.parked[0].resolve({ conversations: [{ id: 'u1-convo' }] }); await vi.advanceTimersByTimeAsync(0) })
    const staleRefresh = hook.result.current.refreshConvos // closes over u1
    auth.user = { id: 'u2' }
    hook.rerender()
    await settle()
    expect(s.parked).toHaveLength(2) // u2's own pull, still out
    act(() => { staleRefresh() })
    await act(async () => { s.parked[2].resolve({ conversations: [{ id: 'u2-convo' }] }); await vi.advanceTimersByTimeAsync(0) })
    await act(async () => { s.parked[1].resolve({ conversations: [{ id: 'u2-convo' }] }); await vi.advanceTimersByTimeAsync(0) })
    expect(ids(hook)).toEqual(['u2-convo'])
    expect(hook.result.current.convosError).toBeNull()
  })

  it('an older answer landing after the NEWEST pull failed shows its data but keeps the banner', async () => {
    const s = manualInbox()
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    await act(async () => { s.parked[0].resolve({ conversations: [{ id: 'c1' }] }); await vi.advanceTimersByTimeAsync(0) })
    act(() => { hook.result.current.refreshConvos() })
    act(() => { hook.result.current.refreshConvos() })
    await act(async () => { s.parked[2].reject(500); await vi.advanceTimersByTimeAsync(0) })
    expect(hook.result.current.convosError).toBe('failed')
    await act(async () => { s.parked[1].resolve({ conversations: [{ id: 'c1' }, { id: 'c2' }] }); await vi.advanceTimersByTimeAsync(0) })
    expect(ids(hook)).toEqual(['c1', 'c2']) // newer than what was shown, so it is shown
    expect(hook.result.current.convosError).toBe('failed') // but the refresh after it failed
  })

  it('an older pull failing while a newer one is still out raises nothing', async () => {
    const s = manualInbox()
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    act(() => { hook.result.current.refreshConvos() })
    await act(async () => { s.parked[0].reject(500); await vi.advanceTimersByTimeAsync(0) })
    expect(hook.result.current.convosError).toBeNull()
    await act(async () => { s.parked[1].reject(500); await vi.advanceTimersByTimeAsync(0) })
    expect(hook.result.current.convosError).toBe('failed')
  })

  it('Try again (retryConvos) keeps the error up and marks the retry in flight; a failure ends it, error still up; a success clears both', async () => {
    const s = manualInbox()
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    await act(async () => { s.parked[0].reject(500); await vi.advanceTimersByTimeAsync(0) })
    expect(hook.result.current.convosError).toBe('failed')
    expect(hook.result.current.convosRetrying).toBe(false)
    act(() => { hook.result.current.retryConvos() })
    expect(hook.result.current.convosRetrying).toBe(true) // the tap shows as busy…
    expect(hook.result.current.convosError).toBe('failed') // …and the caution stays: the list may still be stale
    expect(s.parked).toHaveLength(2)
    await act(async () => { s.parked[1].reject(503); await vi.advanceTimersByTimeAsync(0) })
    expect(hook.result.current.convosRetrying).toBe(false)
    expect(hook.result.current.convosError).toBe('failed')
    act(() => { hook.result.current.retryConvos() })
    await act(async () => { s.parked[2].resolve({ conversations: [{ id: 'c1' }] }); await vi.advanceTimersByTimeAsync(0) })
    expect(ids(hook)).toEqual(['c1'])
    expect(hook.result.current.convosError).toBeNull()
    expect(hook.result.current.convosRetrying).toBe(false)
  })
})

describe('the inbox pull — review round 5: a SESSION owns an answer, not a user id (codex + opus)', () => {
  it('⛔ out and back into the SAME account: a pull from before the sign-out never lands in the new session', async () => {
    const s = manualInbox()
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    expect(s.parked).toHaveLength(1) // session 1's pull, still out
    auth.user = null
    hook.rerender()
    await settle()
    auth.user = { id: 'u1' }
    hook.rerender()
    await settle()
    expect(s.parked).toHaveLength(2) // the new session's pull
    await act(async () => { s.parked[0].resolve({ conversations: [{ id: 'before-sign-out' }] }); await vi.advanceTimersByTimeAsync(0) })
    expect(hook.result.current.convos).toBeNull()
    expect(localStorage.getItem(CONVOS_KEY)).toBeNull()
    await act(async () => { s.parked[1].resolve({ conversations: [{ id: 'now' }] }); await vi.advanceTimersByTimeAsync(0) })
    expect(ids(hook)).toEqual(['now'])
  })

  it('⛔ A → B → A: a stale callback\'s answer, fetched while B was signed in, never reaches A', async () => {
    const s = manualInbox()
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    await act(async () => { s.parked[0].resolve({ conversations: [{ id: 'u1-convo' }] }); await vi.advanceTimersByTimeAsync(0) })
    const staleRefresh = hook.result.current.refreshConvos // closes over u1's session
    auth.user = { id: 'u2' }
    hook.rerender()
    await settle()
    act(() => { staleRefresh() }) // fetches with u2's cookie
    auth.user = { id: 'u1' }
    hook.rerender()
    await settle()
    const stale = s.parked[2]
    await act(async () => { stale.resolve({ conversations: [{ id: 'u2-convo' }] }); await vi.advanceTimersByTimeAsync(0) })
    expect(ids(hook) ?? []).not.toContain('u2-convo')
    expect(localStorage.getItem(CONVOS_KEY) ?? '').not.toContain('u2-convo')
    await act(async () => { s.parked[s.parked.length - 1].resolve({ conversations: [{ id: 'u1-convo' }] }); await vi.advanceTimersByTimeAsync(0) })
    expect(ids(hook)).toEqual(['u1-convo'])
  })

  it('⛔ an OLDER pull landing during a retry does not end its busy state — only the retry, or a newer pull, does', async () => {
    const s = manualInbox()
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    await act(async () => { s.parked[0].resolve({ conversations: [{ id: 'c1' }] }); await vi.advanceTimersByTimeAsync(0) })
    act(() => { hook.result.current.refreshConvos() }) // A — stays out
    act(() => { hook.result.current.refreshConvos() }) // B — fails
    await act(async () => { s.parked[2].reject(500); await vi.advanceTimersByTimeAsync(0) })
    expect(hook.result.current.convosError).toBe('failed')
    act(() => { hook.result.current.retryConvos() }) // C
    await act(async () => { s.parked[1].resolve({ conversations: [{ id: 'c1' }, { id: 'c2' }] }); await vi.advanceTimersByTimeAsync(0) })
    expect(ids(hook)).toEqual(['c1', 'c2']) // A is newer than what was shown, so it shows…
    expect(hook.result.current.convosRetrying).toBe(true) // …but C is still out
    expect(hook.result.current.convosError).toBe('failed')
    await act(async () => { s.parked[3].resolve({ conversations: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }] }); await vi.advanceTimersByTimeAsync(0) })
    expect(hook.result.current.convosRetrying).toBe(false)
    expect(hook.result.current.convosError).toBeNull()
  })

  it('⛔ a stale Try again from a previous session cannot leave the next one busy', async () => {
    const s = manualInbox()
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    await act(async () => { s.parked[0].reject(500); await vi.advanceTimersByTimeAsync(0) })
    const staleRetry = hook.result.current.retryConvos // u1's session
    auth.user = { id: 'u2' }
    hook.rerender()
    await settle()
    await act(async () => { s.parked[1].resolve({ conversations: [] }); await vi.advanceTimersByTimeAsync(0) }) // u2: really empty
    act(() => { staleRetry() })
    expect(hook.result.current.convosRetrying).toBe(false)
    await act(async () => { s.parked[2].resolve({ conversations: [] }); await vi.advanceTimersByTimeAsync(0) }) // dropped on arrival
    expect(hook.result.current.convosRetrying).toBe(false) // "No messages yet", never skeletons forever
    expect(hook.result.current.convos).toEqual([])
  })

  it('a retry in flight does not carry into the next session', async () => {
    const s = manualInbox()
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    await act(async () => { s.parked[0].reject(500); await vi.advanceTimersByTimeAsync(0) })
    act(() => { hook.result.current.retryConvos() })
    expect(hook.result.current.convosRetrying).toBe(true)
    auth.user = { id: 'u2' }
    hook.rerender()
    expect(hook.result.current.convosRetrying).toBe(false) // from u2's first render
    expect(hook.result.current.convosError).toBeNull()
  })
})

describe('the unread count', () => {
  it('⛔ a failure keeps the badge; only a number from a 2xx answer changes it', async () => {
    let reply: { status?: number; body?: unknown } = { body: { unread: 3 } }
    stubFetch(() => ({ body: { conversations: [] } }), () => reply)
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    expect(hook.result.current.unread).toBe(3)
    reply = { status: 500, body: { error: 'boom' } }
    act(() => { hook.result.current.refreshUnread() })
    await settle()
    expect(hook.result.current.unread).toBe(3)
    reply = { body: { nope: true } }
    act(() => { hook.result.current.refreshUnread() })
    await settle()
    expect(hook.result.current.unread).toBe(3)
    // A 401 too: the last count this session had stays (the inbox is the one that says the session expired).
    reply = { status: 401, body: { error: 'auth_required' } }
    act(() => { hook.result.current.refreshUnread() })
    await settle()
    expect(hook.result.current.unread).toBe(3)
    reply = { body: { unread: 0 } }
    act(() => { hook.result.current.refreshUnread() })
    await settle()
    expect(hook.result.current.unread).toBe(0)
  })

  it('an OLDER count landing after a newer one is ignored', async () => {
    const parked: ((n: number) => void)[] = []
    vi.stubGlobal('fetch', vi.fn((url: string) => (url === '/api/conversations/unread'
      ? new Promise((res) => { parked.push((n) => res({ ok: true, status: 200, json: async () => ({ unread: n }) })) })
      : Promise.resolve({ ok: true, status: 200, json: async () => ({ conversations: [] }) }))))
    const hook = renderHook(() => useChat(), { wrapper: ChatProvider })
    await settle()
    act(() => { hook.result.current.refreshUnread() })
    await act(async () => { parked[parked.length - 1](0); await vi.advanceTimersByTimeAsync(0) })
    expect(hook.result.current.unread).toBe(0)
    await act(async () => { parked[0](5); await vi.advanceTimersByTimeAsync(0) })
    expect(hook.result.current.unread).toBe(0)
  })
})
