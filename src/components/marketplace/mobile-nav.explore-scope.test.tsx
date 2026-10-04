// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

/**
 * NAV-5 (UX3, 2026-10-05) — "you are here" for the browse section. Explore used to light only on the exact
 * home path (research R9), so on a category, a listing, a seller or a storefront the icon-only bar said
 * nothing about where the reader was. It now lights across the browse surfaces, while:
 *   · its href stays exactly the home root (a tap from a listing goes home, as before);
 *   · `aria-current="page"` stays for the home page itself, "true" (current item) elsewhere in the section;
 *   · re-tapping on home still scrolls to the top, and a tap from anywhere else is a real navigation;
 *   · Saved, Messages and Account keep their own paths.
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

const explore = () => screen.getByLabelText('Explore')
const current = (name: string) => screen.getByLabelText(name).getAttribute('aria-current')

describe('Explore lights across the browse surfaces', () => {
  it.each(['/c/rentals', '/c/furniture-appliances/d2', '/listings/abc', '/sellers/s1', '/s/apple_store', '/brands'])(
    '%s: Explore is the current item; its href is still the home root, prefetched as before',
    (p) => {
      nav.pathname = p
      render(<MobileNav />)
      expect(current('Explore')).toBe('true')
      expect(explore().getAttribute('href')).toBe('/')
      // Not the page it links, so the prefetch that warms home stays on (it is keyed on the EXACT path).
      expect(explore().getAttribute('data-prefetch')).toBe('undefined')
      for (const other of ['Saved', 'Messages', 'Post', 'Account']) expect(current(other), other).toBeNull()
    },
  )

  it('on home itself it is the current PAGE, does not prefetch itself, and a re-tap scrolls to the top', () => {
    render(<MobileNav />)
    expect(current('Explore')).toBe('page')
    expect(explore().getAttribute('data-prefetch')).toBe('false')
    window.scrollY = 900
    fireEvent.click(explore())
    expect(linkClicks).toEqual([{ href: '/', prevented: true }])
    expect(window.scrollTo).toHaveBeenCalledTimes(1)
  })

  it('from a listing, a tap is a real navigation home — never the scroll-to-top of a re-tap', () => {
    nav.pathname = '/listings/abc'
    render(<MobileNav />)
    window.scrollY = 900
    fireEvent.click(explore())
    expect(linkClicks).toEqual([{ href: '/', prevented: false }])
    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it('the `/vi` pilot: /vi is home (page), /vi/c/… is the section (true), and the href is /vi', () => {
    nav.pathname = '/vi'
    render(<MobileNav />)
    expect(current('Explore')).toBe('page')
    expect(explore().getAttribute('href')).toBe('/vi')
    cleanup()
    nav.pathname = '/vi/c/furniture-appliances'
    render(<MobileNav />)
    expect(current('Explore')).toBe('true')
    expect(explore().getAttribute('href')).toBe('/vi')
  })
})

describe('the other tabs keep their own paths', () => {
  it('Saved', () => {
    nav.pathname = '/saved'
    render(<MobileNav />)
    expect(current('Saved')).toBe('page')
    expect(current('Explore')).toBeNull()
  })

  it('Messages (a guest standing in a thread) and Account (a member inside the dashboard)', () => {
    nav.pathname = '/messages/t1'
    render(<MobileNav />)
    expect(current('Messages')).toBe('page')
    expect(current('Explore')).toBeNull()
    cleanup()
    auth.user = { id: 'u1' }
    nav.pathname = '/dashboard/listings'
    render(<MobileNav />)
    expect(current('Account')).toBe('page')
    expect(current('Explore')).toBeNull()
  })

  it('Post, and the pages that belong to no tab', () => {
    for (const p of ['/post', '/about', '/help', '/motorbike-rental-ho-chi-minh-city']) {
      nav.pathname = p
      render(<MobileNav />)
      expect(current('Explore'), p).toBeNull()
      cleanup()
    }
  })
})
