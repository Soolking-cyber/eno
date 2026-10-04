// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'

/**
 * NEVER STUCK (inbox-10). The shared dashboard store used to know only `loading`, so a failed
 * /api/dashboard with no cache left every section on its skeleton forever. It now says WHY:
 * 401 → 'auth' (a session the server no longer accepts), anything else → 'failed'; a success or a
 * forced refresh clears it. The store is module-level, so every test imports a fresh copy.
 */

vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1' }, loading: false }) }))
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

async function mount() {
  const { useDashboard } = await import('./use-dashboard')
  return renderHook(() => useDashboard())
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
    const { result } = await mount()
    await waitFor(() => expect(result.current.error).toBe('failed'))
    expect(result.current.dash).not.toBeNull()
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

