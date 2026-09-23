// @vitest-environment jsdom
import { useState } from 'react'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { useDropStaleDistrict } from './use-drop-stale-district'
import { districtAfterProvinceChange } from './listings-explorer.constants'

/**
 * ⛔ PICK "District 1", THEN MOVE THE PROVINCE TO Hà Nội: THE FEED WAS EMPTY. `DISTRICTS` is HCMC's
 * list, so the stale pick ANDed an HCMC district with Hà Nội (both reviewers, 2026-09-24). The pick
 * must reset to `all` when the province leaves HCMC — from whichever path set it.
 */
function harness(initialDistrict: string, initialProvince: string | null) {
  return renderHook(() => {
    const [district, setDistrict] = useState(initialDistrict)
    const [province, setProvince] = useState<string | null>(initialProvince)
    useDropStaleDistrict(province, setDistrict)
    return { district, setDistrict, setProvince }
  })
}

describe('useDropStaleDistrict', () => {
  it('resets an HCMC district when the province moves to Hà Nội', () => {
    const h = harness('d1', null)
    expect(h.result.current.district).toBe('d1')
    act(() => h.result.current.setProvince('01'))
    expect(h.result.current.district).toBe('all')
  })

  it('keeps the district under HCMC, and with no province', () => {
    const h = harness('d1', '79')
    expect(h.result.current.district).toBe('d1')
    act(() => h.result.current.setProvince(null))
    expect(h.result.current.district).toBe('d1')
  })

  it('leaves a landing-page slug that is not an HCMC district alone', () => {
    const h = harness('thao-dien', null)
    act(() => h.result.current.setProvince('48'))
    expect(h.result.current.district).toBe('thao-dien')
  })
})

describe('districtAfterProvinceChange', () => {
  it('is the rule the hook applies', () => {
    expect(districtAfterProvinceChange('01', 'd1')).toBe('all')
    expect(districtAfterProvinceChange('79', 'd1')).toBe('d1')
    expect(districtAfterProvinceChange(null, 'd1')).toBe('d1')
    expect(districtAfterProvinceChange('01', 'all')).toBe('all')
    expect(districtAfterProvinceChange('01', 'quan-cau-giay')).toBe('quan-cau-giay')
  })
})

describe('the explorer wires it to its province', () => {
  it('calls useDropStaleDistrict with the active province code and its district setter', () => {
    const src = readFileSync('src/components/marketplace/listings-explorer.tsx', 'utf8')
    expect(src).toMatch(/useDropStaleDistrict\(activeProvince\?\.code \?\? null, setActiveDistrict\)/)
  })
})
