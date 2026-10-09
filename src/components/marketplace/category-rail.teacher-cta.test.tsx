// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

import { LanguageProvider } from '@/context/language-context'
import { SUBCATEGORIES } from '@/lib/subcategories'
import { Collapsible } from '@/components/ui/collapsible'
import { teacherJoinUrl } from '@/lib/teachers/host'
import { CategoryRail } from './category-rail'
import { LadderCompactRow } from './ladder-compact-row'

/**
 * ⛔ THE TEACHERS PLATE'S LAST CHIP IS THE WAY IN (owner, 2026-10-09: "on home page add a button here as subcat that will
 * redirect to teacher.eno.vn to create their profile"): a link to the sign-up form's own host, edition-aware, shown for
 * teachers only — and even when no teacher subcategory is offered, so the way in never disappears.
 */

vi.mock('next/link', () => ({
  default: ({ href, prefetch: _p, scroll: _s, ...rest }: { href: string; prefetch?: boolean; scroll?: boolean } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...rest} />,
}))

afterEach(() => { cleanup(); vi.unstubAllEnvs() })
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
HTMLElement.prototype.scrollTo = () => {}

type Cats = React.ComponentProps<typeof CategoryRail>['categories']
const cats = ['teachers', 'rentals', 'jobs'].map((slug) => ({ id: slug, slug, name: slug, nameVi: slug, icon: 'Car', verifiedCount: 10 })) as unknown as Cats

function rail(activeCategory: string, subcategoryCounts: Record<string, number> = {}) {
  return render(
    <LanguageProvider>
      <CategoryRail categories={cats} activeCategory={activeCategory} activeSubcategory="all" subcategoryCounts={subcategoryCounts}
        onCategory={() => {}} onSubcategory={() => {}} />
    </LanguageProvider>,
  )
}
const cta = () => screen.queryByRole('link', { name: 'Create a teacher profile' })

describe('the teachers plate: "Create a teacher profile" → the sign-up host', () => {
  it('eno.vn → https://teacher.eno.vn/, the plate\'s LAST chip, a link with no pressed state', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
    rail('teachers')
    const a = cta()!
    expect(a.tagName).toBe('A')
    expect(a.getAttribute('href')).toBe('https://teacher.eno.vn/')
    expect(a.hasAttribute('aria-pressed')).toBe(false)
    // After every subcategory chip, inside the same plate.
    const plate = a.parentElement!
    expect(plate.lastElementChild).toBe(a)
    expect(plate.querySelectorAll('[data-subcat]').length).toBe((SUBCATEGORIES.teachers ?? []).length)
  })

  it('follows the edition: eno.forum (www) → https://teacher.eno.forum/; no app URL → the form on this host', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.eno.forum')
    expect(teacherJoinUrl()).toBe('https://teacher.eno.forum/')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '')
    expect(teacherJoinUrl()).toBe('/teachers/join')
  })

  it('teachers only: another category\'s plate has no such chip', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
    rail('jobs')
    expect(cta()).toBeNull()
  })

  it('⛔ shown even when no teacher subcategory is offered — the plate keeps "All" and the way in', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
    const zero = Object.fromEntries((SUBCATEGORIES.teachers ?? []).map((s) => [s.slug, 0]))
    rail('teachers', zero)
    expect(document.querySelectorAll('[data-subcat]').length).toBe(0)
    expect(cta()?.getAttribute('href')).toBe('https://teacher.eno.vn/')
    expect(screen.getByRole('button', { name: /^All/ })).toBeTruthy()
    // ⛔ …AND THE PLATE KEEPS ITS EXPLICIT COLUMN (pill verification, 2026-10-09): with only the render knowing it was
    // open, it got `--sub-col-*: 0` — an invalid line, auto-placed after the tile, every later tile reflowed.
    const box = cta()!.closest('[style*="--sub-col-m"]') as HTMLElement
    expect(Number(box.style.getPropertyValue('--sub-col-m'))).toBeGreaterThan(1)
    expect(Number(box.style.getPropertyValue('--sub-col-d'))).toBeGreaterThan(1)
  })

  it('⛔ in the iOS / Android app the tap stays IN the app — the same form at /teachers/join; the web keeps the host', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
    const real = window.location
    const assign = vi.fn()
    Object.defineProperty(window, 'location', { configurable: true, value: { ...real, assign } })
    try {
      rail('teachers')
      const click = () => { const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }); cta()!.dispatchEvent(ev); return ev }
      // The web: the link is followed as is.
      expect(click().defaultPrevented).toBe(false)
      expect(assign).not.toHaveBeenCalled()
      // The app shell (Capacitor): kept in the WebView, on the same form.
      ;(window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true }
      expect(click().defaultPrevented).toBe(true)
      expect(assign).toHaveBeenCalledWith('/teachers/join')
    } finally {
      delete (window as unknown as { Capacitor?: unknown }).Capacitor
      Object.defineProperty(window, 'location', { configurable: true, value: real })
    }
  })
})

describe('the phone\'s compact row (what the results view shows below 640px) carries the same way in', () => {
  const row = (activeCategory: string) => render(
    <LanguageProvider>
      <Collapsible>
        <LadderCompactRow categories={cats} activeCategory={activeCategory} activeSubcategory="all" onCategory={() => {}} onSubcategory={() => {}}
          expanded={false} subcategoryCounts={{}} />
      </Collapsible>
    </LanguageProvider>,
  )

  it('teachers: the row ends with "Create a teacher profile" → https://teacher.eno.vn/ — a link, never a toggle', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
    row('teachers')
    const group = screen.getByRole('group', { name: /Subcategories|Categories/ })
    const a = within(group).getByRole('link', { name: 'Create a teacher profile' })
    expect(a.getAttribute('href')).toBe('https://teacher.eno.vn/')
    expect(a.hasAttribute('aria-pressed')).toBe(false)
    expect(group.lastElementChild).toBe(a)
  })

  it('⛔ teachers with NO subcategory offered keep the subcategory shape — "All" and the way in, never the category list', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
    const zero = Object.fromEntries((SUBCATEGORIES.teachers ?? []).map((s) => [s.slug, 0]))
    render(
      <LanguageProvider>
        <Collapsible>
          <LadderCompactRow categories={cats} activeCategory="teachers" activeSubcategory="all" onCategory={() => {}} onSubcategory={() => {}}
            expanded={false} subcategoryCounts={zero} />
        </Collapsible>
      </LanguageProvider>,
    )
    const group = screen.getByRole('group', { name: 'Subcategories' })
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['All'])
    expect(group.lastElementChild).toBe(within(group).getByRole('link', { name: 'Create a teacher profile' }))
  })

  it('another category\'s row has no such chip', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://eno.vn')
    row('jobs')
    expect(cta()).toBeNull()
  })
})
