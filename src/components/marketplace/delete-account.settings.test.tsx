// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

/**
 * ⛔ THE APPLE NOTICE, WHERE IT ACTUALLY RENDERS (review, 2026-10-08). DeleteAccount lives inside Settings, whose guard
 * answers "no user" by unmounting its whole body — this dialog included — and sending the visitor to /signin, and a
 * sign-out makes auth-js tell every listener SIGNED_OUT at once (even when /logout fails). So a notice set AFTER the
 * sign-out never painted, while delete-account.apple.test.tsx (DeleteAccount alone, signOut a bare mock) stayed green.
 * Here: the real AuthProvider, the real SettingsClient and DeleteAccount, and a Supabase client whose signOut tells
 * its listeners SIGNED_OUT the way auth-js's _removeSession does.
 */
type Session = { user: { id: string; app_metadata: Record<string, unknown>; user_metadata: Record<string, unknown> }; access_token: string; refresh_token: string }
const h = vi.hoisted(() => ({
  listeners: [] as Array<(event: string, session: unknown) => void>,
  session: null as Session | null,
  signOuts: 0,
  replace: [] as string[],
  apple: 'manual' as string,
  tabStorage: new Map<string, string>(),
}))

vi.mock('@/lib/supabase/browser', () => ({
  createSupabaseBrowser: () => ({
    auth: {
      getSession: async () => ({ data: { session: h.session } }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        h.listeners.push(cb)
        return { data: { subscription: { unsubscribe: () => { h.listeners = h.listeners.filter((l) => l !== cb) } } } }
      },
      signOut: async () => {
        h.signOuts++
        h.session = null
        for (const cb of [...h.listeners]) cb('SIGNED_OUT', null)
        return { error: null }
      },
    },
  }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: (u: string) => { h.replace.push(u) }, push: () => {}, refresh: () => {} }),
  usePathname: () => '/dashboard/settings',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/analytics', () => ({ trackSignUp: () => {} }))
vi.mock('@/lib/post-draft-photos', () => ({ clearDraftPhotos: () => Promise.resolve() }))
// The dashboard payload follows the auth user, as the real hook does (it is null the moment the user is).
vi.mock('@/hooks/use-dashboard', async () => {
  const { useAuth } = await import('@/context/auth-context')
  return {
    useDashboard: () => {
      const { user } = useAuth()
      const dash = user ? { tier: 'individual', seller: null, profile: { email: 'x@privaterelay.appleid.com', displayName: 'A', businessName: null } } : null
      return { dash, refresh: () => {}, error: null, loading: false, fresh: !!dash }
    },
  }
})
vi.mock('@/components/marketplace/change-email-form', () => ({ ChangeEmailForm: () => null }))
vi.mock('@/components/marketplace/set-password-form', () => ({ SetPasswordForm: () => null }))
vi.mock('@/components/marketplace/account-type-switcher', () => ({ AccountTypeSwitcher: () => null }))

const { AuthProvider } = await import('@/context/auth-context')
const { LanguageProvider } = await import('@/context/language-context')
const { SettingsClient } = await import('@/app/[lang]/dashboard/settings/settings-client')

const realLocation = window.location
beforeEach(() => {
  h.listeners = []; h.signOuts = 0; h.replace = []; h.apple = 'manual'
  h.session = { user: { id: 'u1', app_metadata: { provider: 'apple', providers: ['apple'] }, user_metadata: {} }, access_token: 'a', refresh_token: 'r' }
  // A session cookie, so the provider boots supabase-js (auth-context's anonymous-visitor gate).
  document.cookie = 'sb-xihiryllwmjoouipkyhw-auth-token=base64-x; path=/'
  // Node 25's global localStorage has no working methods: a fresh store per test (LanguageProvider, sign-out storage).
  const map = new Map<string, string>([['lang', 'en']])
  vi.stubGlobal('localStorage', {
    get length() { return map.size },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => { map.clear() },
  })
  stubSession(true)
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url) === '/api/account/delete') return { ok: true, status: 200, json: async () => ({ ok: true, apple: h.apple }) }
    return { ok: false, status: 503, json: async () => ({}) } // /api/me and friends: fail open
  }))
  Object.defineProperty(window, 'location', { configurable: true, value: { ...realLocation, href: 'http://localhost:3000/dashboard/settings', reload: () => {}, assign: () => {} } })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
  document.cookie = 'sb-xihiryllwmjoouipkyhw-auth-token=; path=/; max-age=0'
})

