// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'

import { LanguageProvider } from '@/context/language-context'
import { Collapsible } from '@/components/ui/collapsible'
import type { FacetCounts } from '@/lib/facet-counts'
import { CategoryRail } from './category-rail'
import { LadderCompactRow } from './ladder-compact-row'
import { offeredSubcategories } from './count-chip'

vi.mock('next/link', () => ({
  default: ({ href, prefetch: _p, scroll: _s, ...rest }: { href: string; prefetch?: boolean; scroll?: boolean } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...rest} />,
}))

/**
 * E-TILES (2026-09-29). (1) The category and intent tiles are LINKS when the page can say where they go:
 * a modified click keeps the browser's default (a new tab), a plain primary click is taken over and
 * filters in place. (2) The phone's compact ladder row offers the SAME chips as the full rail — it used
 * to list every subcategory, empty ones included.
 */
afterEach(cleanup)
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
HTMLElement.prototype.scrollTo = () => {}

type Cats = React.ComponentProps<typeof CategoryRail>['categories']
const cats = ['rentals', 'electronics', 'vehicles'].map((slug) => ({ id: slug, slug, name: slug, nameVi: slug, icon: 'Car', verifiedCount: 10 })) as unknown as Cats
const INTENTS = [{ type: 'free', name: 'Free', nameVi: 'Miễn phí', icon: 'Gift' }]
const hrefFor = (p: { category?: string; type?: string } | null) => (p ? `/?${new URLSearchParams(p as Record<string, string>)}` : '/')

function rail(over: Partial<React.ComponentProps<typeof CategoryRail>> = {}) {
  const onCategory = vi.fn()
  const onIntent = vi.fn()
  render(
    <LanguageProvider>
      <CategoryRail categories={cats} intents={INTENTS} activeCategory="all" activeSubcategory="all" subcategoryCounts={{}}
        onCategory={onCategory} onSubcategory={() => {}} onIntent={onIntent} hrefFor={hrefFor} {...over} />
    </LanguageProvider>,
  )
  return { onCategory, onIntent }
}

describe('<CategoryRail> tiles are links (E-TILES)', () => {
  it('renders <a href> tiles that point at the filtered feed, the active one at the unfiltered feed', () => {
    rail({ activeCategory: 'electronics' })
    const tile = (slug: string) => document.querySelector(`[data-cat="${slug}"]`)!
    expect(tile('rentals').tagName).toBe('A')
    expect(tile('rentals').getAttribute('href')).toBe('/?category=rentals')
    expect(tile('electronics').getAttribute('href')).toBe('/')
    expect(tile('electronics').getAttribute('aria-current')).toBe('true')
    expect(tile('rentals').hasAttribute('aria-pressed')).toBe(false)
    expect(document.querySelector('[data-intent="free"]')!.getAttribute('href')).toBe('/?type=free')
  })

  it('a plain click filters in place and does not navigate', () => {
    const { onCategory, onIntent } = rail()
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    document.querySelector('[data-cat="rentals"]')!.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(onCategory).toHaveBeenCalledWith('rentals')
    fireEvent.click(document.querySelector('[data-intent="free"]')!)
    expect(onIntent).toHaveBeenCalledWith('free')
  })

  it('a ctrl/cmd/shift click is left to the browser (a new tab) and filters nothing here', () => {
    const { onCategory } = rail()
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...mod })
      document.querySelector('[data-cat="rentals"]')!.dispatchEvent(ev)
      expect(ev.defaultPrevented).toBe(false)
    }
    expect(onCategory).not.toHaveBeenCalled()
  })

  it('without hrefFor the tiles stay toggle buttons', () => {
    rail({ hrefFor: undefined, activeCategory: 'rentals' })
    const t = document.querySelector('[data-cat="rentals"]')!
    expect(t.tagName).toBe('BUTTON')
    expect(t.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('the phone compact row offers the rail\'s chips (E-TILES)', () => {
  // Rentals with only apartments and offices in view: the zero-seeded subcategory dimension says so.
  const facets = {
    subcategory: { all: 50, values: { 'apartment-rental': 40, 'house-rental': 0, 'room-rental': 0, 'office-rental': 10, 'hotel-short-stay': 0, 'homestay-serviced': 0 } },
  } as unknown as FacetCounts

  it('drops the empty subcategories, exactly as the rail\'s plate does', () => {
    render(
      <LanguageProvider>
        <Collapsible>
          <LadderCompactRow categories={cats} activeCategory="rentals" activeSubcategory="all" onCategory={() => {}} onSubcategory={() => {}}
            expanded={false} facets={facets} subcategoryCounts={{}} />
        </Collapsible>
      </LanguageProvider>,
    )
    const row = screen.getByRole('group', { name: /Subcategories|Danh mục con/ })
    const chips = within(row).getAllByRole('button').map((b) => b.textContent)
    const plate = offeredSubcategories('rentals', facets, {}, 'all').subs.map((s) => s.name)
    expect(chips).toEqual(['All', ...plate])
    expect(chips).not.toContain('House')
    expect(plate).toContain('Apartment')
  })

  it('keeps the active subcategory even at 0, so it can be cleared', () => {
    expect(offeredSubcategories('rentals', facets, {}, 'house-rental').subs.map((s) => s.slug)).toContain('house-rental')
  })

  it('with no counts yet it offers everything (no evidence, no guessing)', () => {
    expect(offeredSubcategories('rentals', undefined, {}, 'all').subs.length).toBeGreaterThan(4)
  })
})
