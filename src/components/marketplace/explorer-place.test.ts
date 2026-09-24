import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { clearPlaceForTypedDistrict, queryAfterAreaPick, queryForExplicitDistrict, queryWithoutTypedDistrict } from './explorer-place'
import { DISTRICTS_PROVINCE_CODE } from './listings-explorer.constants'

/**
 * ⛔ A DISTRICT TYPED INTO THE BOX MUST REPLACE THE PLACE ALREADY PICKED (verifier, 2026-09-24). An
 * explicit `?district=` wins on the server, so from a /c/rentals/quan-7 page's "Refine in full search"
 * typing "Quận 1" answered 2,493 rows — every one of them in Quận 7.
 */
describe('clearPlaceForTypedDistrict — what a typed search does to the picked place', () => {
  const setters = () => ({ setDistrict: vi.fn(), setWard: vi.fn(), setNearby: vi.fn(), setProvince: vi.fn() })
  const provinceAfter = (s: ReturnType<typeof setters>, p: { code: string } | null) =>
    (s.setProvince.mock.calls[0][0] as (x: typeof p) => typeof p)(p)

  it('"Quận 1" clears the picked district, ward and radius', () => {
    const s = setters()
    expect(clearPlaceForTypedDistrict('Quận 1', s)).toBe(true)
    expect(s.setDistrict).toHaveBeenCalledWith('all')
    expect(s.setWard).toHaveBeenCalledWith(null)
    expect(s.setNearby).toHaveBeenCalledWith(null)
  })

  it('keeps HCMC — it contains the district — and drops any other province', () => {
    const s = setters()
    clearPlaceForTypedDistrict('căn hộ quận 7', s)
    expect(provinceAfter(s, { code: DISTRICTS_PROVINCE_CODE })).toEqual({ code: DISTRICTS_PROVINCE_CODE })
    expect(provinceAfter(s, { code: '01' })).toBeNull()
    expect(provinceAfter(s, null)).toBeNull()
  })

  /**
   * ⚠️ BESIDE PRODUCT WORDS THE READING MAY NOT HOLD (the feed may serve them as plain text), so only
   * the explicit district goes — it would strip the phrase on the server — and a province, ward or
   * radius the reader chose stays (codex).
   */
  it('"Hồi ức Phú Nhuận" (a book) drops the picked district but keeps the ward, radius and province', () => {
    const s = setters()
    expect(clearPlaceForTypedDistrict('Hồi ức Phú Nhuận', s)).toBe(true)
    expect(s.setDistrict).toHaveBeenCalledWith('all')
    expect(s.setWard).not.toHaveBeenCalled()
    expect(s.setNearby).not.toHaveBeenCalled()
    expect(s.setProvince).not.toHaveBeenCalled()
  })

  it('a bare district name or a housing search is a place search and replaces them all', () => {
    for (const q of ['Bình Thạnh', 'phòng trọ Phú Nhuận']) {
      const s = setters()
      clearPlaceForTypedDistrict(q, s)
      expect(s.setWard).toHaveBeenCalledWith(null)
    }
  })

  it.each(['iphone 7', 'Q7', 'pin sạc dự phòng Q3', ''])('%j names no district and leaves the place alone', (q) => {
    const s = setters()
    expect(clearPlaceForTypedDistrict(q, s)).toBe(false)
    for (const f of Object.values(s)) expect(f).not.toHaveBeenCalled()
  })
})

describe('queryWithoutTypedDistrict — what the box holds once an Area pick replaces a typed district', () => {
  it('removes the district the server applied, keeping the other words', () => {
    expect(queryWithoutTypedDistrict('căn hộ quận 7', 'd7')).toBe('căn hộ')
    expect(queryWithoutTypedDistrict('Quận 7', 'd7')).toBe('')
  })

  /** Across a deploy the server may read a district this parser does not: the words stay (opus). */
  it('leaves the words alone when this parser does not read the district the server applied', () => {
    expect(queryWithoutTypedDistrict('căn hộ quận 7', 'd3')).toBeNull()
    expect(queryWithoutTypedDistrict('something new', 'd3')).toBeNull()
  })

  /** The feed may serve a district-shaped query as plain words ("Hồi ức Phú Nhuận", a book). */
  it('leaves the words alone when the server applied no district from them', () => {
    expect(queryWithoutTypedDistrict('Hồi ức Phú Nhuận', null)).toBeNull()
    expect(queryWithoutTypedDistrict('iphone', null)).toBeNull()
  })
})

/**
 * ⛔ AN EXPLICIT DISTRICT MAKES THE SERVER STRIP ANY DISTRICT PHRASE FROM THE WORDS, so the box must
 * too — or the text chip claims words the server is not searching (opus, 2026-09-24).
 */
