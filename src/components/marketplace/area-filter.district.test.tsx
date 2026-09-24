// @vitest-environment jsdom
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { CurrencyProvider } from '@/context/currency-context'
import { LanguageProvider, useLanguage, type Language } from '@/context/language-context'
import { AreaFilter, type Geo, type Nearby } from './area-filter'
import { FacetBar, type FacetBarProps } from './facet-bar'
import {
  DISTRICTS, DISTRICTS_PROVINCE_CODE, allDistrictsLabel, districtOptionLabel, districtOptionsFor, districtSlugLabel, districtSurvivesArea,
} from './listings-explorer.constants'
import { districtScopeForSlug } from '@/lib/district-slug'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: unknown) => w }))

/**
 * ⛔ "still cant search by district" (owner, 2026-09-24). The one district picker in the app sat in a
 * filters drawer that nothing could open (its only opener was a window event nobody dispatched), and
 * the Area panel offered province → ward only. The Area panel now carries the district list, on every
 * screen size. These pin that a reader can reach it, that one tap applies it, and what it replaces.
 *
 * ⚠️ Harness notes as in facet-bar.test.tsx: explicit cleanup (no vitest globals), the language set
 * through setLang, fetch stubbed. /api/geo answers here because the panel fetches provinces and
 * wards the moment it opens.
 */
afterEach(cleanup)

function LangSwitch({ to }: { to: Language }) {
  const { lang, setLang } = useLanguage()
  React.useEffect(() => {
    if (lang !== to) setLang(to)
  }, [lang, to, setLang])
  return null
}

const HCM: Geo = { code: DISTRICTS_PROVINCE_CODE, name: 'Hồ Chí Minh', nameEn: 'Ho Chi Minh' }
const HN: Geo = { code: '01', name: 'Hà Nội', nameEn: 'Ha Noi' }
const TAN_HUNG: Geo = { code: '26734', name: 'Tân Hưng', nameEn: 'Tan Hung' }

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const body = String(url).includes('type=provinces')
      ? { provinces: [HCM, HN] }
      : String(url).includes('type=wards')
        ? { wards: [TAN_HUNG] }
        : {}
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as unknown as Response)
  }))
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function renderIn(lang: Language, ui: React.ReactNode) {
  return render(
    <LanguageProvider>
      <CurrencyProvider>
        <LangSwitch to={lang} />
        {ui}
      </CurrencyProvider>
    </LanguageProvider>,
  )
}

type AreaProps = React.ComponentProps<typeof AreaFilter>
function area(over: Partial<AreaProps> = {}): AreaProps {
  return {
    open: true, onClose: vi.fn(), province: null, ward: null, nearby: null,
    onApply: vi.fn(), onReset: vi.fn(), district: 'all', onPickDistrict: vi.fn(), ...over,
  }
}

const districtGroup = (name: RegExp | string) => screen.findByRole('group', { name })

