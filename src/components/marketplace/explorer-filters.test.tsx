// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { CurrencyProvider } from '@/context/currency-context'
import { LanguageProvider, useLanguage, type Language } from '@/context/language-context'
import { ExplorerFilters } from './explorer-filters'
import { DISTRICTS, DISTRICTS_PROVINCE_CODE, allDistrictsLabel, districtOptionLabel, districtOptionsFor } from './listings-explorer.constants'
import { districtScopeForSlug } from '@/lib/district-slug'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: unknown) => w }))

/**
 * ⛔ THE DEFAULT VIEW SAID "All HCMC" WHILE SHOWING EVERY CITY.
 *
 * The district picker's `all` option is "no district scope" — districtScopeForSlug('all') is null,
 * so nothing narrows by city — and once Hà Nội / Đà Nẵng rentals are imported they appear in that
 * view. The label must say what the filter does; the value must not change.
 *
 * ⚠️ Same harness notes as facet-bar.test.tsx: explicit cleanup (no vitest globals), language set
 * through setLang (jsdom's localStorage has no setItem here), fetch stubbed for the currency provider.
 */
afterEach(cleanup)

function LangSwitch({ to }: { to: Language }) {
  const { lang, setLang } = useLanguage()
  React.useEffect(() => {
    if (lang !== to) setLang(to)
  }, [lang, to, setLang])
  return null
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as unknown as Response)))
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function renderFilters(lang: 'en' | 'vi', over: Partial<React.ComponentProps<typeof ExplorerFilters>> = {}) {
  return render(
    <LanguageProvider>
      <CurrencyProvider>
        <LangSwitch to={lang} />
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
}

describe('the district picker’s "all" option', () => {
  it('no longer claims HCMC when no city is selected (en)', async () => {
    renderFilters('en')
    expect(await screen.findByText('All cities')).toBeTruthy()
    expect(screen.queryByText('All HCMC')).toBeNull()
  })

  it('no longer claims HCMC when no city is selected (vi)', async () => {
    renderFilters('vi')
    expect(await screen.findByText('Tất cả thành phố')).toBeTruthy()
    expect(screen.queryByText('Toàn bộ HCMC')).toBeNull()
  })

  it('names the province when the area filter has one', async () => {
    renderFilters('en', { activeProvince: { code: '01', name: 'Hà Nội', nameEn: 'Ha Noi' } })
    expect(await screen.findByText('All of Ha Noi')).toBeTruthy()
  })

  it('names the province in Vietnamese too', async () => {
    renderFilters('vi', { activeProvince: { code: '48', name: 'Đà Nẵng', nameEn: 'Da Nang' } })
    expect(await screen.findByText('Toàn bộ Đà Nẵng')).toBeTruthy()
  })

  it('leaves every real district label as it was', () => {
    const d1 = DISTRICTS.find((d) => d.slug === 'd1')!
    expect(districtOptionLabel(d1, 'en', { name: 'Hà Nội', nameEn: 'Ha Noi' })).toBe('District 1')
    expect(districtOptionLabel(d1, 'vi', null)).toBe('Quận 1')
  })

  it('changes the label only — `all` is still the value and still applies no district scope', async () => {
    expect(DISTRICTS[0].slug).toBe('all')
    expect(DISTRICTS[0].match).toBeUndefined()
    expect(await districtScopeForSlug('all')).toBeNull()
    expect(allDistrictsLabel(null, 'en')).toBe(DISTRICTS[0].nameEn)
    expect(allDistrictsLabel(null, 'vi')).toBe(DISTRICTS[0].name)
  })
})

/**
 * ⛔ "All of Ha Noi" MUST NOT HEAD A LIST OF HCMC DISTRICTS. `DISTRICTS` is HCMC's list; under another
 * province picking one of them ANDs an HCMC district with that province — an empty feed (both
 * reviewers, 2026-09-24). Only `all` is offered there, plus a stale HCMC pick so it can be cleared.
 */
describe('which district options the picker offers', () => {
  const HN = { code: '01', name: 'Hà Nội', nameEn: 'Ha Noi' }
  const HCM = { code: DISTRICTS_PROVINCE_CODE, name: 'Hồ Chí Minh', nameEn: 'Ho Chi Minh' }

  it('offers every HCMC district with no province, or with HCMC', () => {
    expect(districtOptionsFor(null, 'all')).toEqual(DISTRICTS)
    expect(districtOptionsFor(HCM, 'all')).toEqual(DISTRICTS)
  })

  it('offers only `all` under another province', () => {
    expect(districtOptionsFor(HN, 'all').map((d) => d.slug)).toEqual(['all'])
  })

  it('keeps a stale HCMC pick visible under another province, so it can be cleared', () => {
    expect(districtOptionsFor(HN, 'd1').map((d) => d.slug)).toEqual(['all', 'd1'])
  })

  it('pins HCMC’s code to vn-units.json', async () => {
    const units = (await import('@/data/vn-units.json')).default as unknown as { code: string; name: string }[]
    const list = Array.isArray(units) ? units : (units as unknown as { provinces: { code: string; name: string }[] }).provinces
    expect(list.find((p) => p.code === DISTRICTS_PROVINCE_CODE)?.name).toBe('Hồ Chí Minh')
  })
})
