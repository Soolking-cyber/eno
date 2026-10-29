import { describe, expect, it } from 'vitest'
import vnUnits from '@/data/vn-units.json'
import { groupHcmcWards, hcmcWardGroup } from './hcmc-ward-groups'

/**
 * HCMC's wards under the old district each grew out of (owner, 2026-10-29: "divide thu duc city into wards so we can select
 * specific area"). Measured against the stored dataset itself, so a dataset edit that moves a ward is read here first.
 */
type W = { code: string; name: string; nameEn: string }
const HCM = (vnUnits as { code: string; wards: W[] }[]).find((p) => p.code === '79')!.wards
const groupOf = (name: string) => hcmcWardGroup(HCM.find((w) => w.name === name)!.code)

describe('hcmcWardGroup', () => {
  it('puts exactly the twelve wards of former TP. Thủ Đức under "Thu Duc City"', () => {
    const thuDuc = HCM.filter((w) => hcmcWardGroup(w.code)?.en === 'Thu Duc City').map((w) => w.name).sort()
    expect(thuDuc).toEqual(['An Khánh', 'Bình Trưng', 'Cát Lái', 'Hiệp Bình', 'Linh Xuân', 'Long Bình', 'Long Phước', 'Long Trường', 'Phước Long', 'Thủ Đức', 'Tam Bình', 'Tăng Nhơn Phú'].sort())
  })
  it('names the other old districts as the district chips do, and the merged provinces as former ones', () => {
    expect(groupOf('Bến Thành')).toMatchObject({ vi: 'Quận 1', en: 'District 1' })
    expect(groupOf('Dĩ An')).toMatchObject({ en: 'Former Binh Duong' })
    expect(groupOf('Vũng Tàu')).toMatchObject({ en: 'Former Ba Ria–Vung Tau' })
    expect(groupOf('Côn Đảo')).toMatchObject({ en: 'Former Ba Ria–Vung Tau' })
  })
  it('gives every HCMC ward a heading', () => {
    expect(HCM.filter((w) => !hcmcWardGroup(w.code)).map((w) => w.name)).toEqual([])
  })
})

describe('groupHcmcWards', () => {
  it('returns every ward once, each heading as one consecutive run (the picker draws a run per heading)', () => {
    const out = groupHcmcWards('79', HCM)
    expect(out.map((w) => w.code).sort()).toEqual(HCM.map((w) => w.code).sort())
    const runs = out.map((w) => w.groupEn).filter((g, i, a) => g !== a[i - 1])
    expect(new Set(runs).size).toBe(runs.length)
  })
  it('leaves every other province exactly as stored', () => {
    const other = [{ code: '1', name: 'A', nameEn: 'A' }]
    expect(groupHcmcWards('01', other)).toBe(other)
  })
})
