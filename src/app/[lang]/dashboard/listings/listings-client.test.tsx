// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * /dashboard/listings is NEVER STUCK (inbox-10). A failed dashboard fetch used to leave the skeletons up
 * forever. Now: 401 → ONLY "session expired" + Sign in (never a cached account — privacy on a shared
 * device); any other failure → Retry, over the cached copy when there is one.
 * Sign in must always REACH /signin, which bounces anyone the auth context still calls signed in.
 */

const h = vi.hoisted(() => ({
  dash: null as unknown,
  error: null as 'auth' | 'failed' | null,
  refresh: vi.fn(),
  // The auth context's user — what /signin's bounce reads. A real SIGNED_OUT event clears it.
  authUser: { id: 'u1' } as { id: string } | null,
  userAtNavigation: undefined as unknown,
  replace: vi.fn((to: string) => { h.order.push(`replace ${to}`); h.userAtNavigation = h.authUser }),
  signOut: vi.fn(async () => {}),
  // The browser client's own sign-out: its SIGNED_OUT event is what clears the auth context's user.
  localSignOut: vi.fn(async (_opts?: unknown) => { h.order.push('localSignOut'); h.authUser = null }),
  clearStorage: vi.fn(() => { h.order.push('clearStorage') }),
  order: [] as string[],
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: h.replace, push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
// `signOut` is the app's standard sign-out (push teardown + per-account device storage), as in auth-context.
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: h.authUser ?? { id: 'u1' }, loading: false, signOut: h.signOut }) }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('@/hooks/use-dashboard', () => ({ useDashboard: () => ({ dash: h.dash, error: h.error, refresh: h.refresh, loading: false }) }))
vi.mock('@/lib/supabase/browser', () => ({ createSupabaseBrowser: () => ({ auth: { signOut: h.localSignOut } }) }))
vi.mock('@/lib/sign-out-storage', () => ({ clearAccountDeviceStorage: h.clearStorage }))
vi.mock('@/lib/post-draft-photos', () => ({ clearDraftPhotos: async () => {} }))
vi.mock('@/lib/rental-check/store', () => ({ clearBasket: () => {}, clearDraft: () => {} }))
vi.mock('@/components/marketplace/dashboard-listing-row', () => ({ DashboardListingRow: () => <div data-row /> }))
vi.mock('@/components/marketplace/section-header', () => ({ SectionHeader: () => null }))

import { ListingsClient } from './listings-client'
import { documentNav } from '@/components/marketplace/dashboard-fetch-error'

let docNav: ReturnType<typeof vi.spyOn>
afterEach(() => { cleanup(); docNav.mockRestore() })
beforeEach(() => {
  docNav = vi.spyOn(documentNav, 'replace').mockImplementation((url: string) => { h.order.push(`document ${url}`) })
  h.dash = null
  h.error = null
  h.authUser = { id: 'u1' }
  h.userAtNavigation = undefined
  h.refresh.mockClear()
  h.replace.mockClear()
  h.signOut.mockReset()
  h.signOut.mockImplementation(async () => { h.order.push('signOut'); h.authUser = null })
  h.localSignOut.mockClear()
  h.localSignOut.mockImplementation(async () => { h.order.push('localSignOut'); h.authUser = null })
  h.clearStorage.mockClear()
  h.order = []
})

const DASH = {
  tier: 'individual', profile: { displayName: 'An', businessName: null }, seller: null,
  stats: { unreadMessages: 0, staleCount: 0, totalViews: 0, totalLeads: 0, activeCount: 0, saves: 0 },
  listings: [], isAdmin: false, hasVisa: false,
}
const SIGNIN = '/signin?next=/dashboard/listings'

describe('no cache', () => {
  it('a failed fetch shows an error with Retry — no skeletons left spinning', () => {
    h.error = 'failed'
    const { container } = render(<ListingsClient embedded />)
    expect(screen.getByText('Couldn’t load your listings')).toBeTruthy()
    expect(container.querySelector('[data-slot="skeleton"], .animate-pulse')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(h.refresh).toHaveBeenCalledTimes(1)
  })
})

describe('401 — the session is gone', () => {
  it('⛔ a CACHED dashboard is never shown under an expired session — only "session expired"', () => {
    h.dash = { ...DASH, stats: { ...DASH.stats, activeCount: 7 } }
    h.error = 'auth'
    const { container } = render(<ListingsClient embedded />)
    expect(screen.getByText('Your session has expired')).toBeTruthy()
    // Not one piece of the cached account: no stats tiles, no listing state, no stale-data notice.
    expect(screen.queryByText('Active listings')).toBeNull()
    expect(screen.queryByText('7')).toBeNull()
    expect(screen.queryByText('No listings yet')).toBeNull()
    expect(container.querySelector('[data-dash-stale]')).toBeNull()
  })

  it('Sign in runs the app sign-out (LOCAL scope — a false 401 must not sign out every device) first, then goes to sign-in', async () => {
    h.error = 'auth'
    render(<ListingsClient embedded />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith(SIGNIN))
    expect(h.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(h.order).toEqual(['signOut', `replace ${SIGNIN}`])
    expect(h.localSignOut).not.toHaveBeenCalled()
    // What /signin bounces on — gone before the navigation.
    expect(h.userAtNavigation).toBeNull()
  })

  it('⛔ a FAILED standard sign-out falls back to a LOCAL sign-out + the device cleanup BEFORE navigating', async () => {
    h.error = 'auth'
    // Throws before it clears anything — the auth context still calls this person signed in.
    h.signOut.mockImplementation(async () => { h.order.push('signOut'); throw new Error('chunk load failed') })
    render(<ListingsClient embedded />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith(SIGNIN))
    expect(h.localSignOut).toHaveBeenCalledWith({ scope: 'local' })
    const nav = h.order.indexOf(`replace ${SIGNIN}`)
    for (const step of ['signOut', 'localSignOut', 'clearStorage']) expect(h.order.indexOf(step), step).toBeLessThan(nav)
    // The SIGNED_OUT of the local sign-out cleared the context's user before we navigated: /signin cannot
    // bounce back to this screen.
    expect(h.userAtNavigation).toBeNull()
  })

  it('⛔ BOTH sign-outs fail (offline): the device data goes, then /signin loads as a NEW document', async () => {
    h.error = 'auth'
    h.signOut.mockImplementation(async () => { h.order.push('signOut'); throw new Error('offline') })
    h.localSignOut.mockImplementation(async () => { h.order.push('localSignOut'); throw new Error('offline') })
    render(<ListingsClient embedded />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(docNav).toHaveBeenCalledWith(SIGNIN))
    // The page's auth context still holds the dead session's user — a client-side navigation would bounce.
    expect(h.replace).not.toHaveBeenCalled()
    expect(h.order.indexOf('clearStorage')).toBeLessThan(h.order.indexOf(`document ${SIGNIN}`))
  })
})

describe('with a cache', () => {
  it('renders the cached dashboard under a "could not load new data" notice', () => {
    h.dash = DASH
    h.error = 'failed'
    const { container } = render(<ListingsClient embedded />)
    expect(container.querySelector('[data-dash-stale]')!.textContent).toContain('Couldn’t load new data')
    expect(screen.getByText('No listings yet')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(h.refresh).toHaveBeenCalledTimes(1)
  })

  it('no notice when the last fetch succeeded', () => {
    h.dash = DASH
    const { container } = render(<ListingsClient embedded />)
    expect(container.querySelector('[data-dash-stale]')).toBeNull()
  })
})
