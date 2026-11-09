// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_KEY, GUEST_KEY } from './saved-store'
import {
  adoptStoredSaved, dropGoneSaved, resetSavedForTest, savedView, startSaved, stopSaved, subscribeSaved, syncSaved, toggleSaved,
} from './saved-sync'

// ── src/lib/saved-sync.ts — a signed-in person's saves, in step with the account (owner, 2026-11-09: "3 ok") ─────────────
// The shapes three plan reviews broke: writes out of order, a write landing in another account, a cleared cache recreated,
// a merge deleting a save another tab made, an unsave brought back by a later merge.

const U = '11111111-1111-4111-8111-111111111111'
const V = '22222222-2222-4222-8222-222222222222'
const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const jwt = (sub: string) => `${b64url('{}')}.${b64url(JSON.stringify({ sub, exp: Math.floor(Date.now() / 1000) + 3600 }))}.s`
function signIn(uid: string | null) {
  document.cookie = 'sb-sb-auth-token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
  if (uid) document.cookie = `sb-sb-auth-token=${encodeURIComponent('base64-' + b64url(JSON.stringify({ access_token: jwt(uid) })))}; path=/`
}

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size }, key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null), setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) }, clear: () => { map.clear() },
  } as Storage
}
const guest = (): string[] => JSON.parse(localStorage.getItem(GUEST_KEY) || '[]')
const copy = () => JSON.parse(localStorage.getItem(ACCOUNT_KEY) || 'null')

type Call = { method: string; body?: { uid: string; add?: string[]; remove?: string[] } }
let calls: Call[] = []
let server: Set<string>
/** Whose list the server answers about (the shared cookie's account). */
let serverUid = U
/** Ids the server will not keep (not shown in this edition). */
let hidden = new Set<string>()
let answer: (c: Call) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>
function stubApi() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe('/api/saved-listings')
    const c: Call = { method: init?.method ?? 'GET', ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) }
    calls.push(c)
    const a = await answer(c)
    return { ok: a.status < 300, status: a.status, json: async () => a.body } as Response
  }))
}
/** A server that keeps one account's list, newest first. */
const realServer = (c: Call) => {
  if (c.method === 'GET') return { status: 200, body: { uid: serverUid, ids: [...server].reverse() } }
  for (const id of c.body!.remove ?? []) server.delete(id)
  const notStored: string[] = []
  for (const id of c.body!.add ?? []) { if (hidden.has(id)) { notStored.push(id); continue } server.delete(id); server.add(id) }
  return { status: 200, body: { ok: true, notStored } }
}

beforeEach(() => {
  resetSavedForTest()
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('navigator', {}) // no Web Locks in jsdom: the in-tab chain
  calls = []
  server = new Set()
  serverUid = U
  hidden = new Set()
  answer = realServer
  stubApi()
  signIn(U)
})
afterEach(() => { vi.unstubAllGlobals(); signIn(null) })

describe('start', () => {
  it('with this account\'s cache: shown at once, newest first — the account\'s list only (the one invariant, review r4)', () => {
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ u: U, ids: ['s2', 's1'] }))
    localStorage.setItem(GUEST_KEY, JSON.stringify(['g1', 'g2']))
    startSaved(U)
    expect(savedView()).toEqual({ owner: U, ids: ['s2', 's1'], ready: true, available: true, failed: false })
  })
  it('until the account\'s list is known, the device\'s guest list stands in for it', () => {
    localStorage.setItem(GUEST_KEY, JSON.stringify(['g1', 'g2']))
    startSaved(U)
    expect(savedView()).toMatchObject({ ids: ['g2', 'g1'], ready: false })
  })
  it('another account\'s cache is never shown: not ready until the account answers', () => {
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ u: V, ids: ['theirs'] }))
    startSaved(U)
    expect(savedView()).toMatchObject({ ids: [], ready: false })
  })
})

