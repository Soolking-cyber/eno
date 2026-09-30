// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

/**
 * THE POST TAB IS DRAFT-FIRST — owner, 2026-09-25: "Draft first, sign in at Publish".
 *
 * Measured on eno.vn before this change: a signed-out tap on the bottom-nav Post coin left the URL on /
 * and opened the sign-in dialog, while the desktop header and /post itself let a guest straight into the
 * wizard. These tests pin the fix from the one place a guest meets it — the tap:
 *   · as a resolved guest, Post is a link to /post that navigates, and sign-in is NOT opened;
 *   · while auth is still resolving, the tap is NOT swallowed and replayed as a sign-in (the trap in
 *     `gate={false}`: GatedTab's boot deferral replays a guest's tap as openSignIn());
 *   · Messages keeps its gate; Account (a guest's) opens the guest sheet instead of the card (O-09).
 *
 * ⚠️ EXPLICIT CLEANUP — no vitest `globals`, so Testing Library registers no afterEach of its own.
 */

const auth = vi.hoisted(() => ({ user: null as null | { id: string }, loading: false, openSignIn: vi.fn() }))
const nav = vi.hoisted(() => ({ pathname: '/', push: vi.fn() }))
/** Every Link click, with whether the COMPONENT prevented the navigation (the mock then stops jsdom's). */
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
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ tr: (en: string) => en, lang: 'en' }) }))
vi.mock('@/hooks/use-virtual-keyboard', () => ({ useVirtualKeyboard: () => ({ open: false }) }))
vi.mock('@/hooks/use-hide-on-scroll', () => ({ useHideOnScroll: () => false }))
vi.mock('@/lib/haptics', () => ({ hapticTap: vi.fn() }))
vi.mock('./category-glyph', () => ({ CategoryGlyphArt: () => null }))
// The guest Account sheet (O-09) is a next/dynamic chunk; a stub that reports whether it is open is all
// these tests need from it (its own contents are guest-account-sheet's business). The module mock covers
// the tab's pointer-down preload, which imports the chunk directly.
vi.mock('next/dynamic', () => ({
  default: () => function GuestSheetProbe({ open }: { open: boolean }) { return <div data-testid="guest-sheet" data-open={String(open)} /> },
}))
vi.mock('./guest-account-sheet', () => ({ GuestAccountSheet: () => null }))

import { MobileNav } from './mobile-nav'

afterEach(cleanup)
beforeEach(() => {
  auth.user = null
  auth.loading = false
  auth.openSignIn.mockClear()
  nav.pathname = '/'
  nav.push.mockClear()
  linkClicks.length = 0
})

const byName = (name: string) => screen.getByLabelText(name)

describe('a signed-out visitor', () => {
  it('Post is a link to /post, and tapping it navigates there without opening sign-in', () => {
    render(<MobileNav />)
    const post = byName('Post')
    expect(post.tagName).toBe('A')
    expect(post.getAttribute('href')).toBe('/post')
    fireEvent.click(post)
    expect(auth.openSignIn).not.toHaveBeenCalled()
    expect(linkClicks).toEqual([{ href: '/post', prevented: false }])
  })

  it('already ON /post (mid-draft): the tab is current, never prefetches itself, and a tap still opens no sign-in', () => {
    // Reviewer-raised (panel round 1): the one state the other tests never reach. The tap is the same
    // same-URL soft navigation members have always had here — the wizard stays mounted and its draft
    // is in localStorage — and it must not be the guest's route back to the modal.
    nav.pathname = '/post'
    render(<MobileNav />)
    const post = byName('Post')
    expect(post.getAttribute('aria-current')).toBe('page')
    expect(post.getAttribute('data-prefetch')).toBe('false')
    fireEvent.click(post)
    expect(auth.openSignIn).not.toHaveBeenCalled()
  })

  it('Messages still meets the sign-in card — only Post changed', () => {
    render(<MobileNav />)
    const el = byName('Messages')
    expect(el.tagName).toBe('BUTTON')
    fireEvent.click(el)
    expect(auth.openSignIn).toHaveBeenCalledTimes(1)
  })

  it('O-09: Account opens the guest sheet (Sign in, Language, Currency, Help, Safety), not the sign-in card', async () => {
    render(<MobileNav />)
    const el = byName('Account')
    expect(el.tagName).toBe('BUTTON')
    expect(el.getAttribute('aria-haspopup')).toBe('dialog')
    fireEvent.pointerDown(el)
    fireEvent.click(el)
    expect(auth.openSignIn).not.toHaveBeenCalled()
    expect((await screen.findByTestId('guest-sheet')).getAttribute('data-open')).toBe('true')
  })
})

describe('while auth is still resolving (most first taps land here)', () => {
  it('a tap on Post navigates at once — it is not swallowed and later replayed as a sign-in', () => {
    auth.loading = true
    const { rerender } = render(<MobileNav />)
    fireEvent.click(byName('Post'))
    expect(linkClicks).toEqual([{ href: '/post', prevented: false }])
    // Auth resolves to a guest: nothing may fire on its own now.
    auth.loading = false
    act(() => { rerender(<MobileNav />) })
    expect(auth.openSignIn).not.toHaveBeenCalled()
    expect(nav.push).not.toHaveBeenCalled()
  })

  it('O-09: an Account tap in that window replays as the guest SHEET once auth says guest — never the bare sign-in card', async () => {
    auth.loading = true
    const { rerender } = render(<MobileNav />)
    fireEvent.click(byName('Account'))
    expect(nav.push).not.toHaveBeenCalled()
    auth.loading = false
    act(() => { rerender(<MobileNav />) })
    expect(auth.openSignIn).not.toHaveBeenCalled()
    expect((await screen.findByTestId('guest-sheet')).getAttribute('data-open')).toBe('true')
  })

  it('does not prefetch /post during that window (the cold load stays as light as before; after it, auto prefetch like Explore/Saved)', () => {
    auth.loading = true
    render(<MobileNav />)
    expect(byName('Post').getAttribute('data-prefetch')).toBe('false')
  })
})

describe('a member', () => {
  it('Post is the same link to /post', () => {
    auth.user = { id: 'u1' }
    render(<MobileNav />)
    const post = byName('Post')
    expect(post.getAttribute('href')).toBe('/post')
    fireEvent.click(post)
    expect(linkClicks).toEqual([{ href: '/post', prevented: false }])
    expect(auth.openSignIn).not.toHaveBeenCalled()
  })
})
