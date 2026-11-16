// @vitest-environment jsdom
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { BARE_MARKS } from '../../../scripts/lucide-solar-map.mjs'

/**
 * ⛔ THE DOCKED TAB BAR (owner-approved 2026-11-14, cook r05: "after this cook round build all best options and deploy").
 * It reverses the 2026-09-26 floating pill, its tinted capsule and the Post coin's orange plate: full width at bottom 0,
 * 56px + the home-indicator band it pads by, white, a top hairline, idle glyphs muted, the current one the accent bold
 * cut, Post the bold add-circle in ink — build 8 (owner-approved 2026-11-15) the outline add-circle — and since 2026-11-16 (owner,
 * hub Q14) a 32px grey disc with an ink +, labelled "Post" like its neighbours (hub Q12). jsdom has no layout, so the classes and
 * the stylesheet rules are the contract.
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

  it('⛔ Post (owner, 2026-11-16, hub Q14): a 32px grey disc with the bare ink + — no ring glyph, no orange — and "Post" under it', () => {
    render(<MobileNav />)
    const post = screen.getByLabelText('Post')
    expect(tokens(post)).not.toContain('icon-own-ink')
    expect(post.querySelector('.icon-solid')).toBeNull()
    const disc = post.querySelector('[data-post-disc]')!
    expect(tokens(disc)).toEqual(expect.arrayContaining(['size-8', 'rounded-full', 'bg-tint', 'group-active/post:bg-line-strong']))
    expect(tokens(disc)).not.toContain('size-10')
    expect(tokens(post)).toContain('group/post')
    // The plus is the sprite's BARE LINE mark (no ring inside the disc; its geometry is generated — lucide-solar-map.mjs
    // BARE_MARKS), at the disc's own 32px, in ink at rest.
    const glyph = disc.querySelector('svg')!
    expect(glyph.querySelector('use')!.getAttribute('href')).toMatch(/#BarePlus-r$/)
    expect(tokens(glyph)).toEqual(expect.arrayContaining(['size-8', 'text-foreground']))
    expect(post.innerHTML).not.toMatch(/#Plus-r|bg-cta|text-brand|text-commerce/)
    expect(post.querySelector('[data-tab-label]')!.textContent).toBe('Post')
  })

  it('⛔ the + is the mock\'s (cook r12 H6: 16x2 round-capped bars on a 40px disc), scaled to the 32px disc — 12.8 across, 1.6 thick', () => {
    // Read from the generator's own inputs, not the gitignored sprite: the BARE_MARKS row and Solar's linear centreline it scales.
    const { from, shape, line } = BARE_MARKS.BarePlus as { from: string; shape: number; line: { scale: number; stroke: number } }
    const tag = readFileSync(`node_modules/@solar-icons/static/dist/icons/linear/${from}.svg`, 'utf8').match(/<(?:path|circle)\b[^>]*>/g)![shape]
    const coords = [...tag.match(/ d="([^"]+)"/)![1].matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]))
    const arm = Math.max(...coords.map((v) => Math.abs(v - 12)))
    const px = 32 / 24 // the glyph is drawn at the disc's own size-8
    expect((2 * arm * line.scale + line.stroke) * px).toBeCloseTo(16 * (32 / 40), 5)
    expect(line.stroke * px).toBeCloseTo(2 * (32 / 40), 5)
  })

  it('Post on /post: the accent like every current tab — the ink is its resting state only', () => {
    nav.pathname = '/post'
    render(<MobileNav />)
    const post = screen.getByLabelText('Post')
    expect(post.getAttribute('aria-current')).toBe('page')
    expect(tokens(post.querySelector('svg')!)).not.toContain('text-foreground')
    expect(tokens(post.firstElementChild!)).toContain('text-accent-foreground')
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