describe('sync', () => {
  it('reads the account, MOVES the guest list in (in chunks of 200, the account named), reads again, caches it', async () => {
    server = new Set(['old'])
    const many = Array.from({ length: 250 }, (_, i) => `g${i}`)
    localStorage.setItem(GUEST_KEY, JSON.stringify(many))
    startSaved(U)
    await syncSaved(U)
    expect(calls.map((c) => [c.method, c.body?.add?.length ?? 0, c.body?.uid ?? null])).toEqual([
      ['GET', 0, null], ['POST', 200, U], ['POST', 50, U], ['GET', 0, null],
    ])
    expect(guest()).toEqual([])
    expect(savedView()).toMatchObject({ ready: true, available: true })
    expect(savedView().ids[0]).toBe('g249')
    expect(savedView().ids).toHaveLength(251)
    expect(copy()).toEqual({ u: U, ids: savedView().ids })
  })

  it('⛔ a save another tab adds to the guest list during the merge stays there (only the ids sent leave)', async () => {
    localStorage.setItem(GUEST_KEY, JSON.stringify(['g1']))
    let once = true
    answer = (c) => {
      if (c.method === 'POST' && once) { once = false; localStorage.setItem(GUEST_KEY, JSON.stringify(['g1', 'late'])) } // the other tab, mid-request
      return realServer(c)
    }
    startSaved(U)
    await syncSaved(U)
    expect(guest()).toEqual(['late'])
    // The account's list is what shows; the late save moves in on the next sync.
    expect(savedView().ids).toEqual(['g1'])
    await syncSaved(U)
    expect(guest()).toEqual([])
    expect(savedView().ids).toEqual(['late', 'g1'])
  })

  it('a full account stops the merge: what was not stored stays on the device', async () => {
    localStorage.setItem(GUEST_KEY, JSON.stringify(Array.from({ length: 300 }, (_, i) => `g${i}`)))
    let n = 0
    answer = (c) => (c.method === 'POST' && ++n === 2 ? { status: 409, body: { error: 'limit_reached' } } : realServer(c))
    startSaved(U)
    await syncSaved(U)
    expect(guest()).toHaveLength(100)
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2)
  })

  it('no table yet → unavailable (the provider goes back to device saves); nothing merged', async () => {
    localStorage.setItem(GUEST_KEY, JSON.stringify(['g1']))
    answer = () => ({ status: 200, body: { uid: U, ids: [], available: false } })
    startSaved(U)
    await syncSaved(U)
    expect(savedView()).toMatchObject({ available: false, ready: true })
    expect(guest()).toEqual(['g1'])
  })

  it('a failed first read: with a cache the cache stays; without one it says it FAILED (never "nothing saved", never device mode)', async () => {
    answer = () => ({ status: 500, body: {} })
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ u: U, ids: ['s1'] }))
    startSaved(U)
    await syncSaved(U)
    expect(savedView()).toMatchObject({ ids: ['s1'], available: true, ready: true, failed: false })
    resetSavedForTest()
    localStorage.removeItem(ACCOUNT_KEY)
    startSaved(U)
    await syncSaved(U)
    expect(savedView()).toMatchObject({ available: true, ready: true, failed: true })
    // …and a tap still reaches the account, so an unsave is never left on this device only.
    answer = realServer
    const done = vi.fn()
    toggleSaved('n1', true, done)
    await vi.waitFor(() => expect(done).toHaveBeenCalledWith(true))
    expect(server.has('n1')).toBe(true)
  })

  it('⛔ an answer about ANOTHER account (the shared cookie changed mid-flight) is dropped, never shown as this one\'s', async () => {
    serverUid = V
    server = new Set(['theirs'])
    startSaved(U)
    await syncSaved(U)
    expect(savedView().ids).toEqual([])
    expect(savedView().failed).toBe(true)
    expect(copy()).toBeNull()
  })

  it('a failed re-read after the merge keeps what moved in (it is on the account), newest first', async () => {
    server = new Set(['s1'])
    localStorage.setItem(GUEST_KEY, JSON.stringify(['g1', 'g2']))
    let gets = 0
    answer = (c) => (c.method === 'GET' && ++gets === 2 ? { status: 500, body: {} } : realServer(c))
    startSaved(U)
    await syncSaved(U)
    expect(savedView().ids).toEqual(['g2', 'g1', 's1'])
    expect(guest()).toEqual([])
  })

  it('a guest save the server does not keep (hidden here) leaves the guest list like the device\'s own self-heal, and is not shown', async () => {
    hidden = new Set(['h1'])
    localStorage.setItem(GUEST_KEY, JSON.stringify(['h1', 'g1']))
    startSaved(U)
    await syncSaved(U)
    expect(guest()).toEqual([])
    expect(savedView().ids).toEqual(['g1'])
  })

  it('⛔ signed out in another tab before the answer: the cache is not written back', async () => {
    let release!: () => void
    answer = (c) => (c.method === 'GET' ? new Promise((r) => { release = () => r(realServer(c)) }) : realServer(c))
    startSaved(U)
    const done = syncSaved(U)
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    signIn(null) // the other tab signed out: the shared cookie is gone, and sign-out removed the cache
    release()
    await done
    expect(localStorage.getItem(ACCOUNT_KEY)).toBeNull()
  })
})

