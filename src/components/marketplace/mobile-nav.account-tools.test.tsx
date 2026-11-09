// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

/**
 * ACCOUNT LIGHTS ON THE SIGNED-IN TOOLS OUTSIDE /dashboard (UI climb 2026-11-09, phone UX hunt): on /disputes, /account,
 * /account-deletion and a teacher's own tools no tab said where the reader was. Only the LIGHT: a tap there is a real
 * navigation to /dashboard/account (the way back), never a scroll to the top; /teachers/join (public sign-up) stays dark.
 *
 * ⚠️ EXPLICIT CLEANUP — no vitest `globals`, so Testing Library registers no afterEach of its own.
 */

const auth = vi.hoisted(() => ({ user: null as null | { id: string }, loading: false, openSignIn: vi.fn() }))
const nav = vi.hoisted(() => ({ pathname: '/', push: vi.fn() }))
const linkClicks = vi.hoisted(() => [] as { href: string; prevented: boolean }[])

vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useRouter: () => ({ push: nav.push, prefetch: vi.fn() }) }))
vi.mock('next/link', () => ({
  default: ({ href, prefetch, onClick, children, ...rest }: { href: string; prefetch?: boolean; onClick?: (e: React.MouseEvent) => void; children: React.ReactNode } & Record<string, unknown>) => (
    <a
      href={href}
      data-prefetch={String(prefetch)}
      {...rest}
      onClick={(e) => { onClick?.(e); linkClicks.push({ href, prevented: e.defaultPrevented }); e.preventDefault() }}
    >
      {children}
    </a>
  ),
  useLinkStatus: () => ({ pending: false }),
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => auth, preloadSignIn: vi.fn() }))
vi.mock('@/context/favorites-context', () => ({ useFavorites: () => ({ count: 0 }) }))
vi.mock('@/context/chat-context', () => ({ useChat: () => ({ unread: 0 }) }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ tr: (en: string) => en, lang: nav.pathname.startsWith('/vi') ? 'vi' : 'en' }) }))
vi.mock('@/hooks/use-virtual-keyboard', () => ({ useVirtualKeyboard: () => ({ open: false }) }))
vi.mock('@/hooks/use-hide-on-scroll', () => ({ useHideOnScroll: () => false }))
vi.mock('@/lib/haptics', () => ({ hapticTap: vi.fn() }))
vi.mock('./category-glyph', () => ({ CategoryGlyphArt: () => null }))
vi.mock('next/dynamic', () => ({ default: () => function GuestSheetProbe() { return null } }))
vi.mock('./guest-account-sheet', () => ({ GuestAccountSheet: () => null }))
// vitest runs as the SERVICES edition, where the `/vi` pilot is off; the marketplace's lists are what
// make `/vi` the home page (stripViPrefix) and the Explore href `/vi` on a Vietnamese page.
vi.mock('@/lib/lang-pinned', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/lang-pinned')>()
  const lists = { live: m.VI_PREFIX_PATHS, retired: [] }
  return {
    ...m,
    stripViPrefix: (p: string | null) => m.stripViPrefix(p, lists),
    localizedHref: (href: string, variant: string) => m.localizedHref(href, variant, lists),
  }
})

import { MobileNav } from './mobile-nav'

afterEach(cleanup)
beforeEach(() => {
  auth.user = null
  auth.loading = false
  nav.pathname = '/'
  linkClicks.length = 0
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 0, writable: true })
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
})

const current = (name: string) => screen.getByLabelText(name).getAttribute('aria-current')

describe('Account lights on the account tools outside /dashboard', () => {
  it.each(['/disputes', '/account', '/account-deletion', '/teachers/edit', '/teachers/check-in', '/teachers/cover', '/teachers/cover-zalo', '/teachers/job-messages'])(
    '%s: Account is lit, and a tap goes back to /dashboard/account', (p) => {
      auth.user = { id: 'u1' }
      nav.pathname = p
      render(<MobileNav />)
      expect(current('Account')).not.toBeNull()
      fireEvent.click(screen.getByLabelText('Account'))
      expect(window.scrollTo).not.toHaveBeenCalled()
      expect(linkClicks.at(-1)).toEqual({ href: '/dashboard/account', prevented: false })
    },
  )

  it.each(['/disputes', '/account', '/account-deletion', '/teachers/edit', '/teachers/check-in', '/teachers/cover', '/teachers/cover-zalo', '/teachers/job-messages'])(
    '%s lights Account only — never Explore too (one current tab)', (p) => {
      auth.user = { id: 'u1' }
      nav.pathname = p
      render(<MobileNav />)
      expect(current('Account')).not.toBeNull()
      for (const other of ['Explore', 'Saved', 'Messages', 'Post']) expect(current(other), other).toBeNull()
    },
  )

  it.each(['/teachers/join', '/teachers', '/accounts-x'])('%s: Account stays dark', (p) => {
    auth.user = { id: 'u1' }
    nav.pathname = p
    render(<MobileNav />)
    expect(current('Account')).toBeNull()
  })
})
