// @vitest-environment jsdom
/**
 * The header's UX3 changes, through the REAL Header (same harness as header.focusout.test.tsx):
 *   · NAV-1 — on a phone the search panel owns one history entry while open: Back closes it (and blurs the
 *     field, or the next tap would show nothing), ✕/Escape/a press on bare page pops the entry, and a
 *     press that may navigate (a link, any listing card) RELEASES it instead of racing that navigation.
 *   · NAV-7 — desktop guests get a Saved heart with the device's saved count, linking to /saved.
 *   · NAV-8 — the panel's "Danh mục" chips keep a Vietnamese reader on the `/vi` twin of a piloted page.
 */
import React from 'react'
import { act, cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Header as StaticHeader } from './header'
import * as staticBackToClose from '@/lib/back-to-close'

// A full Header render (and, for NAV-8, a fresh module graph) is heavy on a loaded machine.
configure({ asyncUtilTimeout: 5_000 })
vi.setConfig({ testTimeout: 30_000 })

const h = vi.hoisted(() => {
  const push = vi.fn()
  const router = { push, prefetch: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }
  const tr = (en: string) => en
  const language = { lang: 'en', t: (k: string) => k, tr, setLang: () => {} }
  const auth: { user: null | { id: string }; profile: null; loading: boolean; openSignIn: () => void } = { user: null, profile: null, loading: false, openSignIn: () => {} }
  const phone = { value: true }
  const saved = { count: 0 }
  return { push, router, language, auth, phone, saved }
})

vi.mock('next/navigation', () => ({
  useRouter: () => h.router,
  usePathname: () => '/help',
  useSearchParams: () => new URLSearchParams(window.location.search),
}))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => h.language,
  useTr: (s: string) => s,
  Tr: ({ text }: { text?: string | null }) => <>{text}</>,
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => h.auth, preloadSignIn: () => {} }))
vi.mock('@/context/favorites-context', () => ({ useFavoriteCount: () => h.saved.count }))
vi.mock('./account-panel', () => ({ useAccountPanel: () => ({ open: false }) }))
vi.mock('@/lib/safe-back', () => ({ useSafeBack: () => () => {} }))
vi.mock('./notification-bell', () => ({ NotificationBell: () => <button type="button" aria-label="Notifications" /> }))
vi.mock('./app-download', () => ({ AppDownload: () => null }))
vi.mock('@/hooks/use-is-phone', () => ({ useIsPhone: () => h.phone.value }))
vi.mock('./ai-concierge', () => ({ AISearchButton: () => <button type="button" aria-label="AI" /> }))

const TRENDING = {
  trending: [],
  categories: [
    { slug: 'furniture-appliances', name: 'Home', nameVi: 'Nhà cửa' },
    { slug: 'rentals', name: 'Rentals', nameVi: 'Cho thuê' },
  ],
}

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => { map.clear() },
  } as Storage
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).startsWith('/api/search/trending')) return new Response(JSON.stringify(TRENDING), { status: 200 })
    return new Response('{}', { status: 200 })
  }))
  h.push.mockClear()
  h.phone.value = true
  h.saved.count = 0
  h.auth.user = null
  h.language.lang = 'en'
  window.history.replaceState({ __NA: true }, '', '/help')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/**
 * The Header under test. vitest pins the services edition, where the `/vi` pilot is off; only NAV-8 needs the
 * marketplace one, and the edition is read once at import — so that case alone gets a fresh module graph.
 */
async function loadHeader(edition: 'marketplace' | 'services' = 'services') {
  if (edition === 'services') {
    staticBackToClose.__resetBackToCloseForTests()
    return { Header: StaticHeader, bt: staticBackToClose }
  }
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', edition)
  const { Header } = await import('./header')
  const bt = await import('@/lib/back-to-close')
  bt.__resetBackToCloseForTests()
  return { Header, bt }
}

const field = () => screen.getByRole('combobox') as HTMLInputElement
const panel = () => document.querySelector('#app-header form div.overflow-y-auto')
const mark = () => (window.history.state as Record<string, unknown> | null)?.enoOverlay as { key: string; released?: true } | undefined

