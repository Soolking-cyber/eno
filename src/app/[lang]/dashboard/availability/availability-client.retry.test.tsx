// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * RETRY MUST NOT COMPLETE TODAY'S REVIEW (inbox-10) — with the REAL dashboard store. A failed fetch, then
 * "Try again": while the refetch is in flight there is still no dashboard, and that used to read as "loaded
 * and empty" (the store cleared the error without re-entering loading), so the nothing-to-review effect
 * marked today's review done and navigated away mid-retry. Empty is only ever a fact about a LOADED dashboard.
 */

const h = vi.hoisted(() => ({ replace: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: h.replace, push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1' }, loading: false, signOut: async () => {} }) }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('@/components/marketplace/price', () => ({ Price: () => null }))
vi.mock('@/components/marketplace/mascot', () => ({ Mascot: () => null }))
vi.mock('@/lib/supabase/browser', () => ({ createSupabaseBrowser: () => ({ auth: { refreshSession: async () => ({ data: { session: null }, error: new Error('x') }) } }) }))

type Reply = { ok: boolean; status: number; json: () => Promise<unknown> }
let releaseRetry: (r: Reply) => void = () => {}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
beforeEach(() => {
  vi.resetModules() // a fresh module-level dashboard store per test
  h.replace.mockClear()
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  })
  let n = 0
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (String(url) !== '/api/dashboard') return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    n += 1
    // 1st: the failure. 2nd: the Retry — held until the test releases it.
    if (n === 1) return Promise.resolve({ ok: false, status: 500, json: async () => ({}) })
    return new Promise<Reply>((resolve) => { releaseRetry = resolve })
  }))
})

async function mount() {
  const { AvailabilityClient, reviewKey } = await import('./availability-client')
  render(<AvailabilityClient />)
  return { reviewKey }
}

describe('availability review — Retry after a failed fetch', () => {
  it('⛔ while the Retry is in flight: no "nothing to review", today not marked done, nothing navigates away', async () => {
    const { reviewKey } = await mount()
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Something went wrong'))
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    // The retry is pending: the error is gone, the dashboard is not here yet.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(h.replace).not.toHaveBeenCalledWith('/dashboard')
    expect(localStorage.getItem(reviewKey('u1'))).toBeNull()
    // It fails again: the failure state is back — still nothing marked done.
    await act(async () => { releaseRetry({ ok: false, status: 503, json: async () => ({}) }) })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Something went wrong'))
    expect(h.replace).not.toHaveBeenCalledWith('/dashboard')
    expect(localStorage.getItem(reviewKey('u1'))).toBeNull()
  })

  it('a Retry that loads a dashboard with NO live listings is the only "nothing to review"', async () => {
    const { reviewKey } = await mount()
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await act(async () => {
      releaseRetry({ ok: true, status: 200, json: async () => ({ dashboard: { tier: 'individual', profile: { availabilitySkips: 0 }, seller: null, stats: {}, listings: [], isAdmin: false, hasVisa: false } }) })
    })
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/dashboard'))
    expect(localStorage.getItem(reviewKey('u1'))).not.toBeNull()
  })
})
