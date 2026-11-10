// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'

/**
 * NEVER STUCK (inbox-10). The shared dashboard store used to know only `loading`, so a failed
 * /api/dashboard with no cache left every section on its skeleton forever. It now says WHY:
 * 401 → 'auth' (a session the server no longer accepts), anything else → 'failed'; a success or a
 * forced refresh clears it. The store is module-level, so every test imports a fresh copy.
 */

// One auth object, as the real context keeps between renders: a new `user` per render re-runs the load effect on every
// store update, and the views tests below count requests.
const auth = vi.hoisted(() => ({ user: { id: 'u1' }, loading: false }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => auth }))
// The browser client's session refresh — tried ONCE on a 401 before "session expired".
const sb = vi.hoisted(() => ({ refreshOk: false, refreshCalls: 0, network: false }))
vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowser: () => ({
    auth: {
      refreshSession: async () => {
        sb.refreshCalls += 1
        if (sb.refreshOk) return { data: { session: { access_token: 'fresh' } }, error: null }
        // Shaped like auth-js: a dead refresh token is an AuthApiError (status 400); a dropped connection is an
        // AuthRetryableFetchError (status 0).
        const error = sb.network
          ? Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError', status: 0 })
          : Object.assign(new Error('Invalid Refresh Token: Refresh Token Not Found'), { name: 'AuthApiError', status: 400, code: 'refresh_token_not_found' })
        return { data: { session: null }, error }
      },
    },
  }),
}))

afterEach(cleanup)

