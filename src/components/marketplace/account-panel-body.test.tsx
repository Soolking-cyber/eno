// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * THE ACCOUNT RAIL UNDER A FAILED DASHBOARD FETCH (inbox-10). The rail reads the shared dashboard store; since
 * a 401 now drops the cached dashboard, the rail must not present an identity this browser no longer holds,
 * nor sit on an empty one — it offers the one way back in. A 'failed' fetch keeps the session's own identity
 * (never a skeleton).
 */

const h = vi.hoisted(() => ({
  dash: null as unknown,
  error: null as 'auth' | 'failed' | null,
  replace: vi.fn(),
  signOut: vi.fn(async (_opts?: unknown) => {}),
  onClose: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard/settings',
  useRouter: () => ({ replace: h.replace, push: vi.fn(), prefetch: vi.fn() }),
}))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'an@example.com' }, loading: false, signOut: h.signOut }) }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ lang: 'en', tr: (en: string) => en }) }))
vi.mock('@/hooks/use-dashboard', () => ({ useDashboard: () => ({ dash: h.dash, error: h.error, refresh: vi.fn(), loading: false }) }))
vi.mock('@/context/chat-context', () => ({ useChat: () => ({ unread: 0 }) }))
vi.mock('@/context/favorites-context', () => ({ useFavorites: () => ({ count: 0 }) }))
vi.mock('./account-panel', () => ({ useAccountPanel: () => ({ expanded: true, setExpanded: () => {} }) }))
vi.mock('./preferences-inline', () => ({ PreferencesInline: () => null }))
vi.mock('@/components/ui/tooltip', () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

import { AccountPanel } from './account-panel-body'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
beforeEach(() => {
  // jsdom has no matchMedia; the panel asks it whether it is on a desktop (it is not, here).
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
  h.dash = null
  h.error = null
  h.replace.mockClear()
  h.signOut.mockClear()
  h.onClose.mockClear()
})

const DASH = { tier: 'individual', profile: { displayName: 'An Nguyen', businessName: null, email: 'an@example.com', avatarUrl: null, avatarColor: '#123', trustScore: 72 }, seller: null, stats: {}, listings: [], isAdmin: false, hasVisa: false }

describe('the account rail', () => {
  it('normally: the identity row (the Settings link)', () => {
    h.dash = DASH
    render(<AccountPanel open onClose={h.onClose} />)
    expect(screen.getByText('An Nguyen')).toBeTruthy()
    expect(document.querySelector('[data-rail-session-expired]')).toBeNull()
  })

  it('⛔ a refused session (401): no identity row, ONE way back in — a local sign-out, then /signin back to this page', async () => {
    h.error = 'auth'
    render(<AccountPanel open onClose={h.onClose} />)
    const btn = document.querySelector('[data-rail-session-expired]') as HTMLElement
    expect(btn).not.toBeNull()
    expect(btn.textContent).toContain('Your session has expired')
    // Not the identity this browser no longer holds.
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull()
    fireEvent.click(btn)
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith('/signin?next=/dashboard/settings'))
    expect(h.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(h.onClose).toHaveBeenCalled()
  })

  it('a failed fetch (no data): the session\'s own identity, never a skeleton or the sign-in row', () => {
    h.error = 'failed'
    const { container } = render(<AccountPanel open onClose={h.onClose} />)
    expect(document.querySelector('[data-rail-session-expired]')).toBeNull()
    expect(screen.getAllByText('an@example.com').length).toBeGreaterThan(0)
    expect(container.querySelector('[data-slot="skeleton"]')).toBeNull()
  })
})
