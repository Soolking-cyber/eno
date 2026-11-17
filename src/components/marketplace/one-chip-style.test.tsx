// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

import { LanguageProvider } from '@/context/language-context'
import { Collapsible } from '@/components/ui/collapsible'
import { PILL_BOX, PILL_ON, PILL_OPEN, PILL_OPEN_ATTR, PILL_REST } from '@/components/ui/chip-style'
import { CategoryRail } from './category-rail'
import { FacetBarFallback } from './facet-bar-fallback'
import { LadderCompactRow, ScopeChip, ScopeChipReserve } from './ladder-compact-row'
import { TrendingSearches } from './trending-searches'

vi.mock('next/link', () => ({
  default: ({ href, prefetch: _p, scroll: _s, ...rest }: { href: string; prefetch?: boolean; scroll?: boolean } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...rest} />,
}))

/**
 * ⛔ ONE CHIP STYLE ON THE BROWSE SURFACES (owner, 2026-10-18: "make it look super professional … like top marketplace").
 * Every chip there is ui/chip's `md`: a 36px pill with an invisible 44px hit area — white, a 1px line-strong hairline, ink
 * bold label, selected = the selected grey (`line-strong`, ink label) since 2026-11-17 (owner: "Grey everywhere"; the ink
 * fill of the 2026-11-14 redesign before) — the strip's pills (pinned in
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
    expect(PILL_BOX.split(' ')).toContain('font-bold')
    // White with a hairline at rest (owner-approved 2026-11-14 — it was the bare tint, "no border at rest").
    expect(PILL_REST.split(' ')).toEqual(expect.arrayContaining(['border', 'border-line-strong', 'bg-background', 'text-foreground']))
    expect(PILL_REST).not.toMatch(/bg-tint|ring/)
    // Selected = the selected grey, never ink (owner 2026-11-17, "Grey everywhere"): `line-strong` with no edge, the label
    // and glyph ink (`icon-own-ink`), forced-colours Highlight (`pill-on`), hover and press held on the same grey.
    expect(PILL_ON).toBe('pill-on border border-transparent bg-line-strong text-foreground hover:bg-line-strong active:bg-line-strong icon-own-ink')
    expect(PILL_ON).not.toMatch(/bg-foreground|text-background/)
    // A resting pill's glyph keeps the label's colour too.
    expect(PILL_REST.split(' ')).toContain('icon-own-ink')
    expect(PILL_OPEN.split(' ')).toEqual(expect.arrayContaining(['bg-muted', 'border', 'border-line-strong']))
    expect(PILL_OPEN_ATTR.split(' ')).toEqual(expect.arrayContaining(['data-popup-open:bg-muted', 'data-popup-open:border-line-strong']))
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
      // Pressed = the selected grey, ink label (owner 2026-11-17, "Grey everywhere" — it was the ink fill).
      expect(tokens(chip)).toEqual(expect.arrayContaining(['min-h-9', 'rounded-full', 'relative', 'tap-44', 'bg-background', 'border-line-strong', 'data-pressed:border-transparent', 'data-pressed:bg-line-strong', 'data-pressed:text-foreground', 'icon-own-ink']))
      expect(tokens(chip)).not.toContain('data-pressed:bg-foreground')
      expect(tokens(chip)).not.toContain('min-h-11')
    }
    expect(tokens(row)).toEqual(expect.arrayContaining(['-my-1', 'py-1']))
    const scope = document.querySelector('[data-slot="ladder-compact-row"] > button')!
    // The folded ladder's pill names what is chosen, so it wears the chosen look: PILL_ON's selected grey (owner 2026-11-17,
    // "Grey everywhere" — the ink fill from 2026-11-14).
    expect(tokens(scope)).toEqual(expect.arrayContaining(['min-h-9', 'rounded-full', 'relative', 'tap-44', 'pill-on', 'bg-line-strong', 'text-foreground', 'icon-own-ink']))
    expect(tokens(scope)).not.toContain('bg-foreground')
    expect(tokens(scope)).not.toContain('text-background')
  })

  it('⛔ the goods search\'s scope chip (owner-approved 2026-11-14, cook r06 goods): a plain white chip with words and a chevron — no grid glyph, no ink fill', () => {
    render(
      <LanguageProvider>
        <Collapsible>
          <ScopeChip expanded={false} />
          <ScopeChipReserve />
        </Collapsible>
      </LanguageProvider>,
    )
    const chip = screen.getByRole('button', { name: /All categories|Tất cả danh mục/ })
    expect(chip.hasAttribute('data-scope-chip')).toBe(true)
    expect(chip.getAttribute('aria-expanded')).toBe('false')
    expect(tokens(chip)).toEqual(expect.arrayContaining(['min-h-9', 'rounded-full', 'relative', 'tap-44', 'bg-background', 'border-line-strong', 'text-foreground', 'shrink-0', 'gap-1.5']))
    expect(tokens(chip)).not.toContain('bg-foreground')
    expect(chip.querySelectorAll('svg')).toHaveLength(1) // the chevron alone
    // The cold-link reserve: the SAME box (its classes, words and chevron), invisible and never focusable.
    const reserve = document.querySelector('.scope-chip-reserve')!
    expect(reserve.tagName).toBe('SPAN')
    expect(reserve.getAttribute('aria-hidden')).toBe('true')
    expect(tokens(reserve).filter((t) => t !== 'scope-chip-reserve').sort()).toEqual(tokens(chip).sort())
    expect(reserve.textContent).toBe(chip.textContent)
  })

  it('the category rail\'s subcategory plate: a grey well, three rows on a phone, the pick a flat white segment with an ink label — no raised `shadow-sm` plate (owner 2026-11-17, "Grey everywhere" / "3 rows")', () => {
    render(
      <LanguageProvider>
        <CategoryRail categories={cats} activeCategory="rentals" activeSubcategory="all" subcategoryCounts={{}} onCategory={() => {}} onSubcategory={() => {}} />
      </LanguageProvider>,
    )
    const plate = screen.getByRole('group', { name: /Subcategories|Danh mục con/ })
    // The well is the field grey (ui/chip-style WELL — it was the brand tint), three rows below 640px in the model panel's box.
    expect(tokens(plate)).toEqual(expect.arrayContaining(['bg-muted', 'max-sm:[grid-template-rows:repeat(3,min-content)]', 'max-sm:min-h-[6.25rem]']))
    expect(tokens(plate)).not.toContain('bg-brand-50')
    expect(tokens(plate).join(' ')).not.toMatch(/max-sm:gap-y-0|max-sm:py-0\.5|repeat\(2,/)
    const all = within(plate).getAllByRole('button').find((b) => b.getAttribute('aria-pressed') === 'true')!
    // The pick: WELL_PICK — ui/segmented's canvas-white pill WITH its shadow on the well (white on the field grey alone is ~1.1:1,
    // no visible pick — review 2026-11-17; mock r14 B, the one the owner chose), the label ink (it was accent ink), one step up
    // and no shadow in dark.
    expect(tokens(all)).toEqual(expect.arrayContaining(['rounded-full', 'bg-background', 'shadow-sm', 'text-foreground', 'dark:bg-line-strong', 'dark:shadow-none']))
    expect(tokens(all)).not.toContain('text-accent-foreground')
    // ⚠️ Still a 28px row (`py-1`): the plate's six-row cap is measured against the tile rail's height.
    expect(tokens(all)).toContain('py-1')
  })

  it('the search panel\'s trending chips', () => {
    render(<LanguageProvider><TrendingSearches items={['iphone 15', 'honda vision']} onPick={() => {}} /></LanguageProvider>)
    for (const chip of screen.getAllByRole('button')) {
      expect(tokens(chip)).toEqual(expect.arrayContaining(['min-h-9', 'rounded-full', 'relative', 'tap-44', 'bg-background', 'border-line-strong']))
      expect(tokens(chip)).not.toContain('rounded-xl')
      expect(tokens(chip)).not.toContain('bg-tint') // one background, never two (chipVariants' md compound)
    }
  })

  it('the server\'s picture of the facet row: the same 36px tinted pills, in a row with the same hit-area room', () => {
    render(<LanguageProvider><FacetBarFallback /></LanguageProvider>)
    const row = document.querySelector('[inert] > div')!
    expect(tokens(row)).toEqual(expect.arrayContaining(['-my-1', 'py-1']))
    const pills = Array.from(row.querySelectorAll(':scope > div > span'))
    expect(pills).toHaveLength(4)
    for (const pill of pills) {
      expect(tokens(pill)).toEqual(expect.arrayContaining(['min-h-9', 'rounded-full', 'px-3.5', 'bg-background', 'border-line-strong']))
      expect(tokens(pill)).not.toContain('min-h-11')
    }
    // Content-sized at every width: no desktop floor left a tinted run between label and ⌄.
    for (const wrap of Array.from(row.querySelectorAll(':scope > div'))) expect(tokens(wrap)).not.toContain('lg:min-w-[7.5rem]')
  })
})
