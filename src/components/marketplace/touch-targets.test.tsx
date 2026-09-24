// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { CurrencyProvider } from '@/context/currency-context'
import { LanguageProvider } from '@/context/language-context'
import { Button } from '@/components/ui/button'
import { RemovableBadge } from '@/components/ui/badge'
import { ModelCascade } from './model-cascade'
import { MoreOverflow } from './more-overflow'
import { FacetBar, type FacetBarProps } from './facet-bar'
import { PriceRangeFilter } from './price-range-filter'
import { PricePresetChips } from './price-preset-chips'
import { ResultLine, type ResultFilter } from './result-line'
import { SearchSuggest } from './search-suggest'
import { ViewToggles } from './explorer-toolbar'

/**
 * TOUCH TARGETS ON THE HOME / SEARCH / FILTER SURFACES — the hit area has to be what the finger sees.
 *
 * jsdom has no layout, so these pin the CLASSES that make the geometry, and each one was measured on
 * a 390×844 phone before it was written down (the numbers are in each test's name or note). The
 * browser checks that took those measurements are the real acceptance; this file is what stops the
 * class from quietly going back.
 *
 *   · Where a hidden `tap-44` pseudo overlapped a NEIGHBOUR, it must be gone and the visible box
 *     must carry the size instead (model menu rows, line chips, the More chip).
 *   · Where a control was simply small, it must carry its min-height (Clear, Reset, Done, presets,
 *     Clear all, the Search-for row) or an extender that cannot reach a neighbour (the chip ✕,
 *     the view toggles at their exact 44px pitch).
 *
 * ⚠️ EXPLICIT CLEANUP — no vitest `globals`, so Testing Library registers no afterEach of its own.
 */
afterEach(cleanup)

beforeEach(() => {
  // Currency prefetches /api/fx and the price panel fetches its histogram; neither matters here.
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as unknown as Response)))
})
afterEach(() => { vi.unstubAllGlobals() })

const wrap = (ui: React.ReactNode) => render(<LanguageProvider><CurrencyProvider>{ui}</CurrencyProvider></LanguageProvider>)
const cls = (el: Element) => el.getAttribute('class') ?? ''
const tokens = (el: Element) => cls(el).split(/\s+/)

const APPLE_ROWS = [
  { model: 'iPhone 16 Pro Max', count: 9 },
  { model: 'iPhone 16 Pro', count: 7 },
  { model: 'iPhone 15', count: 5 },
  { model: 'iPhone 14 Pro Max', count: 3 },
  { model: 'iPad Air', count: 4 },
  { model: 'iPad Pro', count: 2 },
]

describe('model cascade — the visible row IS the hit area', () => {
  it('menu rows are 44px boxes with no tap-44 pseudo (a centre tap used to pick the NEXT model)', async () => {
    const user = userEvent.setup()
    wrap(<ModelCascade brandSlug="apple" rows={APPLE_ROWS} activeLine="" activeModel="all" onPick={vi.fn()} />)
    const group = screen.getByRole('group', { name: 'Product line' })
    await user.click(within(group).getByRole('button', { name: /iPhone/ }))
    const items = await screen.findAllByRole('menuitem')
    expect(items.length).toBeGreaterThan(2)
    for (const it of items) {
      expect(tokens(it)).not.toContain('tap-44')
      expect(tokens(it)).toContain('min-h-11')
    }
  })

  it('the menu is capped by the room the positioner measured, not 60vh alone (it ran to y=916 on an 844px screen)', async () => {
    const user = userEvent.setup()
    wrap(<ModelCascade brandSlug="apple" rows={APPLE_ROWS} activeLine="" activeModel="all" onPick={vi.fn()} />)
    await user.click(within(screen.getByRole('group', { name: 'Product line' })).getByRole('button', { name: /iPhone/ }))
    const menu = await screen.findByRole('menu')
    expect(tokens(menu)).toContain('max-h-[min(60vh,var(--available-height,60vh))]')
    expect(tokens(menu)).not.toContain('max-h-[60vh]')
  })

  it('line chips in the 3-row grid carry no tap-44 (it overlapped the chips above and below)', () => {
    wrap(<ModelCascade brandSlug="apple" rows={APPLE_ROWS} activeLine="" activeModel="all" onPick={vi.fn()} />)
    const chips = within(screen.getByRole('group', { name: 'Product line' })).getAllByRole('button')
    expect(chips.length).toBeGreaterThan(1)
    for (const c of chips) {
      expect(tokens(c)).not.toContain('tap-44')
      // Still the popover anchor: a press transform would move the menu.
      expect(tokens(c)).toContain('active:scale-100')
    }
  })

  it('the More chip that shares that grid carries no tap-44 either', () => {
    const row = (label: string) => <Button variant="bare" size="none" aria-label={label} />
    wrap(<MoreOverflow count={2}>{row('first')}{row('second')}</MoreOverflow>)
    const more = screen.getByRole('button', { name: /More/ })
    expect(tokens(more)).not.toContain('tap-44')
    expect(tokens(more)).toContain('active:scale-100')
  })
})

