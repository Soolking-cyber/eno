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

  it('⛔ the cache is a summary: a page that lists listings gets the error, never the cache read as "no listings"', async () => {
    localStorage.setItem('eno-dashboard', JSON.stringify({ userId: 'u1', dashboard: DASH }))
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
 * answer was 16.5 MB, fetched by the desktop rail on every page. The device cache keeps the summary only.
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

  it('⛔ the device cache keeps the summary only — never the listings, the stats or the trust and enforcement panels', async () => {
    const p = await page()
    await held[0].reply(200, { dashboard: { ...FULL, enforcement: { state: 'good_standing', openReports: [] }, trustProgress: null } })
    expect(p.result.current.dash?.listings).toHaveLength(1)
    const cached = JSON.parse(localStorage.getItem('eno-dashboard') || 'null')
    expect(cached.userId).toBe('u1')
    expect(cached.summary).toEqual(SUMMARY)
    // ⛔ Never under `dashboard`: a pre-R13 build (a rollback) reads that as a full answer and reads its listings and
    // stats unguarded. Without it, that build finds no cache and loads cold.
    expect(cached).not.toHaveProperty('dashboard')
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

  it('⛔ a page that lists listings never reads the summary as "no listings": loading until its own answer lands', async () => {
    // A copy cached before this change still holds listings: they are not painted either.
    localStorage.setItem('eno-dashboard', JSON.stringify({ userId: 'u1', dashboard: FULL }))
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
    // The device cache still keeps the summary only.
    const cached = JSON.parse(localStorage.getItem('eno-dashboard') || 'null')
    expect(cached).not.toHaveProperty('dashboard')
    expect(cached.summary.hasTeacher).toBe(true)
    expect(cached.summary).not.toHaveProperty('listings')
    expect(cached.summary).not.toHaveProperty('stats')
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
