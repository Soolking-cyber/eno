import { describe, expect, it } from 'vitest'
import { vietnameseTitlesFirst } from './vehicle-hub-order'

// Reach finding #4 (OpenSEO audit 2026-11-26): the Vietnamese motorbike hub opened on an English all-caps title. Titles as live.
const EN_AD = { id: 'en', title: '🛵 MOTORBIKE RENTAL IN SAIGON – ONLY 100,000 VND / DAY! Cheap Prices | Free Delivery | 24/7' }
const ADV = { id: 'adv', title: 'Cho thuê xe máy Honda ADV 160 (2026)' }
const CB = { id: 'cb', title: 'Cho thuê xe máy Honda CB500X' }
const EN_WITH_VI = { id: 'envi', title: 'Honda Vision for rent', titleVi: 'Cho thuê Honda Vision' }
const EN_PLAIN = { id: 'plain', title: 'Yamaha NVX scooter, monthly rent' }

describe('vietnameseTitlesFirst', () => {
  it('moves the English title behind the Vietnamese ones and keeps each half in its rank order', () => {
    expect(vietnameseTitlesFirst([EN_AD, ADV, EN_PLAIN, CB]).map((l) => l.id)).toEqual(['adv', 'cb', 'en', 'plain'])
  })
  it('an English ad that names one Vietnamese place still counts as English', () => {
    const adWithPlace = { id: 'ad2', title: 'MOTORBIKE RENTAL IN SÀI GÒN – ONLY 100,000 VND / DAY! Cheap Prices | Free Delivery | 24/7' }
    expect(vietnameseTitlesFirst([adWithPlace, ADV]).map((l) => l.id)).toEqual(['adv', 'ad2'])
  })
  it('an authored titleVi counts as Vietnamese', () => {
    expect(vietnameseTitlesFirst([EN_PLAIN, EN_WITH_VI]).map((l) => l.id)).toEqual(['envi', 'plain'])
  })
  it('the same cards, none added or dropped; nothing to move → the order is untouched', () => {
    const all = [EN_AD, ADV, EN_WITH_VI, EN_PLAIN, CB]
    expect([...vietnameseTitlesFirst(all)].sort((a, b) => a.id.localeCompare(b.id))).toEqual([...all].sort((a, b) => a.id.localeCompare(b.id)))
    expect(vietnameseTitlesFirst([ADV, CB])).toEqual([ADV, CB])
    expect(vietnameseTitlesFirst([])).toEqual([])
  })
})