describe('applied-filter chip ✕', () => {
  it('grows a VERTICAL-only 44px hit area and answers a press', () => {
    wrap(<RemovableBadge label="District 7" removeLabel="Remove District 7" onRemove={vi.fn()} />)
    const x = screen.getByRole('button', { name: 'Remove District 7' })
    const t = tokens(x)
    // 24px box + 10px above and below = 44px tall, still 24px wide — cannot reach the next chip.
    expect(t).toEqual(expect.arrayContaining(['after:absolute', 'after:inset-x-0', 'after:-inset-y-2.5', "after:content-['']"]))
    expect(t).not.toContain('tap-44') // a centred 44×44 would reach sideways into the neighbour
    expect(t).toEqual(expect.arrayContaining(['active:scale-[0.9]', 'active:bg-brand-100', 'transition-[scale,background-color]']))
  })

  it('the chip scroller leaves room for that extender inside its clip, without moving the row', () => {
    const f = (id: string, label: string): ResultFilter => ({ id, label, onRemove: vi.fn() })
    wrap(<ResultLine count={12} filters={[f('district', 'District 7'), f('brand', 'Honda')]} onClearAll={vi.fn()} />)
    const list = screen.getByRole('list', { name: 'Filters' })
    expect(tokens(list)).toEqual(expect.arrayContaining(['py-2.5', '-my-2.5']))
  })
})

describe('the controls that commit or undo a filter are ≥ the size of what they act on', () => {
  it('facet bar "Clear" is 48px, like the pills it clears (was 39×16)', () => {
    const props: FacetBarProps = {
      activeCategory: 'electronics', activeSubcategory: 'all', setActiveSubcategory: vi.fn(),
      province: null, setProvince: vi.fn(), ward: null, setWard: vi.fn(), nearby: null, setNearby: vi.fn(),
      priceRange: 'all', setPriceRange: vi.fn(), conditionFilter: 'new', setConditionFilter: vi.fn(),
      listingType: 'all', setListingType: vi.fn(), customFilters: {}, setCustomFilters: vi.fn(),
      verifiedOnly: true, setVerifiedOnly: vi.fn(), histogramQuery: 'category=electronics',
    }
    wrap(<FacetBar {...props} />)
    const clear = screen.getByRole('button', { name: 'Clear' })
    expect(tokens(clear)).toEqual(expect.arrayContaining(['min-h-12', 'px-3', 'text-sm']))
  })

  it('price panel Reset and Done are 44px (were 34×16 and 63×28)', async () => {
    const user = userEvent.setup()
    wrap(<PriceRangeFilter value="all" onChange={vi.fn()} query="category=electronics" />)
    await user.click(screen.getAllByRole('button')[0])
    const panel = await screen.findByRole('dialog', { name: 'Price range' })
    const reset = await within(panel).findByRole('button', { name: 'Reset' })
    const done = within(panel).getByRole('button', { name: 'Done' })
    expect(tokens(reset)).toEqual(expect.arrayContaining(['min-h-11', '-ml-3', 'px-3']))
    expect(tokens(done)).toEqual(expect.arrayContaining(['min-h-11', 'px-5', 'text-sm']))
  })

  it('price presets are py-2 (were 26px tall)', () => {
    wrap(<PricePresetChips value="all" onChange={vi.fn()} />)
    const chips = screen.getAllByRole('button')
    expect(chips.length).toBeGreaterThan(0)
    for (const c of chips) {
      expect(tokens(c)).toContain('py-2')
      expect(tokens(c)).not.toContain('py-1')
    }
  })

  it('result line "Clear all" is 40px tall (was 64×24)', () => {
    const f = (id: string, label: string): ResultFilter => ({ id, label, onRemove: vi.fn() })
    wrap(<ResultLine count={12} filters={[f('district', 'District 7'), f('brand', 'Honda')]} onClearAll={vi.fn()} />)
    const clearAll = screen.getByRole('button', { name: 'Clear all' })
    expect(tokens(clearAll)).toEqual(expect.arrayContaining(['min-h-10', 'px-3']))
  })
})

describe('search suggestions', () => {
  it('the "Search for …" row is py-2.5 (≈40px, was 36px) and keeps its option wiring', () => {
    wrap(
      <SearchSuggest items={[{ type: 'query' }]} loading={false} query="honda" activeIndex={0} listboxId="sx" onPick={vi.fn()} onSubmitQuery={vi.fn()} />,
    )
    const row = screen.getByRole('option', { name: /Search for/ })
    expect(tokens(row)).toContain('py-2.5')
    expect(tokens(row)).not.toContain('py-2')
    expect(row.getAttribute('id')).toBeTruthy()
  })
})

describe('view toggles', () => {
  it('each toggle is positioned and carries tap-44 — at a 44px pitch the extenders abut, never overlap', () => {
    wrap(<ViewToggles viewMode="grid" onViewMode={vi.fn()} />)
    for (const name of ['List view', 'Grid view', 'Map view', 'Video view']) {
      const b = screen.getByRole('button', { name })
      // `relative` is the tap-44 contract (ui/button is not positioned); without it the pseudo
      // escapes to the nearest positioned ancestor.
      expect(tokens(b)).toEqual(expect.arrayContaining(['relative', 'tap-44', 'p-2.5']))
    }
  })
})
