// @vitest-environment jsdom
/**
 * ⛔ THE HEADER SEARCH PANEL CLOSES WHEN FOCUS LEAVES THE FORM — AND ONLY THEN (D-KEYBOARD, S-TYPEAHEAD).
 *
 * Measured headless on production, 2026-09-29: after six Tabs focus sat on "Search all listings" and
 * the fixed panel was still drawn over the page, because only a mousedown outside or Escape closed it.
 * The fix listens for `focusin` on the document, and the trap it has to avoid is Safari's: a tapped
 * <button> is NOT focused there, so the input blurs with nowhere for focus to go — a blur-based close
 * unmounts the chip before its click fires. These tests replay both halves through the REAL Header:
 * focus reaching something outside closes; focus going nowhere (or moving inside) does not.
 *
 * Also pinned here, because they live in the same panel: the recent-search rows' per-item ✕ (the
 * panel stays open and the caret stays in the field), the category shortcuts (links to /c/<slug>),
 * and the placeholder ladder's contract with the e2e suites (the native attribute keeps the long copy).
 *
 * ⚠️ NO NETWORK: `fetch` answers /api/search/trending from a fixture. The children that are not under
 * test (bell, app download, ✨) are stand-ins; the bell stays a real focusable button OUTSIDE the form,
 * which is exactly what a Tab reaches in production.
 * ⚠️ EXPLICIT `cleanup` — no vitest globals here (zero-results.test.tsx explains).
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const push = vi.fn()
  const router = { push, prefetch: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }
  const tr = (en: string) => en
  const language = { lang: 'en', t: (k: string) => k, tr, setLang: () => {} }
  const auth = { user: null, profile: null, loading: false, openSignIn: () => {} }
  return { push, router, language, auth }
})

vi.mock('next/navigation', () => ({
  useRouter: () => h.router,
  usePathname: () => '/help',
  useSearchParams: () => new URLSearchParams(window.location.search),
}))
// The typeahead listbox is a code-split chunk and is not under test here (search-suggest.test.tsx).
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('@/context/language-context', () => ({
  useLanguage: () => h.language,
  useTr: (s: string) => s,
  Tr: ({ text }: { text?: string | null }) => <>{text}</>,
}))
vi.mock('@/context/auth-context', () => ({ useAuth: () => h.auth, preloadSignIn: () => {} }))
vi.mock('./account-panel', () => ({ useAccountPanel: () => ({ open: false }) }))
vi.mock('@/lib/safe-back', () => ({ useSafeBack: () => () => {} }))
vi.mock('./notification-bell', () => ({ NotificationBell: () => <button type="button" aria-label="Notifications" /> }))
vi.mock('./app-download', () => ({ AppDownload: () => null }))
vi.mock('./ai-concierge', () => ({ AISearchButton: () => <button type="button" aria-label="AI" /> }))

import { Header } from './header'

const TRENDING = {
  trending: ['iphone'],
  categories: [
    { slug: 'rentals', name: 'Rentals', nameVi: 'Cho thuê' },
    { slug: 'jobs', name: 'Jobs', nameVi: 'Việc làm' },
    { slug: 'services', name: 'Services', nameVi: 'Dịch vụ' },
    // The payload carries the category's own name; the panel shows the entry label (category-entry-label.ts).
    { slug: 'teachers', name: 'Teachers', nameVi: 'Giáo viên' },
    { slug: 'electronics', name: 'Electronics', nameVi: 'Điện tử' },
  ],
}

/**
 * ⚠️ A REAL `localStorage`: under vitest's jsdom the global is an empty plain object (see
 * favorites-context.test.tsx), and the ✕ tests are about exactly what lands in storage.
 */
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
  h.push.mockClear()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).startsWith('/api/search/trending')) return new Response(JSON.stringify(TRENDING), { status: 200 })
    return new Response('{}', { status: 200 })
  }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const field = () => screen.getByRole('combobox') as HTMLInputElement
const recentList = () => document.querySelector('ul[aria-labelledby="header-search-recent"]')
const panelOpen = () => !!document.querySelector('#app-header form div.overflow-y-auto')

async function openWithRecents(terms: string[]) {
  localStorage.setItem('eno:recent_searches', JSON.stringify(terms))
  render(<Header />)
  act(() => field().focus())
  await waitFor(() => expect(recentList()).not.toBeNull())
}