describe('the Area panel’s district list', () => {
  it('is there with no province chosen — every curated HCMC district, in English', async () => {
    renderIn('en', <AreaFilter {...area()} />)
    const group = await districtGroup('District (Quận/Huyện)')
    for (const label of ['District 1', 'District 7 (Phu My Hung)', 'Thu Duc City', 'Binh Thanh District']) {
      expect(within(group).getByRole('button', { name: label })).toBeTruthy()
    }
    // Every curated district, and no "all" chip (see the next tests).
    expect(within(group).getAllByRole('button')).toHaveLength(DISTRICTS.length - 1)
  })

  it('speaks Vietnamese in Vietnamese', async () => {
    renderIn('vi', <AreaFilter {...area()} />)
    const group = await districtGroup('Quận / Huyện')
    expect(within(group).getByRole('button', { name: 'Quận 7 (Phú Mỹ Hưng)' })).toBeTruthy()
    expect(within(group).getByRole('button', { name: 'Bình Thạnh' })).toBeTruthy()
  })

  /**
   * ⚠️ NO "ALL" CHIP: it would sit pressed whenever nothing is picked, and its label had to name a
   * province — the APPLIED one ("All of Ha Noi") under a list drawn for the DRAFT one (all three
   * reviewers, 2026-09-24).
   */
  it('has no "all" chip, and nothing is pressed until a district is picked — whatever province is applied', async () => {
    const user = userEvent.setup()
    renderIn('en', <AreaFilter {...area({ province: HN })} />)
    // Hà Nội applied: the list is hidden until the draft province is switched back to HCMC.
    await screen.findByRole('dialog', { name: 'Choose area' })
    expect(screen.queryByRole('group', { name: 'District (Quận/Huyện)' })).toBeNull()
    await user.click(await screen.findByRole('combobox', { name: 'Province / City' }))
    await user.click(await screen.findByRole('option', { name: 'Ho Chi Minh' }))
    const group = await districtGroup('District (Quận/Huyện)')
    expect(within(group).queryByRole('button', { name: /All/ })).toBeNull()
    expect(within(group).getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(0)
  }, 20_000)

  it('one tap APPLIES the district and closes the panel — no Apply press needed', async () => {
    const onPickDistrict = vi.fn()
    const onClose = vi.fn()
    const user = userEvent.setup()
    renderIn('en', <AreaFilter {...area({ onPickDistrict, onClose })} />)
    await user.click(within(await districtGroup('District (Quận/Huyện)')).getByRole('button', { name: 'District 7 (Phu My Hung)' }))
    expect(onPickDistrict).toHaveBeenCalledWith('d7')
    expect(onClose).toHaveBeenCalled()
  })

  it('shows the applied district as pressed, and pressing it again drops it', async () => {
    const onPickDistrict = vi.fn()
    const user = userEvent.setup()
    renderIn('en', <AreaFilter {...area({ district: 'binh-thanh', onPickDistrict })} />)
    const picked = within(await districtGroup('District (Quận/Huyện)')).getByRole('button', { name: 'Binh Thanh District' })
    expect(picked.getAttribute('aria-pressed')).toBe('true')
    expect(within(await districtGroup('District (Quận/Huyện)')).getByRole('button', { name: 'District 1' }).getAttribute('aria-pressed')).toBe('false')
    await user.click(picked)
    expect(onPickDistrict).toHaveBeenCalledWith('all')
  })

  /**
   * ⚠️ TOGGLE BUTTONS, NOT RADIOS: a Base UI radio selects on arrow-key FOCUS, and a pick here applies
   * and closes — arrowing through the list would apply the first district passed.
   */
  /** A /c/<category>/<district> landing slug is a real pick outside DISTRICTS (opus). */
  it('shows a landing-page district as pressed at the head of the list, and pressing it drops it', async () => {
    const onPickDistrict = vi.fn()
    const user = userEvent.setup()
    renderIn('en', <AreaFilter {...area({ district: 'quan-7', onPickDistrict })} />)
    const group = await districtGroup('District (Quận/Huyện)')
    const landing = within(group).getAllByRole('button')[0]
    expect(landing.textContent).toBe('Quan 7')
    expect(landing.getAttribute('aria-pressed')).toBe('true')
    await user.click(landing)
    expect(onPickDistrict).toHaveBeenCalledWith('all')
  })

  it('is a group of pressable buttons, not a radio group that selects on focus', async () => {
    renderIn('en', <AreaFilter {...area()} />)
    await districtGroup('District (Quận/Huyện)')
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })

  it('is not drawn when the parent cannot apply a district, or in the post wizard’s picker', async () => {
    renderIn('en', <AreaFilter {...area({ onPickDistrict: undefined })} />)
    await screen.findByRole('dialog', { name: 'Choose area' })
    expect(screen.queryByRole('group', { name: 'District (Quận/Huyện)' })).toBeNull()
    cleanup()
    renderIn('en', <AreaFilter {...area({ mode: 'pick' })} />)
    await screen.findByRole('dialog', { name: 'Choose area' })
    expect(screen.queryByRole('group', { name: 'District (Quận/Huyện)' })).toBeNull()
  })

  it('is not drawn under another province — DISTRICTS is HCMC’s list', async () => {
    renderIn('en', <AreaFilter {...area({ province: HN })} />)
    await screen.findByRole('dialog', { name: 'Choose area' })
    expect(screen.queryByRole('group', { name: 'District (Quận/Huyện)' })).toBeNull()
  })

  it('Apply no longer carries a district of its own — the list applies itself', async () => {
    const onApply = vi.fn()
    const user = userEvent.setup()
    renderIn('en', <AreaFilter {...area({ onApply, district: 'd7' })} />)
    await user.click(await screen.findByRole('button', { name: 'Apply' }))
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply.mock.calls[0][0]).not.toHaveProperty('district')
  })
})

