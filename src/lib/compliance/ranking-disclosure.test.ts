import { describe, it, expect } from 'vitest'
import { RANK } from '@/lib/ranking-formula'
import { browseFactors, searchFactors, FEATURED_BOOST_PCT } from './ranking-disclosure'

// ⚠️ THIS SUITE IS THE COMPLIANCE CONTROL, NOT A UNIT TEST OF ARITHMETIC.
// Law 122/2025/QH15 requires the published ranking parameters to be accurate. The failure mode it
// guards is mundane and inevitable: someone tunes a weight in ranking-formula.ts and nobody
// remembers a public legal page quotes it. This repo has ALREADY had three copies of the ranking
// formula drift apart, so "we'll remember" is disproven. If a weight moves, this goes red and the
// disclosure has to be re-read before the build passes.

describe('ranking disclosure — matches the live formula', () => {
  it('browse weights are exactly the RANK constants', () => {
    const byKey = Object.fromEntries(browseFactors().map((f) => [f.key, f.weightPct]))
    expect(byKey.trust).toBe(Math.round(RANK.BROWSE_TRUST_W * 100))
    expect(byKey.demand).toBe(Math.round(RANK.BROWSE_RELEVANCE_W * 100))
    expect(byKey.recency).toBe(Math.round(RANK.BROWSE_RECENCY_W * 100))
  })

  it('search weights are exactly the RANK constants', () => {
    const byKey = Object.fromEntries(searchFactors().map((f) => [f.key, f.weightPct]))
    expect(byKey.relevance).toBe(Math.round(RANK.SEARCH_REL_W * 100))
    expect(byKey.trust).toBe(Math.round(RANK.SEARCH_TRUST_W * 100))
    expect(byKey.recency).toBe(Math.round(RANK.SEARCH_RECENCY_W * 100))
  })

  // A published set that sums to 99 or 101 reads as sloppy at best and misleading at worst.
  it.each([
    ['browse', browseFactors()],
    ['search', searchFactors()],
  ])('%s percentages sum to exactly 100', (_mode, factors) => {
    expect(factors.reduce((a, f) => a + f.weightPct, 0)).toBe(100)
  })

  // The underlying weights must themselves be a probability distribution. If someone sets
  // BROWSE_TRUST_W to 0.7 without lowering another, the page would silently publish a normalised
  // fiction rather than what the ranker actually does.
  it.each([
    ['browse', [RANK.BROWSE_TRUST_W, RANK.BROWSE_RELEVANCE_W, RANK.BROWSE_RECENCY_W]],
    ['search', [RANK.SEARCH_REL_W, RANK.SEARCH_TRUST_W, RANK.SEARCH_RECENCY_W]],
  ])('%s RANK weights sum to 1.0', (_mode, weights) => {
    expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
  })

  it('every disclosed factor is bilingual and explained', () => {
    for (const f of [...browseFactors(), ...searchFactors()]) {
      // Labels are deliberately short ("Freshness" / "Độ mới") — assert only that they exist.
      // The EXPLANATIONS are what the disclosure obligation actually rests on, so they carry the
      // substantive floor: a one-word "explanation" discloses nothing.
      for (const field of ['labelEn', 'labelVi'] as const) {
        expect(f[field].trim().length, `${f.key}.${field}`).toBeGreaterThan(2)
      }
      for (const field of ['explainEn', 'explainVi'] as const) {
        expect(f[field].trim().length, `${f.key}.${field}`).toBeGreaterThan(40)
      }
    }
  })

  it('discloses the featured boost rather than hiding it inside relevance', () => {
    expect(FEATURED_BOOST_PCT).toBe(Math.round(RANK.FEATURED_BOOST * 100))
    expect(FEATURED_BOOST_PCT).toBeGreaterThan(0)
  })
})