describe('the header search panel closes when focus leaves the form', () => {
  it('focus reaching a control OUTSIDE the form (a Tab to the bell) closes it', async () => {
    await openWithRecents(['sofa'])
    act(() => screen.getByRole('button', { name: 'Notifications' }).focus())
    await waitFor(() => expect(panelOpen()).toBe(false))
  })

  it('focus going NOWHERE — Safari tapping a chip, which it never focuses — keeps it open, and the tap still lands', async () => {
    await openWithRecents(['sofa'])
    act(() => field().blur())
    expect(document.activeElement).toBe(document.body)
    expect(panelOpen()).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'sofa' }))
    expect(h.push).toHaveBeenCalledWith('/?q=sofa')
  })

  it('focus moving INSIDE the form (a Tab onto a row) keeps it open', async () => {
    await openWithRecents(['sofa', 'bike'])
    act(() => screen.getByRole('button', { name: 'bike' }).focus())
    expect(panelOpen()).toBe(true)
  })

  it('still closes on Escape and on a press outside', async () => {
    await openWithRecents(['sofa'])
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(panelOpen()).toBe(false))
    act(() => field().blur())
    act(() => field().focus())
    await waitFor(() => expect(panelOpen()).toBe(true))
    fireEvent.mouseDown(document.body)
    await waitFor(() => expect(panelOpen()).toBe(false))
  })
})

describe('recent searches are rows, each with its own ✕', () => {
  it('✕ forgets ONE term: storage keeps the rest, the panel stays open, the caret stays in the field', async () => {
    await openWithRecents(['sofa', 'iphone'])
    const remove = screen.getByRole('button', { name: 'Remove “sofa”' })
    // The ✕ holds focus off itself, so a tap never blurs the field under the keyboard.
    expect(fireEvent.mouseDown(remove)).toBe(false)
    fireEvent.click(remove)
    expect(localStorage.getItem('eno:recent_searches')).toBe('["iphone"]')
    expect(recentList()!.querySelectorAll('li')).toHaveLength(1)
    expect(panelOpen()).toBe(true)
    expect(document.activeElement).toBe(field())
  })

  it('the last term out removes the key, exactly as Clear does', async () => {
    await openWithRecents(['sofa'])
    fireEvent.click(screen.getByRole('button', { name: 'Remove “sofa”' }))
    expect(localStorage.getItem('eno:recent_searches')).toBeNull()
  })

  it('shows at most five, and only strings (the stored list is unvalidated JSON)', async () => {
    await openWithRecents(['a1', 'b2', 7 as unknown as string, 'c3', 'd4', 'e5', 'f6'])
    const rows = [...recentList()!.querySelectorAll('li')].map((li) => li.textContent)
    expect(rows).toEqual(['a1', 'b2', 'c3', 'd4', 'e5'])
  })
})

describe('a first visit still opens on somewhere to go', () => {
  it('with no history, focusing shows the category shortcuts as links to their pages', async () => {
    render(<Header />)
    act(() => field().focus())
    const list = await waitFor(() => {
      const ul = document.querySelector('ul[aria-labelledby="header-search-categories"]')
      expect(ul).not.toBeNull()
      return ul!
    })
    const links = [...list.querySelectorAll('a')].map((a) => [a.getAttribute('href'), a.textContent])
    // The owner's lead order (2026-10-10) arrives from the route; Teachers is a way in, so it reads "Find a teacher".
    expect(links).toEqual([['/c/rentals', 'Rentals'], ['/c/jobs', 'Jobs'], ['/c/services', 'Services'], ['/c/teachers', 'Find a teacher'], ['/c/electronics', 'Electronics']])
    expect(screen.getByText('Categories').id).toBe('header-search-categories')
  })
})

describe('the placeholder ladder', () => {
  it('keeps the long copy in the attribute — the accessible description, and what the e2e suites find the box by', () => {
    render(<Header />)
    expect(field().getAttribute('placeholder')).toBe('Find products…')
    expect(field().className).toContain('placeholder:text-transparent')
  })

  it('paints the rungs in an aria-hidden overlay sized by container queries on the field (en thresholds)', () => {
    render(<Header />)
    const overlay = document.querySelector('[data-search-placeholder]')!
    expect(overlay.getAttribute('aria-hidden')).toBe('true')
    expect(overlay.className).toContain('peer-placeholder-shown:@min-[4.55em]/q:flex')
    expect(overlay.querySelector('[data-rung="long"]')!.textContent).toBe('Find products…')
    expect(overlay.querySelector('[data-rung="long"]')!.className).toContain('@min-[8.6em]/q:block')
    // The short rung is the field's accessible NAME, so what a voice user sees is what they can say.
    expect(overlay.querySelector('[data-rung="short"]')!.textContent).toBe(field().getAttribute('aria-label'))
    expect(field().parentElement!.className).toContain('@container/q')
  })
})
