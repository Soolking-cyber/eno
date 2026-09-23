import { describe, expect, it, vi } from 'vitest'
import vnUnits from '@/data/vn-units.json'
import { matchesProvinceRow, provinceCityAliases, provinceWhere, wardAliases, wardWhere } from './province-match'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/edition-scope', () => ({ scopedListingWhere: async (w: unknown) => w, marketplaceListingScope: async () => ({}) }))
vi.mock('@/lib/serialize', () => ({ LISTING_CARD_SELECT: {}, serializeListingCard: (r: unknown) => r }))
vi.mock('@/lib/translate', () => ({ localizeListingTitles: async (l: unknown) => l }))

import { buildFeedFilters } from '@/app/api/listings/feed-query'
import { matchesProvince } from './facet-counts'

/**
 * ⛔ THE AREA FILTER SENDS vn-units `nameEn`; THE WIZARD AND THE PROPERTY IMPORTS STORE `name`.
 *
 * These are the three strings the explorer puts on the wire for the three cities that carry
 * listings (area-filter.tsx → `params.set('province', activeProvince.nameEn)` in
 * listings-explorer.tsx), read from the dataset rather than retyped, so a dataset edit that renames
 * one fails here first.
 */
const SENT = Object.fromEntries(
  (vnUnits as { code: string; name: string; nameEn: string }[])
    .filter((u) => ['79', '01', '48'].includes(u.code))
    .map((u) => [u.code, { sent: u.nameEn, stored: u.name }]),
)

describe('what the province filter sends', () => {
  it('is the vn-units English name — exactly these three strings', () => {
    expect(SENT['79']).toEqual({ sent: 'Ho Chi Minh', stored: 'Hồ Chí Minh' })
    expect(SENT['01']).toEqual({ sent: 'Ha Noi', stored: 'Hà Nội' })
    expect(SENT['48']).toEqual({ sent: 'Da Nang', stored: 'Đà Nẵng' })
  })
})

describe('the province predicate', () => {
  /**
   * ⛔ THE BUG: 'Hồ Chí Minh'.includes('Ho Chi Minh') is false, so the HCMC filter hid every
   * wizard-posted HCMC listing and the ~98,000 imported ones. Each of these was false before.
   */
  it.each([
    ['Ho Chi Minh', 'Hồ Chí Minh'],
    ['Ha Noi', 'Hà Nội'],
    ['Da Nang', 'Đà Nẵng'],
  ])('%s matches a row stored as %s (the wizard’s and the importers’ spelling)', (sent, stored) => {
    expect(matchesProvinceRow({ city: stored, location: '' }, sent)).toBe(true)
    expect(matchesProvince({ city: stored, location: '' }, sent)).toBe(true)
  })

  it('still matches everything it matched before (the sent string over city OR location)', () => {
    expect(matchesProvinceRow({ city: 'Ho Chi Minh City', location: '' }, 'Ho Chi Minh')).toBe(true)
    expect(matchesProvinceRow({ city: 'Ha Noi', location: '' }, 'Ha Noi')).toBe(true)
    expect(matchesProvinceRow({ city: null, location: 'Quận 1, Ho Chi Minh' }, 'Ho Chi Minh')).toBe(true)
    expect(matchesProvinceRow({ city: 'Hanoi', location: '' }, 'Ha Noi')).toBe(true) // legacy English label
  })

  it('does not widen onto street names: the other spellings are matched against city only', () => {
    // "Xa lộ Hà Nội" is a highway in Thủ Đức, HCMC.
    expect(matchesProvinceRow({ city: 'Hồ Chí Minh', location: '12 Xa lộ Hà Nội, Thủ Đức' }, 'Ha Noi')).toBe(false)
    expect(matchesProvinceRow({ city: 'Hà Nội', location: '' }, 'Ho Chi Minh')).toBe(false)
  })

  it('leaves an unknown value exactly as before — no aliases, the two original clauses', () => {
    expect(provinceCityAliases('Atlantis')).toEqual([])
    expect(provinceWhere('Atlantis')).toEqual({ OR: [{ city: { contains: 'Atlantis' } }, { location: { contains: 'Atlantis' } }] })
    expect(matchesProvinceRow({ city: 'hanoi', location: '' }, 'Atlantis')).toBe(false)
  })

  it('resolves a legacy label (an old saved search) to the same place', () => {
    expect(matchesProvinceRow({ city: 'Hà Nội', location: '' }, 'Hanoi')).toBe(true)
    expect(matchesProvinceRow({ city: 'Hồ Chí Minh', location: '' }, 'Ho Chi Minh City')).toBe(true)
    expect(provinceCityAliases('Hanoi')).toContain('Hà Nội')
  })

  it('is what the feed actually filters on', async () => {
    const { andFilters } = await buildFeedFilters(new URLSearchParams('province=Ho Chi Minh'))
    const clause = andFilters.find((f) => JSON.stringify(f).includes('"city"'))
    expect(clause).toEqual({
      OR: [
        { city: { contains: 'Ho Chi Minh' } },
        { location: { contains: 'Ho Chi Minh' } },
        { city: { contains: 'Hồ Chí Minh' } },
        { city: { contains: 'TP. Hồ Chí Minh' } },
        { city: { contains: 'Ho Chi Minh City' } },
      ],
    })
  })
})

