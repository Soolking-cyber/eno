// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

/**
 * THE DAILY AVAILABILITY REVIEW UNDER A FAILED DASHBOARD FETCH (inbox-10). With no payload, the list used to
 * read as "resolved empty" — and the nothing-to-review effect then marked today's review DONE and left. A
 * network blip or an expired session skipped the check. Now the review stays open and says why.
 */

const h = vi.hoisted(() => ({
  dash: null as null | { listings: unknown[]; profile: Record<string, unknown> },
  fresh: false,
  error: 'failed' as 'auth' | 'failed' | null,
  replace: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: h.replace, push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1' }, loading: false, signOut: async () => {} }) }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('@/hooks/use-dashboard', () => ({ useDashboard: () => ({ dash: h.dash ?? null, error: h.error, refresh: vi.fn(), loading: false, fresh: h.fresh ?? false }) }))
vi.mock('@/components/marketplace/price', () => ({ Price: () => null }))
vi.mock('@/components/marketplace/mascot', () => ({ Mascot: () => null }))

import { AvailabilityClient, reviewKey } from './availability-client'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
beforeEach(() => {
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
})

describe('availability review, dashboard fetch failed', () => {
  it('⛔ a failed fetch is NOT "nothing to review": today is not marked done, nothing navigates away, and it says why', async () => {
    h.error = 'failed'
    render(<AvailabilityClient />)
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(h.replace).not.toHaveBeenCalledWith('/dashboard')
    // Today's review was NOT marked done (the key the nothing-to-review path writes).
    expect(localStorage.getItem(reviewKey('u1'))).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe('Something went wrong')
  })

  it('⛔ a CACHED empty dashboard (not fetched this session) is not "nothing to review" either', async () => {
    h.error = 'failed'
    h.dash = { listings: [], profile: { availabilitySkips: 0 } }
    h.fresh = false
    render(<AvailabilityClient />)
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(h.replace).not.toHaveBeenCalledWith('/dashboard')
    expect(localStorage.getItem(reviewKey('u1'))).toBeNull()
    h.dash = null
  })

  it('a refused session offers Sign in instead', async () => {
    h.error = 'auth'
    render(<AvailabilityClient />)
    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
    expect(h.replace).not.toHaveBeenCalledWith('/dashboard')
    expect(screen.getByText('Your session has expired')).toBeTruthy()
  })
})
