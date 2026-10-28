// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { SerializedListingCard } from '@/lib/types'

/**
 * The home page's "Find a teacher" shelf (owner, 2026-10-13). Pinned: the rails' 3-card floor, the category's entry label
 * as the title in both languages, See all → /c/teachers, the cards as the feed draws them minus the LCP hints (lazy
 * photos — the page's one preload stays feed card 0's), the full-width grid row the explorer's CSS keys on, and the
 * door's three states — the sign-up host (edition-aware), a saved draft, the viewer's own profile.
 * ⛔ ON eno.forum EVERY LINK BUT THE CARDS IS eno.vn's OWN URL (owner decision 6, 2026-10-20 — the forum 308s its teacher
 * pages and its teacher host there, src/lib/teachers/surface.ts). vitest runs as eno.forum; `marketplaceShelf` re-imports
 * the shelf as eno.vn, whose links are exactly what they were.
 */
const h = vi.hoisted(() => ({ lang: 'en', cards: [] as Array<Record<string, unknown>>, joinClicks: [] as unknown[][] }))

vi.mock('@/context/language-context', () => ({
  useLanguage: () => ({ lang: h.lang, tr: (en: string, vi?: string) => (h.lang === 'vi' && vi ? vi : en) }),
}))
vi.mock('next/link', () => ({
  default: ({ href, prefetch: _p, scroll: _s, ...rest }: { href: string; prefetch?: boolean; scroll?: boolean } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...rest} />,
}))
// The card is the feed's own <ListingCard>; here it records the props it was handed and opens on a click.
vi.mock('./listing-card', () => ({
  ListingCard: (props: { listing: SerializedListingCard; onOpen: (l: SerializedListingCard) => void }) => {
    h.cards.push(props as unknown as Record<string, unknown>)
    return <button type="button" data-testid="card" onClick={() => props.onOpen(props.listing)}>{props.listing.title}</button>
  },
}))
// Recorded — and the navigation held, which jsdom cannot perform (the app path is teacher-join-click's own concern).
vi.mock('@/components/teachers/teacher-join-click', () => ({
  keepTeacherJoinInApp: (e: React.MouseEvent, lang: string) => { e.preventDefault(); h.joinClicks.push([e, lang]) },
}))

;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }

const { TeacherShelf } = await import('./teacher-shelf')

const teacher = (id: string) => ({ id, title: `Teacher ${id}`, titleVi: `Teacher ${id}`, images: [`https://x/${id}.webp`] }) as unknown as SerializedListingCard
const teachers = (n: number) => Array.from({ length: n }, (_, i) => teacher(`t${i}`))

function shelf(props: Partial<React.ComponentProps<typeof TeacherShelf>> = {}) {
  const onOpen = vi.fn()
  const view = render(<TeacherShelf listings={teachers(3)} onOpen={onOpen} teacherProfile={false} teacherDraft={false} {...props} />)
  return { ...view, onOpen, root: () => view.container.querySelector('[data-teacher-shelf]') as HTMLElement | null }
}

afterEach(() => { cleanup(); vi.unstubAllEnvs(); h.lang = 'en'; h.cards = []; h.joinClicks = [] })

/** The shelf as eno.vn renders it: the edition is a module-level constant, so the shelf is re-imported with it set. */
const marketplaceShelf = async () => {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_ENO_EDITION', 'marketplace')
  const { TeacherShelf: Shelf } = await import('./teacher-shelf')
  return (props: Partial<React.ComponentProps<typeof TeacherShelf>> = {}) =>
    render(<Shelf listings={teachers(3)} onOpen={vi.fn()} teacherProfile={false} teacherDraft={false} {...props} />)
}