describe('NAV-1: Back closes the phone search panel', () => {
  async function openPanel() {
    const { Header, bt } = await loadHeader()
    render(<Header />)
    act(() => field().focus())
    await waitFor(() => expect(panel()).not.toBeNull())
    await waitFor(() => expect(mark()).toMatchObject({ key: expect.any(String) }))
    return bt
  }

  it('opening it pushes ONE state-only entry; Back closes it and blurs the field (a re-tap opens it again)', async () => {
    await openPanel()
    expect(window.location.pathname).toBe('/help')
    act(() => window.history.back())
    await waitFor(() => expect(panel()).toBeNull())
    expect(document.activeElement).not.toBe(field())
    act(() => field().focus())
    await waitFor(() => expect(panel()).not.toBeNull())
  })

  it('Escape closes it and pops the entry it pushed', async () => {
    await openPanel()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(panel()).toBeNull())
    await waitFor(() => expect(mark()).toBeUndefined())
  })

  it('a press on bare page pops it; a press on a listing card RELEASES it (the card navigates — a pop would race it)', async () => {
    await openPanel()
    const bare = document.body.appendChild(document.createElement('div'))
    fireEvent.mouseDown(bare)
    await waitFor(() => expect(panel()).toBeNull())
    await waitFor(() => expect(mark()).toBeUndefined())
    bare.remove()

    act(() => field().blur())
    act(() => field().focus())
    await waitFor(() => expect(mark()).toMatchObject({ key: expect.any(String) }))
    const card = document.body.appendChild(document.createElement('div'))
    card.setAttribute('data-card-root', '')
    const photo = card.appendChild(document.createElement('div')) // a rail card's photo: no link above it
    fireEvent.mouseDown(photo)
    await waitFor(() => expect(panel()).toBeNull())
    await new Promise((r) => setTimeout(r, 30))
    expect(mark()).toMatchObject({ released: true })
    card.remove()
  })

  it('the header\'s own Back is a traversal, not a push: a press on it pops the panel\'s entry (opus, gate)', async () => {
    await openPanel()
    const back = screen.getByRole('button', { name: 'Back' })
    expect(back.hasAttribute('data-header-back')).toBe(true)
    fireEvent.mouseDown(back)
    await waitFor(() => expect(panel()).toBeNull())
    await waitFor(() => expect(mark()).toBeUndefined()) // popped — never left behind as a dead entry
  })

  it('an action that navigates releases first: AI opens its page and the entry is left for that push to replace', async () => {
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Ask eno AI' }))
    expect(h.push).toHaveBeenCalledWith('/messages/ai')
    await waitFor(() => expect(panel()).toBeNull())
    expect(mark()).toMatchObject({ released: true })
  })

  it('from sm up the panel is a dropdown and keeps no entry', async () => {
    h.phone.value = false
    localStorage.setItem('eno:recent_searches', JSON.stringify(['honda'])) // something to show off a phone
    const { Header } = await loadHeader()
    render(<Header />)
    act(() => field().focus())
    await waitFor(() => expect(panel()).not.toBeNull())
    await new Promise((r) => setTimeout(r, 30))
    expect(mark()).toBeUndefined()
  })
})

describe('NAV-7: a desktop guest reaches Saved from the header', () => {
  it('a heart linking to /saved, desktop-only, with the saved count once it is known', async () => {
    h.saved.count = 3
    const { Header } = await loadHeader()
    render(<Header />)
    const heart = document.querySelector('a[data-header-saved]') as HTMLAnchorElement
    expect(heart.getAttribute('href')).toBe('/saved')
    expect(heart.className).toMatch(/(^|\s)hidden(\s|$)/)
    expect(heart.className).toMatch(/(^|\s)lg:flex(\s|$)/)
    expect(heart.getAttribute('aria-label')).toBe('Saved, 3')
    expect(heart.textContent).toBe('3')
  })

  it('no number while nothing is saved, and no heart for a signed-in reader (their rail has Saved)', async () => {
    const { Header } = await loadHeader()
    const view = render(<Header />)
    const heart = document.querySelector('a[data-header-saved]') as HTMLAnchorElement
    expect(heart.textContent).toBe('')
    expect(heart.getAttribute('aria-label')).toBe('Saved')
    view.unmount()
    h.auth.user = { id: 'u1' }
    render(<Header />)
    expect(document.querySelector('a[data-header-saved]')).toBeNull()
  })
})

describe('NAV-8: the panel\'s category chips stay in the reader\'s language', () => {
  it('a Vietnamese reader\'s "Nhà cửa" opens /vi/c/furniture-appliances (the piloted twin); other categories are unchanged', async () => {
    h.language.lang = 'vi'
    h.language.tr = ((en: string, vi?: string) => vi ?? en) as typeof h.language.tr
    try {
      const { Header } = await loadHeader('marketplace')
      render(<Header />)
      act(() => field().focus())
      const list = await waitFor(() => {
        const ul = document.querySelector('ul[aria-labelledby="header-search-categories"]')
        expect(ul).not.toBeNull()
        return ul!
      })
      const hrefs = [...list.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])
      expect(hrefs).toEqual([['Nhà cửa', '/vi/c/furniture-appliances'], ['Cho thuê', '/c/rentals']])
    } finally {
      h.language.tr = ((en: string) => en) as typeof h.language.tr
    }
  })
})
