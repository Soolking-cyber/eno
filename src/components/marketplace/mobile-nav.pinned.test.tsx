// @vitest-environment jsdom
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

/**
 * ⛔ THE TAB BAR ON A PAGE THAT PINS ITS OWN ACTION (owner-approved 2026-11-14, cook r06 "item"; globals.css, the goods tier
 * block): `data-scrolled-up` is absent in the server HTML and the first render, appears once this visit has seen the bar
 * hide and come back (a scroll down, then up), goes while the bar is retracting, and is set at once on a page that cannot
 * scroll. jsdom has no layout: the stylesheet rule is pinned in src/lib/goods-sheet.test.ts.
 */

const off = vi.hoisted(() => ({ scrolled: false }))
const nav = vi.hoisted(() => ({ pathname: '/' }))
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('next/link', () => ({
  default: ({ href, prefetch: _p, children, ...rest }: { href: string; prefetch?: boolean; children: React.ReactNode } & Record<string, unknown>) => <a href={href} {...rest}>{children}</a>,
  useLinkStatus: () => ({ pending: false }),
}))
vi.mock('@/lib/visitor-engaged', () => ({ useVisitorEngaged: () => true }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: null, loading: false, openSignIn: vi.fn() }), preloadSignIn: vi.fn() }))
vi.mock('@/context/favorites-context', () => ({ useFavorites: () => ({ count: 2 }) }))
vi.mock('@/context/chat-context', () => ({ useChat: () => ({ unread: 0 }) }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ tr: (en: string) => en, lang: 'en' }) }))
vi.mock('@/hooks/use-virtual-keyboard', () => ({ useVirtualKeyboard: () => ({ open: false }) }))
vi.mock('@/hooks/use-hide-on-scroll', () => ({ useHideOnScroll: () => off.scrolled }))
vi.mock('@/lib/haptics', () => ({ hapticTap: vi.fn() }))
vi.mock('./category-glyph', () => ({ CategoryGlyphArt: () => null }))
vi.mock('next/dynamic', () => ({ default: () => function Sheet() { return null } }))
vi.mock('./guest-account-sheet', () => ({ GuestAccountSheet: () => null }))

import { MobileNav } from './mobile-nav'
import { renderToString } from 'react-dom/server'
import { act } from 'react'

afterEach(() => { cleanup(); off.scrolled = false; nav.pathname = '/' ; document.body.innerHTML = '' })

const pinPage = () => { const c = document.createElement('div'); c.id = 'contact'; c.setAttribute('data-pin-action', ''); document.body.appendChild(c) }

describe('data-scrolled-up', () => {
  it('absent in the server HTML', () => {
    expect(renderToString(<MobileNav />)).not.toContain('data-scrolled-up')
  })
  it('absent until the bar has hidden once and come back; absent again while it hides', () => {
    nav.pathname = '/listings/x'
    const { rerender } = render(<MobileNav />)
    const bar = () => screen.getByRole('navigation')
    expect(bar().hasAttribute('data-scrolled-up')).toBe(false)
    off.scrolled = true
    rerender(<MobileNav />)
    expect(bar().hasAttribute('data-scrolled-up')).toBe(false)
    off.scrolled = false
    rerender(<MobileNav />)
    expect(bar().hasAttribute('data-scrolled-up')).toBe(true)
  })
  it('a pinned page that cannot scroll shows the bar at once (never stranded)', async () => {
    pinPage()
    nav.pathname = '/listings/short'
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => { f(0); return 1 })
    render(<MobileNav />)
    await act(async () => {})
    // jsdom: scrollHeight 0 and innerHeight 768, so the page "cannot scroll".
    expect(screen.getByRole('navigation').hasAttribute('data-scrolled-up')).toBe(true)
    vi.unstubAllGlobals()
  })
})
