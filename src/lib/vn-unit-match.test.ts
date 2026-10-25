import { describe, expect, it } from 'vitest'
import vnUnits from '@/data/vn-units.json'
import { findUnit, resolveStoredArea } from './vn-unit-match'

describe('findUnit', () => {
  it('matches across diacritics, case and admin prefixes; squashed spellings too ("Hanoi", "Saigon")', () => {
    expect(findUnit(vnUnits, 'TP. Hồ Chí Minh')?.code).toBe('79')
    expect(findUnit(vnUnits, 'ho chi minh')?.code).toBe('79')
    expect(findUnit(vnUnits, 'Hanoi')?.code).toBe('01')
    const hcmc = vnUnits.find((p) => p.code === '79')!
    expect(findUnit(hcmc.wards, 'Saigon')?.name).toBe('Sài Gòn')
  })
  it('loose containment for geocoder candidates, never for a stored name (exact)', () => {
    expect(findUnit(vnUnits, 'Thành phố Hồ Chí Minh, Việt Nam')?.code).toBe('79')
    expect(findUnit(vnUnits, 'Thành phố Hồ Chí Minh, Việt Nam', { exact: true })).toBeUndefined()
    expect(findUnit(vnUnits, '')).toBeUndefined()
  })
})

/**
 * ⚠️ THE EDIT SCREEN'S AREA (sweep, 2026-10-22): the stored city/district reach the picker with their real codes, so it
 * opens on the listing's own place — a code-less seed opened it on Ho Chi Minh City and an untouched Apply moved the
 * listing there.
 */
describe('resolveStoredArea', () => {
  it('a Hà Nội listing opens on Hà Nội and its ward', () => {
    const hn = vnUnits.find((p) => p.code === '01')!
    const ward = hn.wards[0]
    expect(resolveStoredArea(vnUnits, 'Hà Nội', ward.name)).toEqual({
      province: { code: '01', name: 'Hà Nội', nameEn: 'Ha Noi' },
      ward: { code: ward.code, name: ward.name, nameEn: ward.nameEn },
    })
  })
  it('a name that matches nothing → null (the wizard keeps that name, code-less, as before)', () => {
    expect(resolveStoredArea(vnUnits, 'Hồ Chí Minh', 'Quận 12')).toMatchObject({ province: { code: '79' }, ward: null })
    expect(resolveStoredArea(vnUnits, 'Atlantis', 'Bến Thành')).toEqual({ province: null, ward: null })
    expect(resolveStoredArea(vnUnits, null, null)).toEqual({ province: null, ward: null })
  })
  it('⚠️ a stored DISTRICT never becomes the same-named new ward ("Quận Cầu Giấy" ≠ ward "Cầu Giấy")', () => {
    const hn = vnUnits.find((p) => p.code === '01')!
    expect(hn.wards.some((w) => w.name === 'Cầu Giấy')).toBe(true)
    expect(resolveStoredArea(vnUnits, 'Hà Nội', 'Cầu Giấy').ward?.name).toBe('Cầu Giấy')
    for (const d of ['Quận Cầu Giấy', 'quan cau giay', 'Q. Cầu Giấy', 'District 1', 'Q.1', 'Huyện Cần Giờ', 'Thành phố Thủ Đức', 'Thị trấn Củ Chi']) {
      expect(resolveStoredArea(vnUnits, 'Hồ Chí Minh', d).ward, d).toBeNull()
      expect(resolveStoredArea(vnUnits, 'Hà Nội', d).ward, d).toBeNull()
    }
  })
  it('…but a real ward whose name reads like a district prefix still resolves by its literal name ("Quan Triều")', () => {
    expect(resolveStoredArea(vnUnits, 'Thái Nguyên', 'Quan Triều').ward?.name).toBe('Quan Triều')
    expect(resolveStoredArea(vnUnits, 'Lạng Sơn', 'Quan Sơn').ward?.name).toBe('Quan Sơn')
  })
  it('diacritic-only twins resolve by their literal name, and a folded name that fits both resolves to neither', () => {
    expect(resolveStoredArea(vnUnits, 'Hồ Chí Minh', 'Thạnh An').ward?.name).toBe('Thạnh An')
    expect(resolveStoredArea(vnUnits, 'Hồ Chí Minh', 'Thanh An').ward?.name).toBe('Thanh An')
    expect(resolveStoredArea(vnUnits, 'Hồ Chí Minh', 'thanh an').ward?.name).toBe('Thanh An')
    expect(resolveStoredArea(vnUnits, 'Hồ Chí Minh', 'THANH AN').ward?.name).toBe('Thanh An')
    expect(resolveStoredArea(vnUnits, 'Hồ Chí Minh', 'Phường Thanh An').ward).toBeNull()
    // Whatever order the twins come in: nameEn ("Thanh An" for both) never decides the literal pass.
    const hcmc = vnUnits.find((p) => p.code === '79')!
    const reversed = [{ ...hcmc, wards: [...hcmc.wards].reverse() }]
    expect(resolveStoredArea(reversed, 'Hồ Chí Minh', 'Thanh An').ward?.name).toBe('Thanh An')
    expect(resolveStoredArea(reversed, 'Hồ Chí Minh', 'Thạnh An').ward?.name).toBe('Thạnh An')
  })
  it('a ward is looked up only inside its own province', () => {
    const hcmc = vnUnits.find((p) => p.code === '79')!
    const hcmcOnly = hcmc.wards.find((w) => !vnUnits.some((p) => p.code !== '79' && p.wards.some((x) => x.name === w.name)))!
    expect(resolveStoredArea(vnUnits, 'Hà Nội', hcmcOnly.name).ward).toBeNull()
  })
})
