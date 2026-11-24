// @vitest-environment jsdom
import * as React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

/**
 * ⛔ NO LINK THAT REDIRECTS, FROM A SHOP'S OR THE TEACHER'S OWN HOST (Seobility crawl 4, 2026-11-25: 191 "links to
 * redirects", most of them `<shop>.eno.vn/saved`, `/post`, `/messages`, `/dashboard/account`, `/partners`, `/app` and the
 * teacher host's footer). Every path but `/` on those hosts 301s to the apex (src/proxy.ts), so:
 *   · the phone tab bar — mounted by the layout, outside any page's SiteOriginProvider — marks its signed-in tabs
 *     (Saved, Post, Messages, Account) `nofollow`; Explore stays a followed link;
 *   · the partner badge and the app-download link name the apex inside the shop page's provider;
 *   · the teacher form's page wraps itself in the provider on the teacher host.
 * ⚠️ EXPLICIT CLEANUP — no vitest `globals`.
 */

vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }))
vi.mock('next/link', () => ({
  default: ({ href, prefetch: _p, children, ...rest }: { href: string; prefetch?: boolean; children: React.ReactNode } & Record<string, unknown>) => <a href={href} {...rest}>{children}</a>,
  useLinkStatus: () => ({ pending: false }),
}))
vi.mock('@/lib/visitor-engaged', () => ({ useVisitorEngaged: () => true }))
vi.mock('@/context/auth-context', () => ({ useAuth: () => ({ user: { id: 'u1' }, loading: false, openSignIn: vi.fn() }), preloadSignIn: vi.fn() }))
vi.mock('@/context/favorites-context', () => ({ useFavorites: () => ({ count: 0 }) }))
vi.mock('@/context/chat-context', () => ({ useChat: () => ({ unread: 0 }) }))
vi.mock('@/context/language-context', () => ({ useLanguage: () => ({ tr: (en: string) => en, lang: 'en' }) }))
vi.mock('@/hooks/use-virtual-keyboard', () => ({ useVirtualKeyboard: () => ({ open: false }) }))
vi.mock('@/hooks/use-hide-on-scroll', () => ({ useHideOnScroll: () => false }))
vi.mock('@/lib/haptics', () => ({ hapticTap: vi.fn() }))
vi.mock('./category-glyph', () => ({ CategoryGlyphArt: ({ className }: { className?: string }) => <svg className={className} /> }))
vi.mock('next/dynamic', () => ({ default: () => function Sheet() { return null } }))
vi.mock('./guest-account-sheet', () => ({ GuestAccountSheet: () => null }))
vi.mock('@/lib/native-browser', () => ({ isNativeShell: () => false }))
vi.mock('@/lib/in-app-browser', () => ({ browserContext: () => 'browser' }))

import { MobileNav } from './mobile-nav'
import { AppDownload } from './app-download'
import { PartnerBadge } from './partner-badge'
import { SiteOriginProvider } from './site-href'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('links from a shop or teacher host', () => {
  it('the tab bar: Saved, Post, Messages and Account are nofollow; Explore is followed', () => {
    render(<MobileNav />)
    for (const name of ['Saved', 'Post', 'Messages', 'Account']) {
      expect(screen.getByRole('link', { name }).getAttribute('rel')).toBe('nofollow')
    }
    expect(screen.getByRole('link', { name: 'Explore' }).getAttribute('rel')).toBeNull()
  })

  it('inside the shop page’s provider the app link and the partner badge name the apex', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
    render(
      <SiteOriginProvider origin="https://eno.vn">
        <AppDownload />
        <PartnerBadge asLink />
      </SiteOriginProvider>,
    )
    expect(screen.getByRole('link', { name: 'Download the eno app' }).getAttribute('href')).toMatch(/^https:\/\/(eno\.vn\/app$|apps\.apple\.com|play\.google\.com)/)
    expect(screen.getByRole('link', { name: /Official partner/ }).getAttribute('href')).toBe('https://eno.vn/partners')
  })

  it('without a provider (the apex) both stay paths', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }))
    render(<PartnerBadge asLink />)
    expect(screen.getByRole('link', { name: /Official partner/ }).getAttribute('href')).toBe('/partners')
  })

  it('the teacher form’s page gives the teacher host the apex’s origin', () => {
    const SRC = readFileSync(join(process.cwd(), 'src/app/[lang]/teachers/join/page.tsx'), 'utf8')
    expect(SRC).toContain("<SiteOriginProvider origin={draftHost ? apexOrigin(APP_URL) : ''}>")
  })
})