/* ── the facet bar applies the list, and a place replaces a place ─────────────────────────────── */

function bar(over: Partial<FacetBarProps> = {}): FacetBarProps {
  return {
    activeCategory: 'rentals', activeSubcategory: 'all', setActiveSubcategory: vi.fn(),
    province: null, setProvince: vi.fn(), ward: null, setWard: vi.fn(), nearby: null, setNearby: vi.fn(),
    district: 'all', setDistrict: vi.fn(),
    priceRange: 'all', setPriceRange: vi.fn(), conditionFilter: 'all', setConditionFilter: vi.fn(),
    listingType: 'all', setListingType: vi.fn(), customFilters: {}, setCustomFilters: vi.fn(),
    verifiedOnly: true, setVerifiedOnly: vi.fn(), histogramQuery: 'category=rentals', ...over,
  }
}

const NEAR: Nearby = { lat: 10.73, lng: 106.72, radiusKm: 3 }

describe('FacetBar — the district from the Area panel', () => {
  it('the Area pill names the applied district, on either language', async () => {
    renderIn('en', <FacetBar {...bar({ district: 'd7' })} />)
    expect(await screen.findByRole('button', { name: /District 7 \(Phu My Hung\)/ })).toBeTruthy()
    cleanup()
    renderIn('vi', <FacetBar {...bar({ district: 'quan-7' })} />)
    // A /c/<category>/<district> landing slug is not in DISTRICTS; it still reads as a place.
    expect(await screen.findByRole('button', { name: /Quan 7/ })).toBeTruthy()
  })

  it('picking a district applies it and drops the ward and the radius it replaces', async () => {
    const p = bar({ ward: TAN_HUNG, nearby: NEAR, province: HCM })
    const user = userEvent.setup()
    renderIn('en', <FacetBar {...p} />)
    await user.click(screen.getByRole('button', { name: /Tan Hung/ }))
    await user.click(within(await districtGroup('District (Quận/Huyện)')).getByRole('button', { name: 'District 1' }))
    expect(p.setDistrict).toHaveBeenCalledWith('d1')
    expect(p.setWard).toHaveBeenCalledWith(null)
    expect(p.setNearby).toHaveBeenCalledWith(null)
    // HCMC contains the district, so the province stays.
    expect(p.setProvince).not.toHaveBeenCalled()
  })

  it('applying a ward drops the district — a Quận 1 ward AND Quận 7 is an empty feed', async () => {
    const p = bar({ district: 'd7', province: HCM })
    const user = userEvent.setup()
    renderIn('en', <FacetBar {...p} />)
    await user.click(screen.getByRole('button', { name: /District 7/ }))
    await screen.findByRole('dialog', { name: 'Choose area' })
    await waitFor(() => expect(screen.queryByText('Loading wards…')).toBeNull())
    await user.click(await screen.findByRole('combobox', { name: 'Ward / Commune' }))
    await user.click(await screen.findByRole('option', { name: 'Tan Hung' }))
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(p.setWard).toHaveBeenCalledWith(TAN_HUNG)
    expect(p.setDistrict).toHaveBeenCalledWith('all')
  }, 20_000)

  /** An Apply that re-sends the area already applied is not a new place (opus). */
  it('an Apply that changes nothing leaves the district — and any district typed into the box — alone', async () => {
    const p = bar({ nearby: NEAR })
    const user = userEvent.setup()
    renderIn('en', <FacetBar {...p} />)
    await user.click(screen.getByRole('button', { name: /Within 3 km/ }))
    await screen.findByRole('dialog', { name: 'Choose area' })
    await waitFor(() => expect(screen.queryByText('Loading wards…')).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(p.setNearby).toHaveBeenCalled()
    expect(p.setDistrict).not.toHaveBeenCalled()
  })

  it('applying HCMC alone keeps the district — the panel’s province defaults to HCMC', async () => {
    const p = bar({ district: 'd7' })
    const user = userEvent.setup()
    renderIn('en', <FacetBar {...p} />)
    await user.click(screen.getByRole('button', { name: /District 7/ }))
    await screen.findByRole('dialog', { name: 'Choose area' })
    await waitFor(() => expect(screen.queryByText('Loading wards…')).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(p.setDistrict).not.toHaveBeenCalled()
  })

  /** A picked district the applied place already contradicts (a landing slug under Hà Nội) is resolved by any Apply (opus). */
  it('an Apply resolves a picked district the applied province contradicts', async () => {
    const p = bar({ district: 'quan-7', province: HN })
    const user = userEvent.setup()
    renderIn('en', <FacetBar {...p} />)
    await user.click(screen.getByRole('button', { name: /Quan 7/ }))
    await screen.findByRole('dialog', { name: 'Choose area' })
    await waitFor(() => expect(screen.queryByText('Loading wards…')).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    expect(p.setDistrict).toHaveBeenCalledWith('all')
  }, 20_000)

  it('"Delete filter" and the bar’s "Clear" drop the district with the rest of the place', async () => {
    const p = bar({ district: 'd7' })
    const user = userEvent.setup()
    renderIn('en', <FacetBar {...p} />)
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(p.setDistrict).toHaveBeenCalledWith('all')
    ;(p.setDistrict as ReturnType<typeof vi.fn>).mockClear()
    await user.click(screen.getByRole('button', { name: /District 7/ }))
    await user.click(await screen.findByRole('button', { name: 'Delete filter' }))
    expect(p.setDistrict).toHaveBeenCalledWith('all')
  })
})

describe('districtSurvivesArea — which area picks keep a district', () => {
  it('HCMC alone, or nothing, keeps it', () => {
    expect(districtSurvivesArea({ province: null, ward: null, nearby: null })).toBe(true)
    expect(districtSurvivesArea({ province: HCM, ward: null, nearby: null })).toBe(true)
  })
  it('a ward, a radius or another province replaces it', () => {
    expect(districtSurvivesArea({ province: HCM, ward: TAN_HUNG, nearby: null })).toBe(false)
    expect(districtSurvivesArea({ province: null, ward: null, nearby: NEAR })).toBe(false)
    expect(districtSurvivesArea({ province: HN, ward: null, nearby: null })).toBe(false)
  })
})

/* ── the label and option helpers the list draws with (moved from the deleted drawer's suite) ─── */

/**
 * ⛔ THE DEFAULT VIEW SAID "All HCMC" WHILE SHOWING EVERY CITY. The `all` option is "no district
 * scope" — districtScopeForSlug('all') is null, so nothing narrows by city — and Hà Nội / Đà Nẵng
 * rentals appear in that view. The label must say what the filter does; the value must not change.
 */
describe('the district list’s labels and options', () => {
  it('labels real districts by name and `all` by what it does', () => {
    const d1 = DISTRICTS.find((d) => d.slug === 'd1')!
    expect(districtOptionLabel(d1, 'en', HN)).toBe('District 1')
    expect(districtOptionLabel(d1, 'vi', null)).toBe('Quận 1')
    expect(allDistrictsLabel(null, 'en')).toBe(DISTRICTS[0].nameEn)
    expect(allDistrictsLabel(null, 'vi')).toBe(DISTRICTS[0].name)
    expect(allDistrictsLabel(HN, 'en')).toBe('All of Ha Noi')
  })

  it('`all` is still the value and still applies no district scope', async () => {
    expect(DISTRICTS[0].slug).toBe('all')
    expect(DISTRICTS[0].match).toBeUndefined()
    expect(await districtScopeForSlug('all')).toBeNull()
  })

  it('offers every HCMC district with no province or HCMC, and only `all` (plus a stale pick) elsewhere', () => {
    expect(districtOptionsFor(null, 'all')).toEqual(DISTRICTS)
    expect(districtOptionsFor(HCM, 'all')).toEqual(DISTRICTS)
    expect(districtOptionsFor(HN, 'all').map((d) => d.slug)).toEqual(['all'])
    expect(districtOptionsFor(HN, 'd1').map((d) => d.slug)).toEqual(['all', 'd1'])
  })

  it('labels a landing slug outside DISTRICTS as a place, not a URL fragment', () => {
    expect(districtSlugLabel('thao-dien', 'en')).toBe('Thao Dien')
    expect(districtSlugLabel('d7', 'vi')).toBe('Quận 7 (Phú Mỹ Hưng)')
  })

  it('pins HCMC’s code to vn-units.json', async () => {
    const units = (await import('@/data/vn-units.json')).default as unknown as { code: string; name: string }[]
    const list = Array.isArray(units) ? units : (units as unknown as { provinces: { code: string; name: string }[] }).provinces
    expect(list.find((p) => p.code === DISTRICTS_PROVINCE_CODE)?.name).toBe('Hồ Chí Minh')
  })
})
