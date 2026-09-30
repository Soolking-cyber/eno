import { describe, expect, it } from 'vitest'
import {
  aptTypeFromTypeLine, factsFromSlug, furnishingFromLine, mergeFacts, nhatotFurnishing, reverAmenities, reverFurnishing,
} from './apartment-classify'

describe('aptTypeFromTypeLine — the composed "Type:" line', () => {
  it('maps each source vocabulary', () => {
    expect(aptTypeFromTypeLine('Serviced / mini apartment')).toBe('serviced')
    expect(aptTypeFromTypeLine('Duplex')).toBe('duplex')
    expect(aptTypeFromTypeLine('Penthouse')).toBe('penthouse')
    expect(aptTypeFromTypeLine('Officetel')).toBe('officetel')
    expect(aptTypeFromTypeLine('Penthouse / duplex')).toBe('penthouse-or-duplex')
  })
  it('names no type for a plain apartment or collective housing', () => {
    expect(aptTypeFromTypeLine('Apartment')).toBeUndefined()
    expect(aptTypeFromTypeLine('Collective housing / residential quarter')).toBeUndefined()
    expect(aptTypeFromTypeLine(null)).toBeUndefined()
  })
})

describe('furnishingFromLine', () => {
  it('maps the three-way field', () => {
    expect(furnishingFromLine('Premium furnished')).toBe('premium')
    expect(furnishingFromLine('Fully furnished')).toBe('fully')
    expect(furnishingFromLine('Unfurnished')).toBe('partly')
    expect(furnishingFromLine('')).toBeUndefined()
  })
})

describe('factsFromSlug — the agency title in the URL', () => {
  it('reads Rever slugs', () => {
    expect(factsFromSlug('https://rever.vn/thue/can-ho-vinhomes-central-park-huong-ban-cong-dong-bac-day-du-noi-that-dien-tich-79-2m2'))
      .toEqual({ furnishing: 'fully', amenities: ['balcony'] })
    // basic FURNITURE is not "Unfurnished" (the label `partly` carries) — left unclassified
    expect(factsFromSlug('https://rever.vn/thue/can-ho-empire-city-thiet-ke-hien-dai-noi-that-co-ban')).toEqual({})
    expect(factsFromSlug('https://rever.vn/thue/can-ho-khong-noi-that-quan-7')).toEqual({ furnishing: 'partly' })
    expect(factsFromSlug('https://rever.vn/thue/can-ho-dich-vu-duong-nguyen-van-thuong-dien-tich-35m2')).toEqual({ aptType: 'serviced' })
  })
  it('reads Honeycomb slugs', () => {
    expect(factsFromSlug('https://honeycomb.com.vn/property/full-furnished-2-beds-apartment-with-open-kitchen-in-the-estella-heights/'))
      .toEqual({ furnishing: 'fully' })
    expect(factsFromSlug('https://honeycomb.com.vn/property/lovely-studio-with-balcony-and-pool-in-thao-dien/'))
      .toEqual({ aptType: 'studio', amenities: ['balcony', 'pool'] })
  })
  it('names nothing when the slug contradicts itself', () => {
    expect(factsFromSlug('https://honeycomb.com.vn/property/duplex-penthouse-river-view/').aptType).toBeUndefined()
  })
  it('refuses negated, nearby and look-alike phrases (second-opinion catches, 2026-09-30)', () => {
    expect(factsFromSlug('https://rever.vn/thue/can-ho-khong-ban-cong-quan-3').amenities).toBeUndefined()
    expect(factsFromSlug('https://rever.vn/thue/can-ho-khong-co-ban-cong-quan-3').amenities).toBeUndefined()
    expect(factsFromSlug('https://rever.vn/thue/can-ho-cam-nuoi-thu-cung').amenities).toBeUndefined()
    expect(factsFromSlug('https://rever.vn/thue/can-ho-khong-nuoi-thu-cung').amenities).toBeUndefined()
    expect(factsFromSlug('https://rever.vn/thue/can-ho-gan-ho-boi-cong-dong').amenities).toBeUndefined()
    expect(factsFromSlug('https://honeycomb.com.vn/property/apartment-near-gym-and-park/').amenities).toBeUndefined()
    expect(factsFromSlug('https://rever.vn/thue/can-ho-gan-ban-cong-an-phuong').amenities).toBeUndefined()
    expect(factsFromSlug('https://rever.vn/thue/xuong-ban-cong-nghiep-quan-12').amenities).toBeUndefined()
    // round 2: a negation three tokens back, "not yet", and the compounds that only LOOK negated
    expect(factsFromSlug('https://rever.vn/thue/can-ho-khong-cho-phep-nuoi-thu-cung').amenities).toBeUndefined()
    expect(factsFromSlug('https://rever.vn/thue/can-ho-khong-duoc-phep-nuoi-thu-cung').amenities).toBeUndefined()
    expect(factsFromSlug('https://rever.vn/thue/can-ho-chua-co-ban-cong').amenities).toBeUndefined()
    expect(factsFromSlug('https://rever.vn/thue/can-ho-khong-gian-ban-cong-rong').amenities).toEqual(['balcony'])
    expect(factsFromSlug('https://rever.vn/thue/can-ho-phong-cach-studio-quan-1').aptType).toBe('studio')
    expect(factsFromSlug('https://rever.vn/thue/cam-ket-can-ho-co-ban-cong').amenities).toEqual(['balcony'])
    // …while the real statement still reads
    expect(factsFromSlug('https://rever.vn/thue/can-ho-co-ban-cong-view-ho-boi').amenities).toEqual(['balcony', 'pool'])
  })
  it('lets premium outrank fully — "đầy đủ nội thất cao cấp" is the commonest premium phrasing', () => {
    expect(factsFromSlug('https://rever.vn/thue/can-ho-day-du-noi-that-cao-cap-quan-2').furnishing).toBe('premium')
    expect(factsFromSlug('https://rever.vn/thue/can-ho-full-noi-that-hoac-khong-noi-that').furnishing).toBeUndefined()
    // "không nội thất cao cấp" = NOT high-end furniture → some furniture, so neither premium nor unfurnished
    expect(factsFromSlug('https://rever.vn/thue/can-ho-khong-noi-that-cao-cap').furnishing).toBeUndefined()
  })
  it('does not read "house in an alley" as unfurnished', () => {
    expect(factsFromSlug('https://rever.vn/thue/nha-trong-hem-xe-hoi-quan-3').furnishing).toBeUndefined()
  })
  it('matches whole words only', () => {
    expect(factsFromSlug('https://rever.vn/thue/can-ho-studios-gymnastic-poolside').amenities).toBeUndefined()
    expect(factsFromSlug('not a url')).toEqual({})
  })
})

