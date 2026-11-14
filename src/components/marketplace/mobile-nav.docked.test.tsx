// @vitest-environment jsdom
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

/**
 * ⛔ THE DOCKED TAB BAR (owner-approved 2026-11-14, cook r05: "after this cook round build all best options and deploy").
 * It reverses the 2026-09-26 floating pill, its tinted capsule and the Post coin's orange plate: full width at bottom 0,
 * 56px + the home-indicator band it pads by, white, a top hairline, idle glyphs muted, the current one the accent bold
 * cut, Post the bold add-circle in ink. jsdom has no layout, so the classes and the stylesheet rules are the contract.
 * ⚠️ EXPLICIT CLEANUP — no vitest `globals`.
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

afterEach(() => { cleanup(); off.scrolled = false; nav.pathname = '/' })

const tokens = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/)
const css = readFileSync('src/app/globals.css', 'utf8')

describe('the bar is docked, not a floating pill', () => {
  it('full width at bottom 0, padded by the home-indicator band, white with a top hairline — no radius, no blur', () => {
    render(<MobileNav />)
    const bar = tokens(screen.getByRole('navigation'))
    expect(bar).toEqual(expect.arrayContaining(['inset-x-0', 'bottom-0', 'pb-(--tabbar-inset)', 'border-t', 'border-border', 'bg-background', 'shadow-bar', 'pc:hidden']))
    for (const gone of ['rounded-full', 'max-w-sm', 'inset-x-3', 'backdrop-blur-md', 'material', 'bg-popover/95']) expect(bar).not.toContain(gone)
    // The five tabs sit centred in a max-w-md row inside the full-width bar (a touch tablet).
    expect(tokens(screen.getByRole('navigation').firstElementChild!)).toEqual(expect.arrayContaining(['mx-auto', 'max-w-md']))
  })

  it('retracts by its own height (translate-y-full), and keeps the reveal-on-focus', () => {
    off.scrolled = true
    render(<MobileNav />)
    const bar = tokens(screen.getByRole('navigation'))
    expect(bar).toEqual(expect.arrayContaining(['translate-y-full', 'opacity-0', 'pointer-events-none', 'focus-within:translate-y-0']))
    expect(bar.some((c) => c.startsWith('translate-y-[calc('))).toBe(false)
  })

  it('no tinted capsule in any state; idle glyphs muted', () => {
    nav.pathname = '/saved'
    const { container } = render(<MobileNav />)
    expect(container.querySelector('.bar-in')).toBeNull()
    const explore = screen.getByLabelText('Explore').firstElementChild!
    expect(tokens(explore)).toContain('text-muted-foreground')
  })

  it('Post: the ink add-circle — icon-solid, text-foreground, no plate — on a link that keeps its own ink', () => {
    render(<MobileNav />)
    const post = screen.getByLabelText('Post')
    expect(tokens(post)).toContain('icon-own-ink')
    const coin = post.querySelector('.icon-solid')!
    expect(tokens(coin)).toEqual(expect.arrayContaining(['text-foreground', 'size-10', 'rounded-full']))
    expect(coin.className).not.toMatch(/bg-cta-50|text-brand|\[aria-current=page\]/)
  })

  it('the badge ring cuts out the bar\'s own white, and every tab\'s tap strip fills the inset band', () => {
    render(<MobileNav />)
    expect(screen.getByRole('navigation').className).toContain('[--tab-surface:var(--color-background)]')
    expect(tokens(screen.getByLabelText('Saved'))).toEqual(expect.arrayContaining(['after:h-(--tabbar-inset)', 'active:scale-[0.92]']))
  })
})

describe('the stylesheet half', () => {
  it('icon-solid shows the bold layer at rest; bar-in and the native pill lift are gone; kb-open travels 100%', () => {
    expect(css).toMatch(/\.icon-solid \.i-on \{ opacity: 1; \}/)
    expect(css).toMatch(/\.icon-solid \.i-rest \{ opacity: 0; \}/)
    expect(css).not.toMatch(/@keyframes bar-in/)
    expect(css).not.toMatch(/\.bar-in \{/)
    expect(css).not.toMatch(/html\.native \.mobile-nav \{/)
    expect(css).toMatch(/html\.kb-open \.mobile-nav \{\s*transform: translateY\(100%\);/)
    expect(css).toMatch(/--tabbar-inset: max\(env\(safe-area-inset-bottom\), var\(--safe-area-inset-bottom, 0px\)\);/)
  })

  it('forced colours: the ink-filled selected pill (`.pill-on`) is Highlight, in both selector lists', () => {
    const block = css.slice(css.indexOf('@media (forced-colors: active) {\n  [role="tab"][aria-selected="true"]'))
    expect(block).toMatch(/\.pill-on,\n\s*\[role="radio"\]\[aria-checked="true"\],/)
    expect(block).toMatch(/\.pill-on \*,\n\s*\[role="radio"\]\[aria-checked="true"\] \*,/)
  })

  it('no whole-chip fit rule: the clipped pill stays the swipe cue (the fit was dropped in commit review)', () => {
    expect(css).not.toContain('[data-fit-after]')
  })
})
