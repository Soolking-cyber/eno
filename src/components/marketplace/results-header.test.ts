import { describe, expect, it } from 'vitest'
import { resultsForLabel, resultCountLabel } from './result-line'
import { railSwipeSeed } from './shelf'

// A tr() stand-in that picks the language, the way the real one does for en/vi.
const trFor = (lang: 'en' | 'vi') => (en: string, vi?: string) => (lang === 'vi' ? vi ?? en : en)

describe('the results header on a search (E-RESULTS, O-13)', () => {
  it('names the words and groups the number per language', () => {
    expect(resultsForLabel(1204, 'honda', 'en', trFor('en'))).toBe('1,204 results for “honda”')
    expect(resultsForLabel(1204, 'honda', 'vi', trFor('vi'))).toBe('1.204 kết quả cho “honda”')
    expect(resultsForLabel(1, 'sofa', 'en', trFor('en'))).toBe('1 result for “sofa”')
  })

  it('falls back to the plain count when there are no words', () => {
    expect(resultsForLabel(12, '   ', 'en', trFor('en'))).toBe(resultCountLabel(12, 'en', trFor('en')))
  })
})

describe('the server-seeded swipe beam (K-RAIL-PEEK option B, O-18)', () => {
  it('seeds only where the item count must overflow a row (2 phone / 3 sm / 4 lg columns)', () => {
    expect(railSwipeSeed(undefined)).toBeUndefined()
    expect(railSwipeSeed(2)).toBeUndefined()
    expect(railSwipeSeed(3)).toBe('sm')
    expect(railSwipeSeed(4)).toBe('lg')
    expect(railSwipeSeed(12)).toBe('all')
  })
})