describe('toggle', () => {
  beforeEach(async () => {
    server = new Set(['s1'])
    startSaved(U)
    await syncSaved(U)
    calls = []
  })

  it('the heart moves at once; the server is told with the account named; the cache follows', async () => {
    toggleSaved('n1', true)
    expect(savedView().ids[0]).toBe('n1')
    await vi.waitFor(() => expect(copy()?.ids).toEqual(['n1', 's1']))
    expect(calls).toEqual([{ method: 'POST', body: { uid: U, add: ['n1'] } }])
    toggleSaved('s1', false)
    expect(savedView().ids).toEqual(['n1'])
    await vi.waitFor(() => expect(copy()?.ids).toEqual(['n1']))
    expect(server).toEqual(new Set(['n1']))
  })

  it('⛔ a failed save goes back (no outbox to replay later), and says so to its caller', async () => {
    answer = () => ({ status: 500, body: {} })
    const done = vi.fn()
    toggleSaved('n1', true, done)
    expect(savedView().ids[0]).toBe('n1')
    await vi.waitFor(() => expect(savedView().ids).toEqual(['s1']))
    expect(copy()?.ids).toEqual(['s1'])
    expect(done).toHaveBeenCalledWith(false)
  })

  it('a save the server did not keep (the listing is not shown here) goes back like a failure', async () => {
    hidden = new Set(['held'])
    const done = vi.fn()
    toggleSaved('held', true, done)
    await vi.waitFor(() => expect(done).toHaveBeenCalledWith(false))
    expect(savedView().ids).toEqual(['s1'])
    expect(copy()?.ids).toEqual(['s1'])
  })

  it('⛔ save then unsave reach the server in that order (one lock), and the last tap wins on screen', async () => {
    const order: string[] = []
    answer = async (c) => { order.push(c.body?.add ? 'add' : 'remove'); await new Promise((r) => setTimeout(r, 5)); return realServer(c) }
    toggleSaved('n1', true)
    toggleSaved('n1', false)
    expect(savedView().ids).toEqual(['s1'])
    await vi.waitFor(() => expect(order).toEqual(['add', 'remove']))
    await vi.waitFor(() => expect(server.has('n1')).toBe(false))
    expect(savedView().ids).toEqual(['s1'])
  })

  it('⛔ an unsave also takes the id off the guest list, so a later merge cannot bring it back', async () => {
    localStorage.setItem(GUEST_KEY, JSON.stringify(['s1']))
    toggleSaved('s1', false)
    await vi.waitFor(() => expect(server.has('s1')).toBe(false))
    expect(guest()).toEqual([])
    await syncSaved(U)
    expect(server.has('s1')).toBe(false)
  })

  it('⛔ a tap whose account was left before its turn never reaches the server', async () => {
    let release!: () => void
    answer = (c) => (c.method === 'GET' ? new Promise((r) => { release = () => r(realServer(c)) }) : realServer(c))
    const pending = syncSaved(U) // holds the lock
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    toggleSaved('n1', true) // queued behind it
    stopSaved()
    startSaved(V)
    release()
    await pending
    await new Promise((r) => setTimeout(r, 10))
    expect(calls.filter((c) => c.method === 'POST')).toEqual([])
    expect(savedView()).toMatchObject({ owner: V, ids: [] })
  })
})

describe('gone ids and other tabs', () => {
  it('gone ids leave the local list and the cache only — no request', async () => {
    server = new Set(['a', 'b'])
    startSaved(U)
    await syncSaved(U)
    calls = []
    dropGoneSaved(['a'])
    expect(savedView().ids).toEqual(['b'])
    await vi.waitFor(() => expect(copy()?.ids).toEqual(['b']))
    expect(calls).toEqual([])
  })
  it('another tab\'s cache is adopted without a request', () => {
    startSaved(U)
    const seen = vi.fn()
    subscribeSaved(seen)
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ u: U, ids: ['x'] }))
    adoptStoredSaved()
    expect(savedView()).toMatchObject({ ids: ['x'], ready: true })
    expect(seen).toHaveBeenCalled()
    expect(calls).toEqual([])
  })
})

