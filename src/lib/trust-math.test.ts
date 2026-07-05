import { describe, expect, it } from 'vitest'
import {
  TRUST,
  applyDailyCap,
  bayesianRating,
  composeScore,
  conductPenalty,
  credibilityWeight,
  decayFactor,
  dedupeReviewPairs,
  freshnessScore,
  reportsDemote,
  reviewScore,
  severityFromDelta,
  tierFor,
  trackRecordScore,
  verificationScore,
  wilsonLowerBound,
  type TierInputs,
} from './trust-math'

const DAY_MS = 86_400_000

// A fully-clean, fully-qualified seller — tests override the axis under test.
const cleanTier: TierInputs = {
  score: 120,
  transactions365: 20,
  accountAgeDays: 200,
  distinctBuyerReviews: 8,
  responseWilson: 0.9,
  reports90: { count: 0, distinctReporters: 0, scams: 0 },
  reports180: { count: 0, distinctReporters: 0, scams: 0 },
  hasScamHold: false,
}

describe('bayesianRating / reviewScore (IMDb shrinkage)', () => {
  it('pulls tiny samples hard toward the prior', () => {
    // 2 perfect ratings: (5·4.6 + 10) / 7 ≈ 4.71 — well below 5.0
    expect(bayesianRating(10, 2)).toBeCloseTo((5 * 4.6 + 10) / 7, 10)
  })

  it('2×5.0 scores LESS than 200×4.8 (small-n shrinkage + volume ramp)', () => {
    const two50 = reviewScore([{ rating: 5, weight: 1 }, { rating: 5, weight: 1 }])
    const many48 = reviewScore(Array.from({ length: 200 }, () => ({ rating: 4.8, weight: 1 })))
    expect(two50).toBeLessThan(many48)
    expect(two50).toBeLessThan(10) // volume ramp: 2/5 of the quality band at most
    expect(many48).toBeGreaterThan(20)
  })

  it('weights reviews by author credibility (burners barely move it)', () => {
    const trusted = reviewScore(Array.from({ length: 5 }, () => ({ rating: 5, weight: 1 })))
    const burners = reviewScore(Array.from({ length: 5 }, () => ({ rating: 5, weight: 0.25 })))
    expect(burners).toBeLessThan(trusted)
  })

  it('empty input → 0', () => {
    expect(reviewScore([])).toBe(0)
  })
})

describe('wilsonLowerBound (pessimistic response rate)', () => {
  it('3/3 scores below 285/300 — small perfect samples cannot win', () => {
    const small = wilsonLowerBound(3, 3)
    const large = wilsonLowerBound(285, 300)
    expect(small).toBeLessThan(large)
    expect(small).toBeCloseTo(1 / (1 + (1.28 * 1.28) / 3), 6) // closed form at p̂=1
    expect(large).toBeGreaterThan(0.9)
  })

  it('no evidence → 0; never negative', () => {
    expect(wilsonLowerBound(0, 0)).toBe(0)
    expect(wilsonLowerBound(0, 10)).toBeGreaterThanOrEqual(0)
  })
})

describe('decayFactor (per-class half-lives + frozen-scam rule)', () => {
  it('minor halves at 45d, mostly gone at ~3 months', () => {
    expect(decayFactor('minor', 45)).toBeCloseTo(0.5, 10)
    expect(decayFactor('minor', 90)).toBeCloseTo(0.25, 10)
  })

  it('moderate halves at 180d', () => {
    expect(decayFactor('moderate', 180)).toBeCloseTo(0.5, 10)
  })

  it('scam stays FROZEN at 100% regardless of age until 5 clean transactions', () => {
    expect(decayFactor('severe', 1000, { cleanTxAfter: 0, daysSinceFifthCleanTx: null })).toBe(1)
    expect(decayFactor('severe', 1000, { cleanTxAfter: 4, daysSinceFifthCleanTx: null })).toBe(1)
  })

  it('after the 5th clean transaction it decays from THAT moment (H=365)…', () => {
    expect(decayFactor('severe', 2000, { cleanTxAfter: 5, daysSinceFifthCleanTx: 365 })).toBeCloseTo(0.5, 10)
  })

  it('…but never below the permanent 40% floor — time alone never launders fraud', () => {
    expect(decayFactor('severe', 9999, { cleanTxAfter: 50, daysSinceFifthCleanTx: 3650 })).toBe(TRUST.SCAM_FLOOR)
  })
})