/** This tab's sessionStorage — the notice's hand-off (apple-deletion-notice.tsx) — working, or refusing (the fallback). */
function stubSession(works: boolean) {
  h.tabStorage = new Map<string, string>()
  const refuse = () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError') }
  vi.stubGlobal('sessionStorage', {
    get length() { return h.tabStorage.size },
    key: (i: number) => [...h.tabStorage.keys()][i] ?? null,
    getItem: (k: string) => (works && h.tabStorage.has(k) ? h.tabStorage.get(k)! : null),
    setItem: (k: string, v: string) => { if (!works) refuse(); h.tabStorage.set(k, String(v)) },
    removeItem: (k: string) => { h.tabStorage.delete(k) },
    clear: () => { h.tabStorage.clear() },
  })
}

async function mountSignedIn() {
  render(<LanguageProvider initialLang="en" initialViDict={{}}><AuthProvider><SettingsClient embedded section="account" /></AuthProvider></LanguageProvider>)
  // The first interaction boots the client at once (no idle wait), then the session lands.
  await act(async () => { window.dispatchEvent(new Event('pointerdown')) })
  await screen.findByRole('button', { name: 'Delete my account' })
}

async function deleteAccount() {
  fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }))
  fireEvent.change(await screen.findByPlaceholderText('DELETE'), { target: { value: 'DELETE' } })
  fireEvent.click(screen.getByRole('button', { name: 'Permanently delete' }))
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
}

describe('deleting an Apple account from Settings', () => {
  it.each(['manual', 'queued'])('`%s`: signed out and sent home AT ONCE, the notice handed to the page it lands on', async (status) => {
    h.apple = status
    await mountSignedIn()
    await deleteAccount()
    await vi.waitFor(() => expect(window.location.href).toBe('/'))
    expect(h.signOuts).toBe(1)
    expect(h.tabStorage.get('eno:apple-deletion-notice')).toBe(status)
  })
})

describe('…in a tab that cannot store the hand-off — the in-place notice survives the sign-out', () => {
  beforeEach(() => stubSession(false))
  it.each(['manual', 'queued'])('`%s`: the notice paints while the session still exists; Done signs out, THEN goes home', async (status) => {
    h.apple = status
    await mountSignedIn()
    await deleteAccount()
    expect(await screen.findByText('Your account is deleted')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'How to stop using Sign in with Apple for an app' })).toBeTruthy()
    expect(h.signOuts).toBe(0)
    expect(h.replace).toEqual([])
    expect(window.location.href).toBe('http://localhost:3000/dashboard/settings')

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await vi.waitFor(() => expect(window.location.href).toBe('/'))
    expect(h.signOuts).toBe(1)
  })

  it('`revoked`: signs out and goes home, as before — no notice', async () => {
    h.apple = 'revoked'
    await mountSignedIn()
    await deleteAccount()
    await vi.waitFor(() => expect(window.location.href).toBe('/'))
    expect(h.signOuts).toBe(1)
    expect(screen.queryByText('Your account is deleted')).toBeNull()
  })

  it('leaving the notice another way (Settings unmounts it) still signs out', async () => {
    await mountSignedIn()
    await deleteAccount()
    expect(await screen.findByText('Your account is deleted')).toBeTruthy()
    expect(h.signOuts).toBe(0)
    cleanup()
    await vi.waitFor(() => expect(h.signOuts).toBe(1))
  })
})
