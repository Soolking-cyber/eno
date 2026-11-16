// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

/**
 * ⛔ LABELS UNDER THE TAB GLYPHS, ALL FIVE (owner, 2026-11-16, hub Q12: "yes if they are related to visual change"; cook r11
 * home-lab, whose still labels "Post" too). It reverses 2026-09-26's "no visible labels": every tab — the Post disc's too —
 * prints the words of its own `aria-label` (no new copy) at 11px on a 16px line (the stacked Vietnamese marks fit inside the
 * label's overflow box) under its glyph, 500 at rest and 600 in the accent on the current tab, the five on one baseline
 * (bottom-anchored stacks). The label is aria-hidden, so the accessible name stays the aria-label alone and is said once. The
 * bar's own height (56px + the inset) does not move.
 * jsdom has no layout, so the classes are the contract. ⚠️ EXPLICIT CLEANUP — no vitest `globals`.
 */

const nav = vi.hoisted(() => ({ pathname: '/', lang: 'en' as 'en' | 'vi', user: null as null | { id: string } }))
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('next/link', () => ({
  default: ({ href, prefetch: _p, children, ...rest }: { href: string; prefetch?: boolean; children: React.ReactNode } & Record<string, unknown>) => <a href={href} {...rest}>{children}</a>,
  useLinkStatus: () => ({ pending: false }),
}))
vi.mock('@/lib/visitor-engaged', () => ({ useVisitorEngaged: () => true }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: nav.user, loading: false, openSignIn: vi.fn() }), preloadSignIn: vi.fn() }))
vi.mock('@/context/favorites-context', () => ({ useFavorites: () => ({ count: 3 }) }))
vi.mock('@/context/chat-context', () => ({ useChat: () => ({ unread: 2 }) }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ tr: (en: string, vi: string) => (nav.lang === 'vi' ? vi : en), lang: nav.lang }) }))
vi.mock('@/hooks/use-virtual-keyboard', () => ({ useVirtualKeyboard: () => ({ open: false }) }))
vi.mock('@/hooks/use-hide-on-scroll', () => ({ useHideOnScroll: () => false }))
vi.mock('@/lib/haptics', () => ({ hapticTap: vi.fn() }))
vi.mock('./category-glyph', () => ({ CategoryGlyphArt: ({ className }: { className?: string }) => <svg data-compass="" className={className} /> }))
vi.mock('next/dynamic', () => ({ default: () => function Sheet() { return null } }))
vi.mock('./guest-account-sheet', () => ({ GuestAccountSheet: () => null }))

import { MobileNav } from './mobile-nav'

afterEach(() => { cleanup(); nav.pathname = '/'; nav.lang = 'en'; nav.user = null })

const tokens = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/)
const labelOf = (tab: Element) => tab.querySelector('[data-tab-label]')

describe('labels under the glyphs (hub Q12a, 2026-11-16)', () => {
  it.each([
    ['en', ['Explore', 'Saved', 'Post', 'Messages', 'Account']],
    ['vi', ['Khám phá', 'Đã lưu', 'Đăng tin', 'Tin nhắn', 'Tài khoản']],
  ] as const)('%s: each of the five tabs prints its own aria-label, and nothing else — the Post disc included', (lang, words) => {
    nav.lang = lang
    render(<MobileNav />)
    for (const w of words) {
      const tab = screen.getByLabelText(w)
      expect(labelOf(tab)!.textContent).toBe(w)
      expect(tab.getAttribute('aria-label')).toBe(labelOf(tab)!.textContent)
    }
    expect(document.querySelectorAll('[data-tab-label]')).toHaveLength(5)
  })

  it('the name is said once: the label is aria-hidden, so the accessible name stays exactly the aria-label (badges included)', () => {
    render(<MobileNav />)
    for (const l of document.querySelectorAll('[data-tab-label]')) expect(l.getAttribute('aria-hidden')).toBe('true')
    // Saved carries a count badge; its name is still the one word.
    expect(screen.getByRole('link', { name: 'Saved' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Explore' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Post' })).toBeTruthy()
  })

  it('a guest\'s gated tabs (Messages, Account — buttons) carry their labels too', () => {
    render(<MobileNav />)
    for (const w of ['Messages', 'Account']) {
      const tab = screen.getByRole('button', { name: w })
      expect(labelOf(tab)!.textContent).toBe(w)
    }
  })

  it('11px on a 16px line at 500 at rest, one line (truncate) — the 24px glyph over it, the pair bottom-anchored so the labels share a baseline', () => {
    render(<MobileNav />)
    const saved = screen.getByLabelText('Saved')
    // `leading-4`, never `leading-3`: `truncate` clips at the line box, and a 12px one cut the stacked marks (Ẫ Ổ Ữ) and every
    // descender (measured in Chromium, mobile-nav.tsx's label-slot note).
    expect(tokens(labelOf(saved)!)).toEqual(expect.arrayContaining(['text-2xs', 'leading-4', 'font-medium', 'truncate', 'max-w-full']))
    expect(tokens(labelOf(saved)!)).not.toContain('leading-3')
    const stack = saved.firstElementChild!
    expect(tokens(stack)).toEqual(expect.arrayContaining(['flex-col', 'items-center', 'justify-end', 'pb-1', 'text-muted-foreground']))
    expect(tokens(stack)).not.toContain('justify-center')
    // Every tab's stack is the same bottom-anchored column, Post's too: one baseline under the 24px glyphs and the 32px disc.
    for (const w of ['Explore', 'Post', 'Messages', 'Account']) expect(tokens(screen.getByLabelText(w).firstElementChild!)).toEqual(expect.arrayContaining(['flex-col', 'justify-end', 'pb-1']))
    for (const w of ['Saved', 'Messages', 'Account']) expect(tokens(screen.getByLabelText(w).querySelector('svg')!)).toEqual(expect.arrayContaining(['h-6', 'w-6']))
    expect(tokens(screen.getByLabelText('Explore').querySelector('[data-compass]')!)).toEqual(expect.arrayContaining(['h-6', 'w-6']))
    expect(document.querySelector('.h-6\\.5')).toBeNull()
  })

  it('⚠️ every tab is `min-w-0`: a long machine-translated label ends in its ellipsis instead of widening its tab past a fifth of a 320px bar', () => {
    render(<MobileNav />)
    for (const w of ['Explore', 'Saved', 'Post', 'Messages', 'Account']) {
      expect(tokens(screen.getByLabelText(w))).toEqual(expect.arrayContaining(['flex-1', 'min-w-0']))
    }
  })

  it('the current tab: its label at 600 in the accent, like its glyph', () => {
    nav.pathname = '/saved'
    render(<MobileNav />)
    const saved = screen.getByLabelText('Saved')
    expect(tokens(saved.firstElementChild!)).toContain('text-accent-foreground')
    expect(tokens(labelOf(saved)!)).toContain('font-semibold')
    expect(tokens(labelOf(screen.getByLabelText('Explore'))!)).toContain('font-medium')
  })

  it('the bar keeps its 56px + the home-indicator inset — every consumer of that footprint is unchanged', () => {
    render(<MobileNav />)
    expect(tokens(screen.getByRole('navigation'))).toEqual(expect.arrayContaining(['h-[calc(3.5rem+var(--tabbar-inset))]', 'pb-(--tabbar-inset)']))
  })

  it('the badges still hang off the glyph (Saved count, Messages unread for a member)', () => {
    nav.user = { id: 'u1' }
    render(<MobileNav />)
    expect(screen.getByLabelText('Saved').textContent).toContain('3')
    expect(screen.getByLabelText('Messages').textContent).toContain('2')
  })
})
