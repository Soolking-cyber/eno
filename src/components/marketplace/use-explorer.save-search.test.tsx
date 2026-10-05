// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

// ── UX3 J5: a guest's "Save search" is finished after sign-in, through the SAME save ─────────────────

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: 'en', tr: (en: string) => en, t: (en: string) => en, setLang: () => {} }),
}))
const toast = vi.hoisted(() => Object.assign(vi.fn(() => 't1'), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
const auth = vi.hoisted(() => ({
  user: null as null | { id: string },
  loading: false,
  identityLoaded: false,
  accountType: null as string | null,
  openSignIn: vi.fn(),
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => auth }))

import { useSaveSearch } from './use-explorer'
import { __resetPendingIntentForTests, armIntent, readIntent, writeIntent } from '@/lib/pending-intent'

function memoryStorage() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  }
}
const FILTERS = {
  activeCategory: 'furniture', activeSubcategory: 'all', activeBrand: 'all', activeModel: 'all', listingType: 'all',
  debouncedQuery: 'sofa', activeDistrict: 'all', conditionFilter: 'all', priceRange: 'all', customFilters: {},
}
let fetchMock: ReturnType<typeof vi.fn>
const posted = () => fetchMock.mock.calls.filter((c) => c[0] === '/api/saved-searches').map((c) => JSON.parse((c[1] as RequestInit).body as string).params)
const settle = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)) })
const signedIn = () => { auth.user = { id: 'u1' }; auth.identityLoaded = true; auth.accountType = 'individual' }

beforeEach(() => {
  vi.stubGlobal('sessionStorage', memoryStorage())
  __resetPendingIntentForTests()
  fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({}) }))
  vi.stubGlobal('fetch', fetchMock)
  toast.mockClear(); toast.success.mockClear(); toast.error.mockClear()
  auth.user = null; auth.loading = false; auth.identityLoaded = false; auth.accountType = null
  auth.openSignIn.mockReset()
  window.history.replaceState(null, '', '/?q=sofa&category=furniture')
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('useSaveSearch — the guest gate remembers the search', () => {
  it('⛔ a 401 opens sign-in with the "save_search" gate and the exact params as the pending intent', async () => {
    fetchMock.mockImplementation(() => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) }))
    const { result } = renderHook(() => useSaveSearch(FILTERS))
    await act(async () => { await result.current() })
    const ctx = auth.openSignIn.mock.calls[0][0]
    expect(ctx.gate).toBe('save_search')
    expect(ctx.resume).toMatchObject({ kind: 'saveSearch', payload: { params: { category: 'furniture', q: 'sofa' } }, path: '/?q=sofa&category=furniture' })
  })
})

describe('useSaveSearch — after sign-in', () => {
  it('⛔ a sign-in return (resume=saveSearch + the stored intent): saved once, with the STORED params, and the save’s own toast', async () => {
    writeIntent('saveSearch', { params: { category: 'furniture', q: 'sofa', priceMax: 5_000_000 } }, '/?q=sofa&category=furniture')
    window.history.replaceState(null, '', '/?q=sofa&category=furniture&resume=saveSearch')
    signedIn()
    const { rerender } = renderHook(() => useSaveSearch(FILTERS))
    await settle()
    rerender()
    await settle()
    expect(posted()).toEqual([{ category: 'furniture', q: 'sofa', priceMax: 5_000_000 }])
    expect(toast.success).toHaveBeenCalledWith("Saved — we'll alert you on new matches")
    expect(window.location.search).toBe('?q=sofa&category=furniture')
    expect(readIntent()).toBeNull()
  })

  it('an ARMED intent (signed in inside its popup) is saved without any address marker', async () => {
    const it = writeIntent('saveSearch', { params: { q: 'sofa' } }, '/?q=sofa&category=furniture')
    armIntent(it.nonce)
    signedIn()
    renderHook(() => useSaveSearch(FILTERS))
    await settle()
    expect(posted()).toEqual([{ q: 'sofa' }])
  })

  it('⛔ resume=saveSearch with NOTHING stored (crafted link / magic link’s new tab): nothing saved — one "Save" tap offered', async () => {
    window.history.replaceState(null, '', '/?q=sofa&category=furniture&resume=saveSearch')
    signedIn()
    renderHook(() => useSaveSearch(FILTERS))
    await settle()
    expect(posted()).toEqual([])
    expect(toast).toHaveBeenCalledWith('You’re signed in — save this search to get alerts on new listings?', expect.objectContaining({ action: expect.anything() }))
    // The one tap saves the search on screen.
    const action = (toast.mock.calls[0] as unknown as [string, { action: { props: { onClick: () => void } } }])[1].action
    await act(async () => { action.props.onClick() })
    await settle()
    expect(posted()).toEqual([{ category: 'furniture', q: 'sofa' }])
  })

  it('⛔ an intent nobody proved (an abandoned gate, then an unrelated sign-in) saves nothing', async () => {
    writeIntent('saveSearch', { params: { q: 'sofa' } }, '/?q=sofa&category=furniture')
    signedIn()
    renderHook(() => useSaveSearch(FILTERS))
    await settle()
    expect(posted()).toEqual([])
    expect(toast).not.toHaveBeenCalled()
  })

  it('waits for the profile; a guest on a resume= link just loses the marker', async () => {
    window.history.replaceState(null, '', '/?q=sofa&resume=saveSearch')
    renderHook(() => useSaveSearch(FILTERS))
    await settle()
    expect(window.location.search).toBe('?q=sofa')
    expect(posted()).toEqual([])
  })
})