describe('conductPenalty', () => {
  it('multiplies severity × credibility × decay and caps at 90', () => {
    // Fresh scam, full-cred reporter: 45 × 1 × 1 = 45.
    expect(conductPenalty([{ severity: 'severe', credibility: 1, ageDays: 0 }])).toBe(45)
    // A burner's minor report, half-decayed: 5 × 0.25 × 0.5 = 0.625.
    expect(conductPenalty([{ severity: 'minor', credibility: 0.25, ageDays: 45 }])).toBeCloseTo(0.625, 10)
    // Three fresh scams: 135 → capped at 90.
    const scams = Array.from({ length: 3 }, () => ({ severity: 'severe' as const, credibility: 1, ageDays: 0 }))
    expect(conductPenalty(scams)).toBe(TRUST.CONDUCT_MAX)
  })
})

describe('credibilityWeight (mini-EigenTrust)', () => {
  it('high-standing verified accounts speak at full weight', () => {
    expect(credibilityWeight({ trustScore: 90, accountAgeDays: 10, falseReportStrikes: 0, kycVerified: true })).toBe(1)
    expect(credibilityWeight({ trustScore: 85, accountAgeDays: 200, falseReportStrikes: 0, kycVerified: false })).toBe(1)
  })

  it('ordinary month-old accounts get 0.6; day-old burners 0.25', () => {
    expect(credibilityWeight({ trustScore: 70, accountAgeDays: 31, falseReportStrikes: 0, kycVerified: false })).toBe(0.6)
    expect(credibilityWeight({ trustScore: 70, accountAgeDays: 1, falseReportStrikes: 0, kycVerified: false })).toBe(0.25)
  })

  it('false-report strikes halve credibility down to the 0.1 floor', () => {
    expect(credibilityWeight({ trustScore: 70, accountAgeDays: 100, falseReportStrikes: 1, kycVerified: false })).toBe(0.25 * 0.5)
    expect(credibilityWeight({ trustScore: 70, accountAgeDays: 100, falseReportStrikes: 5, kycVerified: false })).toBe(0.1)
  })
})

describe('trackRecordScore (log-diminishing T)', () => {
  it('10 sales ≈ 12.5, 100 ≈ 24, capped at 25', () => {
    expect(trackRecordScore(10)).toBeCloseTo(12 * Math.log10(11), 10)
    expect(trackRecordScore(100)).toBeCloseTo(12 * Math.log10(101), 10)
    expect(trackRecordScore(10000)).toBe(25)
    expect(trackRecordScore(0)).toBe(0)
  })
})

describe('verificationScore / freshnessScore / composeScore', () => {
  it('V: phone 10 + KYC 10 + age≥90d 5 = 25 max', () => {
    expect(verificationScore({ phoneVerified: true, kycVerified: true, accountAgeDays: 90 })).toBe(25)
    expect(verificationScore({ phoneVerified: true, kycVerified: false, accountAgeDays: 10 })).toBe(10)
  })

  it('freshness: proportional; no active listings → full marks (not punished)', () => {
    expect(freshnessScore(0, 0)).toBe(5)
    expect(freshnessScore(1, 2)).toBe(2.5)
  })

  it('composite clamps to [0, 150]', () => {
    expect(composeScore({ V: 25, Q: 40, T: 25, C: 0 })).toBe(150)
    expect(composeScore({ V: 0, Q: 0, T: 0, C: 90 })).toBe(0)
    expect(composeScore({ V: 10, Q: 0, T: 0, C: 0 })).toBe(70)
    expect(composeScore({ V: 25, Q: 40, T: 25, C: 0, M: 100 })).toBe(150) // M can't punch through the cap
  })
})