describe('TeacherShelf', () => {
  it('below the rails\' floor (two cards) it renders nothing; at three it renders', () => {
    expect(shelf({ listings: teachers(2) }).root()).toBeNull()
    cleanup()
    expect(shelf({ listings: teachers(3) }).root()).not.toBeNull()
  })

  it('is one full-width grid row under a hairline, keyed by its own attribute — never a feed card', () => {
    const root = shelf().root()!
    expect(root.hasAttribute('data-teacher-shelf')).toBe(true)
    expect(root.className).toMatch(/\bcol-span-full\b/)
    expect(root.className).toMatch(/\bmin-w-0\b/)
    expect(root.className).toMatch(/\bborder-t\b/)
    expect(root.hasAttribute('data-feed-card')).toBe(false)
    expect(root.querySelector('[data-feed-card]')).toBeNull()
  })

  it('titled with the category\'s entry label — "Find a teacher", "Tìm giáo viên" in Vietnamese', () => {
    shelf()
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Find a teacher')
    cleanup()
    h.lang = 'vi'
    shelf()
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Tìm giáo viên')
  })

  it('"See all" opens /c/teachers — eno.vn\'s page on eno.forum, linked directly', async () => {
    shelf()
    expect(screen.getByRole('link', { name: /See all/ }).getAttribute('href')).toBe('https://eno.vn/c/teachers')
    cleanup()
    ;(await marketplaceShelf())()
    expect(screen.getByRole('link', { name: /See all/ }).getAttribute('href')).toBe('/c/teachers')
  })

  it('draws every card with no LCP hint (no priority, no lcp, no locate), and a tap is the explorer\'s onOpen', () => {
    const { onOpen } = shelf({ listings: teachers(8) })
    expect(screen.getAllByTestId('card')).toHaveLength(8)
    for (const props of h.cards) {
      expect(props.priority).toBeUndefined()
      expect(props.lcp).toBeUndefined()
      expect(props.onLocate).toBeUndefined()
    }
    fireEvent.click(screen.getAllByTestId('card')[2])
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 't2' }))
  })

  describe('the door', () => {
    const door = () => within(shelf().root()!).getByRole('link', { name: /Create a teacher profile/ })

    it('by default: "Want schools to find you?" + the sign-up form on its own host — eno.vn', () => {
      vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
      const a = door()
      expect(a.getAttribute('href')).toBe('https://teacher.eno.vn/')
      expect(a.getAttribute('data-cross-link')).toBe('home-teacher-join')
      expect(a.closest('p')!.textContent).toMatch(/^Want schools to find you\? Create a teacher profile/)
    })

    it('⛔ eno.forum (its app URL is www) links eno.vn\'s form — its own teacher host 308s there; a bare local build keeps the same-host form', () => {
      vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.eno.forum')
      expect(door().getAttribute('href')).toBe('https://teacher.eno.vn/')
      cleanup()
      vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
      expect(door().getAttribute('href')).toBe('/teachers/join')
    })

    it('a tap goes through keepTeacherJoinInApp (the app opens the form in place, signed in)', () => {
      vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
      fireEvent.click(door())
      expect(h.joinClicks).toHaveLength(1)
      expect(h.joinClicks[0][1]).toBe('en')
    })

    it('a saved draft: "Continue your teacher profile" on THIS host — on eno.forum, eno.vn\'s form', async () => {
      shelf({ teacherDraft: true })
      let a = screen.getByRole('link', { name: /Continue your teacher profile/ })
      expect(a.getAttribute('href')).toBe('https://eno.vn/teachers/join')
      expect(a.getAttribute('data-cross-link')).toBe('home-teacher-continue')
      expect(screen.queryByText(/Want schools to find you/)).toBeNull()
      cleanup()
      ;(await marketplaceShelf())({ teacherDraft: true })
      a = screen.getByRole('link', { name: /Continue your teacher profile/ })
      expect(a.getAttribute('href')).toBe('/teachers/join')
    })

    it('a profile: "Your teacher profile" → /teachers/edit (it wins over a stale draft flag) — on eno.forum, eno.vn\'s', async () => {
      shelf({ teacherProfile: true, teacherDraft: true })
      let a = screen.getByRole('link', { name: /Your teacher profile/ })
      expect(a.getAttribute('href')).toBe('https://eno.vn/teachers/edit')
      expect(a.getAttribute('data-cross-link')).toBe('home-teacher-edit')
      expect(screen.queryByRole('link', { name: /Create a teacher profile|Continue your teacher profile/ })).toBeNull()
      cleanup()
      ;(await marketplaceShelf())({ teacherProfile: true, teacherDraft: true })
      a = screen.getByRole('link', { name: /Your teacher profile/ })
      expect(a.getAttribute('href')).toBe('/teachers/edit')
    })

    it('in Vietnamese, the existing curated lines', () => {
      h.lang = 'vi'
      vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
      const root = shelf().root()!
      expect(within(root).getByRole('link', { name: /Tạo hồ sơ giáo viên/ }).closest('p')!.textContent).toMatch(/^Muốn trường học tìm đến bạn\?/)
    })
  })

  /**
   * ⛔ THE TEACHER LIBRARY'S HUB (teacher visibility plan, 2026-10-18): the home page linked nothing in it. The edition is a
   * module-level constant and vitest runs as eno.forum, so the marketplace render re-imports the shelf with the edition set.
   */
  describe('the guide line', () => {

    it('on eno.vn: links the hub in every door state, with the target declared English', async () => {
      const draw = await marketplaceShelf()
      for (const state of [{}, { teacherDraft: true }, { teacherProfile: true }]) {
        const { container } = draw(state)
        const a = container.querySelector('a[data-cross-link="home-teach-guide"]')!
        expect(a.getAttribute('href')).toBe('/teach-in-vietnam')
        expect(a.getAttribute('hreflang')).toBe('en')
        expect(a.closest('p')!.textContent).toMatch(/^New to teaching in Vietnam\? Start with the guide/)
        cleanup()
      }
    })

    it('in Vietnamese the line says the guide is in English', async () => {
      h.lang = 'vi'
      const { container } = (await marketplaceShelf())()
      expect(container.querySelector('a[data-cross-link="home-teach-guide"]')!.closest('p')!.textContent).toMatch(/^Mới dạy học ở Việt Nam\? Đọc cẩm nang \(tiếng Anh\)/)
    })

    it('not on eno.forum, which 308s the library to eno.vn', () => {
      expect(shelf().root()!.querySelector('a[href^="/teach-in-vietnam"]')).toBeNull()
    })
  })
})
