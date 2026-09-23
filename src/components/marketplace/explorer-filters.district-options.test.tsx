// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

import { CurrencyProvider } from '@/context/currency-context'
import { LanguageProvider } from '@/context/language-context'
import { ExplorerFilters } from './explorer-filters'

/**
 * The picker's WIRING to districtOptionsFor() — the options it actually hands its select. The select
 * is replaced by a recorder: Base UI renders its options only while open, and the question here is
 * which options the filter panel offers, not how the menu draws them. explorer-filters.test.tsx
 * covers the rendered labels and the pure rule.
 */
const seen = vi.hoisted(() => ({ calls: [] as { label?: string; options: { value: string; label: string }[] }[] }))
vi.mock('./custom-select', () => ({
  CustomSelect: (props: { label?: string; options: { value: string; label: string }[] }) => {
    seen.calls.push({ label: props.label, options: props.options })
    return null
  },
}))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: unknown) => w }))

afterEach(cleanup)
beforeEach(() => {
  seen.calls = []
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as unknown as Response)))
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function districtOptions(over: Partial<React.ComponentProps<typeof ExplorerFilters>>) {
  render(
    <LanguageProvider>
      <CurrencyProvider>
        <ExplorerFilters
          categories={[]}
          activeCategory="all"
          handleCategorySelect={vi.fn()}
          activeSubcategory="all"
          verifiedOnly={false}
          setVerifiedOnly={vi.fn()}
          activeDistrict="all"
          setActiveDistrict={vi.fn()}
          conditionFilter="all"
          setConditionFilter={vi.fn()}
          customFilters={{}}
          setCustomFilters={vi.fn()}
          {...over}
        />
      </CurrencyProvider>
    </LanguageProvider>,
  )
  const call = seen.calls.filter((c) => c.label === 'District / Commune').at(-1)
  if (!call) throw new Error('the district select was not rendered')
  return call.options.map((o) => o.value)
}

describe('the district picker under the area filter’s province', () => {
  it('offers HCMC’s districts with no province chosen', () => {
    expect(districtOptions({})).toContain('d1')
  })

  it('offers HCMC’s districts under HCMC', () => {
    expect(districtOptions({ activeProvince: { code: '79', name: 'Hồ Chí Minh', nameEn: 'Ho Chi Minh' } })).toContain('d1')
  })

  it('offers only "all" under Hà Nội — no HCMC district under "All of Ha Noi"', () => {
    expect(districtOptions({ activeProvince: { code: '01', name: 'Hà Nội', nameEn: 'Ha Noi' } })).toEqual(['all'])
  })

  it('keeps a stale HCMC pick visible under Đà Nẵng so it can be cleared', () => {
    expect(districtOptions({ activeProvince: { code: '48', name: 'Đà Nẵng', nameEn: 'Da Nang' }, activeDistrict: 'd3' })).toEqual(['all', 'd3'])
  })
})