describe('tierFor (volume gates + dual-threshold demotion)', () => {
  it('volume gates: score alone is NOT enough for Trusted/Exceptional', () => {
    expect(tierFor({ ...cleanTier, score: 95, transactions365: 2 })).toBe('standard') // <3 tx → Building
    expect(tierFor({ ...cleanTier, score: 95, transactions365: 3, accountAgeDays: 70 })).toBe('trusted')
    // young account without the review alternative stays Building
    expect(tierFor({ ...cleanTier, score: 95, transactions365: 3, accountAgeDays: 10, distinctBuyerReviews: 0 })).toBe('standard')
    // …but 3 distinct-buyer reviews substitute for age
    expect(tierFor({ ...cleanTier, score: 95, transactions365: 3, accountAgeDays: 10, distinctBuyerReviews: 3 })).toBe('trusted')
  })

  it('Exceptional needs volume + reviews + Wilson ≥0.85 + clean 180d', () => {
    expect(tierFor(cleanTier)).toBe('exceptional')
    expect(tierFor({ ...cleanTier, responseWilson: 0.7 })).toBe('trusted')
    expect(tierFor({ ...cleanTier, transactions365: 9 })).toBe('trusted')
    expect(tierFor({ ...cleanTier, distinctBuyerReviews: 4 })).toBe('trusted')
  })

  it('dual-threshold demotion: one hostile buyer can never sink a seller alone', () => {
    // 1 confirmed report / 1 reporter on 50 tx (2% rate but uncorroborated) → still trusted.
    const oneReport = { count: 1, distinctReporters: 1, scams: 0 }
    expect(tierFor({ ...cleanTier, score: 95, responseWilson: 0.5, reports90: oneReport, reports180: oneReport })).toBe('trusted')
    // 2 reports / 2 reporters on 50 tx (4% > 2%) → demoted to Building.
    const twoReports = { count: 2, distinctReporters: 2, scams: 0 }
    expect(tierFor({ ...cleanTier, score: 95, responseWilson: 0.5, transactions365: 50, reports90: twoReports, reports180: twoReports })).toBe('standard')
    // Same 2 reports on 200 tx (1% ≤ 2%) → rate too low to demote.
    expect(tierFor({ ...cleanTier, score: 95, responseWilson: 0.5, transactions365: 200, reports90: twoReports, reports180: twoReports })).toBe('trusted')
    // Any confirmed scam bypasses the rate test entirely.
    const scam = { count: 1, distinctReporters: 1, scams: 1 }
    expect(reportsDemote(scam, 10000)).toBe(true)
  })

  it('an active (frozen) scam hold is a hard Restricted regardless of score', () => {
    expect(tierFor({ ...cleanTier, hasScamHold: true })).toBe('restricted')
    expect(tierFor({ ...cleanTier, score: 40 })).toBe('restricted')
  })
})

describe('applyDailyCap (anti-gaming rail)', () => {
  it('caps upward movement to +6 per rolling 24h', () => {
    expect(applyDailyCap(80, 95, 0)).toEqual({ score: 86, lift: 6 })
    expect(applyDailyCap(80, 95, 4)).toEqual({ score: 82, lift: 2 })
    expect(applyDailyCap(80, 95, 6)).toEqual({ score: 80, lift: 0 })
    expect(applyDailyCap(80, 83, 0)).toEqual({ score: 83, lift: 3 }) // small rises pass through
  })

  it('NEVER caps downward movement — penalties bite immediately', () => {
    expect(applyDailyCap(80, 40, 0)).toEqual({ score: 40, lift: 0 })
  })
})

describe('dedupeReviewPairs (one counted review per pair per 90d)', () => {
  const t0 = Date.parse('2026-01-01T00:00:00Z')
  it('keeps one review per author per 90d window, oldest-first', () => {
    const kept = dedupeReviewPairs([
      { authorId: 'a', createdAtMs: t0 },
      { authorId: 'a', createdAtMs: t0 + 10 * DAY_MS }, // inside 90d — dropped
      { authorId: 'a', createdAtMs: t0 + 95 * DAY_MS }, // past 90d of the KEPT one — kept
      { authorId: 'b', createdAtMs: t0 + 5 * DAY_MS }, // different buyer — kept
    ])
    expect(kept).toHaveLength(3)
    expect(kept.filter((r) => r.authorId === 'a')).toHaveLength(2)
  })
})

describe('severityFromDelta (legacy v1 ledger mapping)', () => {
  it('maps −3/−10/−25 (v1) and −5/−18/−45 (v2) to classes', () => {
    expect(severityFromDelta(-3)).toBe('minor')
    expect(severityFromDelta(-5)).toBe('minor')
    expect(severityFromDelta(-10)).toBe('moderate')
    expect(severityFromDelta(-18)).toBe('moderate')
    expect(severityFromDelta(-25)).toBe('severe')
    expect(severityFromDelta(-45)).toBe('severe')
  })
})