describe('review round 2', () => {
  it('⛔ an unsave takes the device copy out whatever the answer — the person\'s word — so nothing can send it back up', async () => {
    localStorage.setItem(GUEST_KEY, JSON.stringify(['g1']))
    answer = (c) => (c.method === 'GET' ? { status: 500, body: {} } : { status: 500, body: {} }) // the account is unreachable
    startSaved(U)
    await syncSaved(U)
    expect(savedView().ids).toEqual(['g1']) // the account unknown: the device list stands in
    const done = vi.fn()
    toggleSaved('g1', false, done)
    await vi.waitFor(() => expect(done).toHaveBeenCalledWith(false))
    expect(guest()).toEqual([])
    expect(savedView().ids).toEqual([])
  })

  it('⛔ (review r4) an unsave whose answer is lost is not undone by the recovery read\'s merge', async () => {
    server = new Set(['g1'])
    localStorage.setItem(GUEST_KEY, JSON.stringify(['g1'])) // stored, but its move never confirmed: still on the device
    answer = (c) => (c.method === 'POST' && c.body?.remove ? (realServer(c), { status: 500, body: {} }) : realServer(c))
    startSaved(U)
    toggleSaved('g1', false)
    await vi.waitFor(() => expect(calls.filter((c) => c.method === 'GET').length).toBeGreaterThan(0))
    await vi.waitFor(() => expect(savedView().ready).toBe(true))
    expect(server.has('g1')).toBe(false)
    expect(guest()).toEqual([])
  })

  it('⛔ a stalled request gives up after 10 s and lets go of the lock (every tab waits on it)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      answer = (c) => (c.method === 'GET'
        ? new Promise<never>(() => {}) // never answers…
        : realServer(c))
      vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => new Promise((resolve, reject) => {
        calls.push({ method: init?.method ?? 'GET' })
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        if ((init?.method ?? 'GET') !== 'GET') resolve({ ok: true, status: 200, json: async () => ({ ok: true, notStored: [] }) } as Response)
      })))
      startSaved(U)
      const sync = syncSaved(U)
      const done = vi.fn()
      toggleSaved('n1', true, done) // queued behind the stalled read
      await vi.advanceTimersByTimeAsync(10_000)
      await sync
      await vi.waitFor(() => expect(done).toHaveBeenCalledWith(true))
      expect(savedView()).toMatchObject({ failed: true })
    } finally { vi.useRealTimers() }
  })
})

describe('review round 3', () => {
  it('a guest "id" the API would refuse leaves the guest list instead of failing its chunk on every sync', async () => {
    localStorage.setItem(GUEST_KEY, JSON.stringify(['g1', 'bad id', 'x.y']))
    startSaved(U)
    await syncSaved(U)
    expect(guest()).toEqual([])
    expect(server).toEqual(new Set(['g1']))
  })
  it('⚠️ a failed write that may have landed is followed by a fresh read of the account', async () => {
    server = new Set(['s1'])
    startSaved(U)
    await syncSaved(U)
    calls = []
    // The unsave commits, but its answer is lost.
    answer = (c) => { if (c.method === 'POST') { realServer(c); return { status: 500, body: {} } } return realServer(c) }
    toggleSaved('s1', false)
    await vi.waitFor(() => expect(calls.map((c) => c.method)).toEqual(['POST', 'GET']))
    await vi.waitFor(() => expect(savedView().ids).toEqual([]))
  })
  it('gone ids leave the guest list not yet moved in too', async () => {
    localStorage.setItem(GUEST_KEY, JSON.stringify(['g1', 'gone1']))
    answer = (c) => (c.method === 'POST' ? { status: 409, body: { error: 'limit_reached' } } : realServer(c))
    startSaved(U)
    await syncSaved(U)
    // The full account took nothing: the account's list shows (empty); the guest ids wait, unseen, for a sign-out.
    expect(savedView().ids).toEqual([])
    dropGoneSaved(['gone1'])
    await vi.waitFor(() => expect(guest()).toEqual(['g1']))
  })
})