describe('reverAmenities — the agent-ticked list', () => {
  it('maps a real, partial list', () => {
    expect(reverAmenities(['Ban công', 'Chỗ đậu xe hơi', 'Hồ bơi riêng', 'Gym', 'Nuôi thú cưng'])).toEqual(['balcony', 'pool', 'gym', 'pets'])
    expect(reverAmenities(['Ban công'])).toEqual(['balcony'])
  })
  it('ignores an everything-ticked list as boilerplate', () => {
    const all = ['Ban công', 'Phòng cho giúp việc', 'Sân vườn', 'Phòng giải trí', 'Chỗ đậu xe hơi', 'Hồ bơi riêng',
      'Quầy minibar', 'Tầng hầm', 'Góc làm việc', 'Nhà kho', 'Nuôi thú cưng', 'Gym']
    expect(reverAmenities(all)).toEqual([])
    expect(reverAmenities([])).toEqual([])
  })
})

describe('reverFurnishing — the meta-description bullet', () => {
  it('reads the bullet, accented', () => {
    expect(reverFurnishing('• Diện tích: 74 m² • Nội thất cơ bản • Pháp lý: HĐ mua bán')).toBeUndefined() // basic ≠ unfurnished
    expect(reverFurnishing('• Nhà trống')).toBe('partly')
    expect(reverFurnishing('• Đầy đủ nội thất')).toBe('fully')
    expect(reverFurnishing('• Đầy đủ nội thất cao cấp')).toBe('premium')
    expect(reverFurnishing('• Nội thất cao cấp')).toBe('premium')
    expect(reverFurnishing('• Nhà trong hẻm')).toBeUndefined()
  })
})

describe('nhatotFurnishing — "Tình trạng nội thất"', () => {
  it('maps the four Nhà Tốt values', () => {
    expect(nhatotFurnishing('Nội thất cao cấp')).toBe('premium')
    expect(nhatotFurnishing('Nội thất đầy đủ')).toBe('fully')
    expect(nhatotFurnishing('Hoàn thiện cơ bản')).toBe('partly')
    expect(nhatotFurnishing('Bàn giao thô')).toBe('partly')
    expect(nhatotFurnishing('Nội thất cơ bản')).toBeUndefined()
    expect(nhatotFurnishing(undefined)).toBeUndefined()
  })
})

describe('mergeFacts', () => {
  it('keeps the first statement of a field and unions amenities', () => {
    expect(mergeFacts({ aptType: 'duplex', amenities: ['balcony'] }, { aptType: 'penthouse', furnishing: 'fully', amenities: ['pool'] }))
      .toEqual({ aptType: 'duplex', furnishing: 'fully', amenities: ['balcony', 'pool'] })
    expect(mergeFacts({}, {})).toEqual({})
  })
})
