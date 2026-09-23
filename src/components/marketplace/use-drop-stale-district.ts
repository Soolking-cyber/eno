'use client'

import { useEffect, type Dispatch, type SetStateAction } from 'react'
import { districtAfterProvinceChange } from './listings-explorer.constants'

/**
 * Reset an HCMC district pick when the explorer's province moves to another province.
 *
 * ⚠️ ONE EFFECT ON THE PROVINCE, NOT A LINE IN EVERY SETTER. The province is set from four places in
 * listings-explorer.tsx — the facet bar's area filter, the header's `eno:set-area` event, a pending
 * area pick from sessionStorage, and a recent location — and a reset wired into one of them leaves
 * the other three producing the empty "Hà Nội AND District 1" feed. The rule is
 * districtAfterProvinceChange(); an unchanged value is returned as-is, so React bails out.
 */
export function useDropStaleDistrict(provinceCode: string | null | undefined, setActiveDistrict: Dispatch<SetStateAction<string>>) {
  useEffect(() => {
    setActiveDistrict((d) => districtAfterProvinceChange(provinceCode, d))
  }, [provinceCode, setActiveDistrict])
}
