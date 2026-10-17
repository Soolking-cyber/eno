// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

import { LanguageProvider } from '@/context/language-context'
import { Collapsible } from '@/components/ui/collapsible'
import { PILL_BOX, PILL_ON, PILL_OPEN, PILL_OPEN_ATTR, PILL_REST } from '@/components/ui/chip-style'
import { CategoryRail } from './category-rail'
import { FacetBarFallback } from './facet-bar-fallback'
import { LadderCompactRow } from './ladder-compact-row'
import { TrendingSearches } from './trending-searches'

vi.mock('next/link', () => ({
  default: ({ href, prefetch: _p, scroll: _s, ...rest }: { href: string; prefetch?: boolean; scroll?: boolean } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...rest} />,
}))

/**
 * ⛔ ONE CHIP STYLE ON THE BROWSE SURFACES (owner, 2026-10-18: "make it look super professional … like top marketplace").
 * Every chip there is ui/chip's `md`: a 36px tinted pill with an invisible 44px hit area — the strip's pills (pinned in
 * explorer-toolbar.test.tsx, touch-targets.test.tsx and seller-listings.test.tsx), and here the other rows: the phone's
 * compact ladder, the category rail's subcategory plate, the search panel's trending chips and the server's picture of
 * the facet row. jsdom lays nothing out, so the classes that make the geometry are what is pinned.
 * ⚠️ EXPLICIT CLEANUP — no vitest `globals`.
 */
afterEach(cleanup)
;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
HTMLElement.prototype.scrollTo = () => {}

const tokens = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/)
const cats = ['rentals', 'electronics', 'vehicles'].map((slug) => ({ id: slug, slug, name: slug, nameVi: slug, icon: 'Car', verifiedCount: 10 })) as unknown as React.ComponentProps<typeof CategoryRail>['categories']

describe('the recipe (ui/chip-style.ts)', () => {
  it('a 36px pill, an invisible 44px hit area that carries its own `relative`, and the three looks', () => {
    expect(PILL_BOX.split(' ')).toEqual(expect.arrayContaining(['min-h-9', 'rounded-full', 'px-3.5', 'text-sm', 'relative', 'tap-44']))
    expect(PILL_REST.split(' ')).toEqual(expect.arrayContaining(['bg-tint', 'text-body']))
    expect(PILL_REST).not.toMatch(/border|ring/) // no border at rest
    expect(PILL_ON).toBe('bg-brand-50 text-accent-foreground')
    expect(PILL_OPEN).toContain('bg-muted')
    expect(PILL_OPEN_ATTR).toContain('data-popup-open:bg-muted')
  })
})

describe('the other chip rows wear it', () => {
  it('the phone\'s compact ladder: 36px pills with a 44px hit area, and a scroller that leaves it room', () => {
    render(
      <LanguageProvider>
        <Collapsible>
          <LadderCompactRow categories={cats} activeCategory="all" activeSubcategory="all" onCategory={() => {}} onSubcategory={() => {}} expanded={false} />
        </Collapsible>
      </LanguageProvider>,
    )
    const row = screen.getByRole('group', { name: /Categories|Danh mục/ })
    for (const chip of within(row).getAllByRole('button')) {
      expect(tokens(chip)).toEqual(expect.arrayContaining(['min-h-9', 'rounded-full', 'relative', 'tap-44', 'bg-tint', 'data-pressed:bg-brand-50']))
      expect(tokens(chip)).not.toContain('min-h-11')
    }
    expect(tokens(row)).toEqual(expect.arrayContaining(['-my-1', 'py-1']))
    const scope = document.querySelector('[data-slot="ladder-compact-row"] > button')!
    expect(tokens(scope)).toEqual(expect.arrayContaining(['min-h-9', 'relative', 'tap-44', 'bg-brand-50']))
  })

  it('the category rail\'s subcategory plate: a flat pill when chosen — no raised `shadow-sm` plate', () => {
    render(
      <LanguageProvider>
        <CategoryRail categories={cats} activeCategory="rentals" activeSubcategory="all" subcategoryCounts={{}} onCategory={() => {}} onSubcategory={() => {}} />
      </LanguageProvider>,
    )
    const plate = screen.getByRole('group', { name: /Subcategories|Danh mục con/ })
    const all = within(plate).getAllByRole('button').find((b) => b.getAttribute('aria-pressed') === 'true')!
    expect(tokens(all)).toEqual(expect.arrayContaining(['rounded-full', 'bg-card', 'text-accent-foreground']))
    expect(tokens(all)).not.toContain('shadow-sm')
    // ⚠️ Still a 28px row (`py-1`): the plate's six-row cap is measured against the tile rail's height.
    expect(tokens(all)).toContain('py-1')
  })

  it('the search panel\'s trending chips', () => {
    render(<LanguageProvider><TrendingSearches items={['iphone 15', 'honda vision']} onPick={() => {}} /></LanguageProvider>)
    for (const chip of screen.getAllByRole('button')) {
      expect(tokens(chip)).toEqual(expect.arrayContaining(['min-h-9', 'rounded-full', 'relative', 'tap-44', 'bg-tint']))
      expect(tokens(chip)).not.toContain('rounded-xl')
    }
  })

  it('the server\'s picture of the facet row: the same 36px tinted pills, in a row with the same hit-area room', () => {
    render(<LanguageProvider><FacetBarFallback /></LanguageProvider>)
    const row = document.querySelector('[inert] > div')!
    expect(tokens(row)).toEqual(expect.arrayContaining(['-my-1', 'py-1']))
    const pills = Array.from(row.querySelectorAll(':scope > div > span'))
    expect(pills).toHaveLength(4)
    for (const pill of pills) {
      expect(tokens(pill)).toEqual(expect.arrayContaining(['min-h-9', 'rounded-full', 'px-3.5', 'bg-tint']))
      expect(tokens(pill)).not.toContain('min-h-11')
    }
    // Content-sized at every width: no desktop floor left a tinted run between label and ⌄.
    for (const wrap of Array.from(row.querySelectorAll(':scope > div'))) expect(tokens(wrap)).not.toContain('lg:min-w-[7.5rem]')
  })
})
