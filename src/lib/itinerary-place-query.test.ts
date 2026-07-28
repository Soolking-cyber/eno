import { describe, expect, it } from 'vitest'
import { placeSearchName } from './itinerary-place-query'
import { isAlternativesName } from './itinerary-place-names'

/**
 * ⚠️ THE CASES BELOW ARE THE REAL PRODUCTION DATA, not invented ones. On 2026-07-28, 23 of 69
 * itinerary stops had no map pin — a third of every plotted trip. Reading the actual names
 * disproved the diagnosis standing in the backlog ("AI-invented names no gazetteer will ever
 * contain"): Tan Son Nhat Airport, Sun World Ba Na Hills and Nguyen Hue Pedestrian Street are all
 * real, famous and indexed. It was the decoration around them that defeated the lookup.
 */

/** Verbatim, from `select place from "ItineraryStop" where lat is null`. */
const PRODUCTION_UNMAPPED = [
  'Cam Thanh Coconut Village', 'Da Nang Coastal Strip', 'Da Nang to Phu Quoc Airport',
  'District 1 Cultural Landmarks', 'Duong Dong Night Market', 'Gam Ghi & May Rut Islands',
  'Hanoi Airport to Da Nang', 'Hoai River Waterfront', 'La Villa French Restaurant',
  'Lan Ha Bay / Cat Ba Island', 'Long Beach Phu Quoc', 'Mekong Delta (Ben Tre Riverways)',
  'Nguyen Hoang Night Market', 'Nguyen Hue Pedestrian Street', 'Phu Quoc to Saigon',
  'Riverside Lodge Ben Tre', 'Social Club Restaurant & Rooftop Bar', 'Sun World Ba Na Hills',
  'Tan Son Nhat Airport (SGN)', 'Thao Dien Wellness Studio', 'The Deck Saigon or Binh An Village',
  'The Summer Experiment', 'Xuan Huong & Dong Khoi Boutiques',
] as const

describe('a journey is not a place, so we never ask', () => {
  it.each(['Da Nang to Phu Quoc Airport', 'Hanoi Airport to Da Nang', 'Phu Quoc to Saigon'])(
    'refuses %s', (name) => expect(placeSearchName(name)).toBeNull(),
  )

  it('declining costs nothing; asking costs a metered lookup', () => {
    // The point of returning null rather than a best-effort string: the daily geocode budget is
    // strict and fail-closed, so a request spent here is one a real place does not get.
    expect(placeSearchName('Hanoi Airport to Da Nang')).toBeNull()
  })

  it('does not mistake a real name that merely contains "to"', () => {
    expect(placeSearchName('Cho Ben Thanh')).toBe('Cho Ben Thanh')
    expect(placeSearchName('Ton That Thiep Street')).toBe('Ton That Thiep Street')
  })
})

describe('decoration is removed, meaning is not', () => {
  it('strips a bracketed annotation', () => {
    expect(placeSearchName('Tan Son Nhat Airport (SGN)')).toBe('Tan Son Nhat Airport')
    expect(placeSearchName('Mekong Delta (Ben Tre Riverways)')).toBe('Mekong Delta')
  })

  it('applies the "both" splitter that until now ran only on the catalogue path', () => {
    // itinerary-places.ts split these; the gazetteer path never did, so a compound that missed the
    // catalogue was handed to the provider whole and failed.
    expect(placeSearchName('Gam Ghi & May Rut Islands')).toBe('Gam Ghi')
    expect(placeSearchName('Xuan Huong & Dong Khoi Boutiques')).toBe('Xuan Huong')
  })

  it('leaves a name that needs no help exactly alone', () => {
    for (const name of ['Sun World Ba Na Hills', 'Nguyen Hue Pedestrian Street', 'Long Beach Phu Quoc', 'Duong Dong Night Market']) {
      expect(placeSearchName(name)).toBe(name)
    }
  })

  it('refuses a fragment too short to identify anything', () => {
    expect(placeSearchName('(SGN)')).toBeNull()
    expect(placeSearchName('')).toBeNull()
    expect(placeSearchName('   ')).toBeNull()
  })
})

describe('⚠️ it must never resolve an "or" — that decision belongs upstream', () => {
  it('does not narrow a choice into one venue', () => {
    // An earlier draft returned 'The Deck Saigon' here. That is the exact bypass
    // itinerary-place-names was written to stop: the itinerary still offers two venues while the
    // map would assert one. geocodePlace refuses these via isAlternativesName BEFORE this runs, and
    // this test pins that this module does not quietly undo it.
    const choice = 'The Deck Saigon or Binh An Village'
    expect(isAlternativesName(choice)).toBe(true)
    expect(placeSearchName(choice)).not.toBe('The Deck Saigon')
  })
})

describe('over the whole production set', () => {
  it('every name either narrows, is refused, or is passed through unchanged — nothing is invented', () => {
    for (const name of PRODUCTION_UNMAPPED) {
      const out = placeSearchName(name)
      if (out === null) continue
      // The only guarantee worth pinning: the output is a SUBSTRING-worth of the input's words,
      // never a word the generator did not write.
      const words = new Set(name.toLowerCase().replace(/[()]/g, ' ').split(/\s+/).filter(Boolean))
      for (const w of out.toLowerCase().split(/\s+/).filter(Boolean)) expect(words.has(w)).toBe(true)
    }
  })

  it('refuses exactly the three transit legs and no more', () => {
    const refused = PRODUCTION_UNMAPPED.filter((n) => placeSearchName(n) === null)
    expect(refused).toEqual(['Da Nang to Phu Quoc Airport', 'Hanoi Airport to Da Nang', 'Phu Quoc to Saigon'])
  })
})