type Res = { status: number; body?: unknown } | 'network'
let queue: Res[] = []
beforeEach(() => {
  vi.resetModules()
  queue = []
  sb.refreshOk = false
  sb.refreshCalls = 0
  sb.network = false
  // A Map-backed stand-in: Node's own experimental localStorage can shadow jsdom's with a non-functional one.
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => store.clear(),
  })
  vi.stubGlobal('fetch', vi.fn(async () => {
    const next = queue.shift() ?? { status: 500 }
    if (next === 'network') throw new TypeError('Failed to fetch')
    return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body }
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

const DASH = { tier: 'individual', profile: {}, seller: null, stats: { unreadMessages: 0, staleCount: 0, totalViews: 0, totalLeads: 0 }, listings: [], isAdmin: false, hasVisa: false }

async function mount(view?: 'summary') {
  const { useDashboard } = await import('./use-dashboard')
  return renderHook(() => (view ? useDashboard(view) : useDashboard()))
}

describe('useDashboard error', () => {
  it('401 and a refresh that FAILS → error "auth", loading ends', async () => {
    queue = [{ status: 401, body: { dashboard: null } }]
    const { result } = await mount()
    await waitFor(() => expect(result.current.error).toBe('auth'))
    expect(sb.refreshCalls).toBe(1)
    expect(result.current.loading).toBe(false)
    expect(result.current.dash).toBeNull()
  })

  it('401 and a refresh that cannot reach the auth server (network) → "failed" (Retry), never "auth"', async () => {
    sb.network = true
    queue = [{ status: 401, body: { dashboard: null } }]
    const { result } = await mount()
    await waitFor(() => expect(result.current.error).toBe('failed'))
    expect(sb.refreshCalls).toBe(1)
    expect(result.current.loading).toBe(false)
  })

  it('`fresh` is false while only the device cache is painted, and true once a fetch succeeds', async () => {
    localStorage.setItem('eno-dashboard', JSON.stringify({ userId: 'u1', dashboard: { listings: [], profile: {} } }))
    queue = [{ status: 500 }]
    const { result } = await mount()
    await waitFor(() => expect(result.current.error).toBe('failed'))
    expect(result.current.fresh).toBe(false)
  })

  it('a 500 → error "failed"', async () => {
    queue = [{ status: 500 }]
    const { result } = await mount()
    await waitFor(() => expect(result.current.error).toBe('failed'))
    expect(result.current.loading).toBe(false)
  })

  it('offline (fetch rejects) → error "failed"', async () => {
    queue = ['network']
    const { result } = await mount()
    await waitFor(() => expect(result.current.error).toBe('failed'))
  })

  it('Retry: refresh() clears the error and a success fills the dashboard', async () => {
    queue = [{ status: 500 }, { status: 200, body: { dashboard: DASH } }]
    const { result } = await mount()
    await waitFor(() => expect(result.current.error).toBe('failed'))
    act(() => { result.current.refresh() })
    await waitFor(() => expect(result.current.dash).not.toBeNull())
    expect(result.current.error).toBeNull()
  })

  it('⛔ a 401 DROPS the cache — memory and device — so an expired account\'s data is never painted again', async () => {
    localStorage.setItem('eno-dashboard', JSON.stringify({ userId: 'u1', dashboard: DASH }))
    queue = [{ status: 401, body: { dashboard: null } }]
    const { result } = await mount()
    await waitFor(() => expect(result.current.error).toBe('auth'))
    expect(result.current.dash).toBeNull()
    expect(localStorage.getItem('eno-dashboard')).toBeNull()
  })

  it('a cache stays on screen when the refetch fails — with the error beside it', async () => {
    localStorage.setItem('eno-dashboard', JSON.stringify({ userId: 'u1', dashboard: DASH }))
    queue = [{ status: 503 }]
    const { result } = await mount('summary')
    await waitFor(() => expect(result.current.error).toBe('failed'))
    expect(result.current.dash).not.toBeNull()
  })

  it('a page that lists listings keeps the device\'s rows on screen when the refetch fails, with the error beside them', async () => {
    // What the live build did before the summary existed: My listings never fell back to an error page over a saved copy.
    localStorage.setItem('eno-dashboard', JSON.stringify({ userId: 'u1', dashboard: { ...DASH, listings: [{ id: 'L1' }] } }))
    queue = [{ status: 503 }]
    const { useDashboard } = await import('./use-dashboard')
    const { result } = renderHook(() => useDashboard())
    await waitFor(() => expect(result.current.error).toBe('failed'))
    expect(result.current.dash?.listings).toHaveLength(1)
    expect(result.current.loading).toBe(false)
    expect(result.current.fresh).toBe(false) // the device's copy is never "fetched this session"
  })

  it('⛔ a device entry with a summary alone: a page that lists listings gets the error, never the summary read as "no listings"', async () => {
    // An account whose full answer is over the storage quota has only this.
    localStorage.setItem('eno-dashboard', JSON.stringify({ userId: 'u1', summary: { tier: 'individual', profile: {}, seller: null, isAdmin: false, hasVisa: false } }))
    queue = [{ status: 503 }]
    const { result } = await mount()
    await waitFor(() => expect(result.current.error).toBe('failed'))
    expect(result.current.dash).toBeNull()
    expect(result.current.fresh).toBe(false)
  })
})

describe('⛔ one session refresh before "expired" (an access token that only expired in the background)', () => {
  it('401 → ONE refresh → the retry succeeds: the dashboard, no error, no "session expired"', async () => {
    sb.refreshOk = true
    queue = [{ status: 401, body: { dashboard: null } }, { status: 200, body: { dashboard: DASH } }]
    const { result } = await mount()
    await waitFor(() => expect(result.current.dash).not.toBeNull())
    expect(result.current.error).toBeNull()
    expect(sb.refreshCalls).toBe(1)
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(2)
  })

  it('401 → refresh ok → the retry is STILL 401: "auth" — one refresh, one retry, never a loop', async () => {
    sb.refreshOk = true
    queue = [{ status: 401, body: { dashboard: null } }, { status: 401, body: { dashboard: null } }]
    const { result } = await mount()
    await waitFor(() => expect(result.current.error).toBe('auth'))
    expect(sb.refreshCalls).toBe(1)
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(2)
  })
})

describe('⛔ Retry re-enters loading (never "loaded and empty" mid-retry)', () => {
  it('no cache, a failure, then refresh(): loading while the refetch is in flight, error cleared, no dashboard', async () => {
    let release: (v: unknown) => void = () => {}
    queue = [{ status: 500 }]
    const { result } = await mount()
    await waitFor(() => expect(result.current.error).toBe('failed'))
    expect(result.current.loading).toBe(false)
    // The retry's fetch hangs until released.
    ;(fetch as unknown as { mockImplementationOnce: (f: () => Promise<unknown>) => void }).mockImplementationOnce(
      () => new Promise((r) => { release = r }),
    )
    act(() => { result.current.refresh() })
    expect(result.current.error).toBeNull()
    expect(result.current.dash).toBeNull()
    expect(result.current.loading).toBe(true)
    await act(async () => { release({ ok: true, status: 200, json: async () => ({ dashboard: DASH }) }) })
    await waitFor(() => expect(result.current.dash).not.toBeNull())
    expect(result.current.loading).toBe(false)
  })
})


/**
 * SUMMARY AND FULL (speed plan R13, audit api-01). The rail, the explorer and the dashboard pages that show no listing
 * read the summary (no listings, no stats); only a page that lists listings reads the full answer. One account's full
 * answer was 16.5 MB, fetched by the desktop rail on every page. The device keeps the summary and, when it fits, the
 * last full answer for the two pages that list listings.
 */
describe('summary and full views', () => {
  type Held = { url: string; reply: (status: number, body?: unknown) => Promise<void> }
  let held: Held[] = []
  beforeEach(() => {
    held = []
    // Every request waits until the test answers it, so the order of requests and answers is the test's.
    vi.stubGlobal('fetch', vi.fn((url: string) => new Promise((resolve) => {
      held.push({
        url: String(url),
        reply: async (status, body) => {
          await act(async () => { resolve({ ok: status >= 200 && status < 300, status, json: async () => body }) })
        },
      })
    })))
  })
  const urls = () => held.map((r) => r.url)
  const SUMMARY_URL = '/api/dashboard?view=summary'
  const FULL_URL = '/api/dashboard'
  const SUMMARY = { tier: 'individual', profile: { displayName: 'An' }, seller: null, isAdmin: false, hasVisa: false, hasTeacher: true, teacherDraft: null }
  const FULL = { ...SUMMARY, stats: { unreadMessages: 0, staleCount: 0, totalViews: 3, totalLeads: 0 }, listings: [{ id: 'L1', status: 'active' }] }
  const hooks = async () => (await import('./use-dashboard')).useDashboard
  const rail = async () => { const useDashboard = await hooks(); return renderHook(() => useDashboard('summary')) }
  const page = async () => { const useDashboard = await hooks(); return renderHook(() => useDashboard()) }

  it('the rail asks for the summary, a page that lists listings for the full answer', async () => {
    await rail()
    expect(urls()).toEqual([SUMMARY_URL])
    vi.resetModules()
    held = []
    await page()
    expect(urls()).toEqual([FULL_URL])
  })

  /** The device entry as stored: line 1 parsed (`head`), line 2 parsed (`full`, null when there is none). */
  const entry = () => {
    const raw = localStorage.getItem('eno-dashboard')
    if (raw === null) return null
    const [line1, ...rest] = raw.split('\n')
    expect(rest.length).toBeLessThanOrEqual(1)
    return { raw, head: JSON.parse(line1), full: rest.length ? JSON.parse(rest[0]) : null }
  }
  const twoLines = (head: unknown, full: unknown) => `${JSON.stringify(head)}\n${JSON.stringify(full)}`

  it('the device entry: line 1 the summary, line 2 the full answer without the trust and enforcement panels', async () => {
    const p = await page()
    await held[0].reply(200, { dashboard: { ...FULL, enforcement: { state: 'good_standing', openReports: [{ id: 'r1' }] }, trustProgress: { step: 2 } } })
    expect(p.result.current.dash?.listings).toHaveLength(1)
    expect(entry()!.head).toEqual({ userId: 'u1', summary: SUMMARY }) // no listings, stats, trust or enforcement
    expect(entry()!.full).toEqual(FULL) // listings and stats; no report details left on the device
    // ⛔ A build from before the summary reads this key with one JSON.parse inside a try: two lines must throw there, so
    // it finds no cache and loads cold instead of reading a summary as the full answer (a TypeError at render).
    expect(() => JSON.parse(entry()!.raw)).toThrow()
  })

  it('⛔ a summary answer writes line 1 alone when the device holds no listings: never a `dashboard` an earlier build would misread', async () => {
    await rail()
    await held[0].reply(200, { dashboard: SUMMARY })
    expect(entry()!.raw).toBe(JSON.stringify({ userId: 'u1', summary: SUMMARY }))
    expect(JSON.parse(entry()!.raw)).not.toHaveProperty('dashboard')
  })

  it('a summary answer refreshes line 1 and keeps the listings: an entry the live build stored is converted once', async () => {
    localStorage.setItem('eno-dashboard', JSON.stringify({ userId: 'u1', dashboard: { ...FULL, enforcement: { openReports: [{ id: 'r1' }] } } }))
    const r = await rail()
    expect(r.result.current.dash?.hasTeacher).toBe(true) // painted from that entry's account fields
    await held[0].reply(200, { dashboard: { ...SUMMARY, profile: { displayName: 'Bình' } } })
    expect(entry()!.head.summary.profile.displayName).toBe('Bình')
    expect(entry()!.full).toEqual(FULL)
  })

  it('⛔ two tabs: a summary answer keeps the listings ANOTHER TAB stored meanwhile, not the copy this tab loaded with', async () => {
    const monday = { ...FULL, listings: [{ id: 'L1', status: 'active' }, { id: 'L-deleted-on-tuesday', status: 'active' }] }
    localStorage.setItem('eno-dashboard', twoLines({ userId: 'u1', summary: SUMMARY }, monday))
    const p = await page() // this tab paints Monday's copy, and its own answer still has both listings
    expect(p.result.current.dash?.listings).toHaveLength(2)
    await held[0].reply(200, { dashboard: monday })
    p.unmount()
    // Another tab deletes a listing and stores its own full answer.
    localStorage.setItem('eno-dashboard', twoLines({ userId: 'u1', summary: SUMMARY }, FULL))
    const r = await rail()
    expect(urls()).toEqual([FULL_URL, SUMMARY_URL])
    await held[1].reply(200, { dashboard: { ...SUMMARY, profile: { displayName: 'Bình' } } })
    expect(r.result.current.dash?.profile.displayName).toBe('Bình')
    expect(entry()!.full).toEqual(FULL) // Tuesday's, not Monday's written back from memory
  })

  it('⛔ after sign-out cleared the device, a late summary answer does not bring the listings back', async () => {
    localStorage.setItem('eno-dashboard', twoLines({ userId: 'u1', summary: SUMMARY }, FULL))
    const p = await page()
    await held[0].reply(200, { dashboard: FULL })
    p.unmount()
    await rail()
    localStorage.removeItem('eno-dashboard') // sign-out-storage.ts, while the rail's request is still in flight
    await held[1].reply(200, { dashboard: SUMMARY })
    expect(entry()!.full).toBeNull()
  })

  it('⛔ another account\'s listings are never painted, nor written back under this account', async () => {
    localStorage.setItem('eno-dashboard', twoLines({ userId: 'someone-else', summary: SUMMARY }, FULL))
    const p = await page()
    expect(p.result.current.dash).toBeNull()
    expect(p.result.current.loading).toBe(true)
    p.unmount()
    vi.resetModules()
    held = []
    const r = await rail()
    expect(r.result.current.dash).toBeNull()
    await held[0].reply(200, { dashboard: SUMMARY })
    expect(entry()!.raw).toBe(JSON.stringify({ userId: 'u1', summary: SUMMARY }))
  })

  it('an answer that changes nothing writes nothing (the rail asks on every page), with listings stored or without', async () => {
    for (const seed of [twoLines({ userId: 'u1', summary: SUMMARY }, FULL), JSON.stringify({ userId: 'u1', summary: SUMMARY })]) {
      vi.resetModules()
      held = []
      localStorage.setItem('eno-dashboard', seed)
      const set = vi.spyOn(localStorage, 'setItem')
      const r = await rail()
      await held[0].reply(200, { dashboard: SUMMARY })
      expect(set).not.toHaveBeenCalled()
      act(() => { r.result.current.refresh() })
      await held[1].reply(200, { dashboard: { ...SUMMARY, hasTeacher: false } })
      expect(set).toHaveBeenCalledTimes(1)
      expect(entry()!.head.summary.hasTeacher).toBe(false)
      expect(entry()!.raw.split('\n').slice(1)).toEqual(seed.split('\n').slice(1)) // line 2 exactly as it was, or still none
      set.mockRestore()
      r.unmount()
    }
  })

  it('⛔ the listings copy has a fixed ceiling: a larger account stores line 1 alone, and its answer is never turned into text', async () => {
    const { DEVICE_LISTINGS_MAX, DEVICE_CHARS_MAX } = await import('./use-dashboard')
    expect(DEVICE_CHARS_MAX).toBeLessThanOrEqual(1_000_000) // a fifth of the smallest quota, at most: the rest of the site shares it
    const many = (n: number, pad = '') => ({ ...FULL, listings: Array.from({ length: n }, (_, i) => ({ id: `L${i}`, status: 'active', description: pad })) })
    localStorage.setItem('eno-dashboard', twoLines({ userId: 'u1', summary: SUMMARY }, FULL)) // from when the account was small
    const p = await page()
    // Too many listings: not serialised at all (JSON.stringify sees the summary alone), and the old copy goes.
    const json = vi.spyOn(JSON, 'stringify')
    await held[0].reply(200, { dashboard: many(DEVICE_LISTINGS_MAX + 1) })
    expect(json.mock.calls.some(([v]) => Array.isArray((v as { listings?: unknown })?.listings))).toBe(false)
    json.mockRestore()
    expect(p.result.current.dash?.listings).toHaveLength(DEVICE_LISTINGS_MAX + 1) // the page has its answer all the same
    expect(entry()!.raw).toBe(JSON.stringify({ userId: 'u1', summary: SUMMARY }))
    // Few listings but long ones: over the character ceiling, so not stored either.
    act(() => { p.result.current.refresh() })
    await held[1].reply(200, { dashboard: many(2, 'x'.repeat(DEVICE_CHARS_MAX / 2)) })
    expect(entry()!.full).toBeNull()
    // At the listing ceiling and under the character one: stored.
    act(() => { p.result.current.refresh() })
    await held[2].reply(200, { dashboard: many(DEVICE_LISTINGS_MAX) })
    expect(entry()!.full.listings).toHaveLength(DEVICE_LISTINGS_MAX)
    expect(entry()!.raw.length).toBeLessThan(DEVICE_CHARS_MAX + 1_000)
  })

  it('an entry the live build stored for a larger account is not carried over by a summary answer', async () => {
    const { DEVICE_LISTINGS_MAX } = await import('./use-dashboard')
    vi.resetModules()
    const big = { ...FULL, listings: Array.from({ length: DEVICE_LISTINGS_MAX + 1 }, (_, i) => ({ id: `L${i}`, status: 'active' })) }
    localStorage.setItem('eno-dashboard', JSON.stringify({ userId: 'u1', dashboard: big }))
    await rail()
    await held[0].reply(200, { dashboard: SUMMARY })
    expect(entry()!.raw).toBe(JSON.stringify({ userId: 'u1', summary: SUMMARY }))
  })

  it('⛔ a full answer that lands after sign-out is dropped: nothing of the account is written back', async () => {
    const useDashboard = await hooks()
    const h = renderHook(() => useDashboard())
    expect(urls()).toEqual([FULL_URL])
    try {
      auth.user = null as unknown as { id: string } // signed out: the auth context hands every consumer no user
      h.rerender()
      localStorage.removeItem('eno-dashboard') // sign-out-storage.ts
      await held[0].reply(200, { dashboard: FULL })
      expect(entry()).toBeNull()
      expect(h.result.current.dash).toBeNull()
    } finally {
      auth.user = { id: 'u1' }
    }
  })

  it('the browser refuses the write (its quota is full): line 1 alone is kept, and no stale listings; with no room at all, nothing', async () => {
    const real = localStorage.setItem.bind(localStorage)
    localStorage.setItem('eno-dashboard', twoLines({ userId: 'u1', summary: SUMMARY }, { ...FULL, listings: [] })) // an old, smaller copy
    let room: 'summary' | 'none' = 'summary'
    localStorage.setItem = (k: string, v: string) => { if (room === 'none' || v.includes('"L-big"')) throw new DOMException('quota', 'QuotaExceededError'); real(k, v) }
    const p = await page()
    await held[0].reply(200, { dashboard: { ...FULL, listings: [{ id: 'L-big', status: 'active' }] } })
    expect(p.result.current.dash?.listings).toHaveLength(1) // the page has its answer all the same
    expect(entry()!.raw).toBe(JSON.stringify({ userId: 'u1', summary: SUMMARY }))
    // Both writes fail: the old entry goes rather than stay to be painted on the next visit.
    localStorage.setItem = real
    localStorage.setItem('eno-dashboard', twoLines({ userId: 'u1', summary: SUMMARY }, { ...FULL, listings: [] }))
    localStorage.setItem = () => { throw new DOMException('quota', 'QuotaExceededError') }
    room = 'none'
    act(() => { p.result.current.refresh() })
    await held[1].reply(200, { dashboard: { ...FULL, listings: [{ id: 'L-big', status: 'active' }] } })
    expect(entry()).toBeNull()
  })

  it('the summary this build stored paints the rail at once on the next load (isAdmin still forced false)', async () => {
    localStorage.setItem('eno-dashboard', JSON.stringify({ userId: 'u1', summary: { ...SUMMARY, isAdmin: true } }))
    const r = await rail()
    expect(r.result.current.dash?.hasTeacher).toBe(true)
    expect(r.result.current.dash?.profile.displayName).toBe('An')
    expect(r.result.current.dash?.isAdmin).toBe(false)
    expect(r.result.current.loading).toBe(false)
    expect(r.result.current.fresh).toBe(false)
  })

  it('⛔ a page that lists listings paints the device\'s copy at once, and it is not `fresh` until its own answer lands', async () => {
    // An entry the live build stored (no `summary`), with the admin flag a cache may never assert.
    localStorage.setItem('eno-dashboard', JSON.stringify({ userId: 'u1', dashboard: { ...FULL, isAdmin: true } }))
    const p = await page()
    expect(urls()).toEqual([FULL_URL]) // and asks for a new answer behind it
    expect(p.result.current.dash?.listings).toHaveLength(1)
    expect(p.result.current.dash?.isAdmin).toBe(false)
    expect(p.result.current.loading).toBe(false)
    expect(p.result.current.fresh).toBe(false)
    await held[0].reply(200, { dashboard: { ...FULL, listings: [] } })
    expect(p.result.current.dash?.listings).toHaveLength(0)
    expect(p.result.current.fresh).toBe(true)
  })

  it('⛔ the rail\'s summary landing first never makes the device\'s listings read as fetched today', async () => {
    // The availability review marks today DONE on an empty `fresh` list: an old empty copy plus a new summary must not be one.
    localStorage.setItem('eno-dashboard', twoLines({ userId: 'u1', summary: SUMMARY }, { ...FULL, listings: [] }))
    const r = await rail()
    await held[0].reply(200, { dashboard: { ...SUMMARY, isAdmin: true } })
    expect(r.result.current.fresh).toBe(true)
    const p = await page() // a soft navigation to the review: the store holds only the summary
    expect(p.result.current.dash?.listings).toEqual([])
    expect(p.result.current.dash?.isAdmin).toBe(true) // this session's account fields win over the copy's
    expect(p.result.current.loading).toBe(false)
    expect(p.result.current.fresh).toBe(false)
    expect(urls()).toEqual([SUMMARY_URL, FULL_URL])
    await held[1].reply(200, { dashboard: FULL })
    expect(p.result.current.fresh).toBe(true)
    expect(p.result.current.dash?.listings).toHaveLength(1)
  })

  it('⛔ a stored copy without what the pages read unguarded (stats, profile) is not painted as a full answer', async () => {
    for (const broken of [{ listings: [] }, { listings: [], stats: FULL.stats }, { ...FULL, listings: 'x' }, null, 7]) {
      vi.resetModules()
      held = []
      localStorage.setItem('eno-dashboard', twoLines({ userId: 'u1', summary: SUMMARY }, broken))
      const p = await page()
      expect(p.result.current.dash).toBeNull()
      expect(p.result.current.loading).toBe(true)
      p.unmount()
      vi.resetModules()
      held = []
      localStorage.setItem('eno-dashboard', JSON.stringify({ userId: 'u1', dashboard: broken })) // the same, as the live build's entry
      const q = await page()
      expect(q.result.current.dash).toBeNull()
      q.unmount()
    }
  })

  it('⛔ with only a summary on the device, a page that lists listings is loading until its own answer lands, never "no listings"', async () => {
    localStorage.setItem('eno-dashboard', JSON.stringify({ userId: 'u1', summary: SUMMARY }))
    const r = await rail()
    const p = await page()
    expect(r.result.current.dash?.hasTeacher).toBe(true) // the rail paints from the cache at once
    expect(r.result.current.dash).not.toHaveProperty('listings')
    expect(p.result.current.dash).toBeNull()
    expect(p.result.current.loading).toBe(true)
    expect(p.result.current.fresh).toBe(false)
    await held[held.length - 1].reply(200, { dashboard: FULL })
    expect(p.result.current.dash?.listings).toHaveLength(1)
    expect(p.result.current.loading).toBe(false)
    expect(p.result.current.fresh).toBe(true)
  })

  it('a page mounting while the rail\'s summary is in flight: its full request supersedes it, and the late summary is dropped', async () => {
    const r = await rail()
    const p = await page()
    expect(urls()).toEqual([SUMMARY_URL, FULL_URL])
    await held[1].reply(200, { dashboard: FULL })
    await held[0].reply(200, { dashboard: SUMMARY })
    expect(p.result.current.dash?.listings).toHaveLength(1)
    expect(r.result.current.dash?.hasTeacher).toBe(true)
  })

  it('a full request in flight serves the rail too: no second request', async () => {
    const p = await page()
    const r = await rail()
    expect(urls()).toEqual([FULL_URL])
    await held[0].reply(200, { dashboard: FULL })
    expect(r.result.current.dash?.hasTeacher).toBe(true)
    expect(p.result.current.dash?.listings).toHaveLength(1)
  })

  it('a refresh asks for the full answer while the page is mounted, and the summary once it has gone', async () => {
    const r = await rail()
    const p = await page()
    await held[1].reply(200, { dashboard: FULL })
    act(() => { r.result.current.refresh() })
    expect(urls()[2]).toBe(FULL_URL)
    await held[2].reply(200, { dashboard: FULL })
    p.unmount()
    act(() => { r.result.current.refresh() })
    expect(urls()[3]).toBe(SUMMARY_URL)
    await held[3].reply(200, { dashboard: { ...SUMMARY, profile: { displayName: 'Bình' } } })
    // The summary refreshes the account fields and keeps the listings: coming back, the page paints at once from memory
    // and asks for a new full answer behind it, as it did before the summary existed.
    const again = await page()
    expect(again.result.current.dash?.listings).toHaveLength(1)
    expect(again.result.current.dash?.profile.displayName).toBe('Bình')
    expect(again.result.current.loading).toBe(false)
    expect(urls()).toHaveLength(5)
    expect(urls()[4]).toBe(FULL_URL)
  })

  it('⛔ a summary consumer mounting after the page keeps the listings in memory: the page comes back at once', async () => {
    const p = await page()
    await held[0].reply(200, { dashboard: FULL })
    p.unmount()
    // The phone's Account tab, Settings, the explorer on home: any summary consumer that mounts revalidates.
    const account = await rail()
    expect(urls()).toEqual([FULL_URL, SUMMARY_URL])
    await held[1].reply(200, { dashboard: SUMMARY })
    expect(account.result.current.dash?.hasTeacher).toBe(true)
    const again = await page()
    expect(again.result.current.dash?.listings).toHaveLength(1)
    expect(again.result.current.loading).toBe(false)
    expect(again.result.current.error).toBeNull()
    expect(urls()).toEqual([FULL_URL, SUMMARY_URL, FULL_URL])
    // The device entry: the summary without listings or stats, and the page's full answer still on line 2.
    expect(entry()!.full).toEqual(FULL)
    expect(entry()!.head.summary.hasTeacher).toBe(true)
    expect(entry()!.head.summary).not.toHaveProperty('listings')
    expect(entry()!.head.summary).not.toHaveProperty('stats')
    // The page's own full answer replaces the kept listings.
    await held[2].reply(200, { dashboard: { ...FULL, listings: [] } })
    expect(again.result.current.dash?.listings).toHaveLength(0)
  })

  it('⛔ an account switch never carries one account\'s listings into the next account\'s summary', async () => {
    const p = await page()
    await held[0].reply(200, { dashboard: FULL })
    p.unmount()
    try {
      auth.user = { id: 'u2' }
      const r = await rail()
      expect(urls()).toEqual([FULL_URL, SUMMARY_URL])
      await held[1].reply(200, { dashboard: SUMMARY })
      expect(r.result.current.dash?.hasTeacher).toBe(true)
      expect(r.result.current.dash).not.toHaveProperty('listings')
    } finally {
      auth.user = { id: 'u1' }
    }
  })

  it('a failed summary is not the page\'s failure: its first full request shows loading, not the error', async () => {
    const r = await rail()
    await held[0].reply(500)
    expect(r.result.current.error).toBe('failed')
    const p = await page()
    expect(urls()).toEqual([SUMMARY_URL, FULL_URL])
    expect(p.result.current.error).toBeNull()
    expect(p.result.current.loading).toBe(true)
    await held[1].reply(200, { dashboard: FULL })
    expect(p.result.current.dash?.listings).toHaveLength(1)
  })

  it('a consumer that switches to the full view asks for it instead of waiting on the summary it has', async () => {
    const useDashboard = await hooks()
    const h = renderHook(({ view }: { view?: 'summary' }) => (view ? useDashboard(view) : useDashboard()), { initialProps: { view: 'summary' as 'summary' | undefined } })
    await held[0].reply(200, { dashboard: SUMMARY })
    h.rerender({ view: undefined })
    expect(urls()).toEqual([SUMMARY_URL, FULL_URL])
    await held[1].reply(200, { dashboard: FULL })
    expect(h.result.current.dash).toHaveProperty('listings')
  })
})
