// @vitest-environment jsdom
/**
 * ⛔ THE HEADER'S ORANGE POST BUTTON STANDS DOWN ON THE POST FLOW — IN THE SERVER HTML (review, 2026-09-29).
 *
 * It used to hide only once the wizard's effect set `data-post-wizard` on <html>, so the server HTML
 * carried the button and hydration removed it: the header controls beside it jumped ~105px at
 * 1280×800 on /post (layout shift 0.0017). The header now decides from the pathname while it renders,
 * so these tests render it to a STRING — the server's output — and read the button's wrapper there.
 * The one thing still written from an effect is the success screen's `data-post-done`, which lets the
 * button back after a Publish (a user action, never on load).
 *
 * ⚠️ Same stand-ins as header.focusout.test.tsx; nothing here needs the search panel.
 */
import { readFileSync } from 'node:fs'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const router = { push: () => {}, prefetch: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }
  const language = { lang: 'en', t: (k: string) => k, tr: (en: string) => en, setLang: () => {} }
  const auth = { user: null, profile: null, loading: false, openSignIn: () => {} }
  return { router, language, auth, pathname: '/post' }
})

vi.mock('next/navigation', () => ({
  useRouter: () => h.router,
  usePathname: () => h.pathname,
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => h.language,
  useTr: (s: string) => s,
  Tr: ({ text }: { text?: string | null }) => <>{text}</>,
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => h.auth, preloadSignIn: () => {} }))
vi.mock('./account-panel', () => ({ useAccountPanel: () => ({ open: false }) }))
vi.mock('@/lib/safe-back', () => ({ useSafeBack: () => () => {} }))
vi.mock('./notification-bell', () => ({ NotificationBell: () => null }))
vi.mock('./app-download', () => ({ AppDownload: () => null }))
vi.mock('./ai-concierge', () => ({ AISearchButton: () => null, GuideMark: () => null }))

import { Header, isPostFlowPath } from './header'

/** The class list of the element wrapping the header's Post link, as the SERVER renders it. */
function postWrapperClass(pathname: string): string {
  h.pathname = pathname
  const doc = new DOMParser().parseFromString(renderToString(<Header />), 'text/html')
  const link = doc.querySelector('a[href="/post"]')
  expect(link, pathname).not.toBeNull()
  return link!.parentElement!.className
}

describe('isPostFlowPath — the same answer on both sides of the proxy rewrite', () => {
  it('matches /post and /listings/<id>/edit, public or internal (/en, /vi)', () => {
    for (const p of ['/post', '/post/', '/en/post', '/vi/post', '/listings/cmx1/edit', '/vi/listings/cmx1/edit']) expect(isPostFlowPath(p), p).toBe(true)
  })

  it('matches nothing else', () => {
    for (const p of [null, undefined, '', '/', '/en', '/posts', '/post/x', '/listings/cmx1', '/listings/cmx1/edit/x', '/dashboard', '/fr/post', '/c/post'])
      expect(isPostFlowPath(p), String(p)).toBe(false)
  })
})

describe('the Post button in the server-rendered header', () => {
  it('⛔ is hidden on /post and on the edit page from the first byte — until the success screen releases it', () => {
    for (const p of ['/post', '/en/post', '/listings/cmx1/edit']) {
      expect(postWrapperClass(p), p).toContain('[html:not([data-post-done])_&]:hidden')
    }
  })

  it('is left alone everywhere else', () => {
    for (const p of ['/', '/help', '/listings/cmx1']) expect(postWrapperClass(p), p).toBe('mobile:hidden pc:contents')
  })

  it('⛔ the whole header stands down on a phone only where the shell passes `postBar` (the wizard\'s task bar, owner-approved 2026-11-16) — from the first byte', () => {
    const headerClass = (pathname: string, postBar?: boolean) => {
      h.pathname = pathname
      return new DOMParser().parseFromString(renderToString(<Header postBar={postBar} />), 'text/html').getElementById('app-header')!.className.split(/\s+/)
    }
    for (const p of ['/post', '/vi/post', '/listings/cmx1/edit']) expect(headerClass(p, true), p).toContain('post-bar:hidden')
    // ⛔ NOT BY PATHNAME (review, 2026-11-16): a bare <Header /> on the post flow's own paths — a 404 or an error screen
    // there — keeps its header, because no wizard is on that page to give it a task bar.
    for (const p of ['/post', '/vi/post', '/listings/cmx1/edit', '/', '/help', '/listings/cmx1', '/dashboard']) expect(headerClass(p), p).not.toContain('post-bar:hidden')
  })

  it('⛔ a 404 under the edit path (a bad listing id → notFound()) renders the real 404 page WITH its header', async () => {
    h.pathname = '/listings/nope/edit'
    const { default: NotFound } = await import('@/app/[lang]/not-found')
    const doc = new DOMParser().parseFromString(renderToString(<NotFound />), 'text/html')
    const header = doc.getElementById('app-header')
    expect(header).not.toBeNull()
    expect(header!.className.split(/\s+/)).not.toContain('post-bar:hidden')
    // …and it is the 404 page, not the wizard: no task bar to stand in for it.
    expect(doc.querySelector('[data-error-page]')).not.toBeNull()
    expect(doc.querySelector('[data-post-bar]')).toBeNull()
  })

  it('only the three shells that render the wizard pass `postBar`; the 404 and error screens do not', () => {
    for (const f of ['src/app/[lang]/post/page.tsx', 'src/app/[lang]/post/loading.tsx', 'src/app/[lang]/listings/[id]/edit/page.tsx'])
      expect(readFileSync(f, 'utf8'), f).toMatch(/<Header postBar \/>/)
    for (const f of ['src/app/[lang]/not-found.tsx', 'src/app/[lang]/error.tsx']) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).toMatch(/<Header \/>/)
      expect(src, f).not.toContain('postBar')
    }
  })

  it('the wizard writes only the success hook, and only after a Publish — no load-time attribute is left', () => {
    const wizard = readFileSync('src/components/marketplace/post-wizard.tsx', 'utf8')
    expect(wizard).not.toContain('data-post-wizard')
    expect(wizard).toMatch(/if \(!submitted\) return\s*\n\s*const root = document\.documentElement\s*\n\s*root\.setAttribute\('data-post-done', ''\)/)
  })
})