describe('the ward predicate', () => {
  it('matches the Vietnamese ward name the rows carry, within the chosen province', () => {
    expect(wardAliases('Long Phuoc', 'Ho Chi Minh')).toEqual(['Long Phước'])
    expect(wardWhere('Long Phuoc', 'Ho Chi Minh')).toEqual({
      OR: [
        { district: { contains: 'Long Phuoc' } },
        { location: { contains: 'Long Phuoc' } },
        { district: { contains: 'Long Phước' } },
        { location: { contains: 'Long Phước' } },
      ],
    })
  })

  it('matches the other direction too: a Vietnamese ward value picks up the English spelling', () => {
    expect(wardAliases('Long Phước', 'Ho Chi Minh')).toEqual(['Long Phuoc'])
    expect(wardAliases('Long Phuoc', 'Ho Chi Minh City')).toEqual(['Long Phước']) // legacy province label
  })

  it('without a province, adds nothing — ward names repeat across provinces', () => {
    expect(wardAliases('Long Phuoc', null)).toEqual([])
    expect(wardWhere('Long Phuoc')).toEqual({ OR: [{ district: { contains: 'Long Phuoc' } }, { location: { contains: 'Long Phuoc' } }] })
  })

  it('a province with two wards sharing an English name matches both Vietnamese spellings', () => {
    const hcm = (vnUnits as { code: string; wards: { name: string; nameEn: string }[] }[]).find((u) => u.code === '79')!
    const twins = hcm.wards.filter((w) => w.nameEn === 'Thanh An').map((w) => w.name)
    expect(twins.length).toBe(2)
    expect(wardAliases('Thanh An', 'Ho Chi Minh').sort()).toEqual(twins.filter((n) => n !== 'Thanh An').sort())
  })

  it('the in-memory mirror trims like the query does', () => {
    expect(matchesProvinceRow({ city: null, location: 'Quận 1, Ho Chi Minh' }, ' Ho Chi Minh ')).toBe(true)
  })

  it('adds nothing for an unknown ward or a ward of another province', () => {
    expect(wardAliases('Atlantis', 'Ho Chi Minh')).toEqual([])
    expect(wardAliases('Long Phuoc', 'Ha Noi')).toEqual([])
    expect(wardWhere('Atlantis', 'Ho Chi Minh')).toEqual({ OR: [{ district: { contains: 'Atlantis' } }, { location: { contains: 'Atlantis' } }] })
  })

  it('is what the feed actually filters on', async () => {
    const { andFilters } = await buildFeedFilters(new URLSearchParams('province=Ho Chi Minh&ward=Long Phuoc'))
    expect(andFilters).toContainEqual(wardWhere('Long Phuoc', 'Ho Chi Minh'))
    expect(JSON.stringify(andFilters)).toContain('Long Phước')
  })
})