describe('queryAfterAreaPick — the box after an Area pick', () => {
  it('a picked district drops a typed place search’s phrase, and leaves a product title whole — as the server does', () => {
    expect(queryAfterAreaPick('Hồi ức Phú Nhuận', 'Hồi ức Phú Nhuận', 'd7', null)).toBe('Hồi ức Phú Nhuận')
    expect(queryAfterAreaPick('căn hộ quận 7', 'căn hộ quận 7', 'd1', 'd7')).toBe('căn hộ')
    expect(queryAfterAreaPick('Quận 7', 'Quận 7', 'd1', 'd7')).toBe('')
    expect(queryAfterAreaPick('iphone', 'iphone', 'd1', null)).toBe('iphone')
  })

  it('drops a numbered phrase beside product words too — the server strips it under the pick anyway', () => {
    expect(queryAfterAreaPick('iphone quận 7', 'iphone quận 7', 'd1', null)).toBe('iphone')
  })

  it('reads the LIVE box for a picked district — words typed inside the debounce window are stripped too', () => {
    expect(queryAfterAreaPick('căn hộ quận 7', '', 'd1', null)).toBe('căn hộ')
  })

  it('a ward or radius (district → all) drops only a district the server applied from the words', () => {
    expect(queryAfterAreaPick('căn hộ quận 7', 'căn hộ quận 7', 'all', 'd7')).toBe('căn hộ')
    expect(queryAfterAreaPick('Hồi ức Phú Nhuận', 'Hồi ức Phú Nhuận', 'all', null)).toBe('Hồi ức Phú Nhuận')
  })

  it('never overwrites newer typing with the words an older answer was for', () => {
    expect(queryAfterAreaPick('iphone', 'căn hộ quận 7', 'all', 'd7')).toBe('iphone')
  })
})

describe('queryForExplicitDistrict — a URL carrying ?district= and ?q= together', () => {
  it('shows the words the server searches under the explicit district', () => {
    expect(queryForExplicitDistrict('căn hộ quận 7', 'd1')).toBe('căn hộ')
    expect(queryForExplicitDistrict('Quận 7', 'quan-7')).toBe('')
  })
  it('leaves the words alone without an explicit district', () => {
    expect(queryForExplicitDistrict('căn hộ quận 7', null)).toBe('căn hộ quận 7')
    expect(queryForExplicitDistrict('căn hộ quận 7', 'all')).toBe('căn hộ quận 7')
    expect(queryForExplicitDistrict('iphone', 'd1')).toBe('iphone')
    expect(queryForExplicitDistrict('Hồi ức Phú Nhuận', 'd1')).toBe('Hồi ức Phú Nhuận') // a book title
    // A district NAME stays text under a pick, on the server too (strippedUnderExplicitDistrict).
    expect(queryForExplicitDistrict('căn hộ Bình Thạnh', 'd1')).toBe('căn hộ Bình Thạnh')
  })
})

/**
 * The explorer is a 3,500-line component with no mountable harness, so its WIRING to the rules above
 * is pinned at the source: each of these lines is what makes the behaviour reach the reader, and
 * deleting any one of them leaves every unit test above green while the bug is back.
 */
describe('listings-explorer.tsx wiring', () => {
  const src = readFileSync(join(__dirname, 'listings-explorer.tsx'), 'utf8')
  const landingSearch = src.slice(src.indexOf('const handleLandingSearch = useCallback'), src.indexOf('}, [saveSearchToHistory])'))

  it('a typed search runs the place rule', () => {
    expect(landingSearch).toContain('clearPlaceForTypedDistrict(trimmed, { setDistrict: setActiveDistrict, setWard: setActiveWard, setNearby, setProvince: setActiveProvince })')
  })

  it('the district chip is the SERVER’s answer, not a local parse', () => {
    expect(src).toContain('queryChips(debouncedQuery, serverInferredDistrict, lang)')
    expect(src).toMatch(/inferredDistrict\?: string \| null \}\)\.inferredDistrict \?\? null/)
  })

  it('the Area panel’s district pick goes through the replace rule, and never overwrites newer typing', () => {
    expect(src).toContain('setDistrict={pickDistrictFromArea}')
    expect(src).toContain('setQuery((live) => queryAfterAreaPick(live, debouncedQuery, slug, serverInferredDistrict))')
  })

  it('every other place-picking and word-committing path follows the same rules', () => {
    const visual = src.slice(src.indexOf('const applyVisualSearch = useCallback'), src.indexOf('}, [saveSearchToHistory, applyResolved])'))
    expect(visual).toContain('clearPlaceForTypedDistrict(q, {')
    // the header's area event, the pending area stash and the recent-location chips
    expect(src.match(/replaceDistrictRef\.current\('all'\)/g)).toHaveLength(3)
    expect(src).toContain("setQuery(queryForExplicitDistrict(params.get('q') || '', params.get('district')))")
  })

  it('there is no dead opener left: no drawer, no open-mobile-filters listener', () => {
    expect(src).not.toMatch(/addEventListener\('open-mobile-filters'/)
    expect(src).not.toContain('ExplorerFiltersDrawer')
  })
})
