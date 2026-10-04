// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * SIGN IN AGAIN after a 401 (inbox-10) — the one implementation every dashboard surface uses.
 *   · ⛔ a LOCAL-scope sign-out: a false 401 must not revoke the person's session on every device;
 *   · with the app's device cleanup (signOut does it; the fallback does it when signOut fails part-way);
 *   · and /signin must be reachable: the auth context's user is gone BEFORE the navigation.
 */

const h = vi.hoisted(() => ({
  authUser: { id: 'u1' } as { id: string } | null,
  userAtNavigation: undefined as unknown,
  order: [] as string[],
  replace: vi.fn((to: string) => { h.order.push(`replace ${to}`); h.userAtNavigation = h.authUser }),
  signOut: vi.fn(async (_opts?: unknown) => { h.order.push('signOut'); h.authUser = null }),
  localSignOut: vi.fn(async (_opts?: unknown) => { h.order.push('localSignOut'); h.authUser = null }),
  clearStorage: vi.fn(() => { h.order.push('clearStorage') }),
  clearPhotos: vi.fn(async () => { h.order.push('clearPhotos') }),
  clearBasket: vi.fn(() => { h.order.push('clearBasket') }),
  clearDraft: vi.fn(() => { h.order.push('clearDraft') }),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: h.replace, push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1' }, loading: false, signOut: h.signOut }) }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('@/lib/supabase/browser', () => ({ createSupabaseBrowser: () => ({ auth: { signOut: h.localSignOut } }) }))
vi.mock('@/lib/sign-out-storage', () => ({ clearAccountDeviceStorage: h.clearStorage }))
vi.mock('@/lib/post-draft-photos', () => ({ clearDraftPhotos: h.clearPhotos }))
vi.mock('@/lib/rental-check/store', () => ({ clearBasket: h.clearBasket, clearDraft: h.clearDraft }))

import { DashboardFetchError, SIGN_OUT_FALLBACK_MS, documentNav } from './dashboard-fetch-error'

let docNav: ReturnType<typeof vi.spyOn>
afterEach(() => {
  cleanup()
  docNav.mockRestore()
  vi.useRealTimers()
  for (const c of document.cookie.split(';')) {
    const name = c.split('=')[0]?.trim()
    if (name) document.cookie = `${name}=; Max-Age=0; path=/`
  }
})
beforeEach(() => {
  docNav = vi.spyOn(documentNav, 'replace').mockImplementation((url: string) => { h.order.push(`document ${url}`) })
  h.authUser = { id: 'u1' }
  h.userAtNavigation = undefined
  h.order = []
  for (const f of [h.replace, h.signOut, h.localSignOut, h.clearStorage, h.clearPhotos, h.clearBasket, h.clearDraft]) f.mockClear()
  h.signOut.mockImplementation(async () => { h.order.push('signOut'); h.authUser = null })
  h.localSignOut.mockImplementation(async () => { h.order.push('localSignOut'); h.authUser = null })
})

const renderAuth = () => render(<DashboardFetchError error="auth" onRetry={() => {}} next="/dashboard/settings" />)

describe('Sign in again (401)', () => {
  it('⛔ signs out LOCALLY — never the global default that would revoke every device — then reaches /signin', async () => {
    renderAuth()
    expect(screen.getByText('Your session has expired')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/signin?next=/dashboard/settings'))
    expect(h.signOut).toHaveBeenCalledTimes(1)
    expect(h.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(h.order).toEqual(['signOut', 'replace /signin?next=/dashboard/settings'])
    // What /signin bounces on — gone before the navigation.
    expect(h.userAtNavigation).toBeNull()
  })

  it('⛔ signOut failing part-way: a local sign-out + the full device cleanup, AWAITED, then a client-side navigation', async () => {
    h.signOut.mockImplementation(async () => { h.order.push('signOut'); throw new Error('chunk load failed') })
    renderAuth()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/signin?next=/dashboard/settings'))
    expect(h.localSignOut).toHaveBeenCalledWith({ scope: 'local' })
    // Every cleanup step finished BEFORE the navigation — none is left running behind it.
    const nav = h.order.indexOf('replace /signin?next=/dashboard/settings')
    for (const step of ['signOut', 'localSignOut', 'clearStorage', 'clearPhotos', 'clearBasket', 'clearDraft']) {
      expect(h.order.indexOf(step), step).toBeGreaterThan(-1)
      expect(h.order.indexOf(step), step).toBeLessThan(nav)
    }
    expect(h.userAtNavigation).toBeNull()
    expect(docNav).not.toHaveBeenCalled()
  })

  it('⛔ BOTH sign-outs fail: the auth cookies are dropped and /signin loads as a NEW document — it cannot bounce back', async () => {
    document.cookie = 'sb-proj-auth-token=session; path=/'
    document.cookie = 'sb-proj-auth-token.0=chunk; path=/'
    document.cookie = 'sb-proj-auth-token-code-verifier=v; path=/'
    document.cookie = 'lang=vi; path=/'
    h.signOut.mockImplementation(async () => { h.order.push('signOut'); throw new Error('offline') })
    h.localSignOut.mockImplementation(async () => { h.order.push('localSignOut'); throw new Error('offline') })
    renderAuth()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(docNav).toHaveBeenCalledWith('/signin?next=/dashboard/settings'))
    // Not a client-side navigation: the auth context in THIS page still holds the dead session's user.
    expect(h.replace).not.toHaveBeenCalled()
    expect(document.cookie).not.toMatch(/sb-proj-auth-token/)
    expect(document.cookie).toMatch(/lang=vi/) // nothing else is touched
    // The device cleanup still ran, before the navigation.
    const nav = h.order.indexOf('document /signin?next=/dashboard/settings')
    for (const step of ['clearStorage', 'clearPhotos', 'clearBasket', 'clearDraft']) expect(h.order.indexOf(step), step).toBeLessThan(nav)
  })

  it('a cleanup that HANGS never hangs the navigation: at the deadline, the cookie path takes over', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    document.cookie = 'sb-proj-auth-token=session; path=/'
    h.signOut.mockImplementation(async () => { throw new Error('chunk load failed') })
    h.localSignOut.mockImplementation(() => new Promise(() => {})) // never settles
    renderAuth()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(SIGN_OUT_FALLBACK_MS - 100) })
    expect(docNav).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(docNav).toHaveBeenCalledWith('/signin?next=/dashboard/settings')
    expect(document.cookie).not.toMatch(/sb-proj-auth-token/)
  })
})

describe('a failed fetch (no data)', () => {
  it('the canon\'s fault state with Retry — never a skeleton', () => {
    const onRetry = vi.fn()
    const { container } = render(<DashboardFetchError error="failed" onRetry={onRetry} next="/dashboard/settings" />)
    expect(screen.getByRole('alert').textContent).toBe('Something went wrong')
    expect(container.querySelector('[data-slot="skeleton"], .animate-pulse')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('a page can name what is missing', () => {
    render(<DashboardFetchError error="failed" onRetry={() => {}} next="/x" failedTitle="Couldn’t load your listings" />)
    expect(screen.getByRole('alert').textContent).toBe('Couldn’t load your listings')
  })
})
